import { describe, it, expect } from 'vitest'
import { BeaconPrototype } from 'factorio:prototype'
import { beaconEffectMultiplier } from './beaconEffects'

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
})
