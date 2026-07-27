import { Container, Rectangle, Text, TextStyle } from 'pixi.js'
import G from '../common/globals'
import FD from '../core/factorioData'
import { Blueprint } from '../core/Blueprint'
import { Entity } from '../core/Entity'
import { ItemRateTotals, calculateBlueprintRates } from '../core/craftingRates'
import F from './controls/functions'
import { Panel } from './controls/Panel'
import { fitToWidthScale } from './quickbarLayout'
import { colors, styles } from './style'

/**
 * Blueprint-wide production/consumption overview (a RateCalculator-style
 * readout, computed offline — see core/craftingRates.ts for the maths and
 * docs/rate-calculator.md for scope/backlog). Toggled by the `showRates`
 * action or its own ✕; pinned to the right edge *below* the entity info
 * panel's anchor, so hover-info and rates can be open at once and neither
 * fights the website's top-left logo/settings stack (a DOM overlay the canvas
 * can't see).
 *
 * Materials are bucketed the way the mod presents them:
 *   - products — only produced here (what the blueprint exports),
 *   - intermediates — produced *and* consumed, shown as a net rate so a
 *     shortfall (negative net) is immediately visible,
 *   - ingredients — only consumed (what must be supplied).
 *
 * While visible the panel recomputes live: blueprint-level entity add/remove
 * plus per-entity recipe/module edits (each rated entity is subscribed on every
 * recompute; entities drop their listeners on destroy, and a blueprint swap
 * re-attaches via UIContainer → onBlueprintSwapped).
 */

const ROW_H = 28
const ICON = 24
const PAD = 10
/**
 * Vertical clearance for the entity info panel (270 high) that shares the
 * right edge: rates sit below it so both can be open at once.
 */
const INFO_PANEL_CLEARANCE = 276

/** Section-header style — the title colour at label size, so it reads as a
 * grouping rather than a value. */
const sectionStyle = new TextStyle({
    fill: colors.text.title,
    fontFamily: "'Roboto', sans-serif",
    fontWeight: '500',
    fontSize: 14,
})

const netPositiveStyle = new TextStyle({
    fill: 0x8bc34a,
    fontFamily: "'Roboto', sans-serif",
    fontWeight: '500',
    fontSize: 14,
})

const netNegativeStyle = new TextStyle({
    fill: 0xff7043,
    fontFamily: "'Roboto', sans-serif",
    fontWeight: '500',
    fontSize: 14,
})

/**
 * Compact per-second rate: 2 decimals under 10 (module ratios live in the
 * hundredths), 1 under 100, whole numbers above — keeps megabase-scale rows
 * from overflowing the panel's fixed width.
 */
const formatRate = (n: number): string => {
    const abs = Math.abs(n)
    const digits = abs < 10 ? 2 : abs < 100 ? 1 : 0
    // Trim trailing zeros so common exact rates read clean ("1.5", not "1.50").
    return `${Number(n.toFixed(digits))}/s`
}

export class RatesPanel extends Panel {
    private readonly title: Text
    private readonly m_CloseButton: Text
    private readonly m_Rows: Container
    /** Blueprint currently subscribed for add/remove events (tracked so a
     * blueprint swap on load can re-attach cleanly). */
    private attachedBp?: Blueprint
    /** Entities carrying recipe/modules listeners from the last recompute. */
    private readonly subscribedEntities = new Set<Entity>()
    private readonly recompute = (): void => this.updateRates()

    public constructor() {
        super(270, 400)

        // 'passive': the panel itself never swallows canvas interactions (it's
        // a read-only overlay), but its ✕ button still receives taps.
        this.eventMode = 'passive'
        this.interactiveChildren = true
        this.visible = false

        this.title = new Text({ text: 'Production rates', style: styles.dialog.title })
        this.title.anchor.set(0.5, 0)
        this.title.position.set(super.width / 2, 2)
        this.addChild(this.title)

        // A dismiss affordance of its own: without it the only way out is
        // re-triggering the action, which touch users may have buried in the
        // rail's ⋯ overflow — easy to strand the panel over the blueprint,
        // especially in portrait. The hit area is padded well past the glyph
        // for a finger-sized target.
        this.m_CloseButton = new Text({ text: '✕', style: styles.dialog.label })
        this.m_CloseButton.position.set(super.width - 22, 4)
        this.m_CloseButton.eventMode = 'static'
        this.m_CloseButton.cursor = 'pointer'
        this.m_CloseButton.hitArea = new Rectangle(-12, -4, 36, 36)
        this.m_CloseButton.on('pointertap', () => this.hide())
        this.addChild(this.m_CloseButton)

        this.m_Rows = new Container()
        this.addChild(this.m_Rows)
    }

