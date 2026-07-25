// Sprite census — the shared enumeration of everything the editor can draw.
//
// Two consumers, one walk:
//
//  - `spriteCensus.test.ts` (#28's ratchet) tallies, per pack, how many entities
//    generate a complete sprite list, an incomplete one, or none at all.
//  - `scripts/spriteRects.ts` (the rect report, docs/slim-graphics.md) collects
//    every `(file, x, y, w, h)` those sprites resolve to and unions them per file,
//    which is what the exporter's slim mode crops each texture to. "Whatever the
//    editor can draw survives by construction" is only true if this enumeration
//    and the renderer agree — hence one module, imported by both, and hence
//    `resolveSpriteFilename` living here and being used by `EntitySprite` itself.
//
// Framework-free (no PixiJS): it runs in the node test env and under vite-node.

import FD from './factorioData'
import { getSpriteData, ExtendedSpriteData, SPRITE_GENERATION_FAILED } from './spriteDataBuilder'
import { Rect } from './textureTransform'

/** The `getSpriteData` argument bag (not exported by the builder). */
type DrawData = Parameters<typeof getSpriteData>[0]

/** One resolved texture request: a rect of a specific image file. */
export interface SpriteRect extends Rect {
    /** The `.png` path exactly as `data.json` spells it. */
    file: string
}

/** Per-file summary of a rect report: the union bbox and how many rects fed it. */
export interface FileRects {
    bbox: [number, number, number, number]
    rects: number
}

/** In-memory rect report: `path -> union bbox + rect count`. */
export type RectReport = Record<string, FileRects>

/**
 * The on-disk form `scripts/spriteRects.ts` writes and the exporter reads. JSON
 * has no `Infinity`, so a file that is requested WHOLE somewhere (and therefore
 * can't be cropped) serializes its bbox as `null`.
 */
export interface SerializedFileRects {
    bbox: [number, number, number, number] | null
    rects: number
}
export type SerializedRectReport = Record<string, SerializedFileRects>

/**
 * Which file a sprite part actually draws, mirroring `EntitySprite.getParts`:
 * a plain `filename`, else the direction-indexed `filenames[]`, else the first
 * `stripes[]` entry (animations whose frames are split across files). Shadows are
 * never drawn. Returns undefined when the part resolves to no texture at all —
 * the census's "partial" signal.
 */
export function resolveSpriteFilename(data: ExtendedSpriteData, direction = 0): string | undefined {
    if (!data) return undefined
    const p = data as ExtendedSpriteData & { filenames?: string[]; stripes?: { filename }[] }
    if (p.filename) return p.filename
    if (p.filenames) {
        // Use the direction-based index if the entity has one, otherwise file 0.
        const dirIndex = direction ? Math.floor(direction / 4) : 0
        return p.filenames[Math.min(dirIndex, p.filenames.length - 1)]
    }
    if (p.stripes?.[0]?.filename) return p.stripes[0].filename
    return undefined
}

/** The rect a sprite part samples, using `getTexture`'s own width/height fallbacks. */
export function spriteRectOf(data: ExtendedSpriteData, file: string): SpriteRect {
    const size = data.size
    return {
        file,
        x: data.x || 0,
        y: data.y || 0,
        w: data.width || (Array.isArray(size) ? size[0] : size) || 0,
        h: data.height || (Array.isArray(size) ? size[1] : size) || 0,
    }
}

/**
 * The non-direction axes of `getSpriteData` that change WHICH sprites come out.
 * Crossed with the directions below (rather than with each other — a full
 * cartesian product is millions of calls for no extra coverage: these knobs pick
 * independent sprite sets). `undefined` entries keep the defaults.
 *
 * Deliberately absent: `modules`, `displayPanelIcon` and `trainStopColor` — the
 * first two draw *icon* files, which the rect report enumerates directly from the
 * prototypes, and the third is a tint.
 */
