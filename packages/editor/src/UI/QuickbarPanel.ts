import { Container, Graphics } from 'pixi.js'
import { EditorMode } from '../containers/BlueprintContainer'
import G from '../common/globals'
import { inputMode } from '../common/input'
import { Panel } from './controls/Panel'
import { Slot } from './controls/Slot'
import { bindSlotGestures } from './controls/gestures'
import F from './controls/functions'
import { colors } from './style'
import { fitToWidthScale } from './quickbarLayout'
import { storedQuality } from '../core/quality'
import { parseQuickbarSlot, serializeQuickbarSlot, type QuickbarStored } from './quickbarSerialize'

export type { QuickbarStored } from './quickbarSerialize'

export class QuickbarSlot extends Slot<string | undefined> {
    private itemQuality: string | undefined

    public get itemName(): string {
        return this.data
    }

    public get quality(): string | undefined {
        return this.itemQuality
    }

    public assignItem(itemName: string, quality?: string): void {
        if (itemName === 'blueprint') return
        this.data = itemName
        this.itemQuality = storedQuality(quality)
        this.content = F.CreateIcon(itemName, undefined, true, false, this.itemQuality)
    }

    public unassignItem(): void {
        this.data = undefined
        this.itemQuality = undefined
        this.content = undefined
    }
}

export class QuickbarPanel extends Panel {
    private iWidth = 442
    private iHeight: number
    private rows: number

    private slots: QuickbarSlot[]
    private slotsContainer: Container

    public constructor(rows = 1, itemNames?: QuickbarStored[]) {
        super(
            442,
            24 + rows * 38,
            colors.quickbar.background.color,
            colors.quickbar.background.alpha,
            colors.quickbar.background.border
        )

        this.rows = rows
        this.iHeight = 24 + rows * 38
        this.slots = new Array<QuickbarSlot>(rows * 10)

        this.slotsContainer = new Container()
        this.slotsContainer.position.set(12, 12)
        this.addChild(this.slotsContainer)

        this.generateSlots(itemNames)

        const t = QuickbarPanel.createTriangleButton(15, 14)
        t.position.set((this.iWidth - t.width) / 2, (this.iHeight - t.height) / 2)
        t.on('pointerdown', this.changeActiveQuickbar, this)
        this.addChild(t)
    }

    private static createTriangleButton(width: number, height: number): Graphics {
        const button = new Graphics()

        button
            .moveTo(0, height)
            .lineTo(width / 2, 0)
            .lineTo(width, height)
            .lineTo(0, height)
            .fill(colors.controls.button.background.color)

        button.eventMode = 'static'

        button.on('pointerover', () => {
            button.alpha = 0.8
        })
        button.on('pointerout', () => {
            button.alpha = 1
        })

        return button
    }

    public generateSlots(itemNames?: QuickbarStored[]): void {
        for (let r = 0; r < this.rows; r++) {
            for (let i = 0; i < 10; i++) {
                const quickbarSlot = new QuickbarSlot()
                quickbarSlot.position.set((36 + 2) * i + (i > 4 ? 38 : 0), 38 * r)

                const parsed = itemNames ? parseQuickbarSlot(itemNames[r * 10 + i]) : undefined
                if (parsed) {
                    quickbarSlot.assignItem(parsed.name, parsed.quality)
                }

                // Use Case 1:   Activate    & Slot=Empty & Mouse=Painting                      >> Assign Mouse Item to Slot
                // Use Case 2:   Activate    & Slot=Item  & Mouse=Painting                      >> Assign Slot Item to Mouse
                // Use Case 2.5: Activate    & Slot=Item  & Mouse=Painting & Item=PaintingItem  >> Destroy Painting Item
                // Use Case 3:   Activate    & Slot=Empty & Mouse=Empty                         >> Assign Slot Item to Selected Inv item
                // Use Case 4:   Activate    & Slot=Item  & Mouse=Empty                         >> Assign Slot Item to Mouse
                // Use Case 5:   Clear       & Slot=*     & Mouse=*                             >> Unassign Slot
                //
                // "Activate" is a left-click or a tap; "Clear" is a right-click or
                // a long-press (touch has no right-click) — see bindSlotGestures.
                bindSlotGestures(
                    quickbarSlot,
                    () => {
                        if (G.BPC.mode === EditorMode.PAINT) {
                            if (quickbarSlot.itemName) {
                                if (
                                    quickbarSlot.itemName === G.BPC.paintContainer.getItemName() &&
                                    (quickbarSlot.quality ?? undefined) ===
                                        (G.BPC.paintContainer.getQuality() ?? undefined)
                                ) {
                                    // UC2.5
                                    G.BPC.paintContainer.destroy()
                                } else {
                                    // UC2
                                    G.BPC.spawnPaintContainer(
                                        quickbarSlot.itemName,
                                        0,
                                        [],
                                        false,
                                        quickbarSlot.quality
                                    )
                                }
                            } else {
                                // UC1
                                quickbarSlot.assignItem(
                                    G.BPC.paintContainer.getItemName(),
                                    G.BPC.paintContainer.getQuality()
                                )
                            }
                        } else if (quickbarSlot.itemName) {
                            // UC4
                            G.BPC.spawnPaintContainer(
                                quickbarSlot.itemName,
                                0,
                                [],
                                false,
                                quickbarSlot.quality
                            )
                        } else {
                            // UC3 — an empty slot has nothing to clear, so no ✕ Clear.
                            G.UI.createInventory(
                                'Inventory',
                                undefined,
                                (item, quality) => quickbarSlot.assignItem(item, quality),
                                'items'
                            )
                        }
                    },
                    // UC5
                    () => quickbarSlot.unassignItem()
                )

                this.slots[r * 10 + i] = quickbarSlot
                this.slotsContainer.addChild(quickbarSlot)
            }
        }
    }

