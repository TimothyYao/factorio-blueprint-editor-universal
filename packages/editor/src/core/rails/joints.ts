/**
 * Factorio 2.0 ground-rail joint geometry.
 *
 * A pose is a connection point (integer tiles) plus a 16-way heading. Each
 * rail piece has two ends; the planner expands a pose by placing a piece whose
 * *inward* end matches it (FFF-113: only straight / left / right).
 *
 * Control points follow FFF-377's r≈13 90° curve: a right turn from north
 * visits (0,0) → (1,-5) → (4,-9) → (8,-12) → (13,-13). Left is the X-mirror.
 * 90° rotation (y-down, clockwise = +4 direction) generates the other headings.
 *
 * `layer` is carried so elevated successors can plug in later without a
 * rewrite; v1 always emits `ground`.
 */

export type RailLayer = 'ground' | 'elevated'

export type RailMove = 'straight' | 'left' | 'right'

export interface RailPose {
    x: number
    y: number
    dir: number
    layer: RailLayer
}

export interface RailPiece {
    name: string
    position: { x: number; y: number }
    direction: number
}

export interface RailSuccessor {
    pose: RailPose
    pieces: RailPiece[]
    cost: number
    move: RailMove
}

interface RailEnd {
    dx: number
    dy: number
    /** Outward heading (the direction you *leave* this end). */
    outDir: number
}

interface OrientedPiece {
    name: string
    direction: number
    ends: [RailEnd, RailEnd]
    /** Planner cost (tile-ish length + curve penalty). */
    cost: number
}

const STRAIGHT_COST = 2
const HALF_DIAG_COST = 4
const CURVE_COST = 5.5 // extra_planner_penalty 0.5 on ~5-tile chords

/** 90° clockwise in Factorio's y-down grid: (x,y) → (-y, x), dir += 4. */
function rot90End(e: RailEnd): RailEnd {
    return { dx: -e.dy, dy: e.dx, outDir: (e.outDir + 4) % 16 }
}

function rot90Piece(p: OrientedPiece): OrientedPiece {
    return {
        name: p.name,
        direction: (p.direction + 4) % 16,
        ends: [rot90End(p.ends[0]), rot90End(p.ends[1])],
        cost: p.cost,
    }
}

function mirrorXEnd(e: RailEnd): RailEnd {
    // Mirror over Y (x → -x). Outward dir: 0 stays, 4↔12, 1↔15, 2↔14, …
    return { dx: -e.dx, dy: e.dy, outDir: (16 - e.outDir) % 16 }
}

function mirrorXPiece(p: OrientedPiece): OrientedPiece {
    return {
        name: p.name,
        // Chiral curves: the left-hand family is a distinct 8-way picture
        // (north-right = 0, north-left = 14, then +4).
        direction: (14 - (p.direction % 16) + 16) % 16,
        ends: [mirrorXEnd(p.ends[0]), mirrorXEnd(p.ends[1])],
        cost: p.cost,
    }
}

function spin4(p: OrientedPiece): OrientedPiece[] {
    const out = [p]
    let cur = p
    for (let i = 0; i < 3; i++) {
        cur = rot90Piece(cur)
        out.push(cur)
    }
    return out
}

/**
 * Canonical pieces, then 90° copies. A/B curves also get their left-hand
 * (X-mirrored) family so all 8 entity directions exist.
 */
