import { Container, Text } from 'pixi.js'
import { ComparatorString } from '../../types'
import { pickerQualityTiers } from '../../core/quality'
import { qualityUi } from '../../common/qualityUi'
import F from './functions'
import { Button } from './Button'
import { CycleButton } from './CycleButton'
import { styles } from '../style'

const COMPARATORS: ComparatorString[] = ['=', '≠', '>', '<', '≥', '≤']

export interface QualityRowOptions {
    /** Current quality id; omitted/`normal` is the first/Any chip. */
    value?: string
    onChange: (quality: string | undefined) => void
    /** Extra leading chip that means "no quality key" (filters / signals). */
    includeAny?: boolean
    anyLabel?: string
    showComparator?: boolean
    comparator?: ComparatorString
    onComparator?: (comparator: ComparatorString) => void
}

/**
 * Compact tier chips (Any + dump/builtin qualities) used by the inventory
 * picker, signal picker, and the shared entity-editor frame (issue #5).
 */
export class QualityRow extends Container {
    public static readonly H = 28

    private readonly opts: QualityRowOptions
    private current: string | undefined

    public constructor(opts: QualityRowOptions) {
        super()
        this.opts = opts
        this.current = opts.value && opts.value !== 'normal' ? opts.value : undefined
        this.rebuild()
    }

    public get value(): string | undefined {
        return this.current
    }

    public set value(next: string | undefined) {
        const n = next && next !== 'normal' ? next : undefined
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
            const n = id && id !== 'normal' ? id : undefined
            this.current = n
            this.opts.onChange(n)
            this.rebuild()
        }

        if (this.opts.includeAny) {
            const any = QualityRow.chip(this.opts.anyLabel ?? 'Any', !this.current)
            any.position.set(x, 0)
            any.on('pointerdown', e => {
                e.stopPropagation()
                select(undefined)
            })
            this.addChild(any)
            x += 40
        }

        for (const tier of tiers) {
            const active =
                this.current === tier.id ||
                (!this.current && !this.opts.includeAny && tier.id === 'normal')
            const chip = QualityRow.chip(tier.label.slice(0, 3), active, tier.id)
            chip.position.set(x, 0)
            chip.on('pointerdown', e => {
                e.stopPropagation()
                select(tier.id === 'normal' && this.opts.includeAny ? undefined : tier.id)
            })
            this.addChild(chip)
            x += 40
        }

        if (this.opts.showComparator && this.opts.onComparator) {
            const cmp = new CycleButton<ComparatorString>(
                COMPARATORS,
                this.opts.comparator ?? '=',
                v => this.opts.onComparator?.(v),
                36,
                26
            )
            cmp.position.set(x + 4, 0)
            this.addChild(cmp)
        }
    }

    private static chip(label: string, active: boolean, quality?: string): Button {
        const b = new Button<undefined>(36, 26)
        b.active = active
        const icon = quality && quality !== 'normal' ? F.CreateQualityBadge(quality, 12) : undefined
        const t = new Text({ text: label, style: styles.dialog.label })
        t.anchor.set(0.5)
        if (icon) {
            const wrap = new Container()
            icon.position.set(-10, -6)
            t.position.set(6, 0)
            wrap.addChild(icon, t)
            b.content = wrap
        } else {
            b.content = t
        }
        return b
    }
}
