import {
    ColorSource,
    Container,
    Graphics,
    Sprite,
    Text,
    CanvasTextMetrics,
    RenderTexture,
} from 'pixi.js'
import FD, { ColorWithAlpha, getColor, getRecipeIconSourceName } from '../../core/factorioData'
import { qualityColorHex, qualityShowsBadge, resolveQuality } from '../../core/quality'
import { qualityUi } from '../../common/qualityUi'
import {
    abbreviateAmount,
    formatProductAmount,
    formatProductProbability,
    getIngredientAmount,
    getProductAmount,
} from '../../core/recipeAmounts'
import { styles } from '../style'
import G from '../../common/globals'
import { ComparatorString } from '../../types'
import { IngredientPrototype, IconData, ProductPrototype } from 'factorio:prototype'

/**
 * Shade Color
 *
 * @param color - The color to shade
 * @param percent - How many percent the color shall be shaded (+ makes it brigther / - makes it darker)
 */
function ShadeColor(color: number, percent: number): number {
    const amt = Math.round(2.55 * percent)
    const R = (color >> 16) + amt
    const G = ((color >> 8) & 0x00ff) + amt
    const B = (color & 0x0000ff) + amt
    return (
        (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
        (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
        (B < 255 ? (B < 1 ? 0 : B) : 255)
    )
}

const rect_map: Map<string, RenderTexture> = new Map()

/**
 * Draw Rectangle with Border
 *
 * @param width - Width of the Rectangle
 * @param height - Height of the Rectangle
 * @param background - Background Color of the Rectangle
 * @param alpha - Background Alpha of the Rectangle (1...no transparency)
 * @param border - Border Width of the Rectangle (0...no border)
 * @param pressed - True if the Rectangle Border shall apear as the Rectangle is pressed rather than raised
 */
function DrawRectangle(
    width: number,
    height: number,
    background: number,
    alpha = 1,
    border = 0,
    pressed = false
): Sprite {
    const key = `${width}-${height}-${background}-${alpha}-${border}-${pressed}`
    const existing_texture = rect_map.get(key)
    if (existing_texture) {
        return new Sprite(existing_texture)
    }

    const rectangle = new Graphics()
    rectangle.alpha = alpha
    rectangle.rect(0, 0, width, height).fill(background)

    if (border > 0) {
        rectangle
            .moveTo(0, height)
            .lineTo(0, 0)
            .lineTo(width, 0)
            .stroke({
                width: 1,
                color: ShadeColor(background, pressed ? -12.5 : 22.5),
                alignment: 1,
            })
            .lineTo(width, height)
            .lineTo(0, height)
            .stroke({
                width: 1,
                color: ShadeColor(background, pressed ? 10 : -7.5),
                alignment: 1,
            })
    }
    if (border > 1) {
        rectangle
            .moveTo(1, height - 1)
            .lineTo(1, 1)
            .lineTo(width - 1, 1)
            .stroke({
                width: 1,
                color: ShadeColor(background, pressed ? -10 : 20),
                alignment: 1,
            })
            .lineTo(width - 1, height - 1)
            .lineTo(1, height - 1)
            .stroke({
                width: 1,
                color: ShadeColor(background, pressed ? 7.5 : -5),
                alignment: 1,
            })
    }
    if (border > 2) {
        rectangle
            .moveTo(2, height - 2)
            .lineTo(2, 2)
            .lineTo(width - 2, 2)
            .stroke({
                width: 1,
                color: ShadeColor(background, pressed ? -7.5 : 17.5),
                alignment: 1,
            })
            .lineTo(width - 2, height - 2)
            .lineTo(2, height - 2)
            .stroke({
                width: 1,
                color: ShadeColor(background, pressed ? 5 : -2.5),
                alignment: 1,
            })
    }

    const renderTexture = RenderTexture.create({
        width: width,
        height: height,
    })

    G.app.renderer.render({ container: rectangle, target: renderTexture })

    rectangle.destroy()

    rect_map.set(key, renderTexture)

    const s = new Sprite(renderTexture)

    return s
}

/**
 * Draw Control Face
 *
 * @param w - Width
 * @param h - Height
 * @param f - Factor
 * @param c - Background Color
 * @param a - Background Alpha
 * @param p0 - Percent shade for brightest border
 * @param p1 - Percent shade for bright border
 * @param p2 - Percent shade for dark border
 * @param p3 - Percent shade for darkest border
 */
function DrawControlFace(
    w: number,
    h: number,
    f: number,
    c: number,
    a: number,
    p0: number,
    p1: number,
    p2: number,
    p3: number
): Container {
    const out = new Container()

    const wf = w * f
    const hf = h * f

    const mask = new Graphics()
    mask.roundRect(0, 0, wf, hf, 6).fill(0x000000)

    const face = new Graphics()
    face.rect(0, 0, wf, hf)
        .fill(colorAndAlphaToColorSource(c, a))
        .moveTo(wf, 0)
        .lineTo(wf, hf)
        .lineTo(0, hf)
        .stroke({ width: f, color: ShadeColor(c, p3), alpha: a, alignment: 1 })
        .moveTo(wf - f, f)
        .lineTo(wf - f, hf - f)
        .lineTo(f, hf - f)
        .stroke({ width: f, color: ShadeColor(c, p2), alpha: a, alignment: 1 })
        .moveTo(wf - f, f)
        .lineTo(f, f)
        .lineTo(f, hf - f)
        .stroke({ width: f, color: ShadeColor(c, p1), alpha: a, alignment: 1 })
        .moveTo(wf, 0)
        .lineTo(0, 0)
        .lineTo(0, hf)
        .stroke({ width: f, color: ShadeColor(c, p0), alpha: a, alignment: 1 })
    face.scale.set(1 / f, 1 / f)
    face.mask = mask

    out.addChild(mask)
    out.addChild(face)
    out.cacheAsTexture(true)

    return out
}

/**
 * Multicolored "any quality" diamond from the game (`__core__/…/any-quality.png`).
 * Used by the filter/signal quality picker's leading Any chip — the hollow
 * stroke we used to draw was a stand-in for this asset. Prefer the dump's
 * `utilitySprites.any_quality` / `signal-any-quality` path; fall back to the
 * well-known core filename (present on vanilla-2.0 and space-age packs alike).
 */
function CreateAnyQualityBadge(size = 16): Container {
    const wrap = new Container()
    wrap.eventMode = 'none'
    // `any_quality` is on the dump but not always in the typed UtilitySprites.
    const util = (
        FD.utilitySprites as { any_quality?: { filename?: string; size?: number } } | undefined
    )?.any_quality
    const signal = FD.signals?.['signal-any-quality']
    const filename = util?.filename ?? signal?.icon ?? '__core__/graphics/icons/any-quality.png'
    const iconSize = util?.size ?? signal?.icon_size ?? 64
    const sprite = new Sprite(G.getTexture(filename, 0, 0, iconSize, iconSize))
    sprite.width = size
    sprite.height = size
    wrap.addChild(sprite)
    return wrap
}

/**
 * Quality diamond (issue #5 slice 1). Texture from the dump's `icon` when the
 * pack shipped one; otherwise a Pixi diamond tinted with the tier colour so
 * vanilla-2.0 / pre-field dumps still badge. Nothing for omitted/`normal`.
 */
function CreateQualityBadge(
    quality: string | undefined,
    size = 14,
    /** Picker chips need the normal diamond too; overlays still skip it. */
    includeNormal = false
): Container | undefined {
    if (!qualityUi.enabled || !quality) return undefined
    if (!includeNormal && !qualityShowsBadge(quality)) return undefined
    const q = resolveQuality(quality)
    const wrap = new Container()
    wrap.eventMode = 'none'

    const filename = q?.icon ?? q?.icons?.[0]?.icon
    if (filename) {
        const iconSize = q.icons?.[0]?.icon_size ?? q.icon_size ?? 64
        const sprite = new Sprite(G.getTexture(filename, 0, 0, iconSize, iconSize))
        sprite.width = size
        sprite.height = size
        wrap.addChild(sprite)
        return wrap
    }

    const hex = qualityColorHex(q?.color)
    const g = new Graphics()
        .poly([size / 2, 0, size, size / 2, size / 2, size, 0, size / 2])
        .fill(hex)
        .stroke({ width: Math.max(1, size / 14), color: 0x111111, alignment: 0 })
    wrap.addChild(g)
    return wrap
}

/**
 * Rasterise the dump-icon quality diamond at **native** atlas size (usually
 * 64px), the same `G.getTexture(q.icon)` path menus and blueprint overlays
 * use. Callers display it smaller with `image-rendering: pixelated` so the
 * badge isn't bilinear-smoothed down to mud (12px extract looked worse than
 * the on-canvas 16px sprites).
 */
export function qualityBadgeDataUrl(quality: string | undefined): string | undefined {
    if (!qualityUi.enabled || !quality || quality === 'normal') return undefined
    const renderer = G.app?.renderer
    if (!renderer) return undefined
    const q = resolveQuality(quality)
    const native = q?.icons?.[0]?.icon_size ?? q?.icon_size ?? 64
    const badge = CreateQualityBadge(quality, native)
    if (!badge) return undefined
    try {
        const bounds = badge.getLocalBounds()
        if (bounds.width < 1 || bounds.height < 1) return undefined
        const rt = RenderTexture.create({ width: native, height: native })
        renderer.render({ container: badge, target: rt })
        const canvas = renderer.extract.canvas(rt) as HTMLCanvasElement | undefined
        rt.destroy(true)
        badge.destroy({ children: true })
        if (!canvas || canvas.width < 2) return undefined
        const ctx = canvas.getContext('2d')
        if (ctx) {
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
            let visible = 0
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] > 16) visible += 1
            }
            if (visible < 4) return undefined
        }
        return canvas.toDataURL()
    } catch {
        badge.destroy({ children: true })
        return undefined
    }
}

