import { Container, Text } from 'pixi.js'
import EventEmitter from 'eventemitter3'
import { Entity, EntityEvents } from '../../core/Entity'
import { inputMode, type InputMode } from '../../common/input'
import { styles } from '../style'
import { Dialog } from '../controls/Dialog'
import { Preview } from './components/Preview'
import { Recipe } from './components/Recipe'
import { Modules } from './components/Modules'
import { Filters } from './components/Filters'
import { CircuitCondition } from './components/CircuitCondition'
import { createCircuitNetworkBadges } from '../circuitNetworkBadges'
import { qualityUi } from '../../common/qualityUi'
import { QualityRow } from '../controls/QualityRow'

/** Editor */
export abstract class Editor extends Dialog {
    /**
     * Footer band reserved below every editor's content for the clear-a-slot
     * hint. Reserved unconditionally so subclasses keep passing their existing
     * hand-tuned content heights (editorLayout's sizing, the chest's computed
     * height, …) without each having to know about the hint; an editor with no
     * clearable slots just gets the extra padding.
     */
    private static readonly HINT_H = 20

    /** Blueprint Editor Entity reference */
    protected readonly m_Entity: Entity

    /** Reference to preview container */
    protected readonly m_Preview: Preview

    /** Content height (i.e. the dialog height minus the hint band). */
    private readonly m_contentHeight: number

    /** The clear-a-slot hint, created on the first declareClearableSlots() call. */
    private m_clearHint?: Text

    /**
     * Controls the `editorControlPos` e2e probe can locate by name — the canvas
     * has no DOM to query, so specs press real controls via these positions.
     * Editors opt controls in with `registerControl`; names only need to be
     * unique within one editor.
     */
    private readonly m_namedControls = new Map<string, Container>()

    /**
     * Base Constructor for Editors
     *
     * @param width - Width of the Editor Dialog
     * @param height - Height of the Editor Dialog (excluding the hint band)
     * @param entity - Reference to Entity Data
     */
    public constructor(width: number, height: number, entity: Entity) {
        super(width, height + Editor.HINT_H, entity.entityData.localised_name as string)

        this.m_contentHeight = height

        // Store reference to entity for later use
        this.m_Entity = entity

        // Create preview container
        this.m_Preview = new Preview(this.m_Entity, 114)
        this.m_Preview.position.set(12, 45)
        this.addChild(this.m_Preview)

        // Red/green circuit-network ids (top-right, by the title) when wired.
        let rightReserve = 12
        const badges = createCircuitNetworkBadges(this.m_Entity)
        if (badges.children.length > 0) {
            badges.position.set(this.width - badges.width - 12, 14)
            this.addChild(badges)
            rightReserve = badges.width + 16
        }

        // Close on entity destroy
        this.m_Entity.once('destroy', () => this.close())

        // Entity-level quality chips (issue #5 slice 3). Icon-only, right-
        // aligned so a long localised_name isn't covered the way the old
        // Nrm/Nor/Unc… labelled row covered "Electromagnetic plant".
        if (qualityUi.enabled) {
            const row = new QualityRow({
                value: this.m_Entity.quality,
                onChange: q => {
                    this.m_Entity.quality = q
                },
            })
            row.position.set(Math.max(12, this.width - row.width - rightReserve), 10)
            this.addChild(this.registerControl('entityQuality', row))
            if (this.m_title) {
                const maxW = row.x - 20
                if (maxW > 0 && this.m_title.width > maxW) {
                    this.m_title.scale.set(maxW / this.m_title.width)
                }
            }
        }
    }

    /**
     * Add Recipe Slot to Editor
     * @description Defined in Base Editor class so extensions can use it when they need to
     * @param x - Horizontal position of Recipe Slot from top left corner
     * @param y - Vertical position of Recipe Slot from top left corner
     */
    protected addRecipe(x = 208, y = 45): Recipe {
        const recipe = new Recipe(this.m_Entity)
        recipe.position.set(x, y)
        this.addChild(recipe)
        this.declareClearableSlots()

        // Return component in case extension wants to use it
        return recipe
    }