    public toggle(): void {
        if (this.visible) {
            this.hide()
        } else {
            this.show()
        }
    }

    public show(): void {
        this.visible = true
        this.attach()
        this.updateRates()
    }

    public hide(): void {
        this.visible = false
        this.detach()
    }

    /** Called by UIContainer when `loadBlueprint` swaps `G.bp`, so an open
     * panel follows the new blueprint instead of listening to a dead one. */
    public onBlueprintSwapped(): void {
        if (!this.visible) return
        this.detach()
        this.attach()
        this.updateRates()
    }

    private attach(): void {
        this.attachedBp = G.bp
        this.attachedBp.on('create-entity', this.recompute)
        this.attachedBp.on('remove-entity', this.recompute)
    }

    private detach(): void {
        this.attachedBp?.off('create-entity', this.recompute)
        this.attachedBp?.off('remove-entity', this.recompute)
        this.attachedBp = undefined
        for (const entity of this.subscribedEntities) {
            entity.off('recipe', this.recompute)
            entity.off('modules', this.recompute)
        }
        this.subscribedEntities.clear()
    }

    /**
     * (Re)subscribe to the entities whose settings feed the calculation, so a
     * recipe/module edit refreshes an open panel. Destroyed entities drop
     * their listeners themselves (`Entity.destroy` → `removeAllListeners`);
     * they're also pruned here on the next recompute.
     */
    private resubscribeEntities(entities: Entity[]): void {
        for (const entity of this.subscribedEntities) {
            entity.off('recipe', this.recompute)
            entity.off('modules', this.recompute)
        }
        this.subscribedEntities.clear()
        for (const entity of entities) {
            const type = entity.entityData?.type
            if (
                type === 'assembling-machine' ||
                type === 'furnace' ||
                type === 'rocket-silo' ||
                type === 'beacon'
            ) {
                entity.on('recipe', this.recompute)
                entity.on('modules', this.recompute)
                this.subscribedEntities.add(entity)
            }
        }
    }

    private updateRates(): void {
        if (!this.visible) return
        this.m_Rows.removeChildren()

        const entities = G.bp.entities.valuesArray()
        this.resubscribeEntities(entities)

        const report = calculateBlueprintRates(entities)

        const all = [...report.rates.values()]
        const products = all
            .filter(r => r.consumption === 0)
            .sort((a, b) => b.production - a.production)
        const ingredients = all
            .filter(r => r.production === 0)
            .sort((a, b) => b.consumption - a.consumption)
        const intermediates = all
            .filter(r => r.production > 0 && r.consumption > 0)
            .sort((a, b) => a.production - a.consumption - (b.production - b.consumption))

        let y = this.title.height + 12
        const maxY = this.height - ROW_H - 6 // reserve the footer line

        if (report.countedMachines === 0) {
            const label = new Text({
                text: 'No crafting machines with a recipe.',
                style: styles.dialog.hint,
            })
            label.position.set(PAD, y)
            this.m_Rows.addChild(label)
            y += ROW_H
        } else {
            let overflow = 0
            const section = (heading: string, rows: ItemRateTotals[]): void => {
                if (rows.length === 0) return
                if (y + ROW_H * 2 > maxY) {
                    overflow += rows.length
                    return
                }
                const header = new Text({ text: heading, style: sectionStyle })
                header.position.set(PAD, y)
                this.m_Rows.addChild(header)
                y += 20
                for (const row of rows) {
                    if (y + ROW_H > maxY) {
                        overflow += 1
                        continue
                    }
                    this.addRow(row, y)
                    y += ROW_H
                }
            }

            section('Products', products)
            section('Intermediates', intermediates)
            section('Ingredients', ingredients)

            if (overflow > 0) {
                const more = new Text({ text: `+${overflow} more…`, style: styles.dialog.hint })
                more.position.set(PAD, y)
                this.m_Rows.addChild(more)
            }
        }

        // Footer: what was (and wasn't) counted, so a furnace-heavy blueprint
        // reads as "not counted" instead of silently under-reporting.
        const skipped =
            report.machinesWithoutRecipe > 0
                ? ` · ${report.machinesWithoutRecipe} without recipe`
                : ''
        const footer = new Text({
            text: `${report.countedMachines} machine${
                report.countedMachines === 1 ? '' : 's'
            } counted${skipped}`,
            style: styles.dialog.hint,
        })
        footer.position.set(PAD, this.height - ROW_H + 4)
        this.m_Rows.addChild(footer)
    }

