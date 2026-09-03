/**
 * Bidirectional A* rail planner (FFF-113).
 *
 * Nodes are poses (position + direction + layer). Expansion is only
 * straight/left/right via {@link successors}. Work is capped at
 * {@link PLANNER_NODE_BUDGET} expansions per {@link RailPlanner.step} so a
 * frame of ghost updates matches the game's 200-nodes-per-tick budget; the
 * search tree is reused across frames while the start pose is unchanged.
 */

import {
    poseKey,
    posesEqual,
    reversePose,
    successors,
    type RailPiece,
    type RailPose,
    type RailSuccessor,
} from './joints'

/** FFF-113: "limit the path finder to do 200 nodes per tick". */
export const PLANNER_NODE_BUDGET = 200

/** Give up after this many lifetime expansions (~100 frames at 200/tick). */
export const PLANNER_LIFETIME_BUDGET = 20_000

/** Extra expansions after the first meeting so a wiggly first hit can lose. */
const POST_MEET_BUDGET = 200

interface SearchNode {
    pose: RailPose
    g: number
    parent?: SearchNode
    via?: RailSuccessor
}

function heuristic(a: RailPose, b: RailPose): number {
    const dx = a.x - b.x
    const dy = a.y - b.y
    // Straight step is 2 tiles / cost 2, so euclidean is an admissible-ish scale.
    return Math.sqrt(dx * dx + dy * dy)
}

function reconstructForward(n: SearchNode): RailPiece[] {
    const pieces: RailPiece[] = []
    let cur: SearchNode | undefined = n
    while (cur?.via) {
        pieces.push(...cur.via.pieces)
        cur = cur.parent
    }
    pieces.reverse()
    return pieces
}

function reconstructBackward(n: SearchNode): RailPiece[] {
    // Backward nodes walk from the goal toward the meet; `via.pieces` were
    // placed going *away* from the meet (toward the goal), so keep order.
    const pieces: RailPiece[] = []
    let cur: SearchNode | undefined = n
    while (cur?.via) {
        pieces.push(...cur.via.pieces)
        cur = cur.parent
    }
    return pieces
}

export type PlaceFn = (piece: RailPiece) => boolean

export class RailPlanner {
    private start: RailPose | undefined
    private goal: RailPose | undefined
    private canPlace: PlaceFn | undefined

    private fwdOpen: SearchNode[] = []
    private bwdOpen: SearchNode[] = []
    private fwdBest = new Map<string, SearchNode>()
    private bwdBest = new Map<string, SearchNode>()

    private bestMeet: { cost: number; pieces: RailPiece[] } | undefined
    private postMeetLeft = 0
    private lifetime = 0
    private finished = false

    public get complete(): boolean {
        return this.finished
    }

    public get bestPieces(): RailPiece[] | undefined {
        return this.bestMeet?.pieces
    }

    public get expansions(): number {
        return this.lifetime
    }

    public begin(start: RailPose, goal: RailPose, canPlace?: PlaceFn): void {
        const startChanged = !this.start || !posesEqual(this.start, start)
        const goalChanged = !this.goal || !posesEqual(this.goal, goal)
        this.canPlace = canPlace
        this.goal = { ...goal }
        if (startChanged) {
            this.start = { ...start }
            this.lifetime = 0
            this.resetTrees()
        } else if (goalChanged) {
            this.resetBackward()
        }
        this.finished = false
        this.bestMeet = undefined
        this.postMeetLeft = 0
        if (posesEqual(start, goal)) {
            this.bestMeet = { cost: 0, pieces: [] }
            this.finished = true
        }
    }

    public step(budget = PLANNER_NODE_BUDGET): RailPiece[] | undefined {
        if (this.finished) return this.bestMeet?.pieces
        if (!this.start || !this.goal) return undefined

        let left = budget
        while (left > 0 && !this.finished) {
            if (this.lifetime >= PLANNER_LIFETIME_BUDGET) {
                this.finished = true
                break
            }
            if (this.fwdOpen.length === 0 && this.bwdOpen.length === 0) {
                this.finished = true
                break
            }
            // Alternate fronts, skipping an empty one.
            const goFwd = this.fwdOpen.length > 0 && (this.bwdOpen.length === 0 || left % 2 === 0)
            if (goFwd) this.expandFront(true)
            else this.expandFront(false)
            left -= 1
            this.lifetime += 1
            if (this.bestMeet && this.postMeetLeft <= 0) {
                this.finished = true
            }
        }
        return this.bestMeet?.pieces
    }

    private resetTrees(): void {
        this.fwdBest = new Map()
        this.bwdBest = new Map()
        const f0: SearchNode = { pose: this.start!, g: 0 }
        this.fwdBest.set(poseKey(this.start!), f0)
        this.fwdOpen = [f0]
        this.resetBackward()
    }

    private resetBackward(): void {
        this.bwdBest = new Map()
        const g0: SearchNode = { pose: reversePose(this.goal!), g: 0 }
        this.bwdBest.set(poseKey(g0.pose), g0)
        this.bwdOpen = [g0]
        this.finished = false
        this.bestMeet = undefined
        this.postMeetLeft = 0
    }

    private expandFront(forward: boolean): void {
        const open = forward ? this.fwdOpen : this.bwdOpen
        const best = forward ? this.fwdBest : this.bwdBest
        const other = forward ? this.bwdBest : this.fwdBest
        const target = forward ? reversePose(this.goal!) : reversePose(this.start!)

        if (open.length === 0) return
        let bestI = 0
        let bestF = open[0].g + heuristic(open[0].pose, target)
        for (let i = 1; i < open.length; i++) {
            const f = open[i].g + heuristic(open[i].pose, target)
            if (f < bestF) {
                bestF = f
                bestI = i
            }
        }
        const [node] = open.splice(bestI, 1)
        const recorded = best.get(poseKey(node.pose))
        if (recorded && recorded !== node && recorded.g < node.g) return

        for (const suc of successors(node.pose, this.canPlace)) {
            const g = node.g + suc.cost
            const key = poseKey(suc.pose)
            const prev = best.get(key)
            if (prev && prev.g <= g) continue
            const child: SearchNode = { pose: suc.pose, g, parent: node, via: suc }
            best.set(key, child)
            open.push(child)

            const meet = other.get(poseKey(reversePose(suc.pose)))
            if (meet) this.considerMeet(forward ? child : meet, forward ? meet : child)
        }

        if (this.bestMeet) this.postMeetLeft -= 1
    }

    private considerMeet(fwd: SearchNode, bwd: SearchNode): void {
        const cost = fwd.g + bwd.g
        if (this.bestMeet && cost >= this.bestMeet.cost) return
        const pieces = [...reconstructForward(fwd), ...reconstructBackward(bwd)]
        this.bestMeet = { cost, pieces }
        if (this.postMeetLeft <= 0) this.postMeetLeft = POST_MEET_BUDGET
    }
}
