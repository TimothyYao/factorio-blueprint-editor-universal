import { Ticker } from 'pixi.js'
import G from '../common/globals'
import { Entity } from '../core/Entity'
import {
    PLANNER_NODE_BUDGET,
    RailPlanner,
    cycleHeading,
    isGroundRailName,
    snapIdlePose,
    snapToRails,
    successors,
    type RailPiece,
    type RailPose,
} from '../core/rails'
import { EntitySprite } from './EntitySprite'
import { PaintContainer } from './PaintContainer'
import { BlueprintContainer } from './BlueprintContainer'

/**
 * Factorio-like rail planner cursor. Idle: one straight ghost. Planning: a
 * bidirectional A* path that steps 200 nodes per frame (FFF-113) and lingers
 * until Place / a second click (mobile) or mouse-up after a drag (desktop).
 */
export class PaintRailContainer extends PaintContainer {
    private heading: number
    private start: RailPose | undefined
    private goal: RailPose | undefined
    private readonly planner = new RailPlanner()
    private pieces: RailPiece[] = []
    /** True once the pointer moved after beginPlan — desktop treats that as a drag-commit. */
    public movedSinceBegin = false
    private readonly onTick = (_ticker: Ticker): void => {
        if (!this.start || this.planner.complete) return
        this.planner.step(PLANNER_NODE_BUDGET)
        this.pieces = this.planner.bestPieces ?? []
        this.redraw()
        this.updateBlocked()
    }

    public constructor(bpc: BlueprintContainer, _name: string, direction: number) {
        super(bpc, 'straight-rail')
        this.heading = [0, 2, 4, 6, 8, 10, 12, 14].includes(direction) ? direction : 0
        this.attachUpdateOn16()
        G.app.ticker.add(this.onTick)
        this.on('destroyed', () => {
            G.app.ticker.remove(this.onTick)
        })
        this.moveAtCursor()
        this.redraw()
    }

    public get isPlanning(): boolean {
        return this.start !== undefined
    }

    public get hasCompletePath(): boolean {
        return this.planner.complete && (this.pieces.length > 0 || this.start !== undefined)
    }

    public getPlanState(): {
        active: boolean
        pieceCount: number
        complete: boolean
        start: { x: number; y: number; dir: number } | null
        goal: { x: number; y: number; dir: number } | null
    } {
        return {
            active: this.isPlanning,
            pieceCount: this.pieces.length,
            complete: this.planner.complete,
            start: this.start ? { x: this.start.x, y: this.start.y, dir: this.start.dir } : null,
            goal: this.goal ? { x: this.goal.x, y: this.goal.y, dir: this.goal.dir } : null,
        }
    }

    public getHeading(): number {
        return this.goal?.dir ?? this.heading
    }

    public override getGridPosition(): { x: number; y: number } {
        if (this.pieces[0]) return { ...this.pieces[0].position }
        if (this.start) return { x: this.start.x, y: this.start.y }
        return super.getGridPosition()
    }

    public override getItemName(): string {
        return Entity.getItemName('straight-rail')
    }

    public override containsWorldPoint(x: number, y: number): boolean {
        return this.worldBoundsContain(x, y)
    }

    public override rotate(ccw = false): void {
        if (!this.visible && !this.isPlanning) return
        if (this.isPlanning) {
            if (!this.goal) return
            this.goal = { ...this.goal, dir: cycleHeading(this.goal.dir, ccw) }
            this.replan()
        } else {
            this.heading = cycleHeading(this.heading, ccw)
            this.moveAtCursor()
        }
    }

    public override canFlipOrRotateByCopying(): boolean {
        return false
    }

    public override rotatedEntities(_ccw?: boolean): Entity[] {
        return undefined
    }

    public override flippedEntities(_vertical: boolean): Entity[] {
        return undefined
    }

    public beginPlan(): void {
        this.start = this.poseAtCursor(this.heading)
        this.goal = { ...this.start }
        this.movedSinceBegin = false
        this.pieces = []
        this.show()
        this.replan()
    }

    public cancelPlan(): void {
        this.start = undefined
        this.goal = undefined
        this.pieces = []
        this.movedSinceBegin = false
        this.moveAtCursor()
    }

    public override moveAtCursor(): void {
        if (this.isPlanning) {
            const next = this.poseAtCursor(this.goal?.dir ?? this.heading)
            if (
                this.goal &&
                next.x === this.goal.x &&
                next.y === this.goal.y &&
                next.dir === this.goal.dir
            ) {
                return
            }
            this.goal = next
            this.movedSinceBegin = true
            this.replan()
            return
        }
        if (!this.visible) return
        const pose = this.poseAtCursor(this.heading)
        const idle = successors(pose).find(s => s.move === 'straight')
        this.pieces = idle ? idle.pieces : []
        this.redraw()
        this.updateBlocked()
    }

