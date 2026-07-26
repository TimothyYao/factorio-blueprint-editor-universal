import { describe, it, expect } from 'vitest'
import {
    TextureTransform,
    containsRect,
    mapRectToFile,
    mapRectToFrame,
    shippedSize,
} from './textureTransform'

/**
 * The `textures.json` mapping math (docs/slim-graphics.md). This is the whole
 * correctness surface of graphics variants: get it wrong and every sprite of a
 * slim pack samples the wrong texels, silently. The renderer around it is PixiJS
 * plumbing verified by running the app (and by the census verifier in
 * `slimPackCensus.test.ts`, which replays real rects through these functions).
 */

/** A cropped + halved file: original region (100, 200) 400×300 → 200×150 shipped. */
const CROPPED: TextureTransform = { crop: [100, 200, 400, 300], scale: 0.5 }
/** A downscale-only file (what the exporter emits for anything it doesn't crop). */
const WHOLE: TextureTransform = { crop: [0, 0, 1024, 512], scale: 0.5 }

describe('textureTransform', () => {
    it('is identity without a transform', () => {
        const rect = { x: 3, y: 5, w: 7, h: 11 }
        expect(containsRect(undefined, rect)).toBe(true)
        expect(mapRectToFile(undefined, rect)).toEqual(rect)
        expect(mapRectToFrame(undefined, rect)).toEqual(rect)
    })

    it('maps an original-space rect into the shipped file (x-crop.x)*scale', () => {
        expect(mapRectToFile(CROPPED, { x: 100, y: 200, w: 64, h: 64 })).toEqual({
            x: 0,
            y: 0,
            w: 32,
            h: 32,
        })
        expect(mapRectToFile(CROPPED, { x: 300, y: 400, w: 200, h: 100 })).toEqual({
            x: 100,
            y: 100,
            w: 100,
            h: 50,
        })
    })

    it('leaves the scale to the source resolution in the PixiJS frame', () => {
        // Frames stay in ORIGINAL units, shifted by the crop origin only — see
        // mapRectToFrame's doc comment (TextureSource.resolution does the scaling).
        expect(mapRectToFrame(CROPPED, { x: 300, y: 400, w: 200, h: 100 })).toEqual({
            x: 200,
            y: 200,
            w: 200,
            h: 100,
        })
    })

    it('accepts rects flush with the crop edges', () => {
        expect(containsRect(CROPPED, { x: 100, y: 200, w: 400, h: 300 })).toBe(true)
        expect(mapRectToFile(CROPPED, { x: 100, y: 200, w: 400, h: 300 })).toEqual({
            x: 0,
            y: 0,
            w: 200,
            h: 150,
        })
    })

    it('rejects rects that start before or extend past the crop', () => {
        expect(containsRect(CROPPED, { x: 99, y: 200, w: 10, h: 10 })).toBe(false)
        expect(containsRect(CROPPED, { x: 100, y: 199, w: 10, h: 10 })).toBe(false)
        expect(containsRect(CROPPED, { x: 100, y: 200, w: 401, h: 300 })).toBe(false)
        expect(containsRect(CROPPED, { x: 100, y: 200, w: 400, h: 301 })).toBe(false)
        expect(mapRectToFrame(CROPPED, { x: 0, y: 0, w: 64, h: 64 })).toBeNull()
    })

    it('serves a whole-file request only when the crop starts at the origin', () => {
        // w/h of 0 is getTexture's "let PixiJS size it from the source" convention.
        expect(containsRect(WHOLE, { x: 0, y: 0, w: 0, h: 0 })).toBe(true)
        expect(mapRectToFrame(WHOLE, { x: 0, y: 0, w: 0, h: 0 })).toEqual({
            x: 0,
            y: 0,
            w: 0,
            h: 0,
        })
        expect(containsRect(CROPPED, { x: 0, y: 0, w: 0, h: 0 })).toBe(false)
        expect(mapRectToFrame(CROPPED, { x: 0, y: 0, w: 0, h: 0 })).toBeNull()
    })

    it('rounds the shipped size up, matching the exporter', () => {
        expect(shippedSize(CROPPED)).toEqual({ w: 200, h: 150 })
        // An odd crop dimension keeps its last half pixel rather than truncating.
        expect(shippedSize({ crop: [0, 0, 101, 33], scale: 0.5 })).toEqual({ w: 51, h: 17 })
    })

    it('keeps every in-crop rect inside the shipped file bounds', () => {
        // The invariant the census verifier asserts against a real slim pack.
        const size = shippedSize(CROPPED)
        for (const rect of [
            { x: 100, y: 200, w: 1, h: 1 },
            { x: 137, y: 271, w: 63, h: 29 },
            { x: 460, y: 470, w: 40, h: 30 },
        ]) {
            expect(containsRect(CROPPED, rect)).toBe(true)
            const m = mapRectToFile(CROPPED, rect)
            expect(m.x).toBeGreaterThanOrEqual(0)
            expect(m.y).toBeGreaterThanOrEqual(0)
            expect(m.x + m.w).toBeLessThanOrEqual(size.w)
            expect(m.y + m.h).toBeLessThanOrEqual(size.h)
        }
    })
})