function buildCatalog(): OrientedPiece[] {
    const straightNS: OrientedPiece = {
        name: 'straight-rail',
        direction: 0,
        ends: [
            { dx: 0, dy: -1, outDir: 0 },
            { dx: 0, dy: 1, outDir: 8 },
        ],
        cost: STRAIGHT_COST,
    }
    const straightNE: OrientedPiece = {
        name: 'straight-rail',
        direction: 2,
        ends: [
            { dx: 1, dy: -1, outDir: 2 },
            { dx: -1, dy: 1, outDir: 10 },
        ],
        cost: STRAIGHT_COST,
    }

    // Half-diagonal heading 1 (NNE): 2 east, 4 north.
    const halfNNE: OrientedPiece = {
        name: 'half-diagonal-rail',
        direction: 0,
        ends: [
            { dx: 1, dy: -2, outDir: 1 },
            { dx: -1, dy: 2, outDir: 9 },
        ],
        cost: HALF_DIAG_COST,
    }
    // Heading 3 (ENE): 4 east, 2 north.
    const halfENE: OrientedPiece = {
        name: 'half-diagonal-rail',
        direction: 2,
        ends: [
            { dx: 2, dy: -1, outDir: 3 },
            { dx: -2, dy: 1, outDir: 11 },
        ],
        cost: HALF_DIAG_COST,
    }

    // Curved-A, right from north (dir 0 → 1). Entity at (1,-2) in the
    // origin-at-south-joint frame; ends relative to that center.
    const curveARight: OrientedPiece = {
        name: 'curved-rail-a',
        direction: 0,
        ends: [
            { dx: -1, dy: 2, outDir: 8 },
            { dx: 0, dy: -3, outDir: 1 },
        ],
        cost: CURVE_COST,
    }

    // Curved-B, right from NNE (dir 1 → 2).
    const curveBRight: OrientedPiece = {
        name: 'curved-rail-b',
        direction: 2,
        ends: [
            { dx: -2, dy: 2, outDir: 9 },
            { dx: 1, dy: -2, outDir: 2 },
        ],
        cost: CURVE_COST,
    }

    return [
        ...spin4(straightNS),
        ...spin4(straightNE),
        ...spin4(halfNNE),
        ...spin4(halfENE),
        ...spin4(curveARight),
        ...spin4(mirrorXPiece(curveARight)),
        ...spin4(curveBRight),
        ...spin4(mirrorXPiece(curveBRight)),
    ]
}

const CATALOG = buildCatalog()

export function poseKey(p: RailPose): string {
    return `${p.x},${p.y},${p.dir},${p.layer}`
}

export function reversePose(p: RailPose): RailPose {
    return { x: p.x, y: p.y, dir: (p.dir + 8) % 16, layer: p.layer }
}

export function posesEqual(a: RailPose, b: RailPose): boolean {
    return a.x === b.x && a.y === b.y && a.dir === b.dir && a.layer === b.layer
}

function classifyMove(inDir: number, outDir: number): RailMove {
    const delta = (outDir - inDir + 16) % 16
    if (delta === 0) return 'straight'
    if (delta === 1 || delta === 2) return 'right'
    if (delta === 15 || delta === 14) return 'left'
    // Larger heading jumps still count as a turn; pick the short arc.
    return delta <= 8 ? 'right' : 'left'
}

/**
 * All legal one-piece extensions from `from`. `canPlace` rejects a successor
 * when any of its pieces collide with the existing blueprint (not with other
 * pieces of the same path).
 */
export function successors(
    from: RailPose,
    canPlace?: (piece: RailPiece) => boolean
): RailSuccessor[] {
    if (from.layer !== 'ground') return []
    const out: RailSuccessor[] = []
    const seen = new Set<string>()

    for (const piece of CATALOG) {
        for (let i = 0; i < 2; i++) {
            const enter = piece.ends[i]
            if (enter.outDir !== (from.dir + 8) % 16) continue
            const leave = piece.ends[1 - i]
            const entityPos = { x: from.x - enter.dx, y: from.y - enter.dy }
            const placed: RailPiece = {
                name: piece.name,
                position: entityPos,
                direction: piece.direction,
            }
            if (canPlace && !canPlace(placed)) continue
            const pose: RailPose = {
                x: entityPos.x + leave.dx,
                y: entityPos.y + leave.dy,
                dir: leave.outDir,
                layer: from.layer,
            }
            const move = classifyMove(from.dir, pose.dir)
            const id = `${poseKey(pose)}|${placed.name}|${placed.position.x},${placed.position.y}`
            if (seen.has(id)) continue
            seen.add(id)
            out.push({ pose, pieces: [placed], cost: piece.cost, move })
        }
    }
    return out
}

