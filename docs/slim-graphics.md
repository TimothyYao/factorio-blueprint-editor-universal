# Slim graphics: variant packs, texture transforms, and the full-quality unlock

Design record + tracker for the graphics-slimming slice of the data-plane
work (fbe #29's unpause path; the last open box in the FIB fork's
`docs/data-plane.md`). The product idea, long term: the **publicly hosted
default is a slimmed asset set** (lower resolution, no animation frames —
smaller and a materially lighter fair-use posture), and **full-quality
graphics are an unlock** — served from a privately hosted URL, or provided
by the user's own game files. Blueprints, the library, and all user state
are completely independent of which graphics variant is active.

## Variant packs (`variantOf`)

A slim pack is a **graphics-only variant** of a base pack: same Factorio
version, same mod set, same `data.json` semantics — different texture files.
The manifest (`packs.json` in `trisiak/factorio-pack-data`) expresses that
additively:

```jsonc
{
    "id": "vanilla-2.0-slim",
    "label": "Vanilla 2.0 (slim)",
    "variantOf": "vanilla-2.0",
    "graphics": "slim",
    "artifacts": ["editor"],
} // no browser/ tier — FIB is unaffected
```

Rules:

- **The canonical pack id is `variantOf ?? id`.** Everything that scopes
  user state by pack — the blueprint library's top-level tier
  (`store.ts` `packs[<id>]`), the per-pack scratchpad and active leaf,
  cross-pack copy/strip-on-open checks — keys on the **canonical** id.
  Switching between `vanilla-2.0` and `vanilla-2.0-slim` changes textures
  and nothing else: same library subtree, same active blueprint, no
  strip-on-open. Only the persisted `DATA_PACK` choice (which variant to
  load) uses the variant id.
- Blueprint compatibility is a data question, not a graphics question — a
  blueprint made on any variant of a pack is native to every variant.
- FIB ignores variant entries entirely (its bundled manifest lists packs
  explicitly; slim variants carry no `browser/` tier).

## Texture transforms (`textures.json`)

