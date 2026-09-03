import { Color, QualityPrototype } from 'factorio:prototype'
import FD, { getColor } from './factorioData'

/**
 * Built-in vanilla quality tiers (FFF-375 / wiki). Legendary is level **5**,
 * not 4 — effects scale with `level`, so nothing may treat the fifth tier as
 * index 4. Used when a pack's `data.json` has no `qualities` key (dumps from
 * before the exporter extracted `data.raw.quality`) and as the color/label
 * fallback for the five names every 2.0 quality-mod game shares.
 *
 * Exact RGBA is replaced by `data.raw.quality[*].color` once a dump carries
 * the prototypes; these are the conventional diamond tints for the drawn
 * fallback badge.
 */
export interface BuiltinQualityTier {
    name: string
    localised_name: string
    level: number
    color: Color
}

export const BUILTIN_QUALITY_TIERS: Record<string, BuiltinQualityTier> = {
    normal: {
        name: 'normal',
        localised_name: 'Normal',
        level: 0,
        color: { r: 0.62, g: 0.62, b: 0.62 },
    },
    uncommon: {
        name: 'uncommon',
        localised_name: 'Uncommon',
        level: 1,
        color: { r: 0.14, g: 0.8, b: 0.14 },
    },
    rare: {
        name: 'rare',
        localised_name: 'Rare',
        level: 2,
        color: { r: 0.29, g: 0.58, b: 1 },
    },
    epic: {
        name: 'epic',
        localised_name: 'Epic',
        level: 3,
        color: { r: 0.78, g: 0.22, b: 0.97 },
    },
    legendary: {
        name: 'legendary',
        localised_name: 'Legendary',
        level: 5,
        color: { r: 1, g: 0.63, b: 0.12 },
    },
}

/** Strength used by crafting-speed / module-effect formulas: 0.3 × level. */
export function qualityLevel(id: string | undefined): number {
    if (!id || id === 'normal') return 0
    const dumped = FD.qualities?.[id]
    if (dumped && typeof dumped.level === 'number') return dumped.level
    return BUILTIN_QUALITY_TIERS[id]?.level ?? 0
}

/** Crafting-speed multiplier from entity quality: 1 + 0.3 × level. */
export function qualityCraftingSpeedMul(quality: string | undefined): number {
    return 1 + 0.3 * qualityLevel(quality)
}

/**
 * Positive module effects scale with the *module's* quality; negatives stay
 * as written (FFF-375).
 */
export function scalePositiveEffect(value: number, quality: string | undefined): number {
    if (value <= 0) return value
    return value * (1 + 0.3 * qualityLevel(quality))
}

/**
 * Resolved tier for badges / pickers. Dump wins (icon, color, level, locale);
 * then the built-in five; unknown names get a neutral placeholder so a modded
 * blueprint doesn't throw.
 */
export function resolveQuality(
    id: string | undefined
): (BuiltinQualityTier & Partial<QualityPrototype>) | undefined {
    if (!id) return undefined
    const dumped = FD.qualities?.[id]
    const builtin = BUILTIN_QUALITY_TIERS[id]
    if (dumped) {
        return {
            name: dumped.name,
            localised_name:
                (dumped as QualityPrototype & { localised_name?: string }).localised_name ??
                builtin?.localised_name ??
                dumped.name,
            level: dumped.level,
            color: dumped.color ?? builtin?.color ?? { r: 0.5, g: 0.5, b: 0.5 },
            icon: dumped.icon,
            icons: dumped.icons,
            icon_size: dumped.icon_size,
        }
    }
    if (builtin) return builtin
    return {
        name: id,
        localised_name: id,
        level: 0,
        color: { r: 0.45, g: 0.45, b: 0.5 },
    }
}

/**
 * Anything other than omitted/`normal` gets a badge — including unknown mod
 * names (neutral diamond) and dumped tiers whose `level` happens to be 0.
 * Fluids never carry quality; callers skip those icons separately.
 */
export function qualityShowsBadge(quality: string | undefined): boolean {
    return !!quality && quality !== 'normal'
}

/** Persist / paint key: omit when the tier is Normal (or unset). */
export function storedQuality(quality: string | undefined): string | undefined {
    return qualityShowsBadge(quality) ? quality : undefined
}

const HIDDEN_PICKER_TIERS = new Set(['quality-unknown'])

/**
 * Tiers the quality picker should offer. Dump order by `level` when the pack
 * shipped `qualities`; otherwise the built-in five. `quality-unknown` is a
 * dump sentinel, not a user-facing tier.
 */
export function pickerQualityTiers(): { id: string; label: string }[] {
    const dumped = FD.qualities
    const names =
        dumped && Object.keys(dumped).length > 0
            ? Object.values(dumped)
                  .filter(q => q?.name && !HIDDEN_PICKER_TIERS.has(q.name))
                  .sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
                  .map(q => q.name)
            : Object.keys(BUILTIN_QUALITY_TIERS)
    return names.map(id => {
        const q = resolveQuality(id)
        const raw = q?.localised_name
        const label = typeof raw === 'string' ? raw : id
        return { id, label }
    })
}

