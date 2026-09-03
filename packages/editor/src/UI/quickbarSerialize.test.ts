import { describe, it, expect } from 'vitest'
import { parseQuickbarSlot, serializeQuickbarSlot } from './quickbarSerialize'

describe('quickbar slot persistence', () => {
    it('reads the pre-quality string format', () => {
        expect(parseQuickbarSlot('fast-inserter')).toEqual({ name: 'fast-inserter' })
        expect(parseQuickbarSlot('')).toBeUndefined()
        expect(parseQuickbarSlot(null)).toBeUndefined()
    })

    it('reads { name, quality } and drops Normal', () => {
        expect(parseQuickbarSlot({ name: 'assembling-machine-2', quality: 'legendary' })).toEqual({
            name: 'assembling-machine-2',
            quality: 'legendary',
        })
        expect(parseQuickbarSlot({ name: 'inserter', quality: 'normal' })).toEqual({
            name: 'inserter',
        })
    })

    it('writes a string when quality is omitted so old saves stay stable', () => {
        expect(serializeQuickbarSlot('transport-belt')).toBe('transport-belt')
        expect(serializeQuickbarSlot('transport-belt', 'normal')).toBe('transport-belt')
        expect(serializeQuickbarSlot('transport-belt', 'rare')).toEqual({
            name: 'transport-belt',
            quality: 'rare',
        })
        expect(serializeQuickbarSlot(undefined)).toBeUndefined()
    })
})
