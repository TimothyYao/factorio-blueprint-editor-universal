import { describe, it, expect } from 'vitest'
import { qualitySplitResults, withRecipeQuality, EntityInfoStack } from './entityInfoQuality'

describe('qualitySplitResults', () => {
    const base: EntityInfoStack[] = [{ type: 'item', name: 'processing-unit', amount: 0.25 }]

    it('keeps the legendary tail that used to vanish under per-second rounding', () => {
        // 31% quality chance (5× legendary Q3) on a modest rate — the old
        // roundToThree + amount < 0.0005 filter dropped legendary entirely.
        const split = qualitySplitResults(base, 0.31)
        const byQuality = Object.fromEntries(split.map(s => [s.quality ?? 'normal', s.amount]))
        expect(byQuality.normal).toBeCloseTo(0.25 * 0.69)
        expect(byQuality.uncommon).toBeCloseTo(0.25 * 0.279)
        expect(byQuality.rare).toBeCloseTo(0.25 * 0.0279)
        expect(byQuality.epic).toBeCloseTo(0.25 * 0.00279)
        expect(byQuality.legendary).toBeCloseTo(0.25 * 0.00031)
        // Unrounded amount must survive so /h display can recover it:
        // 0.25 * 0.00031 * 3600 ≈ 0.279
        expect(byQuality.legendary * 3600).toBeGreaterThan(0.1)
    })

    it('starts the ladder at recipeQuality and still keeps legendary', () => {
        const split = qualitySplitResults(base, 0.31, 'uncommon')
        expect(split.map(s => s.quality)).toEqual(['uncommon', 'rare', 'epic', 'legendary'])
        const legendary = split.find(s => s.quality === 'legendary')
        expect(legendary?.amount).toBeGreaterThan(0)
    })

    it('leaves fluids unsplit and untagged', () => {
        const split = qualitySplitResults(
            [
                { type: 'fluid', name: 'water', amount: 10 },
                { type: 'item', name: 'ice', amount: 1 },
            ],
            0.1,
            'rare'
        )
        expect(split[0]).toEqual({ type: 'fluid', name: 'water', amount: 10 })
        expect(split.some(s => s.quality === 'rare')).toBe(true)
    })
})

describe('withRecipeQuality', () => {
    it('badges non-fluid ingredients when the recipe has quality', () => {
        const stacks = withRecipeQuality(
            [
                { type: 'item', name: 'electronic-circuit', amount: 20 },
                { type: 'fluid', name: 'sulfuric-acid', amount: 5 },
            ],
            'legendary'
        )
        expect(stacks[0].quality).toBe('legendary')
        expect(stacks[1].quality).toBeUndefined()
    })

    it('is a no-op for normal / unset recipe quality', () => {
        const stacks: EntityInfoStack[] = [{ type: 'item', name: 'iron-plate', amount: 1 }]
        expect(withRecipeQuality(stacks, undefined)).toBe(stacks)
        expect(withRecipeQuality(stacks, 'normal')).toBe(stacks)
    })
})