function drawVariants(): Partial<DrawData>[] {
    // The combinator operator symbols live side by side in one sheet; each
    // operator picks a different rect of it, so all of them must be enumerated or
    // a crop would drop the ones the walk never asked for.
    const operators = [
        '*',
        '/',
        '+',
        '-',
        '%',
        '^',
        '<<',
        '>>',
        'AND',
        'OR',
        'XOR',
        '=',
        '>',
        '<',
        '≥',
        '≤',
        '≠',
        'select',
        'count',
        'random',
        'stack-size',
        'rocket-capacity',
        'quality-filter',
        'quality-transfer',
    ]
    return [
        {},
        { dirType: 'input' },
        { dirType: 'output' },
        { generateConnector: true },
        { railLayer: 'elevated' },
        { assemblerHasFluidInputs: true },
        { assemblerHasFluidOutputs: true },
        { assemblerHasFluidInputs: true, assemblerHasFluidOutputs: true },
        { selectorCombinatorSelectMax: true },
        ...operators.map(operator => ({ operator }) as Partial<DrawData>),
    ]
}

/** Factorio 2.0 directions (16-way); rails and half-diagonals use the odd ones. */
const ALL_DIRECTIONS = Array.from({ length: 16 }, (_, i) => i)

export interface CensusOptions {
    /** Directions to draw each entity in. Default `[0]` — the ratchet's baseline. */
    dirs?: number[]
    /** Vary the other draw knobs too (the rect report does; the ratchet doesn't). */
    allVariants?: boolean
    /** Called for every generated part list. */
    onParts?: (name: string, dir: number, parts: readonly ExtendedSpriteData[]) => void
}

export interface CensusBuckets {
    /** Entities that generate no sprites — they render as the labeled box fallback. */
    failed: string[]
    /** Entities with a part that resolves to no texture — they render incomplete. */
    partial: string[]
}

/**
 * Run every entity of the loaded pack through `getSpriteData` and bucket the
 * results. `onParts` sees each generated list, which is how the rect report
 * harvests rects from the very same walk the ratchet counts.
 *
 * Classification uses the FIRST (default) variant of each entity only, so the
 * ratchet's numbers are independent of how many extra variants are enumerated.
 */
export function censusEntities(options: CensusOptions = {}): CensusBuckets {
    const dirs = options.dirs ?? [0]
    const variants = options.allVariants ? drawVariants() : [{}]
    const failed: string[] = []
    const partial: string[] = []

    for (const name of Object.keys(FD.entities)) {
        let classified = false
        for (const dir of dirs) {
            for (const variant of variants) {
                let res: ReturnType<typeof getSpriteData> | typeof SPRITE_GENERATION_FAILED
                try {
                    res = getSpriteData({
                        dir,
                        name,
                        position: { x: 0, y: 0 },
                        generateConnector: false,
                        ...variant,
                    } as DrawData)
                } catch {
                    res = SPRITE_GENERATION_FAILED
                }

                const parts = Array.isArray(res) ? (res as readonly ExtendedSpriteData[]) : null
                if (parts && parts.length > 0) options.onParts?.(name, dir, parts)

                if (classified) continue
                classified = true
                if (!parts || parts.length === 0) {
                    failed.push(name)
                } else if (
                    parts.some(d => {
                        // Mirror EntitySprite's resolution: a part is dropped only
                        // if it resolves to no texture at all.
                        return d && !d.draw_as_shadow && !resolveSpriteFilename(d, dir)
                    })
                ) {
                    partial.push(name)
                }
            }
        }
    }

    return { failed, partial }
}

/** Grow (or seed) a file's union bbox with one more rect. */
function accumulate(report: RectReport, rect: SpriteRect): void {
    // A zero-size request means "the whole file" (see textureTransform); such a
    // file can never be cropped, which a bbox anchored at the origin with zero
    // extent cannot express — mark it by widening to Infinity, and let the
    // exporter read that as "no crop, downscale only".
    const w = rect.w > 0 ? rect.w : Infinity
    const h = rect.h > 0 ? rect.h : Infinity
    const cur = report[rect.file]
    if (!cur) {
        report[rect.file] = { bbox: [rect.x, rect.y, w, h], rects: 1 }
        return
    }
    const [bx, by, bw, bh] = cur.bbox
    const x0 = Math.min(bx, rect.x)
    const y0 = Math.min(by, rect.y)
    const x1 = Math.max(bx + bw, rect.x + w)
    const y1 = Math.max(by + bh, rect.y + h)
    cur.bbox = [x0, y0, x1 - x0, y1 - y0]
    cur.rects += 1
}

