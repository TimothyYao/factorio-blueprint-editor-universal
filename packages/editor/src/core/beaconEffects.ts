import { BeaconPrototype, QualityPrototype } from 'factorio:prototype'
import FD from './factorioData'
import { qualityLevel } from './quality'

/**
 * Engine clamp on BeaconPrototype::supply_area_distance (and the quality
 * bonus added to it). Same `[0, 64]` range the prototype docs document.
 */
const MAX_SUPPLY_AREA_DISTANCE = 64

type BeaconQualityFields = BeaconPrototype & {
    quality_affects_supply_area_distance?: boolean
}

type QualityBeaconFields = QualityPrototype & {
    beacon_supply_area_distance_bonus?: number
}

/**
 * Tiles the supply area extends past the beacon's own footprint, including
 * the quality bonus.
 *
 * QualityPrototype::beacon_supply_area_distance_bonus defaults to
 * `clamp(level, 0, 64)` — the same +1 tile per quality level the
 * [Quality wiki](https://wiki.factorio.com/Quality) lists for electric-pole
 * supply area (5×5 / 7×7 / 9×9 / 11×11 / 15×15). A vanilla 3×3 beacon with
 * `supply_area_distance` 3 is therefore:
 *
 * | Quality    | Level | Distance | Area   |
 * | ---------- | ----- | -------- | ------ |
 * | Normal     | 0     | 3        | 9×9    |
 * | Uncommon   | 1     | 4        | 11×11  |
 * | Rare       | 2     | 5        | 13×13  |
 * | Epic       | 3     | 6        | 15×15  |
 * | Legendary  | 5     | 8        | 19×19  |
 *
 * The Beacon wiki still lists a flat 9×9 (vanilla `beacon.lua` does not set
 * `quality_affects_supply_area_distance`); a pack that dumps the flag as
 * `false` keeps that flat range. Dumps that omit the flag (current data
 * plane) get the documented default bonus so the overlay and the rate maths
 * agree with the Quality wiki's +1/level table.
 */
export function beaconSupplyAreaDistance(beacon: BeaconPrototype, quality?: string): number {
    const base = beacon.supply_area_distance ?? 0
    const affects = (beacon as BeaconQualityFields).quality_affects_supply_area_distance
    if (affects === false) return clampSupply(base)

    const dumped = quality
        ? (FD.qualities?.[quality] as QualityBeaconFields | undefined)
        : undefined
    const bonus =
        dumped && typeof dumped.beacon_supply_area_distance_bonus === 'number'
            ? dumped.beacon_supply_area_distance_bonus
            : qualityLevel(quality)
    return clampSupply(base + bonus)
}

/** Axis-aligned supply-area side length in tiles (footprint + 2 × distance). */
export function beaconSupplyAreaSize(
    beacon: BeaconPrototype,
    footprint: number,
    quality?: string
): number {
    return footprint + 2 * beaconSupplyAreaDistance(beacon, quality)
}

function clampSupply(n: number): number {
    return Math.min(Math.max(n, 0), MAX_SUPPLY_AREA_DISTANCE)
}

/**
 * Factorio 2.0 beacon transmission math (see `BeaconPrototype` in the
 * prototype docs): every module effect a beacon transmits is scaled by
 * `distribution_effectivity * profile[N - 1]`, where N is the number of
 * beacons whose supply area reaches the machine. `beacon_counter` picks what
 * N counts — every beacon in range (`'total'`, the default) or only beacons
 * of the same prototype (`'same_type'`, the vanilla beacon). Counts past the
 * end of `profile` clamp to its last entry; a missing profile means no
 * falloff (`[1]`).
 *
 * `profile` is also how mods express "beacon overload": Space Exploration
 * beacons have `profile: [1, 0]`, i.e. a machine reached by two or more
 * beacons receives nothing at all.
 */
export function beaconEffectMultiplier(
    beacon: BeaconPrototype,
    sameTypeCount: number,
    totalCount: number,
    quality?: string
): number {
    const count = beacon.beacon_counter === 'same_type' ? sameTypeCount : totalCount
    const profile = beacon.profile ?? [1]
    const index = Math.min(Math.max(count, 1), profile.length) - 1
    const bonus =
        (beacon as BeaconPrototype & { distribution_effectivity_bonus_per_quality_level?: number })
            .distribution_effectivity_bonus_per_quality_level ?? 0
    const effectivity = beacon.distribution_effectivity + bonus * qualityLevel(quality)
    return effectivity * profile[index]
}
