import { describe, it, expect } from 'vitest'
import { BeaconPrototype } from 'factorio:prototype'
import {
    beaconEffectMultiplier,
    beaconSupplyAreaDistance,
    beaconSupplyAreaSize,
} from './beaconEffects'

const proto = (partial: Partial<BeaconPrototype>): BeaconPrototype =>
    ({ distribution_effectivity: 1, ...partial }) as BeaconPrototype

// Real values from the shipped data packs, so these double as a regression
// check on the assumptions EntityInfoPanel makes about them.
const vanilla = proto({
    distribution_effectivity: 1.5,
    profile: [1, 0.7071, 0.5773, 0.5],
    beacon_counter: 'same_type',
})
const seCompact = proto({ distribution_effectivity: 0.75, profile: [1, 0] })

describe('beaconEffectMultiplier', () => {
    it('applies distribution_effectivity at full profile for a single beacon', () => {
        expect(beaconEffectMultiplier(vanilla, 1, 1)).toBe(1.5)
        expect(beaconEffectMultiplier(seCompact, 1, 1)).toBe(0.75)
    })

    it('falls off along the profile as more beacons reach the machine', () => {
        expect(beaconEffectMultiplier(vanilla, 2, 2)).toBeCloseTo(1.5 * 0.7071)
        expect(beaconEffectMultiplier(vanilla, 3, 3)).toBeCloseTo(1.5 * 0.5773)
    })

    it('zeroes out overloaded SE beacons (profile [1, 0])', () => {
        expect(beaconEffectMultiplier(seCompact, 2, 2)).toBe(0)
        // 5 beacons still clamp to the last profile entry (0)
        expect(beaconEffectMultiplier(seCompact, 5, 5)).toBe(0)
    })

    it('clamps counts past the end of the profile to its last entry', () => {
        expect(beaconEffectMultiplier(vanilla, 9, 9)).toBeCloseTo(1.5 * 0.5)
    })

    it('counts same-prototype beacons only when beacon_counter is same_type', () => {
        // 1 beacon of this prototype among 4 total: the vanilla beacon
        // ('same_type') stays at full profile, a 'total' counter does not.
        expect(beaconEffectMultiplier(vanilla, 1, 4)).toBe(1.5)
        const totalCounter = proto({
            distribution_effectivity: 1.5,
            profile: [1, 0.7071, 0.5773, 0.5],
        })
        expect(beaconEffectMultiplier(totalCounter, 1, 4)).toBeCloseTo(1.5 * 0.5)
    })

    it('treats a missing profile as no falloff', () => {
        expect(beaconEffectMultiplier(proto({ distribution_effectivity: 0.5 }), 3, 3)).toBe(0.5)
    })

    it('adds distribution_effectivity_bonus_per_quality_level × level', () => {
        const b = proto({
            distribution_effectivity: 1.5,
            distribution_effectivity_bonus_per_quality_level: 0.2,
        } as Partial<BeaconPrototype>)
        expect(beaconEffectMultiplier(b, 1, 1)).toBe(1.5)
        expect(beaconEffectMultiplier(b, 1, 1, 'legendary')).toBeCloseTo(2.5)
    })
})

describe('beaconSupplyAreaDistance', () => {
    // Quality wiki +1 tile/level (legendary is level 5). Vanilla beacon is
    // 3×3 + distance 3 = 9×9; legendary 3×3 + 8 = 19×19.
    const vanillaRange = proto({ supply_area_distance: 3 })

    it('matches the Quality-wiki +1/level table for a vanilla 3×3 beacon', () => {
        const area = (q?: string): number => beaconSupplyAreaSize(vanillaRange, 3, q)
        expect(beaconSupplyAreaDistance(vanillaRange)).toBe(3)
        expect(area()).toBe(9)
        expect(area('normal')).toBe(9)
        expect(area('uncommon')).toBe(11)
        expect(area('rare')).toBe(13)
        expect(area('epic')).toBe(15)
        expect(area('legendary')).toBe(19)
    })

    it('honours an explicit quality_affects_supply_area_distance: false', () => {
        const flat = proto({
            supply_area_distance: 3,
            quality_affects_supply_area_distance: false,
        } as Partial<BeaconPrototype>)
        expect(beaconSupplyAreaDistance(flat, 'legendary')).toBe(3)
        expect(beaconSupplyAreaSize(flat, 3, 'legendary')).toBe(9)
    })

    it('clamps the total to [0, 64]', () => {
        const huge = proto({ supply_area_distance: 60 })
        expect(beaconSupplyAreaDistance(huge, 'legendary')).toBe(64)
    })
})