function attachQualityBadge(
    icon: Container,
    quality: string | undefined,
    iconSize: number,
    setAnchor: boolean,
    opts?: { anyQuality?: boolean; comparator?: ComparatorString }
): Container {
    const badgeSize = Math.max(8, Math.round(iconSize * 0.4))
    // Named items: Normal has no diamond (game `draw_sprite_by_default`); Any
    // (keyless) gets the rainbow asset; `=` is the default and stays off-icon.
    const mark = CreateFilterQualityMark(quality, badgeSize, opts)
    if (!mark) return icon
    const wrap = new Container()
    wrap.addChild(icon)
    // Bottom-left of the icon box. Anchored icons are centered on (0, 0);
    // unanchored ones (CreateIconWithAmount) sit with their top-left at origin.
    if (setAnchor) {
        mark.position.set(-iconSize / 2, iconSize / 2 - badgeSize)
    } else {
        mark.position.set(0, iconSize - badgeSize)
    }
    wrap.addChild(mark)
    return wrap
}

/**
 * Quality diamond (or the any-quality asset) plus an optional comparator
 * glyph — Factorio's filter slot / alt-mode cluster, not just the picker row.
 * `=` is the default and is not drawn. Normal on a named item is unbadged
 * unless a non-`=` comparator is set (then the diamond must sit next to `>`
 * / `≥` / …); quality-only always draws Normal (`includeNormal`).
 */
