import { describe, expect, it } from 'vitest'
import {
    constrainToPossibleDirections,
    flipDirection,
    flipPoint,
    flipSwapsSplitterPriority,
    rotatePoint,
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
