// Texture transforms — how a *graphics variant* pack's shipped image files map
// back to the base pack's original images (see docs/slim-graphics.md).
//
// A slim pack ships the base pack's byte-identical `data.json` — so every sprite
// is still addressed as `(file, x, y, w, h)` in the ORIGINAL image's pixel space
// — plus a `textures.json` sidecar saying, per file, which region of the original
// the shipped file contains and by how much it was scaled down. `G.getTexture`
// (the single texture seam) consults this to turn an original-space request into
// a frame of the shipped file.
//
// Everything here is pure and framework-free so the mapping math is unit-testable
// (`textureTransform.test.ts`) and reusable by the census verifier, which replays
// every rect the editor can generate through it and asserts it lands inside the
// shipped file. A missing entry (or a missing `textures.json` — a full pack) is
// IDENTITY: undefined transform ⇒ pass-through, which is why full packs and old
// deploys are untouched by all of this.

/** One file's transform. Keys are the `.png` paths exactly as `data.json` spells them. */
export interface TextureTransform {
    /** Region of the ORIGINAL image the shipped file contains: `[x, y, w, h]`. */
    crop: [number, number, number, number]
    /** Factor applied after cropping (0.5 = half resolution). */
    scale: number
}

/** The whole `textures.json` sidecar: `path -> transform`. */
export type TextureTransforms = Record<string, TextureTransform>

/** A sprite rect, in whichever pixel space the surrounding function documents. */
export interface Rect {
    x: number
    y: number
    w: number
    h: number
}

/**
 * A request for `w`/`h` of 0 means "the whole file" (`getTexture` leaves the frame
 * to PixiJS, which fills it from the source size). That's only meaningful under a
 * transform whose crop starts at the origin — i.e. a downscale-only file, which is
 * exactly what the exporter emits for files it doesn't crop. A cropped file asked
 * for "the whole image" cannot be served and is reported out-of-bounds.
 */
const isWholeFileRequest = (r: Rect): boolean => r.w <= 0 || r.h <= 0

/** True if `rect` (original-space) lies entirely inside the transform's crop. */
export function containsRect(transform: TextureTransform | undefined, rect: Rect): boolean {
    if (!transform) return true
    const [cx, cy, cw, ch] = transform.crop
    if (isWholeFileRequest(rect)) return cx === 0 && cy === 0
    return rect.x >= cx && rect.y >= cy && rect.x + rect.w <= cx + cw && rect.y + rect.h <= cy + ch
}

/**
 * Map an original-space rect into the shipped file's REAL pixel coordinates:
 * `x' = (x - crop.x) * scale`, `w' = w * scale`. This is the design doc's formula
 * and what the census verifier bounds-checks against `shippedSize`; the renderer
 * itself uses `mapRectToFrame` (see there for why the pixel scaling is left to
 * PixiJS). Returns the mapping even when it falls outside the crop — callers that
 * care ask `containsRect` first.
 */
export function mapRectToFile(transform: TextureTransform | undefined, rect: Rect): Rect {
    if (!transform) return { ...rect }
    const [cx, cy] = transform.crop
    const s = transform.scale
    return {
        x: (rect.x - cx) * s,
        y: (rect.y - cy) * s,
        w: rect.w * s,
        h: rect.h * s,
    }
}

/**
 * The shipped file's pixel size (before the exporter's power-of-two padding,
 * which only ever adds unused pixels to the right/bottom). `ceil` mirrors the
 * exporter's rounding, so a crop with an odd dimension keeps its last half pixel
 * rather than truncating a sprite's final column.
 */
export function shippedSize(transform: TextureTransform): { w: number; h: number } {
    const [, , cw, ch] = transform.crop
    return { w: Math.ceil(cw * transform.scale), h: Math.ceil(ch * transform.scale) }
}

/**
 * Map an original-space rect to the PixiJS `Texture.frame` to use for it, or
 * `null` when the rect falls outside the crop (caller shows the missing-texture
 * placeholder and logs).
 *
 * THE FRAME IS RETURNED IN ORIGINAL PIXEL UNITS, only shifted by the crop origin
 * — the `* scale` is deliberately NOT applied here. The renderer instead sets the
 * shared `TextureSource.resolution` to the transform's scale, which makes PixiJS
 * treat the shipped file as `pixelWidth / scale` logical pixels wide: frames (and
 * therefore `texture.width` / `texture.height`, which every consumer sizes and
 * anchors from) stay in the original pack's units, and the UVs come out right
 * because `updateUvs` divides the frame by that same resolution-adjusted source
 * size. See the comment in `globals.ts:getTexture` for why that mechanism was
 * chosen over per-sprite scale compensation.
 *
 * A whole-file request maps to a zero-size frame, the caller's own "let PixiJS
 * fill it from the source size" convention.
 */
export function mapRectToFrame(transform: TextureTransform | undefined, rect: Rect): Rect | null {
    if (!containsRect(transform, rect)) return null
    if (!transform) return { ...rect }
    const [cx, cy] = transform.crop
    if (isWholeFileRequest(rect)) return { x: 0, y: 0, w: rect.w, h: rect.h }
    return { x: rect.x - cx, y: rect.y - cy, w: rect.w, h: rect.h }
}
