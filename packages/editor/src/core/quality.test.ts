import { describe, it, expect } from 'vitest'
import FD, { loadData } from './factorioData'
import { havePackData, readPackData } from './packDataFiles'
import {
    BUILTIN_QUALITY_TIERS,
    pickerQualityTiers,
    qualityColorCss,
    qualityColorHex,
    qualityCraftingSpeedMul,
    qualityEffectChance,
    qualityInserterSpeedMul,
    qualityRollDistribution,
    qualityDisplayName,
    qualityLevel,
    qualityShowsBadge,
    storedQuality,
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
        expect(storedQuality(undefined)).toBeUndefined()
        expect(storedQuality('normal')).toBeUndefined()
        expect(storedQuality('legendary')).toBe('legendary')
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

    it('scales inserter rotation speed by the same 0.3 × level (wiki +30%/tier)', () => {
        // Fast inserter base 864°/s → uncommon 1123 / rare 1382 / epic 1642 /
        // legendary 2160 on the Quality wiki; those ratios are exactly 1.3 /
        // 1.6 / 1.9 / 2.5.
        expect(qualityInserterSpeedMul(undefined)).toBe(1)
        expect(qualityInserterSpeedMul('normal')).toBe(1)
        expect(qualityInserterSpeedMul('uncommon')).toBeCloseTo(1.3)
        expect(qualityInserterSpeedMul('rare')).toBeCloseTo(1.6)
        expect(qualityInserterSpeedMul('epic')).toBeCloseTo(1.9)
        expect(qualityInserterSpeedMul('legendary')).toBeCloseTo(2.5)
        expect(qualityInserterSpeedMul('legendary')).toBe(qualityCraftingSpeedMul('legendary'))
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

    it('formats a quality id as a CSS #rrggbb for the DOM overlay', () => {
        expect(qualityColorCss('legendary')).toBe('#ffa01e')
        expect(qualityColorCss(undefined)).toBe('#808080')
    })
})

describe('quality module chance (wiki table)', () => {
    // Prototype encoding: Q1=0.1, Q2=0.2, Q3=0.25. Displayed chance is
    // effect × next_probability (0.1), then × (1 + 0.3 × level), floored
    // to 0.1%. Wiki: https://wiki.factorio.com/Quality
    it('converts the 2.0 dump encoding to the wiki percentages', () => {
        expect(qualityEffectChance(0.1)).toBe(0.01)
        expect(qualityEffectChance(0.2)).toBe(0.02)
        expect(qualityEffectChance(0.25)).toBe(0.025)
    })

    it('matches the wiki quality-module-3 row including the 0.1% floor', () => {
        expect(qualityEffectChance(0.25, 'normal')).toBe(0.025)
        expect(qualityEffectChance(0.25, 'uncommon')).toBe(0.032) // 3.25 → 3.2
        expect(qualityEffectChance(0.25, 'rare')).toBe(0.04)
        expect(qualityEffectChance(0.25, 'epic')).toBe(0.047) // 4.75 → 4.7
        expect(qualityEffectChance(0.25, 'legendary')).toBe(0.062) // 6.25 → 6.2
    })

    it('matches the wiki quality-module-1 and -2 legendary cells', () => {
        expect(qualityEffectChance(0.1, 'legendary')).toBe(0.025)
        expect(qualityEffectChance(0.2, 'legendary')).toBe(0.05)
    })

    it('does not treat 5× legendary Q3 as 300%+', () => {
        // Electromagnetic plant (5 slots): 5 × 6.2% = 31%, not 312.5%.
        expect(5 * qualityEffectChance(0.25, 'legendary')).toBeCloseTo(0.31)
    })
})

describe('quality roll distribution (wiki)', () => {
    it('splits a 10% quality chance the way the wiki does', () => {
        const dist = Object.fromEntries(
            qualityRollDistribution(0.1).map(d => [d.quality, d.fraction])
        )
        expect(dist.normal).toBeCloseTo(0.9)
        expect(dist.uncommon).toBeCloseTo(0.09)
        expect(dist.rare).toBeCloseTo(0.009)
        expect(dist.epic).toBeCloseTo(0.0009)
        expect(dist.legendary).toBeCloseTo(0.0001)
    })

    it('keeps the input-tier remainder so regular output is never dropped', () => {
        const dist = qualityRollDistribution(0.31)
        expect(dist[0].quality).toBe('normal')
        expect(dist[0].fraction).toBeCloseTo(0.69)
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
