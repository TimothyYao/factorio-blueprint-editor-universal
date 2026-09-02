import { describe, it, expect } from 'vitest'
import FD, { loadData } from '../core/factorioData'
import { havePackData, readPackData } from '../core/packDataFiles'
import {
    vectorToPoint,
    inserterIndicationSprites,
    placeResultIndicationSprite,
    overlayLocalToWorld,
    overlayLocalDirection,
    mirroredPlaceResult,
    OVERLAY_TILE,
    PLACE_RESULT_ARROW_NUDGE_Y,
} from './overlayIndication'

describe('vectorToPoint', () => {
    it('reads a Lua 2-array', () => {
        expect(vectorToPoint([0, -1])).toEqual({ x: 0, y: -1 })
        expect(vectorToPoint([-0.35, -2.3])).toEqual({ x: -0.35, y: -2.3 })
    })

    it('reads an {x, y} object', () => {
        expect(vectorToPoint({ x: 0.2, y: 1.2 })).toEqual({ x: 0.2, y: 1.2 })
    })

    it('returns undefined for junk', () => {
        expect(vectorToPoint(undefined)).toBeUndefined()
        expect(vectorToPoint(null)).toBeUndefined()
        expect(vectorToPoint('nope')).toBeUndefined()
        expect(vectorToPoint([1])).toBeUndefined()
        expect(vectorToPoint({})).toBeUndefined()
    })
})

describe('inserterIndicationSprites', () => {
    it('puts the drop arrow south of a vanilla inserter, rotated π (texture points north)', () => {
        const { pickup, drop } = inserterIndicationSprites({ x: 0, y: -1 }, { x: 0, y: 1.2 })
        expect(pickup).toEqual({
            x: 0,
            y: -OVERLAY_TILE,
            rotation: 0,
            kind: 'line',
        })
        expect(drop.x).toBe(0)
        expect(drop.y).toBeCloseTo(1.2 * OVERLAY_TILE)
        expect(drop.kind).toBe('arrow')
        expect(drop.rotation).toBeCloseTo(Math.PI)
    })

    it('reaches two tiles for a long-handed inserter', () => {
        const { pickup, drop } = inserterIndicationSprites({ x: 0, y: -2 }, { x: 0, y: 2.2 })
        expect(pickup.y).toBe(-2 * OVERLAY_TILE)
        expect(drop.y).toBeCloseTo(2.2 * OVERLAY_TILE)
        expect(drop.rotation).toBeCloseTo(Math.PI)
    })

    it('tilts the drop arrow when the insert vector has a lane offset', () => {
        const { drop } = inserterIndicationSprites({ x: 0, y: -1 }, { x: 0.2, y: 1.2 })
        // Still mostly south, but yawed toward +X.
        expect(drop.rotation).toBeGreaterThan(0)
        expect(drop.rotation).toBeLessThan(Math.PI)
        expect(drop.x).toBeCloseTo(0.2 * OVERLAY_TILE)
    })
})

describe('placeResultIndicationSprite', () => {
    it('nudges the arrow toward the entity along Y', () => {
        const s = placeResultIndicationSprite({ x: 0, y: -1.85 })
        expect(s.x).toBe(0)
        expect(s.y).toBeCloseTo(-1.85 * OVERLAY_TILE + PLACE_RESULT_ARROW_NUDGE_Y)
        expect(s.kind).toBe('arrow')
        expect(s.rotation).toBe(0)
    })
})

describe('overlay mirror (local left/right)', () => {
    it('swaps a chemical-plant input from west to east when mirrored, north-facing', () => {
        const west = overlayLocalToWorld({ x: -1, y: -1 }, 0, true)
        const east = overlayLocalToWorld({ x: 1, y: -1 }, 0, true)
        expect(west).toEqual({ x: 1, y: -1 })
        expect(east).toEqual({ x: -1, y: -1 })
        expect(overlayLocalDirection(0, 0, true)).toBe(0)
    })

    it('keeps north recipe shift on X=0 and still rotates it when the plant faces east', () => {
        const north = overlayLocalToWorld({ x: 0, y: -0.3 }, 0, true)
        expect(north.x).toBeCloseTo(0)
        expect(north.y).toBeCloseTo(-0.3)
        const east = overlayLocalToWorld({ x: 0, y: -0.3 }, 4, false)
        expect(east.x).toBeCloseTo(0.3)
        expect(east.y).toBeCloseTo(0)
    })

    it('mirrors the recycler drop vector across local X', () => {
        const raw = { x: -0.5, y: -2.3 }
        expect(mirroredPlaceResult(raw, false)).toEqual(raw)
        expect(mirroredPlaceResult(raw, true)).toEqual({ x: 0.5, y: -2.3 })
        expect(placeResultIndicationSprite(mirroredPlaceResult(raw, true)).x).toBeCloseTo(
            0.5 * OVERLAY_TILE
        )
    })
})

describe('prototype vectors (space-age pack)', () => {
    it.skipIf(!havePackData('space-age'))(
        'vanilla inserters dump pickup/insert and the recycler dumps vector_to_place_result',
        () => {
            loadData(readPackData('space-age'))
            const inserter = FD.entities['inserter'] as {
                pickup_position?: unknown
                insert_position?: unknown
            }
            expect(vectorToPoint(inserter.pickup_position)).toEqual({ x: 0, y: -1 })
            expect(vectorToPoint(inserter.insert_position)).toEqual({ x: 0, y: 1.2 })

            const long = FD.entities['long-handed-inserter'] as {
                pickup_position?: unknown
                insert_position?: unknown
            }
            expect(vectorToPoint(long.pickup_position)).toEqual({ x: 0, y: -2 })
            expect(vectorToPoint(long.insert_position)).toEqual({ x: 0, y: 2.2 })

            const recycler = FD.entities['recycler'] as { vector_to_place_result?: unknown }
            expect(recycler).toBeDefined()
            const recyclerDrop = vectorToPoint(recycler.vector_to_place_result)
            // North of the 2×4 footprint (half-height 2 plus a bit past the
            // edge). X has drifted across Factorio 2.0.x dumps (-0.35 vs -0.5);
            // only the sign matters for the overlay — it's a belt-lane bias.
            expect(recyclerDrop).toBeDefined()
            expect(recyclerDrop!.y).toBeLessThan(-2)
            expect(recyclerDrop!.x).toBeLessThan(0)

            // Pumpjacks dump [0, 0] (fluid output, not an item drop) — the
            // overlay skips a zero vector so they don't get a spurious arrow.
            expect(
                vectorToPoint(
                    (FD.entities['pumpjack'] as { vector_to_place_result?: unknown } | undefined)
                        ?.vector_to_place_result
                )
            ).toEqual({ x: 0, y: 0 })

            expect(FD.utilitySprites.indication_arrow).toBeDefined()
            expect(FD.utilitySprites.indication_line).toBeDefined()
        }
    )
})
