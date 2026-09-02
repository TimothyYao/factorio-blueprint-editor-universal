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