    private addRow(row: ItemRateTotals, y: number): void {
        // Guard the icon: a foreign blueprint can reference materials this
        // pack has no prototype (and thus no icon) for.
        if (FD.items[row.name] || FD.fluids[row.name]) {
            const icon = F.CreateIcon(row.name, ICON, false)
            icon.position.set(PAD, y)
            this.m_Rows.addChild(icon)
        } else {
            const label = new Text({ text: '?', style: styles.dialog.label })
            label.position.set(PAD + 6, y + 3)
            this.m_Rows.addChild(label)
        }

        const net = row.production - row.consumption
        const isIntermediate = row.production > 0 && row.consumption > 0

        const mainText = isIntermediate
            ? `${net >= 0 ? '+' : '−'}${formatRate(Math.abs(net))}`
            : formatRate(row.production > 0 ? row.production : row.consumption)
        const mainStyle = !isIntermediate
            ? styles.dialog.label
            : net >= 0
              ? netPositiveStyle
              : netNegativeStyle
        const main = new Text({ text: mainText, style: mainStyle })
        main.position.set(PAD + ICON + 8, y + 3)
        this.m_Rows.addChild(main)

        if (isIntermediate) {
            // The net's breakdown (production vs consumption), dimmed.
            const detail = new Text({
                text: `= ${formatRate(row.production)} − ${formatRate(row.consumption)}`,
                style: styles.dialog.hint,
            })
            detail.position.set(main.position.x + main.width + 8, y + 5)
            this.m_Rows.addChild(detail)
            return
        }

        // Producer/consumer machine counts, one icon+×n pair *per machine
        // type* (a mixed bank — say 2× asm2 and 3× asm3 on the same recipe —
        // must not collapse into one machine's icon with a merged total).
        // A bare "× 80" next to a rate would read as a rate multiplier, hence
        // the icons. Largest groups first; what doesn't fit the panel width
        // folds into a "+k" tail so the row never overflows.
        const machines = row.production > 0 ? row.producerMachines : row.consumerMachines
        const entries = [...machines.entries()].sort((a, b) => b[1] - a[1])
        let x = main.position.x + main.width + 10
        const maxX = this.width - PAD - 22 // keep room for the "+k" tail
        for (let i = 0; i < entries.length; i++) {
            if (x > maxX) {
                const rest = new Text({
                    text: `+${entries.length - i}`,
                    style: styles.dialog.hint,
                })
                rest.position.set(x, y + 5)
                this.m_Rows.addChild(rest)
                break
            }
            const [machineName, n] = entries[i]
            // Machines are placeable, so the prototype name doubles as the item
            // (icon) name — guard anyway for modded packs.
            if (FD.items[machineName]) {
                const machineIcon = F.CreateIcon(machineName, 16, false)
                machineIcon.position.set(x, y + 4)
                this.m_Rows.addChild(machineIcon)
                x += 18
            }
            const label = new Text({ text: `×${n}`, style: styles.dialog.hint })
            label.position.set(x, y + 5)
            this.m_Rows.addChild(label)
            x += label.width + 8
        }
    }

    /**
     * Rendered text lines top-to-bottom, left-to-right (for the e2e probe —
     * the panel is canvas-drawn, so the DOM has nothing to query).
     */
    public get textLines(): string[] {
        return [...this.m_Rows.children]
            .filter((c): c is Text => c instanceof Text)
            .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
            .map(t => t.text)
    }

    /** Screen-space center of the ✕ button (for the e2e probe). */
    public closeButtonPosition(): { x: number; y: number } | null {
        if (!this.visible) return null
        const r = this.m_CloseButton.getBounds().rectangle
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }

    protected override setPosition(): void {
        // Right edge, below the entity info panel's anchor — the top-left is
        // owned by the website's logo/settings DOM overlay (and the mobile
        // rail), which a canvas panel would sit underneath. Scale down on a
        // viewport narrower than the panel; clamp handles short viewports.
        const scale = fitToWidthScale(G.app.screen.width, this.width)
        this.scale.set(scale)
        this.clampToScreen(G.app.screen.width - this.width * scale, INFO_PANEL_CLEARANCE * scale)
    }
}