/** The two poses (outward) of a placed rail, for snapping onto existing track. */
export function jointsOf(piece: RailPiece): RailPose[] {
    const row = CATALOG.find(p => p.name === piece.name && p.direction === piece.direction)
    if (!row) return []
    return row.ends.map(e => ({
        x: piece.position.x + e.dx,
        y: piece.position.y + e.dy,
        dir: e.outDir,
        layer: 'ground' as const,
    }))
}

const PLANNER_TYPES = new Set([
    'straight-rail',
    'half-diagonal-rail',
    'curved-rail-a',
    'curved-rail-b',
])

export function isGroundRailName(name: string): boolean {
    return PLANNER_TYPES.has(name)
}

/**
 * Nearest joint of an existing ground rail to a world tile, preferring a
 * heading close to `preferDir` when given.
 */
export function snapToRails(
    rails: { name: string; position: { x: number; y: number }; direction: number }[],
    cursor: { x: number; y: number },
    preferDir?: number,
    maxDist = 4
): RailPose | undefined {
    const score = (dist: number, dirDelta: number): number => {
        // Prefer a joint that already faces our heading when we're close —
        // nearest-only would pick the back of a stub and start a new island.
        if (preferDir !== undefined && dist <= 3 && dirDelta <= 2) return dirDelta * 10 + dist
        return 1000 + dist * 10 + dirDelta
    }
    let best: { pose: RailPose; dist: number; dirDelta: number } | undefined
    for (const r of rails) {
        if (!isGroundRailName(r.name)) continue
        for (const pose of jointsOf(r)) {
            const dist = Math.abs(pose.x - cursor.x) + Math.abs(pose.y - cursor.y)
            const dirDelta =
                preferDir === undefined
                    ? 0
                    : Math.min((pose.dir - preferDir + 16) % 16, (preferDir - pose.dir + 16) % 16)
            if (!best || score(dist, dirDelta) < score(best.dist, best.dirDelta)) {
                best = { pose, dist, dirDelta }
            }
        }
    }
    if (!best || best.dist > maxDist) return undefined
    return best.pose
}

/** Even/odd 2-tile snap for an idle cursor, matching existing rail parity. */
export function snapIdlePose(
    cursor: { x: number; y: number },
    dir: number,
    firstRail?: { x: number; y: number }
): RailPose {
    const h = ((dir % 16) + 16) % 16

    const px = firstRail ? firstRail.x : 1
    const py = firstRail ? firstRail.y : 1
    const snapParity = (v: number, parity: number): number => {
        const r = Math.round(v)
        return Math.abs(r) % 2 === Math.abs(parity) % 2 ? r : r + (r >= v ? -1 : 1)
    }
    const ent = {
        x: snapParity(cursor.x, px),
        y: snapParity(cursor.y, py),
    }
    const dummy = { name: 'straight-rail', position: ent, direction: h % 2 === 0 ? h : 0 }
    if (h % 2 === 0) {
        const front = jointsOf(dummy).find(j => j.dir === h)
        if (front) return front
    }
    return { x: ent.x, y: ent.y, dir: h, layer: 'ground' }
}

export function cycleHeading(dir: number, ccw = false): number {
    // 8-way even headings for the idle straight ghost; planning then uses
    // odd headings via curves/half-diags.
    const even = [0, 2, 4, 6, 8, 10, 12, 14]
    const i = even.indexOf(((dir % 16) + 16) % 16)
    const idx = i < 0 ? 0 : i
    return even[(idx + (ccw ? 7 : 1)) % 8]
}

/**
 * 16-way heading from a world-space delta (Factorio y-down: 0 is north,
 * clockwise). Used so a drag's goal faces along the pointer, not the
 * start heading — otherwise a circular sweep keeps asking for "arrive
 * facing north" and the search drops isolated stubs.
 */
export function headingFromDelta(dx: number, dy: number): number {
    if (dx === 0 && dy === 0) return 0
    const a = Math.atan2(dx, -dy)
    const step = Math.PI / 8
    return ((Math.round(a / step) % 16) + 16) % 16
}
