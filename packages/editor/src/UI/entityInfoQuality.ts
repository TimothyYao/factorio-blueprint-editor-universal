import { qualityRollDistribution } from '../core/quality'

/** One side of a recipe row: an item/fluid token with its (resolved) amount. */
export interface EntityInfoStack {
    type: string
    name: string
    amount: number
    quality?: string
}

/**
 * Tag non-fluid stacks with the recipe's input quality. Fluids never carry
 * quality; Normal / unset leaves stacks untouched.
 */
export function withRecipeQuality(
    stacks: EntityInfoStack[],
    recipeQuality?: string
): EntityInfoStack[] {
    if (!recipeQuality || recipeQuality === 'normal') return stacks
    return stacks.map(s => (s.type === 'fluid' ? s : { ...s, quality: recipeQuality }))
}

/**
 * Split a set of recipe results into quality-distributed stacks. Non-fluid
 * outputs are multiplied by the quality roll distribution; fluids pass through
 * unchanged (they never carry quality). When `recipeQuality` is set, non-fluid
 * outputs inherit that quality instead of normal (the input quality floor).
 *
 * Amounts are left unrounded here so a tiny legendary fraction (Q × 0.001)
 * survives until display multiplies by the active rate unit (/s /m /h). Filtering
 * on a pre-rounded per-second amount used to drop legendary entirely.
 */
export function qualitySplitResults(
    results: EntityInfoStack[],
    qualityChance: number,
    recipeQuality?: string
): EntityInfoStack[] {
    if (qualityChance <= 0 && !recipeQuality) return results

    const inputQuality = recipeQuality || undefined
    const dist = qualityChance > 0 ? qualityRollDistribution(qualityChance, inputQuality) : null
    const out: EntityInfoStack[] = []

    for (const r of results) {
        if (r.type === 'fluid') {
            out.push(r)
            continue
        }

        if (dist && dist.length > 1) {
            for (const d of dist) {
                const amount = r.amount * d.fraction
                const isInputTier = d.quality === (inputQuality || 'normal')
                // Always keep the regular / input-tier row (total minus the
                // quality upgrades) even when the remainder is ~0. Match the
                // rates calculator's 1e-10 floor so legendary isn't dropped
                // just because its per-second share rounds below 0.001.
                if (!isInputTier && amount < 1e-10) continue
                out.push({
                    type: r.type,
                    name: r.name,
                    amount,
                    quality: d.quality === 'normal' ? undefined : d.quality,
                })
            }
        } else {
            // No quality modules, but recipe has quality — tag all items with it
            out.push({
                ...r,
                quality: inputQuality,
            })
        }
    }
    return out
}
