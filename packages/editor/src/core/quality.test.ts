import { describe, it, expect } from 'vitest'
import FD, { loadData } from './factorioData'
import { havePackData, readPackData } from './packDataFiles'
import { BUILTIN_QUALITY_TIERS, qualityLevel, resolveQuality } from './quality'

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