`data.json` addresses sprites as `(file, x, y, w, h)` in the source image's
pixel space, and everything funnels through **one seam**:
`G.getTexture(path, x, y, w, h)` (`editor/src/common/globals.ts`). A slim
pack publishes the same `data.json` (byte-identical to the base pack's) plus
a **`textures.json`** sidecar describing, per texture file, how the shipped
file maps back to the original image:

```jsonc
{ "__base__/graphics/entity/assembling-machine-2/….png":
    { "crop": [x, y, w, h],   // region of the ORIGINAL image this file contains
      "scale": 0.5 } }        // factor applied after cropping
```

Keys are the **`.png` paths exactly as `data.json` spells them** — i.e. the
`path` argument of `getTexture`, before its `.png` → `.basis` swap — so both
sides key off the one string that already exists on both sides.

`getTexture` applies the transform when present (`x' = (x-crop.x)*scale`, …); a
missing entry or a missing `textures.json` means identity — full packs are
untouched and old deploys keep working. Requests that fall outside the cropped
region (a code path the census missed, or a future editor feature) fail soft to
the existing missing-texture placeholder and log loudly (once per file, not once
per sprite).

**How the `scale` is applied (implementation note).** Not by per-sprite scale
compensation, which would have to be repeated at every `getTexture` consumer and
would fight `data.scale` / `squishY` / `sprite.width` arithmetic in
`EntitySprite`. Instead the shipped file's shared `TextureSource.resolution` is
set to the transform's scale: PixiJS defines a source's logical size as
`pixelWidth / resolution`, so a 0.5× file measures exactly like the original.
Frames stay in **original units** (shifted only by the crop origin),
`texture.width/height` keep reporting original dimensions for every consumer that
sizes or anchors from them, and `updateUvs` divides by the same
resolution-adjusted size, so the UVs land on the right texels. One line at the
single seam, a no-op at scale 1. The mapping math itself is pure and unit-tested
(`core/textureTransform.ts`).

## What slimming does

1. **Downscale** every sprite 0.5× (Factorio ships HR ~2× art, so this is
   roughly native-resolution quality) → ~4× size reduction across the board.
2. **Strip animation frames.** The editor renders frame 0 only (idle
   animations are #29/#53, paused). Animation sheets carry `frame_count`
   / `line_length` / `direction_count` grids; naively cropping "the first
   frame" is unsafe (direction variants stack in the same sheet). Instead:
   **the census decides.** `spriteCensus.test.ts` (#28's ratchet) already
   enumerates, per pack, every `(file, x, y, w, h)` the editor can generate
   across all entities/directions at frame 0 — a build step extracts that
   enumeration into a rect report, and each file is cropped to the union
   bounding box of its actually-sampled rects. Whatever the editor can draw
   survives by construction; everything else (trailing frames, unused
   layers) is dropped.
3. `basisu` settings stay as-is initially (a compression-quality pass is a
   later, orthogonal knob).

**Nothing is dropped.** The census enumerates what the editor _draws_; a file
referenced by `data.json` that it never samples (UI-only art, unreferenced
layers) is still shipped — downscaled but uncropped — rather than dropped. A
dropped file that some code path does reach is a visible hole, while keeping it
costs only the 4× the downscale gives anyway. The exporter's run log counts the
two buckets separately. Crop rectangles are snapped outward to even coordinates
so the 0.5× texel grid stays aligned with the original image's.

Beyond entity sprites the rect report also enumerates the other `getTexture`
call sites, since they share files with nothing else to protect them: prototype
**icons** (`icon`/`icons`/`dark_background_icon*`, always `(0, 0, size, size)`),
**tile** variant grids, and the **overlay/utility** sprites (a generic sweep of
`utilitySprites` plus each entity's `underground_sprite`).

Pipeline: rect report (node script over `@fbe/editor`'s own sprite-generation
logic, fed the pack's `data.json`) → exporter slim mode (crop + downscale +
basisu + emit `textures.json`) → publish as a variant pack on the data
plane. **Verification is the same census**, re-run against the slim pack
with transforms applied: every rect must resolve inside the shipped
textures, pixel-for-pixel coverage of frame-0 rendering. Plus the e2e visual
tour on the slim pack for eyeballing.

## The full-quality unlock (design space, not built yet)

The graphics _source_ becomes a setting, orthogonal to the pack choice:

- **Default:** the data plane's slim variant.
- **Private URL:** point the editor at a privately hosted base URL carrying
  full-quality editor tiers (the data repo's pipeline can produce them for
  self-hosting; `VITE_DATA_URL`-style, but a runtime setting).
- **Bring-your-own via OPFS:** the user picks their local Factorio install
  (File System Access API); sprite paths (`__<mod>__/…`) map 1:1 to game
  files, which are imported into the Origin Private File System and served
  to `getTexture` through a loader seam (PNG decode instead of basis
  transcode). No redistribution at all — the user's own purchased assets,
  never leaving their machine.

Open questions parked here: whether slim becomes the only publicly hosted
editor tier (the #29 end-state) or coexists with full for a while; OPFS
storage budget for SE-sized packs; whether the private-URL path wants
auth-fronted hosting guidance.

## Status

- [x] Editor: `textures.json` transform support in `getTexture` (+ soft-fail
      outside crop) and canonical-id (`variantOf`) keying for the library and
      pack-scoped state; manifest `variantOf`/`graphics` fields understood by the
      pack selector (variant grouping in the UI).
      <br>`core/textureTransform.ts` (pure mapping math + tests),
      `core/packManifest.ts` (`canonicalPackId` / `canonicalPacks` /
      `packSelectorOptions` + tests), `common/globals.ts` (the seam, the shared
      `packs.json` fetch), `website/index.ts` (library scoped by canonical id),
      `website/settingsPane.ts` (variant-aware selector).
- [x] Rect report: extract the census enumeration into a reusable script
      emitting per-file union bboxes for a pack.
      <br>`core/spriteCensus.ts` (shared by the #28 ratchet test and the report),
      `editor/scripts/spriteRects.ts`, `npm run rect-report -- <pack> [out.json]`.
- [x] Exporter: slim mode (crop + 0.5× downscale + `textures.json`),
      driven by the rect report; census re-verification against the transformed
      output.
      <br>`exporter/src/slim.rs` (`--slim <rect-report.json>`, README section) +
      `core/slimPackCensus.test.ts`, which replays the census against a locally
      generated variant and asserts every rect resolves inside the shipped textures.
- [ ] Generate `vanilla-2.0-slim` as the **temporary iteration pack**,
      publish via the data plane, verify in-editor (census + e2e + tour).
      <br>Generated and census-verified locally (1963 textures, 71 MB → ~18 MB);
      publishing, the e2e tour and the visual QA pass are what remain.
- [ ] Iterate: size numbers, visual QA, then SA/SE variants; then the
      unlock paths; then decide the public-hosting end-state (#29).
