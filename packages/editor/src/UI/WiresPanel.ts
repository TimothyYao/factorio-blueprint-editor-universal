import { Container } from 'pixi.js'
import { EditorMode } from '../containers/BlueprintContainer'
import G from '../common/globals'
import { inputMode } from '../common/input'
import { Panel } from './controls/Panel'
import { Slot } from './controls/Slot'
import F from './controls/functions'
import { colors } from './style'

class WireSlot extends Slot<string | undefined> {
    public get wireName(): string {
        return this.data
    }

    public setWireName(wireName: string): void {
        this.data = wireName
        this.content = F.CreateIcon(wireName)
    }
}

export class WiresPanel extends Panel {
    private slotsContainer: Container
    public static Wires = ['copper-wire', 'red-wire', 'green-wire']

    public constructor() {
        super(
            24 + 38 * 3 - 2,
            24 + 38,
            colors.quickbar.background.color,
            colors.quickbar.background.alpha,
            colors.quickbar.background.border
        )

        this.slotsContainer = new Container()
        this.slotsContainer.position.set(12, 12)
        this.addChild(this.slotsContainer)

        this.generateSlots()
    }

    public generateSlots(): void {
        for (const [i, wire] of WiresPanel.Wires.entries()) {
            const slot = new WireSlot()
            slot.setWireName(wire)
            slot.position.set((36 + 2) * i, 0)

            slot.on('pointerdown', e => {
                if (e.button === 0) {
                    if (G.BPC.mode === EditorMode.PAINT) {
                        if (slot.wireName === G.BPC.paintContainer.getItemName()) {
                            G.BPC.paintContainer.destroy()
                        } else {
                            G.BPC.spawnPaintContainer(slot.wireName)
                        }
                    } else {
                        G.BPC.spawnPaintContainer(slot.wireName)
                    }
                }
            })

            this.slotsContainer.addChild(slot)
        }
    }

    protected override setPosition(): void {
        // Retired on mobile, like the quickbar: the three wire buttons live in
        // the action rail there (issue #89 — the panel was a permanent resident
        // of the bottom band the PAINT/SELECT clusters need). Desktop unchanged.
        this.visible = inputMode.mode === 'desktop'

        // The wires panel belongs next to the (centered, bottom-pinned) quickbar.
        // The quickbar scales down on narrow viewports, so anchor off its *actual*
        // scaled bounds rather than a hardcoded 442 — otherwise this panel runs
        // off the right edge in portrait. If there's no room beside it, stack the
        // panel just above the quickbar's right end; clamp on-screen as a backstop.
        const sw = G.app.screen.width
        const sh = G.app.screen.height
        const qb = G.UI?.quickbarPanel
        // No visible quickbar to anchor to (sub-~442px desktop viewports) — sit
        // centered along the bottom instead.
        const qbb = qb && qb.visible ? qb.getBounds().rectangle : null
        if (!qbb) {
            this.clampToScreen(sw / 2 - this.width / 2, sh - this.height + 1)
            return
        }

        const besideX = qbb.x + qbb.width + 2
        if (besideX + this.width > sw) {
            this.clampToScreen(qbb.x + qbb.width - this.width, qbb.y - this.height + 1)
        } else {
            this.clampToScreen(besideX, sh - this.height + 1)
        }
    }
}
