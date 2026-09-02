import { Color, QualityPrototype } from 'factorio:prototype'
import FD from './factorioData'

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