    public bindKeyToSlot(slot: number): void {
        const itemName = this.slots[slot].itemName
        if (!itemName) return

        if (
            G.BPC.mode === EditorMode.PAINT &&
            G.BPC.paintContainer.getItemName() === itemName &&
            (G.BPC.paintContainer.getQuality() ?? undefined) ===
                (this.slots[slot].quality ?? undefined)
        ) {
            G.BPC.paintContainer.destroy()
            return
        }

        G.BPC.spawnPaintContainer(itemName, 0, [], false, this.slots[slot].quality)
    }

    public changeActiveQuickbar(): void {
        this.slotsContainer.removeChildren()

        let itemNames = this.serialize()
        // Left shift array by 10
        itemNames = itemNames.concat(itemNames.splice(0, 10))
        this.generateSlots(itemNames)
    }

    public serialize(): QuickbarStored[] {
        return this.slots.map(s => serializeQuickbarSlot(s.itemName, s.quality))
    }

    /** Slot `index`, or undefined if out of range. Used by the `?test` probe. */
    public slotAt(index: number): QuickbarSlot | undefined {
        return this.slots[index]
    }

    /** Whether `name` (+ optional quality) is currently in any quickbar slot. */
    public hasItem(name: string, quality?: string): boolean {
        const q = storedQuality(quality)
        return this.slots.some(s => s.itemName === name && storedQuality(s.quality) === q)
    }

    /** Pin `name` to the first empty slot (no-op if already present / full). */
    public addItem(name: string, quality?: string): boolean {
        if (this.hasItem(name, quality)) return true
        const empty = this.slots.find(s => !s.itemName)
        if (!empty) return false
        empty.assignItem(name, quality)
        return true
    }

    /** Unpin slots holding `name` (and `quality` when given). */
    public removeItem(name: string, quality?: string): void {
        const q = storedQuality(quality)
        for (const s of this.slots) {
            if (s.itemName === name && storedQuality(s.quality) === q) s.unassignItem()
        }
    }

    protected override setPosition(): void {
        // Retired on mobile: touch users build via the action rail's Items button
        // (which leads with a Recents tab) + Pick, so the fixed bottom bar is just
        // clutter there. Its slots/keybinds still work, so desktop is unchanged.
        this.visible = inputMode.mode === 'desktop'

        // Scale to fit narrow viewports (see quickbarLayout) so the fixed-width
        // panel never runs off the edges, then center along the bottom.
        // Use the width/height getters (backed by the background sprite, which
        // exists during super()'s setPosition() call) rather than iWidth/iHeight:
        // those are class fields not yet initialized on that first call. The
        // getters report the intrinsic size regardless of scale, so this stays
        // correct across the repeated resize calls.
        const sa = G.safeArea
        const scale = fitToWidthScale(sa.width, this.width)
        this.scale.set(scale)

        const scaledWidth = this.width * scale
        const scaledHeight = this.height * scale
        this.position.set(
            sa.x + sa.width / 2 - scaledWidth / 2,
            sa.y + sa.height - scaledHeight + 1
        )
    }
}
