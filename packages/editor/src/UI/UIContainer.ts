import { Container } from 'pixi.js'
import { Entity } from '../core/Entity'
import { DebugContainer } from './DebugContainer'
import { QuickbarPanel } from './QuickbarPanel'
import { EntityInfoPanel } from './EntityInfoPanel'
import { InventoryDialog } from './InventoryDialog'
import { SignalPicker, SignalChoice } from './SignalPicker'
import { NumericKeypad } from './NumericKeypad'
import { WiresPanel } from './WiresPanel'
import { Editor } from './editors/Editor'
import { createEditor } from './editors/factory'

export class UIContainer extends Container {
    private debugContainer: DebugContainer
    public quickbarPanel: QuickbarPanel
    public wiresPanel: WiresPanel
    private entityInfoPanel: EntityInfoPanel
    private dialogsContainer: Container
    private paintIconContainer: Container

    public constructor() {
        super()

        this.debugContainer = new DebugContainer()
        this.quickbarPanel = new QuickbarPanel(2)
        this.wiresPanel = new WiresPanel()
        this.entityInfoPanel = new EntityInfoPanel()
        this.dialogsContainer = new Container()
        this.paintIconContainer = new Container()

        this.addChild(
            this.debugContainer,
            this.quickbarPanel,
            this.wiresPanel,
            this.entityInfoPanel,
            this.dialogsContainer,
            this.paintIconContainer
        )
    }

    public updateEntityInfoPanel(entity?: Entity): void {
        this.entityInfoPanel.updateVisualization(entity)
    }

    /** Whether the top-right entity info panel is currently shown (for e2e). */
    public get entityInfoPanelVisible(): boolean {
        return this.entityInfoPanel.visible
    }

    public addPaintIcon(icon: Container): void {
        this.paintIconContainer.addChild(icon)
    }

    public set showDebuggingLayer(visible: boolean) {
        this.debugContainer.visible = visible
    }

    /** @returns The created editor, or undefined if the entity has none. */
    public createEditor(entity: Entity): Editor | undefined {
        const editor = createEditor(entity)
        if (editor) {
            this.dialogsContainer.addChild(editor)
        }
        return editor
    }

    /**
     * @param clearCallBack - When given, the dialog shows a "✕ Clear" button that
     * empties the slot it was opened from. Omit it when there is nothing to clear
     * (e.g. assigning an empty quickbar slot) so no dead button is drawn.
     */
    public createInventory(
        title?: string,
        itemsFilter?: string[],
        selectedCallBack?: (selectedItem: string) => void,
        recentsKey?: string,
        clearCallBack?: () => void
    ): InventoryDialog {
        const inv = new InventoryDialog(
            title,
            itemsFilter,
            selectedCallBack,
            recentsKey,
            clearCallBack
        )
        this.dialogsContainer.addChild(inv)
        return inv
    }

    public createSignalPicker(
        title: string,
        onConfirm: (choice: SignalChoice) => void,
        allowSpecial = true,
        allowConstant = false
    ): SignalPicker {
        const picker = new SignalPicker(title, onConfirm, allowSpecial, allowConstant)
        this.dialogsContainer.addChild(picker)
        return picker
    }

    public createNumericKeypad(
        title: string,
        initial: number | undefined,
        onConfirm: (value: number) => void
    ): NumericKeypad {
        const pad = new NumericKeypad(title, initial, onConfirm)
        this.dialogsContainer.addChild(pad)
        return pad
    }

    // public changeQuickbarRows(rows: number): void {
    //     const itemNames = this.quickbarPanel.serialize()
    //     this.quickbarPanel.destroy()
    //     this.quickbarPanel = new QuickbarContainer(rows, itemNames)

    //     const index = this.getChildIndex(this.quickbarPanel)
    //     this.addChildAt(this.quickbarPanel, index)
    // }
}