function CreateFilterQualityMark(
    quality: string | undefined,
    size: number,
    opts?: {
        anyQuality?: boolean
        comparator?: ComparatorString
        includeNormal?: boolean
    }
): Container | undefined {
    const cmp = opts?.comparator && opts.comparator !== '=' ? opts.comparator : undefined
    const badge = quality
        ? CreateQualityBadge(quality, size, !!opts?.includeNormal || !!cmp)
        : opts?.anyQuality && qualityUi.enabled
          ? CreateAnyQualityBadge(size)
          : undefined
    if (!badge && !cmp) return undefined

    const cluster = new Container()
    cluster.eventMode = 'none'
    let x = 0
    if (cmp) {
        const t = new Text({ text: cmp, style: styles.icon.comparator })
        t.anchor.set(0, 1)
        t.position.set(0, size)
        cluster.addChild(t)
        x = Math.ceil(t.width) + 1
    }
    if (badge) {
        badge.position.set(x, 0)
        cluster.addChild(badge)
    }
    return cluster
}

/** Create Icon from Sprite Item information */
function CreateIcon(
    itemName: string,
    maxSize = 32,
    setAnchor = true,
    darkBackground = false,
    quality?: string,
    badge?: { anyQuality?: boolean; comparator?: ComparatorString }
): Container {
    if (darkBackground) {
        const item = FD.items[itemName]
        if (item) {
            if (item.dark_background_icons) {
                return attachQualityBadge(
                    generateIcons(item.dark_background_icons),
                    quality,
                    maxSize,
                    setAnchor,
                    badge
                )
            } else if (item.dark_background_icon) {
                return attachQualityBadge(
                    generateIcon(item.dark_background_icon, item.dark_background_icon_size),
                    quality,
                    maxSize,
                    setAnchor,
                    badge
                )
            }
        }
    }

    const item =
        FD.items[itemName] ||
        FD.fluids[itemName] ||
        FD.recipes[itemName] ||
        FD.signals[itemName] ||
        // inventory group icon is not present in FD.items
        FD.inventoryLayout.find(g => g.name === itemName)

    if (item?.icons) {
        return attachQualityBadge(generateIcons(item.icons), quality, maxSize, setAnchor, badge)
    } else if (item?.icon) {
        return attachQualityBadge(
            generateIcon(item.icon, item.icon_size),
            quality,
            maxSize,
            setAnchor,
            badge
        )
    }

    // A recipe may define no icon of its own — in Factorio it then shows its
    // main_product's (or sole result's) icon. Resolve and render that. Without
    // this, picking such a recipe (SE's *-alt recipes, se-pulverised-sand, SA's
    // fluoroketone, …) threw here, which aborted the editor's recipe-slot icon
    // update mid-way and left the entity in a state where its editor could no
    // longer be opened — the recipe stays set, so every reopen re-threw (#35).
    const recipeIconSource = getRecipeIconSourceName(itemName)
    if (recipeIconSource) {
        return CreateIcon(recipeIconSource, maxSize, setAnchor, darkBackground, quality, badge)
    }

    throw new Error(`CreateIcon: no renderable icon for '${itemName}'`)

    function generateIcon(filename: string, icon_size: number = 64): Sprite {
        const texture = G.getTexture(filename, 0, 0, icon_size, icon_size)
        const sprite = new Sprite(texture)
        sprite.scale.set(maxSize / icon_size)
        if (setAnchor) {
            sprite.anchor.set(0.5)
        }
        return sprite
    }

    function generateIcons(icons: readonly IconData[]): Container {
        const img = new Container()
        for (const icon of icons) {
            const sprite = generateIcon(icon.icon, icon.icon_size)
            if (icon.scale) {
                sprite.scale.set(icon.scale, icon.scale)
            }
            if (icon.shift) {
                sprite.position.set(icon.shift[0], icon.shift[1])
            }
            if (icon.tint) {
                applyTint(sprite, getColor(icon.tint))
            }

            if (!setAnchor && icon.shift) {
                sprite.position.x += sprite.width / 2
                sprite.position.y += sprite.height / 2
            }

            img.addChild(sprite)
        }
        return img
    }
}

