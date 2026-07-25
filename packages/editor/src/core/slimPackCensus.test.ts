import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { loadData } from './factorioData'
import { havePackData, readPackData } from './packDataFiles'
import { clearSpriteDataCache } from './spriteDataBuilder'
import { collectSpriteRects } from './spriteCensus'
import { TextureTransforms, containsRect, mapRectToFile, shippedSize } from './textureTransform'

/**
 * Census verification of a generated **graphics variant** pack
 * (docs/slim-graphics.md): replay the editor's whole sprite enumeration against
 * the variant's `textures.json` and assert every rect it can request resolves
 * INSIDE the shipped texture. That is the property the whole slim pipeline rests
 * on — a crop that lost a rect renders as the missing-texture checkerboard, and
 * only this test catches it before a human does.
 *
 * Self-skips unless the variant has been generated locally:
 *
 *   npm run rect-report -- vanilla-2.0 packages/exporter/data/rect-report-vanilla-2.0.json
 *   cd packages/exporter && cargo run --release -- \
 *       --pack vanilla-2.0 --slim ./data/rect-report-vanilla-2.0.json
 *
 * (The variant isn't published yet, so CI has nothing to fetch — see the doc's
 * Status list.)
 */
const VARIANTS: { base: string; variant: string }[] = [
    { base: 'vanilla-2.0', variant: 'vanilla-2.0-slim' },
    { base: 'space-age', variant: 'space-age-slim' },
    { base: 'space-exploration', variant: 'space-exploration-slim' },
]

const variantDir = (id: string): string => `packages/exporter/data/output/${id}`
const transformsPath = (id: string): string => `${variantDir(id)}/textures.json`

describe.each(VARIANTS)('slim pack census: $variant', ({ base, variant }) => {
    const ready = havePackData(base) && existsSync(transformsPath(variant))

    it.skipIf(!ready)(
        'resolves every census rect inside the shipped textures',
        () => {
            clearSpriteDataCache()
            loadData(readPackData(base))
            const transforms: TextureTransforms = JSON.parse(
                readFileSync(transformsPath(variant), 'utf8')
            )
            // The walk deliberately asks for combinations an entity may not support
            // (all 16 directions, every combinator operator, …); the generators log
            // and degrade on those, by design — thousands of lines that would bury
            // the rest of `npm test`'s output.
            const realError = console.error
            const realWarn = console.warn
            console.error = () => undefined
            console.warn = () => undefined
            let report: ReturnType<typeof collectSpriteRects>['report']
            try {
                ;({ report } = collectSpriteRects())
            } finally {
                console.error = realError
                console.warn = realWarn
            }

            const outside: string[] = []
            const unshipped: string[] = []
            for (const file of Object.keys(report)) {
                const [x, y, w, h] = report[file].bbox
                const transform = transforms[file]
                if (!transform) {
                    // No entry = identity, which is only legitimate if the variant
                    // ships the file untransformed. It must at least exist.
                    if (!existsSync(`${variantDir(variant)}/${file.replace('.png', '.basis')}`)) {
                        unshipped.push(file)
                    }
                    continue
                }
                // The report's bbox is the UNION of every rect the editor can request
                // for this file, so "bbox inside the crop" ⇒ every rect is. Zero-size
                // (whole-file) requests widen the bbox to Infinity, which no crop can
                // contain — those files must be shipped uncropped, i.e. crop origin at
                // (0, 0), which is exactly what containsRect checks for them.
                const rect = {
                    x,
                    y,
                    w: Number.isFinite(w) ? w : 0,
                    h: Number.isFinite(h) ? h : 0,
                }
                if (!containsRect(transform, rect)) {
                    outside.push(
                        `${file} rect [${x}, ${y}, ${w}, ${h}] vs crop [${transform.crop}]`
                    )
                    continue
                }
                // …and the mapped rect must land within the shipped file's bounds.
                const mapped = mapRectToFile(transform, rect)
                const size = shippedSize(transform)
                if (
                    mapped.x < 0 ||
                    mapped.y < 0 ||
                    mapped.x + mapped.w > size.w ||
                    mapped.y + mapped.h > size.h
                ) {
                    outside.push(
                        `${file} maps to [${mapped.x}, ${mapped.y}, ${mapped.w}, ${mapped.h}] ` +
                            `outside the shipped ${size.w}×${size.h}`
                    )
                }
            }

            expect(outside, `rects outside their crop:\n  ${outside.join('\n  ')}`).toEqual([])
            expect(
                unshipped,
                `files with no texture in the variant:\n  ${unshipped.join('\n  ')}`
            ).toEqual([])
            // Replaying the whole enumeration (every entity × 16 directions × every
            // draw variant, plus icons/tiles/overlays) is seconds of work, well past
            // vitest's 5s default — and more so for an SE-sized pack.
        },
        120_000
    )

    it.skipIf(!ready)("ships the base pack's data.json byte-identically", () => {
        const baseData = readPackData(base)
        const variantData = readFileSync(`${variantDir(variant)}/data.json`, 'utf8')
        // A variant is a GRAPHICS change only: same prototypes, so blueprints and
        // the library are portable across variants by construction.
        expect(variantData.length).toBe(baseData.length)
        expect(variantData === baseData).toBe(true)
    })
})
