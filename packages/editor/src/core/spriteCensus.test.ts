import { describe, it, expect } from 'vitest'
import { loadData } from './factorioData'
import { havePackData, readPackData } from './packDataFiles'
import { clearSpriteDataCache } from './spriteDataBuilder'
import { censusEntities } from './spriteCensus'

/**
 * Sprite-generation census + ratchet (issue #28).
 *
 * Runs every entity of every committed data pack through getSpriteData and
 * tallies three buckets:
 *  - ok:      a non-empty sprite list, every visible part resolvable
 *  - partial: sprites generated, but some part resolves to no texture — no
 *             `filename`, `filenames`, or `stripes` (e.g. an un-flattened
 *             `{layers}` object) — so EntitySprite drops it and the entity
 *             renders incomplete
 *  - failed:  SPRITE_GENERATION_FAILED — the entity draws as the labeled
 *             UnknownEntitySprite box fallback
 *
 * The exact counts below are a RATCHET: when a fix lands, lower the numbers
 * (the test fails on improvement too, so the baseline can't go stale); a
 * regression can never land silently. The failing assertion message lists the
 * offending entity names — that listing is the live to-do list for #28.
 *
 * The walk itself lives in `spriteCensus.ts`, shared with the rect report that
 * drives slim-graphics cropping (docs/slim-graphics.md) — same enumeration, so a
 * pack can't be cropped to less than what this test says the editor draws.
 */
const BASELINES: Record<string, { partial: number; failed: number }> = {
    // Remaining failures are graphics-less internal entities (dummy rails,
    // fulgoran ruin attractor, SE's spaceship-clamp/console/blocker internals)
    // that draw as the labeled box — acceptable; they aren't placeable buildings.
    'vanilla-2.0': { partial: 0, failed: 2 },
    'space-age': { partial: 0, failed: 3 },
    'space-exploration': { partial: 0, failed: 10 },
}

describe.each(Object.keys(BASELINES))('sprite census: %s', pack => {
    it.skipIf(!havePackData(pack))('matches the ratchet baseline', () => {
        // Both loadData and the generator cache are module-global; clear the
        // cache so this pack's tally can't be served generators that closed
        // over a previously loaded pack's prototypes (cache keys are names,
        // which collide across packs).
        clearSpriteDataCache()
        // Repo-root relative: vitest runs with the repo root as cwd (the root
        // vitest.config.ts), and the tsconfig types don't cover __dirname /
        // import.meta.url, so a plain relative path is the portable option.
        loadData(readPackData(pack))

        const { failed, partial } = censusEntities()

        const baseline = BASELINES[pack]
        expect(failed.length, `failed entities: ${failed.join(', ')}`).toBe(baseline.failed)
        expect(partial.length, `partial entities: ${partial.join(', ')}`).toBe(baseline.partial)
    })
})
