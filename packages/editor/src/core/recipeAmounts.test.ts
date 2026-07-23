import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { IngredientPrototype, ProductPrototype } from 'factorio:prototype'
import FD, { loadData } from './factorioData'
import {
    abbreviateAmount,
    formatProductAmount,
    formatProductProbability,
    getIngredientAmount,
    getProductAmount,
    getProductAmountWithProductivity,
} from './recipeAmounts'

const product = (partial: Partial<ProductPrototype>): ProductPrototype =>
    ({ type: 'item', name: 'x', ...partial }) as ProductPrototype

describe('getProductAmount', () => {
    it('returns the plain amount when defined', () => {
        expect(getProductAmount(product({ amount: 20 }))).toBe(20)
        expect(getProductAmount(product({ amount: 1 }))).toBe(1)
    })

    it('scales a plain amount by its probability', () => {
        // asteroid-crushing style: the chunk comes back 20% of the time.
        expect(getProductAmount(product({ amount: 1, probability: 0.2 }))).toBeCloseTo(0.2)
    })

    it('handles a probabilistic amount_min/amount_max by-product without amount (the NaN bug)', () => {
        // SE's se-cryonite-powder sand by-product: no `amount` field at all.
        const sand = product({ amount_min: 1, amount_max: 1, probability: 0.25 })
        const value = getProductAmount(sand)
        expect(Number.isNaN(value)).toBe(false)
        expect(value).toBeCloseTo(0.25)
    })

    it('uses the expected value of a min/max range', () => {
        // EV = p * 0.5 * (min + max) = 1 * 0.5 * (2 + 8) = 5
        expect(getProductAmount(product({ amount_min: 2, amount_max: 8 }))).toBe(5)
        expect(getProductAmount(product({ amount_min: 2, amount_max: 8, probability: 0.5 }))).toBe(
            2.5
        )
    })

    it('adds extra_count_fraction on top (recycling recipes)', () => {
        expect(
            getProductAmount(
                product({ amount: 2, extra_count_fraction: 0.5 } as Partial<ProductPrototype>)
            )
        ).toBe(2.5)
    })

    it('degrades to 0 rather than NaN for an empty product', () => {
        const value = getProductAmount(product({}))
        expect(Number.isNaN(value)).toBe(false)
        expect(value).toBe(0)
    })
})

describe('getProductAmountWithProductivity', () => {
    it('returns the base amount when there is no productivity bonus', () => {
        expect(getProductAmountWithProductivity(product({ amount: 10 }), 0)).toBe(10)
        // Negative/garbage productivity is treated as none rather than shrinking output.
        expect(getProductAmountWithProductivity(product({ amount: 10 }), -0.5)).toBe(10)
    })

    it('scales an ordinary product fully by the productivity bonus', () => {
        // No catalyst floor: 10 * (1 + 0.5) = 15.
        expect(getProductAmountWithProductivity(product({ amount: 10 }), 0.5)).toBe(15)
    })

    it('leaves a pure catalyst product untouched (the cryonite water case)', () => {
        // amount == ignored_by_productivity -> nothing is above the floor, so
        // productivity cannot inflate it. This is exactly SE cryonite-crystal water.
        const water = product({ amount: 2, ignored_by_productivity: 2, ignored_by_stats: 2 })
        expect(getProductAmountWithProductivity(water, 0.5)).toBe(2)
        expect(getProductAmountWithProductivity(water, 3)).toBe(2)
    })

    it('scales only the portion above the catalyst floor', () => {
        // amount 10, catalyst 4, +50% -> 10 + 0.5 * (10 - 4) = 13.
        const p = product({ amount: 10, ignored_by_productivity: 4 })
        expect(getProductAmountWithProductivity(p, 0.5)).toBe(13)
    })

    it('defaults ignored_by_productivity to ignored_by_stats when absent', () => {
        // Only ignored_by_stats set (78 SE / 116 SA / 21 vanilla products rely on
        // this default): the game copies it into ignored_by_productivity.
        const p = product({ amount: 5, ignored_by_stats: 5 })
        expect(getProductAmountWithProductivity(p, 1)).toBe(5)
    })

    it('clamps a catalyst larger than the crafted amount (excess is ignored)', () => {
        // ignored_by_productivity may exceed the amount; the excess is discarded
        // rather than producing a negative bonus.
        const p = product({ amount: 2, ignored_by_productivity: 5 })
        expect(getProductAmountWithProductivity(p, 1)).toBe(2)
    })

    it('applies productivity to the expected value of a probabilistic product', () => {
        // EV = 0.25, no catalyst, +100% -> 0.5.
        const sand = product({ amount_min: 1, amount_max: 1, probability: 0.25 })
        expect(getProductAmountWithProductivity(sand, 1)).toBeCloseTo(0.5)
    })
})

describe('abbreviateAmount', () => {
    it('shows values under 1000 verbatim', () => {
        expect(abbreviateAmount(1)).toBe('1')
        expect(abbreviateAmount(12.34)).toBe('12.34')
        expect(abbreviateAmount(999)).toBe('999')
    })

    it('collapses large values to Nk', () => {
        expect(abbreviateAmount(1000)).toBe('1k')
        expect(abbreviateAmount(2500)).toBe('2k')
    })

    it('degrades non-finite input to 0 rather than NaNk', () => {
        expect(abbreviateAmount(NaN)).toBe('0')
        expect(abbreviateAmount(undefined as unknown as number)).toBe('0')
    })
})