/** Human label for the info panel (`Legendary`), or undefined when no badge. */
export function qualityDisplayName(quality: string | undefined): string | undefined {
    if (!qualityShowsBadge(quality)) return undefined
    const q = resolveQuality(quality)
    const name = q?.localised_name
    return typeof name === 'string' ? name : quality
}

/**
 * The five vanilla quality tier names in ascending order. Used by the quality
 * roll distribution to walk from the input tier upward.
 */
export const QUALITY_TIER_ORDER: readonly string[] = [
    'normal',
    'uncommon',
    'rare',
    'epic',
    'legendary',
]

/** Index of a quality name in the tier order; unknown names map to 0 (normal). */
export function qualityTierIndex(id: string | undefined): number {
    if (!id || id === 'normal') return 0
    const idx = QUALITY_TIER_ORDER.indexOf(id)
    return idx >= 0 ? idx : 0
}

/**
 * Quality roll output distribution (Factorio wiki / FFF-375).
 *
 * When a machine has quality modules summing to total quality chance `Q`:
 *   - First roll: `Q` chance to upgrade one tier from the input quality.
 *   - Each subsequent roll: fixed 10% (`next_probability = 0.1`) chance to
 *     upgrade one more tier, until a roll fails or legendary is reached.
 *
 * This produces (from the wiki's derived formula for normal-quality input):
 *   - stays at input tier:  `1 - Q`
 *   - +1 tier:              `Q × 0.9`
 *   - +2 tiers:             `Q × 0.09`
 *   - +3 tiers:             `Q × 0.009`
 *   - +4 tiers (legendary): `Q × 0.001`  (absorbs the remaining tail)
 *
 * When input quality is above normal the same ladder applies upward, but the
 * output can never drop below the input tier — so `1 - Q` stays at input, and
 * the roll probabilities are compressed into the remaining tiers above.
 *
 * Returns an array of `{ quality, fraction }` for every tier that has a
 * non-zero chance, sorted ascending by tier. Fluids ignore quality entirely
 * (callers filter them out).
 */
export interface QualityDistribution {
    quality: string
    fraction: number
}

const NEXT_PROBABILITY = 0.1

export function qualityRollDistribution(
    totalQualityChance: number,
    inputQuality?: string
): QualityDistribution[] {
    const Q = Math.max(0, Math.min(1, totalQualityChance))
    const inputIdx = qualityTierIndex(inputQuality)
    const maxIdx = QUALITY_TIER_ORDER.length - 1

    if (Q <= 0 || inputIdx >= maxIdx) {
        return [{ quality: QUALITY_TIER_ORDER[inputIdx], fraction: 1 }]
    }

    const result: QualityDistribution[] = []
    let remaining = 1

    // Fraction that stays at input tier
    const stayFraction = 1 - Q
    result.push({ quality: QUALITY_TIER_ORDER[inputIdx], fraction: stayFraction })
    remaining -= stayFraction

    // Walk upward from inputIdx+1; each step has a chain probability of 10%
    // to continue to the next tier.
    let chainProb = Q
    for (let tier = inputIdx + 1; tier <= maxIdx; tier++) {
        if (tier === maxIdx) {
            // Legendary absorbs all remaining probability
            result.push({ quality: QUALITY_TIER_ORDER[tier], fraction: remaining })
        } else {
            const tierFraction = chainProb * (1 - NEXT_PROBABILITY)
            result.push({ quality: QUALITY_TIER_ORDER[tier], fraction: tierFraction })
            remaining -= tierFraction
            chainProb *= NEXT_PROBABILITY
        }
    }

    return result.filter(d => d.fraction > 1e-10)
}

/**
 * Dump colors are either 0–1 floats or 0–255 ints (and sometimes arrays). Same
 * rule as `applyTint`: any component > 1 means the whole colour is 0–255.
 */
export function qualityColorHex(
    color:
        | Color
        | readonly [number, number, number]
        | readonly [number, number, number, number]
        | undefined
): number {
    if (color === undefined) return 0x808080
    const c = getColor(color)
    let r = c.r || 0
    let g = c.g || 0
    let b = c.b || 0
    if (r > 1 || g > 1 || b > 1) {
        r /= 255
        g /= 255
        b /= 255
    }
    return Math.floor(r * 255) * 0x10000 + Math.floor(g * 255) * 0x100 + Math.floor(b * 255)
}

/** CSS `#rrggbb` for a quality id — used by the DOM overlay diamond. */
export function qualityColorCss(id: string | undefined): string {
    const hex = qualityColorHex(resolveQuality(id)?.color)
    return `#${hex.toString(16).padStart(6, '0')}`
}