/**
 * Creates an icon with amount on host at coordinates
 * @param host - Container on top of which the icon shall be created
 * @param x - Horizontal position of icon from top left corner
 * @param y - Vertical position of icon from top left corner
 * @param name - Name if item
 * @param amount - Amount to show
 * @param amountLabel - Optional pre-formatted label (e.g. a `1–5` range) that
 *   overrides the numeric `amount`. When omitted the numeric amount is
 *   abbreviated (`Nk`) as before.
 * @param probabilityLabel - Optional probability badge (e.g. `25%`) rendered at
 *   the top of the icon, kept separate from the bottom amount so a wide label
 *   can't run into the neighbouring icon's amount.
 */
function CreateIconWithAmount(
    host: Container,
    x: number,
    y: number,
    name: string,
    amount: number = 1,
    amountLabel?: string,
    probabilityLabel?: string,
    quality?: string,
    badge?: { anyQuality?: boolean; comparator?: ComparatorString }
): void {
    const icon = CreateIcon(name, undefined, false, false, quality, badge)
    icon.position.set(x, y)
    host.addChild(icon)

    // `abbreviateAmount` is NaN-safe, so a product with no plain `amount` (only
    // amount_min/amount_max/probability) can never render "NaNk"/"undefinedk".
    const amountString = amountLabel ?? abbreviateAmount(amount)
    const text = new Text({ text: amountString, style: styles.icon.amount })
    text.anchor.set(1, 1)
    text.position.set(x + 33, y + 33)
    host.addChild(text)

    if (probabilityLabel !== undefined) {
        const prob = new Text({ text: probabilityLabel, style: styles.icon.probability })
        prob.anchor.set(1, 0)
        prob.position.set(x + 33, y)
        host.addChild(prob)
    }
}

