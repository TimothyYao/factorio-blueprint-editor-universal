import { Container, FederatedPointerEvent, Graphics, Text } from 'pixi.js'
import { ColorWithAlpha } from '../../../core/factorioData'
import { Slot } from '../../controls/Slot'
import { styles } from '../../style'

/**
 * Preset palette for entity colours (train-stop sign, lamp) — an approximation
 * of the game's colour-picker row. Factorio accepts any float RGB, so these
 * don't need to byte-match the game's presets; `a: 0.5` mirrors how the game
 * serializes entity colours. Absence of `color` = the prototype default, so
 * the row ends with a ✕ reset swatch rather than a "default colour" guess.
 */
export const COLOR_PRESETS: ColorWithAlpha[] = [
    { r: 1, g: 0, b: 0, a: 0.5 }, // red
    { r: 1, g: 0.55, b: 0.1, a: 0.5 }, // orange
    { r: 1, g: 0.9, b: 0.1, a: 0.5 }, // yellow
    { r: 0.2, g: 0.8, b: 0.2, a: 0.5 }, // green
    { r: 0.2, g: 0.8, b: 0.9, a: 0.5 }, // cyan
    { r: 0.25, g: 0.45, b: 0.9, a: 0.5 }, // blue
    { r: 0.9, g: 0.4, b: 0.75, a: 0.5 }, // pink
    { r: 1, g: 1, b: 1, a: 0.5 }, // white
]

const toHex = (c: ColorWithAlpha): number =>
    (Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255)

const sameColor = (a: ColorWithAlpha | undefined, b: ColorWithAlpha | undefined): boolean =>
    (!a && !b) || (!!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a)

/**
 * One-tap colour row: the presets plus a ✕ reset. The active swatch shows via
 * the Slot's built-in pressed highlight; call the `value` setter (e.g. from an
 * entity `color` event) to keep it following undo/redo.
 */
export class ColorSwatches extends Container {
    private readonly swatches: { slot: Slot<undefined>; color: ColorWithAlpha | undefined }[] = []

    public constructor(
        current: ColorWithAlpha | undefined,
        onChange: (color: ColorWithAlpha | undefined) => void
    ) {
        super()
        const add = (i: number, color: ColorWithAlpha | undefined): void => {
            const slot = new Slot<undefined>(22, 22)
            if (color) {
                slot.content = new Graphics().rect(-7, -7, 14, 14).fill(toHex(color))
            } else {
                const x = new Text({ text: '✕', style: styles.dialog.label })
                x.anchor.set(0.5)
                slot.content = x
            }
            slot.position.set(i * 24, 0)
            slot.on('pointerdown', (e: FederatedPointerEvent) => {
                e.stopPropagation()
                if (e.button !== 0) return
                onChange(color ? { ...color } : undefined)
            })
            this.addChild(slot)
            this.swatches.push({ slot, color })
        }
        COLOR_PRESETS.forEach((c, i) => add(i, c))
        add(COLOR_PRESETS.length, undefined)
        this.value = current
    }

    /** Refresh which swatch shows as active. */
    public set value(current: ColorWithAlpha | undefined) {
        for (const s of this.swatches) s.slot.active = sameColor(s.color, current)
    }

    /** The first (red) preset swatch and the ✕ reset, for e2e registration. */
    public get firstSwatch(): Slot<undefined> {
        return this.swatches[0].slot
    }

    public get resetSwatch(): Slot<undefined> {
        return this.swatches[this.swatches.length - 1].slot
    }
}
