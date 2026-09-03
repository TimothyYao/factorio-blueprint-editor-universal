import { Container } from 'pixi.js'
import { ComparatorString } from '../../types'
import { pickerQualityTiers } from '../../core/quality'
import { qualityUi } from '../../common/qualityUi'
import F from './functions'
import { Button } from './Button'
import { CycleButton } from './CycleButton'

const COMPARATORS: ComparatorString[] = ['=', '≠', '>', '<', '≥', '≤']
const CHIP = 26
const STEP = 28

export interface QualityRowOptions {
    /** Current quality id; omitted/`normal` means the Normal (or Any) chip. */
    value?: string
    onChange: (quality: string | undefined) => void
    /**
     * Leading "any quality" chip (filters / signals: omit the key). Distinct
     * from Normal. Entity/module rows leave this off so Normal isn't doubled.
     */
    includeAny?: boolean
    showComparator?: boolean
    comparator?: ComparatorString
    onComparator?: (comparator: ComparatorString) => void
}

/**
 * Icon-only quality chips (issue #5). Diamonds from the dump / fallback; no
 * labels — three-letter stubs overflowed on a phone and duplicated Normal
 * ("Nrm" + "Nor") next to the built-in tier list.
 */
export class QualityRow extends Container {
    public static readonly H = 28

    private readonly opts: QualityRowOptions
    private current: string | undefined

    public constructor(opts: QualityRowOptions) {
        super()
        this.opts = opts
        this.current = this.opts.includeAny
            ? opts.value
            : opts.value && opts.value !== 'normal'
              ? opts.value
              : undefined
        this.rebuild()
    }

    public get value(): string | undefined {
        return this.current
    }

    /**
     * On-screen centres of the quality chips only (Any if present, then tiers).
     * Skips the comparator cycle so callers can index 0 = first chip.
     */
    public chipCenters(): { x: number; y: number }[] {
        const out: { x: number; y: number }[] = []
        for (const c of this.children) {
            if (!(c instanceof Button) || c instanceof CycleButton) continue
            const r = c.getBounds().rectangle
            out.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
        }
        return out
    }

    public set value(next: string | undefined) {
        const n = this.opts.includeAny ? next : next && next !== 'normal' ? next : undefined
        if (n === this.current) return
        this.current = n
        this.rebuild()
    }

    private rebuild(): void {
        for (const c of this.removeChildren()) c.destroy()
        if (!qualityUi.enabled) return

        let x = 0
        const tiers = pickerQualityTiers()

        const select = (id: string | undefined): void => {
            const n = id === 'normal' && !this.opts.includeAny ? undefined : id
            this.current = n
            this.opts.onChange(n)
            this.rebuild()
        }

        if (this.opts.includeAny) {
            const any = QualityRow.chip(undefined, this.current === undefined)
            any.position.set(x, 0)
            any.on('pointerdown', e => {
                e.stopPropagation()
                select(undefined)
            })
            this.addChild(any)
            x += STEP
        }

        for (const tier of tiers) {
            const active = this.opts.includeAny
                ? this.current === tier.id
                : tier.id === 'normal'
                  ? !this.current
                  : this.current === tier.id
            const chip = QualityRow.chip(tier.id, active)
            chip.position.set(x, 0)
            chip.on('pointerdown', e => {
                e.stopPropagation()
                select(tier.id)
            })
            this.addChild(chip)
            x += STEP
        }

        if (this.opts.showComparator && this.opts.onComparator) {
            const cmp = new CycleButton<ComparatorString>(
                COMPARATORS,
                this.opts.comparator ?? '=',
                v => this.opts.onComparator?.(v),
                36,
                CHIP
            )
            cmp.position.set(x + 4, 0)
            this.addChild(cmp)
        }
    }

    /** Diamond for a named tier; the game's multicolored any-quality icon for Any. */
    private static chip(quality: string | undefined, active: boolean): Button {
        const b = new Button<undefined>(CHIP, CHIP)
        b.active = active
        const mark = quality ? F.CreateQualityBadge(quality, 16, true) : F.CreateAnyQualityBadge(16)
        if (mark) {
            mark.pivot.set(8, 8)
            b.content = mark
        }
        return b
    }
}
