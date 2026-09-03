import { IPoint } from '../types'
import util from '../common/util'
import { flipDirection, flipPoint } from '../core/flip'

/**
 * Alt-mode indication sprites (the yellow drop arrow / pickup line the game
 * draws on inserters, and the output arrow on mining drills and recyclers).
 *
 * OverlayContainer places these in a container that is then scaled by 0.5 and
 * rotated by `entity.direction`, matching the existing combinator / drill
 * overlay. Positions here are in that pre-scale space: 64 units per tile, so
 * after the 0.5 scale they land on the 32 px tile grid.
 */

/** Pixi `label` on alt-mode overlay containers (placed entities + paint ghosts). */
export const ENTITY_INFO_LABEL = 'entity-info'

/** Overlay uses 64 units per tile, then scales the container by 0.5. */
export const OVERLAY_TILE = 64

/**
 * Nudge the mining-drill / recycler output arrow slightly toward the entity so
 * the sprite's visual centre (the arrowhead sits above the texture centre)
 * lands on the drop tile. Matches the overlay that mining drills already had.
 */
export const PLACE_RESULT_ARROW_NUDGE_Y = 18

export type IndicationKind = 'arrow' | 'line'

export interface IndicationSprite {
    x: number
    y: number
    /**
     * Extra rotation on top of the parent container's `entity.direction`
     * rotation. The indication-arrow texture points north (entity dir 0).
     */
    rotation: number
    kind: IndicationKind
}

/**
 * Factorio Vector: a 2-array `[x, y]` (what the exporter dumps from Lua) or
 * `{x, y}`. Returns undefined for anything we can't read, so callers can skip
 * drawing rather than throw — prototypes are allowed to omit these fields.
 */
export function vectorToPoint(v: unknown): IPoint | undefined {
    if (v == null) return undefined
    if (Array.isArray(v) && v.length >= 2) {
        const x = Number(v[0])
        const y = Number(v[1])
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
        return undefined
    }
    if (typeof v === 'object') {
        const rec = v as { x?: unknown; y?: unknown }
        if (rec.x !== undefined && rec.y !== undefined) {
            const x = Number(rec.x)
            const y = Number(rec.y)
            if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
        }
    }
    return undefined
}

/**
 * Inserter alt-mode markers: a line at `pickup_position` and an arrow at
 * `insert_position` pointing along the drop vector. The arrow texture points
 * north; vanilla insert is +Y (south) so the drop sprite is rotated π, and
 * the parent container's entity-direction rotation then carries both markers
 * with the inserter.
 */
export function inserterIndicationSprites(
    pickup: IPoint,
    insert: IPoint
): { pickup: IndicationSprite; drop: IndicationSprite } {
    return {
        pickup: {
            x: pickup.x * OVERLAY_TILE,
            y: pickup.y * OVERLAY_TILE,
            rotation: 0,
            kind: 'line',
        },
        drop: {
            x: insert.x * OVERLAY_TILE,
            y: insert.y * OVERLAY_TILE,
            // atan2(x, -y): rotation from pointing north toward (insert.x, insert.y)
            // in Factorio coords (+Y is south, matching the canvas).
            rotation: Math.atan2(insert.x, -insert.y),
            kind: 'arrow',
        },
    }
}

/**
 * Factorio's `mirror` bit is a left/right flip in **entity-local** space
 * (negate X, remap E↔W), then the entity still faces `direction`. Overlay
 * sprites that live in already-rotated world space (fluid arrows, recipe
 * icon shift) go through this; children of a parent rotated by `direction`
 * (recycler drop arrow) only need the local X flip.
 */
export function overlayLocalToWorld(local: IPoint, direction: number, mirrored: boolean): IPoint {
    return util.rotatePointBasedOnDir(mirrored ? flipPoint(local, false) : local, direction)
}

export function overlayLocalDirection(
    connectionDirection: number,
    entityDirection: number,
    mirrored: boolean
): number {
    const local = mirrored ? flipDirection(connectionDirection, false) : connectionDirection
    return (entityDirection + local) % 16
}

/** Local drop vector with the blueprint `mirror` bit applied. */
export function mirroredPlaceResult(vector: IPoint, mirrored: boolean): IPoint {
    return mirrored ? flipPoint(vector, false) : vector
}

/** Output arrow for anything with `vector_to_place_result` (drills, recycler). */
export function placeResultIndicationSprite(vector: IPoint): IndicationSprite {
    return {
        x: vector.x * OVERLAY_TILE,
        y: vector.y * OVERLAY_TILE + PLACE_RESULT_ARROW_NUDGE_Y,
        rotation: 0,
        kind: 'arrow',
    }
}