/** Every icon rect `F.CreateIcon` can request: always `(0, 0, icon_size, icon_size)`. */
function collectIconRects(report: RectReport): void {
    const DEFAULT_ICON_SIZE = 64
    type IconOwner = {
        icon?: string
        icon_size?: number
        icons?: readonly { icon: string; icon_size?: number }[]
        dark_background_icon?: string
        dark_background_icon_size?: number
        dark_background_icons?: readonly { icon: string; icon_size?: number }[]
    }
    const push = (file: string, size = DEFAULT_ICON_SIZE): void => {
        if (file) accumulate(report, { file, x: 0, y: 0, w: size, h: size })
    }
    const visit = (owner: IconOwner): void => {
        if (!owner) return
        if (owner.icon) push(owner.icon, owner.icon_size)
        for (const i of owner.icons ?? []) push(i.icon, i.icon_size)
        if (owner.dark_background_icon)
            push(owner.dark_background_icon, owner.dark_background_icon_size)
        for (const i of owner.dark_background_icons ?? []) push(i.icon, i.icon_size)
    }
    for (const group of [FD.items, FD.fluids, FD.recipes, FD.signals, FD.entities, FD.tiles]) {
        for (const key of Object.keys(group ?? {})) visit(group[key] as IconOwner)
    }
    for (const g of FD.inventoryLayout ?? []) visit(g as IconOwner)
}

/** Every tile cell `TileContainer.generateSprite` can pick (64px cells). */
function collectTileRects(report: RectReport): void {
    const S = 64
    for (const name of Object.keys(FD.tiles ?? {})) {
        const variants = FD.tiles[name]?.variants as any
        if (!variants) continue
        if (variants.material_background) {
            // An 8×8 grid indexed by the tile's world position.
            const file = variants.material_background.picture
            if (file) accumulate(report, { file, x: 0, y: 0, w: 8 * S, h: 8 * S })
        }
        for (const variant of variants.main ?? []) {
            // Only the size-1 variant is ever drawn, but its column is random.
            if ((variant.size || 1) !== 1 || !variant.picture) continue
            accumulate(report, {
                file: variant.picture,
                x: 0,
                y: 0,
                w: (variant.count || 1) * S,
                h: S,
            })
        }
    }
}

/**
 * Every rect the overlay layer can request. `FD.utilitySprites` is a nested bag of
 * sprite records (cursor boxes, indication arrows, the entity-info background,
 * …), so this sweeps it generically for anything shaped like a sprite; plus the
 * per-entity `underground_sprite` the underground-connection lines draw.
 */
function collectOverlayRects(report: RectReport): void {
    const seen = new Set<unknown>()
    const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object' || seen.has(node)) return
        seen.add(node)
        if (Array.isArray(node)) {
            for (const v of node) visit(v)
            return
        }
        const rec = node as Record<string, any>
        if (typeof rec.filename === 'string') {
            accumulate(report, spriteRectOf(rec as ExtendedSpriteData, rec.filename))
        }
        for (const key of Object.keys(rec)) visit(rec[key])
    }
    visit(FD.utilitySprites)
    for (const name of Object.keys(FD.entities)) {
        const sprite = (FD.entities[name] as any)?.underground_sprite
        if (sprite?.filename) visit(sprite)
    }
}

/**
 * The rect report: every `(file, x, y, w, h)` the editor can ask `getTexture`
 * for, unioned per file. Sources, in order: entity sprites (the census walk over
 * all 16 directions and every draw variant), prototype icons, tile variants, and
 * the overlay/utility sprites. Requires `loadData()` to have run.
 */
export function collectSpriteRects(): { report: RectReport; buckets: CensusBuckets } {
    const report: RectReport = {}
    const buckets = censusEntities({
        dirs: ALL_DIRECTIONS,
        allVariants: true,
        onParts: (_name, dir, parts) => {
            for (const part of parts) {
                if (!part) continue
                const file = resolveSpriteFilename(part, dir)
                if (!file) continue
                // Shadows are skipped by EntitySprite, so they're never sampled —
                // but `stripes`/`filenames` parts share files with drawn ones, and
                // excluding a rect we might yet draw is the dangerous direction.
                // Including shadows costs a slightly larger bbox; keep them.
                accumulate(report, spriteRectOf(part, file))
            }
        },
    })
    collectIconRects(report)
    collectTileRects(report)
    collectOverlayRects(report)
    return { report, buckets }
}