describe('formatProductAmount', () => {
    it('shows a plain amount, without folding in the probability', () => {
        expect(formatProductAmount(product({ amount: 20 }))).toBe('20')
        // The probability is rendered as a separate badge, not appended here, so
        // a wide "1 25%" label can't collide with the neighbouring icon.
        expect(
            formatProductAmount(product({ amount_min: 1, amount_max: 1, probability: 0.25 }))
        ).toBe('1')
        expect(formatProductAmount(product({ amount: 1, probability: 0.2 }))).toBe('1')
    })

    it('shows a min–max range', () => {
        expect(formatProductAmount(product({ amount_min: 1, amount_max: 5 }))).toBe('1–5')
        expect(
            formatProductAmount(product({ amount_min: 0, amount_max: 5, probability: 0.5 }))
        ).toBe('0–5')
    })

    it('never renders NaN for an empty product', () => {
        expect(formatProductAmount(product({}))).toBe('0')
    })
})

describe('formatProductProbability', () => {
    it('returns undefined for a guaranteed product', () => {
        expect(formatProductProbability(product({ amount: 20 }))).toBeUndefined()
        expect(formatProductProbability(product({ amount: 1, probability: 1 }))).toBeUndefined()
    })

    it('formats a sub-100% probability as a percentage (the cryonite case)', () => {
        expect(
            formatProductProbability(product({ amount_min: 1, amount_max: 1, probability: 0.25 }))
        ).toBe('25%')
        expect(formatProductProbability(product({ amount: 1, probability: 0.2 }))).toBe('20%')
        expect(formatProductProbability(product({ amount: 1, probability: 0.05 }))).toBe('5%')
    })
})

describe('getIngredientAmount', () => {
    it('returns the ingredient amount', () => {
        expect(
            getIngredientAmount({ type: 'item', name: 'x', amount: 3 } as IngredientPrototype)
        ).toBe(3)
    })

    it('degrades to 0 rather than NaN when amount is missing', () => {
        const value = getIngredientAmount({
            type: 'item',
            name: 'x',
        } as unknown as IngredientPrototype)
        expect(Number.isNaN(value)).toBe(false)
        expect(value).toBe(0)
    })
})

// Regression against the shipped Space Exploration pack: `se-cryonite-powder`
// (crafted in the Pulveriser) is the exact recipe from the bug report — its
// `sand` by-product carries amount_min/amount_max/probability and no plain
// `amount`, which produced a "NaNk" crafting rate.
describe('se-cryonite-powder (shipped SE data — the cryonite crushing bug)', () => {
    loadData(readFileSync('packages/exporter/data/output/space-exploration/data.json', 'utf8'))
    const recipe = FD.recipes['se-cryonite-powder']
    const sand = recipe.results.find(r => r.name === 'sand')

    it('exists with a probabilistic sand by-product that has no plain amount', () => {
        expect(recipe).toBeDefined()
        expect(sand).toBeDefined()
        expect(sand.amount).toBeUndefined()
        expect(sand.probability).toBe(0.25)
    })

    it('never yields NaN for any product amount (rate maths)', () => {
        for (const r of recipe.results) {
            expect(Number.isNaN(getProductAmount(r))).toBe(false)
        }
        // 25% chance of one sand -> expected 0.25.
        expect(getProductAmount(sand)).toBeCloseTo(0.25)
    })

    it('renders the sand by-product amount and probability as separate labels', () => {
        expect(formatProductAmount(sand)).toBe('1')
        expect(formatProductProbability(sand)).toBe('25%')
        // The main product is deterministic: plain amount, no probability badge.
        const powder = recipe.results.find(r => r.name === 'se-cryonite-powder')
        expect(formatProductAmount(powder)).toBe('1')
        expect(formatProductProbability(powder)).toBeUndefined()
    })
})

// The recipe from this task's report: `se-cryonite-crystal` lists water as a
// product with `ignored_by_productivity: 2` equal to its `amount: 2` — a pure
// catalyst. Productivity must scale the crystal output but leave the water
// (i.e. the steam→water ratio) alone.
describe('se-cryonite-crystal (shipped SE data — catalyst / ignored_by_productivity)', () => {
    loadData(readFileSync('packages/exporter/data/output/space-exploration/data.json', 'utf8'))
    const recipe = FD.recipes['se-cryonite-crystal']
    const crystal = recipe.results.find(r => r.name === 'se-cryonite-crystal')
    const water = recipe.results.find(r => r.name === 'water')

    it('marks water as a catalyst but not the crystal', () => {
        expect(recipe.allow_productivity).toBe(true)
        expect(crystal.amount).toBe(1)
        expect(water.amount).toBe(2)
        expect((water as { ignored_by_productivity?: number }).ignored_by_productivity).toBe(2)
        expect(
            (crystal as { ignored_by_productivity?: number }).ignored_by_productivity
        ).toBeUndefined()
    })

    it('scales the crystal with productivity but never the water', () => {
        // +40% (e.g. two Productivity Module 3s): crystal 1 -> 1.4, water stays 2.
        expect(getProductAmountWithProductivity(crystal, 0.4)).toBeCloseTo(1.4)
        expect(getProductAmountWithProductivity(water, 0.4)).toBe(2)
        // Even at an extreme bonus the water — the catalyst — is unmoved.
        expect(getProductAmountWithProductivity(water, 3)).toBe(2)
    })
})