function CreateRecipe(
    host: Container,
    x: number,
    y: number,
    ingredients: readonly IngredientPrototype[],
    results: readonly ProductPrototype[],
    energy_required: number = 0.5,
    /** Recipe input quality — badges non-fluid ingredients and results. */
    quality?: string
): void {
    let nextX = x
    const itemQuality = quality && quality !== 'normal' ? quality : undefined

    for (const i of ingredients) {
        CreateIconWithAmount(
            host,
            nextX,
            y,
            i.name,
            getIngredientAmount(i),
            undefined,
            undefined,
            i.type === 'fluid' ? undefined : itemQuality
        )
        nextX += 36
    }

    nextX += 2
    const timeText = `=${energy_required}s>`
    const timeSize = CanvasTextMetrics.measureText(timeText, styles.dialog.label)
    const timeObject = new Text({ text: timeText, style: styles.dialog.label })
    timeObject.position.set(nextX, 6 + y)
    host.addChild(timeObject)
    nextX += timeSize.width + 6

    for (const r of results) {
        // Show the authored yield (amount or min–max range) with its probability
        // as a separate top badge, rather than flattening a probabilistic output
        // to one number or running the two labels together.
        CreateIconWithAmount(
            host,
            nextX,
            y,
            r.name,
            getProductAmount(r),
            formatProductAmount(r),
            formatProductProbability(r),
            r.type === 'fluid' ? undefined : itemQuality
        )
        nextX += 36
    }
}

function colorAndAlphaToColorSource(color: number, a: number): ColorSource {
    const r = (color >> 16) & 0xff
    const g = (color >> 8) & 0xff
    const b = color & 0xff
    return { r, g, b, a }
}

function applyTint(s: { tint: ColorSource; alpha: number }, tint: ColorWithAlpha): void {
    let r = tint.r || 0
    let g = tint.g || 0
    let b = tint.b || 0
    let a = tint.a || 1
    // Factorio colors come in two scales: 0-1 floats or 0-255 ints, and the
    // game treats any component > 1 as meaning the whole color is 0-255
    // (SE's icon tints use that form, e.g. {r: 219, g: 96, b: 255}). PixiJS
    // only takes 0-1, so normalize here — the one funnel every tint (UI icons
    // and entity sprites alike) flows through. Alpha is only rescaled when it
    // itself is > 1: an omitted alpha defaults to opaque on either scale.
    if (r > 1 || g > 1 || b > 1 || a > 1) {
        r /= 255
        g /= 255
        b /= 255
        if (a > 1) {
            a /= 255
        }
    }
    s.tint = rgbToColorSource(r, g, b)
    s.alpha = a
}

function rgbToColorSource(r: number, g: number, b: number): ColorSource {
    return Math.floor(r * 255) * 0x10000 + Math.floor(g * 255) * 0x100 + Math.floor(b * 255)
}

export default {
    ShadeColor,
    DrawRectangle,
    DrawControlFace,
    CreateIcon,
    CreateIconWithAmount,
    CreateQualityBadge,
    CreateAnyQualityBadge,
    CreateFilterQualityMark,
    CreateRecipe,
    applyTint,
    colorAndAlphaToColorSource,
    rgbToColorSource,
}
