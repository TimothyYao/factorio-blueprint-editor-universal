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

/** Human label for the info panel (`Legendary`), or undefined when no badge. */
export function qualityDisplayName(quality: string | undefined): string | undefined {
    if (!qualityShowsBadge(quality)) return undefined
    const q = resolveQuality(quality)
    const name = q?.localised_name
    return typeof name === 'string' ? name : quality
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