    /**
     * Add Module Slots to Editor
     * @description Defined in Base Editor class so extensions can use it when they need to
     * @param x - Horizontal position of Module Slots from top left corner
     * @param y - Vertical position of Module Slots from top left corner
     * @param columns - Wrap the module grid at this many columns (default: one row)
     */
    protected addModules(x = 208, y = 83, columns?: number): Modules {
        const modules = new Modules(this.m_Entity, columns)
        modules.position.set(x, y)
        this.addChild(modules)
        this.declareClearableSlots()

        // Return component in case extension wants to use it
        return modules
    }

    /**
     * Add Filter Slots to Editor
     * @description Defined in Base Editor class so extensions can use it when they need to
     * @param x - Horizontal position of Filter Slots from top left corner
     * @param y - Vertical position of Filter Slots from top left corner
     * @param counts - Shall filter counts be shown
     */
    protected addFilters(x = 208, y = 83, amount = false): Filters {
        const filters = new Filters(this.m_Entity, amount)
        filters.position.set(x, y)
        this.addChild(filters)
        // Logistic/infinity chests have filter slots the setter can't write yet
        // (Entity.canEditFilters), so don't promise a clear gesture there.
        if (this.m_Entity.canEditFilters) this.declareClearableSlots()

        // Return component in case extension wants to use it
        return filters
    }

    /**
     * Add the enable/disable circuit-condition control. Shared by every editor
     * whose entity can be gated by the circuit network (inserters, pumps, belts,
     * mining drills, …).
     */
    protected addCircuitCondition(x: number, y: number): CircuitCondition {
        const cc = new CircuitCondition(this.m_Entity)
        cc.position.set(x, y)
        this.addChild(cc)
        this.declareClearableSlots()
        return cc
    }

    /**
     * Declare that this editor holds at least one slot that can be emptied, which
     * reveals the footer hint naming the gesture that does it.
     *
     * Clearing a slot is otherwise invisible — desktop right-clicks it and touch
     * holds it, and neither is something a UI can show. (The pickers opened *from*
     * a filled slot also carry a "✕ Clear" button; the hint covers the slots you
     * can clear without opening anything, and the counted-chest filters, whose
     * filled slots jump straight to the count field instead of the picker.)
     *
     * Idempotent — editors that add several kinds of slot just call it per slot.
     */
    protected declareClearableSlots(): void {
        if (this.m_clearHint) return
        this.m_clearHint = this.addLabel(
            12,
            this.m_contentHeight,
            Editor.clearHintFor(inputMode.mode),
            styles.dialog.hint
        )

        // Input mode switches live (no reload), and an editor can be open across
        // the switch — the settings pane is DOM, so toggling it doesn't close the
        // canvas dialogs. Without this the hint would keep naming the gesture of
        // the mode you just left. Unsubscribed on destroy so a closed editor
        // doesn't leak a listener, same shape as onEntityChange.
        const onModeChange = (mode: InputMode): void => {
            if (this.m_clearHint && !this.m_clearHint.destroyed) {
                this.m_clearHint.text = Editor.clearHintFor(mode)
            }
        }
        inputMode.on('change', onModeChange)
        this.once('destroyed', () => inputMode.off('change', onModeChange))
    }

    private static clearHintFor(mode: InputMode): string {
        return mode === 'mobile' ? 'Hold a slot to clear it' : 'Right-click a slot to clear it'
    }

    /**
     * The clear-a-slot hint's text, or null when this editor has no clearable
     * slots. Backs the `?test` probe — the hint is canvas-drawn, so e2e has no
     * other way to assert it renders (and says the right thing per input mode).
     */
    public get clearHintText(): string | null {
        return this.m_clearHint?.text ?? null
    }

    /** Name a control for the e2e probe (chainable at call sites via return). */
    protected registerControl<C extends Container>(name: string, control: C): C {
        this.m_namedControls.set(name, control)
        return control
    }

    /** On-screen centre (canvas-relative CSS px) of a named control, for e2e. */
    public controlPosition(name: string): { x: number; y: number } | null {
        const control = this.m_namedControls.get(name)
        if (!control) return null
        const r = control.getBounds().rectangle
        if (r.width === 0 || r.height === 0) return null
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }

    protected onEntityChange<T extends EventEmitter.EventNames<EntityEvents>>(
        event: T,
        fn: EventEmitter.EventListener<EntityEvents, T>
    ): void {
        this.m_Entity.on(event, fn)
        this.once('destroyed', () => this.m_Entity.off(event, fn))
    }
}
