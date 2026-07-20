import { BeaconPrototype } from 'factorio:prototype'

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
    totalCount: number
): number {
    const count = beacon.beacon_counter === 'same_type' ? sameTypeCount : totalCount
    const profile = beacon.profile ?? [1]
    const index = Math.min(Math.max(count, 1), profile.length) - 1
    return beacon.distribution_effectivity * profile[index]
}
