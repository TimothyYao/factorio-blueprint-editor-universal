// Rect report generator (docs/slim-graphics.md, phase "rect report").
//
//   npm run rect-report -- <pack> [out.json]
//
// Loads a pack's `data.json` from the exporter's local output dir, replays the
// shared sprite census (`core/spriteCensus.ts` — the same enumeration the #28
// ratchet counts, here over all 16 directions and every draw variant, plus the
// icon / tile / overlay rects), and writes the union bounding box of the rects
// actually sampled per image file:
//
//   { "__base__/graphics/entity/…/foo.png": { "bbox": [x, y, w, h], "rects": 12 } }
//
// `bbox: null` means the file is requested WHOLE somewhere (a zero-size
// `getTexture` request, which is "let PixiJS size it from the source") and
// therefore can't be cropped at all — the exporter downscales it untouched.
//
// The exporter's slim mode consumes this to crop each texture, so whatever the
// editor can draw survives by construction; anything outside (trailing animation
// frames, unused layers) is dropped. Run with vite-node — no build step, the
// editor is TypeScript source.

import { loadData } from '../src/core/factorioData'
import { collectSpriteRects, SerializedRectReport } from '../src/core/spriteCensus'
import { havePackData, packDataPath, readPackData } from '../src/core/packDataFiles'
import { writeFileSync } from 'fs'
import { argv, exit } from 'node:process'

// Run through vite-node, argv still carries the runner's own entries; the `--`
// in the npm script marks where this script's arguments start.
const sep = argv.lastIndexOf('--')
const [pack, outArg] = sep === -1 ? argv.slice(2) : argv.slice(sep + 1)

if (!pack) {
    console.error('usage: npm run rect-report -- <pack> [out.json]')
    exit(2)
}
if (!havePackData(pack)) {
    console.error(
        `no data.json for pack '${pack}' at ${packDataPath(pack)} — run the exporter first ` +
            "(or fetch the pack's JSON tier from the data plane)"
    )
    exit(1)
}

const out = outArg ?? `packages/exporter/data/rect-report-${pack}.json`

console.log(`Loading ${packDataPath(pack)} …`)
loadData(readPackData(pack))

// The walk deliberately asks for combinations an entity may not support (all 16
// directions, every operator, …). The generators log and degrade on those, which
// is correct behaviour but thousands of lines of noise here — count them instead
// and restore the real console afterwards.
const realError = console.error
const realWarn = console.warn
let suppressed = 0
console.error = () => (suppressed += 1) && undefined
console.warn = () => (suppressed += 1) && undefined
let collected: ReturnType<typeof collectSpriteRects>
try {
    collected = collectSpriteRects()
} finally {
    console.error = realError
    console.warn = realWarn
}
const { report, buckets } = collected
if (suppressed > 0) {
    console.log(
        `(${suppressed} sprite-generation log line(s) suppressed — unsupported ` +
            'direction/variant combinations degrade to no sprites, by design)'
    )
}

// Deterministic output: sorted by path, so a re-run produces a byte-identical
// file and diffs between packs/versions are readable.
const sorted: SerializedRectReport = {}
let rects = 0
let whole = 0
for (const file of Object.keys(report).sort()) {
    const entry = report[file]
    const [x, y, w, h] = entry.bbox
    const unbounded = !Number.isFinite(w) || !Number.isFinite(h)
    if (unbounded) whole += 1
    rects += entry.rects
    sorted[file] = { bbox: unbounded ? null : [x, y, w, h], rects: entry.rects }
}

writeFileSync(out, `${JSON.stringify(sorted, null, 2)}\n`)

console.log(
    `Rect report for '${pack}': ${Object.keys(sorted).length} file(s), ${rects} rect(s), ` +
        `${whole} requested whole (uncroppable)`
)
console.log(
    `Census while walking: ${buckets.failed.length} entit(ies) generate no sprites, ` +
        `${buckets.partial.length} incomplete`
)
console.log(`Wrote ${out}`)