    public override removeContainerUnder(): void {
        if (!this.visible) return
        for (const piece of this.pieces) {
            const ents = this.bpc.bp.entityPositionGrid.getEntitiesInArea({
                x: piece.position.x,
                y: piece.position.y,
                w: 2,
                h: 2,
            })
            this.bpc.bp.removeEntities(ents.filter(e => isGroundRailName(e.name)))
        }
        this.updateBlocked()
    }

    public override placeEntityContainer(): void {
        if (this.isPlanning) {
            this.commitPlan()
            return
        }
        this.commitPieces(this.pieces)
        this.moveAtCursor()
    }

    /** Stamp the current complete plan and return to idle (rail stays in hand). */
    public commitPlan(): boolean {
        if (!this.isPlanning) return false
        if (!this.planner.complete || this.pieces.length === 0) return false
        const ok = this.commitPieces(this.pieces)
        this.cancelPlan()
        return ok
    }

    private commitPieces(pieces: RailPiece[]): boolean {
        if (pieces.length === 0) return false
        this.bpc.bp.history.startTransaction('Place rails')
        let placed = 0
        for (const piece of pieces) {
            if (this.alreadyThere(piece)) continue
            if (
                !this.bpc.bp.entityPositionGrid.isAreaAvailable(
                    piece.name,
                    piece.position,
                    piece.direction
                )
            ) {
                continue
            }
            this.bpc.bp.createEntity(
                { name: piece.name, position: piece.position, direction: piece.direction },
                true
            )
            placed += 1
        }
        this.bpc.bp.history.commitTransaction()
        return placed > 0
    }

    private replan(): void {
        if (!this.start || !this.goal) return
        this.planner.begin(this.start, this.goal, p => this.canPlacePiece(p))
        this.planner.step(PLANNER_NODE_BUDGET)
        this.pieces = this.planner.bestPieces ?? []
        this.redraw()
        this.updateBlocked()
    }

    private poseAtCursor(dir: number): RailPose {
        const cursor = {
            x: this.bpc.gridData.x / 32,
            y: this.bpc.gridData.y / 32,
        }
        const rails: RailPiece[] = []
        for (const [, e] of this.bpc.bp.entities) {
            if (isGroundRailName(e.name)) {
                rails.push({ name: e.name, position: e.position, direction: e.direction })
            }
        }
        const snapped = snapToRails(rails, cursor, dir)
        if (snapped) return { ...snapped, dir: snapped.dir }
        const first = this.bpc.bp.getFirstRailRelatedEntityPos()
        return snapIdlePose(cursor, dir, first)
    }

    private canPlacePiece(piece: RailPiece): boolean {
        if (this.alreadyThere(piece)) return true
        return this.bpc.bp.entityPositionGrid.isAreaAvailable(
            piece.name,
            piece.position,
            piece.direction
        )
    }

    private alreadyThere(piece: RailPiece): boolean {
        const hits = this.bpc.bp.entityPositionGrid.getEntitiesInArea({
            x: piece.position.x,
            y: piece.position.y,
            w: 0.1,
            h: 0.1,
        })
        return hits.some(
            e =>
                e.name === piece.name &&
                e.direction === piece.direction &&
                e.position.x === piece.position.x &&
                e.position.y === piece.position.y
        )
    }

    private updateBlocked(): void {
        if (this.isPlanning && !this.planner.complete) {
            this.blocked = this.pieces.length === 0
            return
        }
        const selfHit = this.pathHitsItself(this.pieces)
        const blocked = this.pieces.some(p => !this.canPlacePiece(p)) || selfHit
        this.blocked = blocked || (this.isPlanning && this.pieces.length === 0)
    }

    private pathHitsItself(pieces: RailPiece[]): boolean {
        const seen = new Set<string>()
        for (const p of pieces) {
            const k = `${p.name}@${p.position.x},${p.position.y},${p.direction}`
            if (seen.has(k)) return true
            seen.add(k)
        }
        return false
    }

    protected override redraw(): void {
        this.removeChildren()
        // World-space sprites: the container sits at the origin so piece
        // positions are absolute (the path isn't a cursor-relative stamp).
        this.position.set(0, 0)
        for (const piece of this.pieces) {
            const sprites = EntitySprite.getParts(
                {
                    name: piece.name,
                    direction: piece.direction,
                    position: piece.position,
                    railLayer: 'ground',
                },
                { x: piece.position.x * 32, y: piece.position.y * 32 }
            )
            this.addChild(...sprites)
        }
    }
}
