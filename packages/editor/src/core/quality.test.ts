import { describe, it, expect } from 'vitest'
import FD, { loadData } from './factorioData'
import { havePackData, readPackData } from './packDataFiles'
import {
    BUILTIN_QUALITY_TIERS,
    pickerQualityTiers,
    qualityColorHex,
    qualityCraftingSpeedMul,
    qualityDisplayName,
    qualityLevel,
    qualityShowsBadge,
    resolveQuality,
    scalePositiveEffect,
} from './quality'

describe('builtin quality tiers', () => {
    it('uses legendary level 5, not a 0-based index of 4', () => {
        expect(BUILTIN_QUALITY_TIERS.normal.level).toBe(0)
        expect(BUILTIN_QUALITY_TIERS.uncommon.level).toBe(1)
        expect(BUILTIN_QUALITY_TIERS.rare.level).toBe(2)
        expect(BUILTIN_QUALITY_TIERS.epic.level).toBe(3)
        expect(BUILTIN_QUALITY_TIERS.legendary.level).toBe(5)
    })

    it('treats absent and normal as strength 0 without a dump', () => {
        expect(qualityLevel(undefined)).toBe(0)
        expect(qualityLevel('normal')).toBe(0)
        expect(qualityLevel('legendary')).toBe(5)
        expect(qualityLevel('modded-quality')).toBe(0)
    })

    it('resolves unknown names to a neutral fallback instead of throwing', () => {
        const q = resolveQuality('my-mod-tier')
        expect(q?.name).toBe('my-mod-tier')
        expect(q?.level).toBe(0)
        expect(resolveQuality(undefined)).toBeUndefined()
    })

    it('shows a badge for every non-normal id, including unknown names', () => {
        expect(qualityShowsBadge(undefined)).toBe(false)
        expect(qualityShowsBadge('normal')).toBe(false)
        expect(qualityShowsBadge('legendary')).toBe(true)
        expect(qualityShowsBadge('my-mod-tier')).toBe(true)
        expect(qualityDisplayName(undefined)).toBeUndefined()
        expect(qualityDisplayName('normal')).toBeUndefined()
        expect(qualityDisplayName('legendary')).toBe('Legendary')
    })

    it('scales crafting speed and positive module effects by 0.3 × level', () => {
        expect(qualityCraftingSpeedMul(undefined)).toBe(1)
        expect(qualityCraftingSpeedMul('legendary')).toBeCloseTo(2.5)
        expect(scalePositiveEffect(0.2, 'legendary')).toBeCloseTo(0.5)
        expect(scalePositiveEffect(-0.05, 'legendary')).toBe(-0.05)
    })

    it('lists picker tiers without quality-unknown', () => {
        const ids = pickerQualityTiers().map(t => t.id)
        expect(ids).toContain('legendary')
        expect(ids).not.toContain('quality-unknown')
    })

    it('normalizes 0–1 and 0–255 dump colors to the same hex', () => {
        expect(qualityColorHex({ r: 1, g: 0, b: 0 })).toBe(0xff0000)
        expect(qualityColorHex({ r: 255, g: 0, b: 0 })).toBe(0xff0000)
        expect(qualityColorHex([43, 165, 61])).toBe(qualityColorHex({ r: 43, g: 165, b: 61 }))
    })
})

describe('FD.qualities from a pack dump', () => {
    it('is always an object after loadData, even on pre-field dumps', () => {
        if (!havePackData('vanilla-2.0')) return
        loadData(readPackData('vanilla-2.0'))
        expect(FD.qualities).toEqual(expect.any(Object))
    })

    it('prefers dumped level/icon when the pack carries qualities', () => {
        if (!havePackData('space-age')) return
        loadData(readPackData('space-age'))
        const legendary = FD.qualities?.legendary
        if (!legendary) {
            // Published dumps from before this exporter field — empty is fine.
            expect(qualityLevel('legendary')).toBe(5)
            return
        }
        expect(legendary.level).toBe(5)
        expect(qualityLevel('legendary')).toBe(5)
        const resolved = resolveQuality('legendary')
        expect(resolved?.icon || resolved?.icons).toBeTruthy()
    })
})
