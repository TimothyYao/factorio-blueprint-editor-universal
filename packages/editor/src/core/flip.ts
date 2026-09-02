import { IPoint } from '../types'

/**
 * Factorio 2.0 16-way direction after a horizontal (`vertical === false`) or
 * vertical flip. Cardinals:
 *   0 north, 4 east, 8 south, 12 west.
 *
 * Horizontal (mirror over the Y axis): N/S stay, E↔W.
 * Vertical   (mirror over the X axis): E/W stay, N↔S.
 */
export function flipDirection(direction: number, vertical: boolean): number {
    const axisDir = vertical ? 12 : 8
    return (((axisDir * 2 - (direction % 16)) % 16) + 16) % 16
}

/** Mirror a point about the origin on the given axis. */
export function flipPoint(point: IPoint, vertical: boolean): IPoint {
    return vertical ? { x: point.x, y: -point.y } : { x: -point.x, y: point.y }
}

/**
 * Rotate a point 90° about the origin. `ccw` matches `Entity.getRotatedCopy`.
 */
export function rotatePoint(point: IPoint, ccw: boolean): IPoint {
    return ccw ? { x: point.y, y: -point.x } : { x: -point.y, y: point.x }
}

/**
 * Clamp a candidate direction onto an entity's `possibleRotations`. Empty
 * means not rotatable → Factorio stores direction 0. The 8↔0 / 12↔4 aliases
 * cover two-direction buildings (`two_direction_only`).
 */
export function constrainToPossibleDirections(
    current: number,
    next: number,
    possible: number[]
): number {
    if (possible.length === 0) return 0
    if (possible.includes(next)) return next
    if (next === 8 && possible.includes(0)) return 0
    if (next === 12 && possible.includes(4)) return 4
    return current
}

/**
 * Whether a flip at `directionAfterFlip` should swap a splitter's left/right
 * priorities. Same rule the game uses: a flip along the belt's travel axis
 * swaps lanes; a flip across it does not.
 */
export function flipSwapsSplitterPriority(directionAfterFlip: number, vertical: boolean): boolean {
    return (
        (vertical && (directionAfterFlip === 4 || directionAfterFlip === 8)) ||
        (!vertical && (directionAfterFlip === 0 || directionAfterFlip === 12))
    )
}

/**
 * Duck-typed prototype fields used to decide whether H/V should toggle the
 * blueprint `mirror` bit (and pick `graphics_set_flipped` when present).
 *
 * Space Age 2.0 census (live `space-age` dump):
 *   Dedicated flipped sheets: **recycler** (`graphics_set_flipped` /
 *   `circuit_connector_flipped`, drop vector x=-0.5).
 *   Geometric sprite mirror (same `graphics_set`, scale.x *= -1):
 *   chemical-plant, oil-refinery, foundry, biochamber, cryogenic-plant,
 *   electromagnetic-plant (`forced_symmetry: horizontal`), boiler,
 *   heat-exchanger, fusion-generator, fusion-reactor.
 *   Explicitly *not* mirrored this way: belts/inserters (direction only),
 *   pipes/pumps/valves, pumpjack, steam-engine (connections on the axis).
 */
export interface MirrorProto {
    type?: string
    use_mirroring?: boolean
    forced_symmetry?: string
    graphics_set_flipped?: unknown
    circuit_connector_flipped?: unknown
    vector_to_place_result?: readonly number[]
    fluid_boxes?: ReadonlyArray<FluidBoxLike>
    /** Boiler / heat-exchanger */
    fluid_box?: FluidBoxLike
    /** Fusion generator / reactor */
    input_fluid_box?: FluidBoxLike
    output_fluid_box?: FluidBoxLike
}

interface FluidBoxLike {
    production_type?: string
    pipe_connections?: ReadonlyArray<{
        position?: { x: number; y: number } | readonly number[]
    }>
}

/** True when the dump ships a separate flipped graphics set (recycler). */
export function prototypeHasFlippedGraphics(e: MirrorProto): boolean {
    return e.graphics_set_flipped != null
}

function connXY(
    position?: { x: number; y: number } | readonly number[]
): { x: number; y: number } | undefined {
    if (!position) return undefined
    if (Array.isArray(position)) return { x: position[0], y: position[1] }
    return position as { x: number; y: number }
}

/**
 * Fluid boxes that actually swap under a left/right flip: every connection
 * has a counterpart at (-x, y) of the same production type, and at least
 * one connection is off the centreline (so the flip is visible).
 */
export function hasOffAxisHorizontalFluidSymmetry(e: MirrorProto): boolean {
    const boxes: FluidBoxLike[] = [...(e.fluid_boxes || [])]
    if (e.fluid_box) boxes.push(e.fluid_box)
    if (e.input_fluid_box) boxes.push(e.input_fluid_box)
    if (e.output_fluid_box) boxes.push(e.output_fluid_box)
    const pts: { x: number; y: number; kind: string }[] = []
    for (const fb of boxes) {
        for (const c of fb.pipe_connections || []) {
            const p = connXY(c.position)
            if (!p) continue
            pts.push({ x: p.x, y: p.y, kind: fb.production_type || '' })
        }
    }
    if (!pts.some(p => Math.abs(p.x) > 0.01)) return false
    const key = (x: number, y: number, kind: string): string =>
        `${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000},${kind}`
    const set = new Set(pts.map(p => key(p.x, p.y, p.kind)))
    return pts.every(p => set.has(key(-p.x, p.y, p.kind)))
}

const MIRROR_TYPES = new Set([
    'assembling-machine',
    'furnace',
    'rocket-silo',
    'boiler',
    'fusion-generator',
    'fusion-reactor',
])

/**
 * Whether flipping this prototype should toggle `entity.mirror` (and redraw
 * with flipped sprites). Direction remap still runs for everyone.
 */
export function entityUsesMirroring(e: MirrorProto): boolean {
    if (e.use_mirroring === false) return false
    if (e.graphics_set_flipped != null || e.circuit_connector_flipped != null) return true
    if (e.use_mirroring === true || e.forced_symmetry) return true
    const v = e.vector_to_place_result
    if (v && Math.abs(v[0]) > 0.01) return true
    if (!MIRROR_TYPES.has(e.type || '')) return false
    return hasOffAxisHorizontalFluidSymmetry(e)
}
