import { describe, expect, it } from 'vitest'
import {
    constrainToPossibleDirections,
    flipDirection,
    flipPoint,
    flipSwapsSplitterPriority,
    rotatePoint,
    entityUsesMirroring,
    hasOffAxisHorizontalFluidSymmetry,
    prototypeHasFlippedGraphics,
} from './flip'

describe('flipDirection', () => {
    it('horizontal: north/south stay, east↔west', () => {
        expect(flipDirection(0, false)).toBe(0)
        expect(flipDirection(8, false)).toBe(8)
        expect(flipDirection(4, false)).toBe(12)
        expect(flipDirection(12, false)).toBe(4)
    })

    it('vertical: east/west stay, north↔south', () => {
        expect(flipDirection(4, true)).toBe(4)
        expect(flipDirection(12, true)).toBe(12)
        expect(flipDirection(0, true)).toBe(8)
        expect(flipDirection(8, true)).toBe(0)
    })

    it('round-trips on the 8-way compass', () => {
        for (const dir of [0, 2, 4, 6, 8, 10, 12, 14]) {
            expect(flipDirection(flipDirection(dir, false), false)).toBe(dir)
            expect(flipDirection(flipDirection(dir, true), true)).toBe(dir)
        }
    })
})

describe('flipPoint / rotatePoint', () => {
    it('flips about each axis', () => {
        expect(flipPoint({ x: 3, y: 5 }, false)).toEqual({ x: -3, y: 5 })
        expect(flipPoint({ x: 3, y: 5 }, true)).toEqual({ x: 3, y: -5 })
    })

    it('rotates 90°', () => {
        expect(rotatePoint({ x: 3, y: 5 }, false)).toEqual({ x: -5, y: 3 })
        expect(rotatePoint({ x: 3, y: 5 }, true)).toEqual({ x: 5, y: -3 })
    })
})

describe('constrainToPossibleDirections', () => {
    it('returns 0 when the entity cannot rotate', () => {
        expect(constrainToPossibleDirections(4, 12, [])).toBe(0)
    })

    it('keeps a direction the entity supports', () => {
        expect(constrainToPossibleDirections(0, 12, [0, 4, 8, 12])).toBe(12)
    })

    it('aliases south→north and west→east for two-direction buildings', () => {
        expect(constrainToPossibleDirections(0, 8, [0, 4])).toBe(0)
        expect(constrainToPossibleDirections(0, 12, [0, 4])).toBe(4)
    })
})

describe('flipSwapsSplitterPriority', () => {
    it('swaps when the flip is along the belt', () => {
        expect(flipSwapsSplitterPriority(0, false)).toBe(true)
        expect(flipSwapsSplitterPriority(12, false)).toBe(true)
        expect(flipSwapsSplitterPriority(4, true)).toBe(true)
        expect(flipSwapsSplitterPriority(8, true)).toBe(true)
    })

    it('does not swap when the flip is across the belt', () => {
        expect(flipSwapsSplitterPriority(4, false)).toBe(false)
        expect(flipSwapsSplitterPriority(8, false)).toBe(false)
        expect(flipSwapsSplitterPriority(0, true)).toBe(false)
        expect(flipSwapsSplitterPriority(12, true)).toBe(false)
    })
})

describe('entityUsesMirroring', () => {
    const chemicalPlant = {
        type: 'assembling-machine',
        fluid_boxes: [
            {
                production_type: 'input',
                pipe_connections: [{ position: [-1, -1] }, { position: [1, -1] }],
            },
            {
                production_type: 'output',
                pipe_connections: [{ position: [-1, 1] }, { position: [1, 1] }],
            },
        ],
    }

    it('detects chemical-plant-style off-axis fluid symmetry', () => {
        expect(hasOffAxisHorizontalFluidSymmetry(chemicalPlant)).toBe(true)
        expect(entityUsesMirroring(chemicalPlant)).toBe(true)
    })

    it('ignores assembling machines whose pipes sit on the centreline', () => {
        const am2 = {
            type: 'assembling-machine',
            fluid_boxes: [
                { production_type: 'input', pipe_connections: [{ position: [0, -1] }] },
                { production_type: 'output', pipe_connections: [{ position: [0, 1] }] },
            ],
        }
        expect(hasOffAxisHorizontalFluidSymmetry(am2)).toBe(false)
        expect(entityUsesMirroring(am2)).toBe(false)
    })

    it('treats recycler flipped sheets / off-centre drop as mirroring', () => {
        expect(
            entityUsesMirroring({
                type: 'furnace',
                graphics_set_flipped: {},
                circuit_connector_flipped: [],
                vector_to_place_result: [-0.5, -2.3],
            })
        ).toBe(true)
        expect(prototypeHasFlippedGraphics({ graphics_set_flipped: {} })).toBe(true)
    })

    it('detects boiler-style fluid_box / output_fluid_box pairs', () => {
        expect(
            entityUsesMirroring({
                type: 'boiler',
                fluid_box: {
                    production_type: 'input',
                    pipe_connections: [{ position: [-1, 0.5] }, { position: [1, 0.5] }],
                },
                output_fluid_box: {
                    production_type: 'output',
                    pipe_connections: [{ position: [0, -0.5] }],
                },
            })
        ).toBe(true)
    })

    it('honours forced_symmetry when fluid boxes are not left-right pairs', () => {
        expect(
            entityUsesMirroring({
                type: 'assembling-machine',
                forced_symmetry: 'horizontal',
                fluid_boxes: [
                    {
                        production_type: 'input',
                        pipe_connections: [{ position: [-1.5, 0.5] }, { position: [1.5, -0.5] }],
                    },
                ],
            })
        ).toBe(true)
    })

    it('does not mirror pipes or belts', () => {
        expect(entityUsesMirroring({ type: 'pipe' })).toBe(false)
        expect(entityUsesMirroring({ type: 'transport-belt' })).toBe(false)
    })
})
