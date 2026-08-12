import { Entity } from '../../core/Entity'
import { Checkbox } from '../controls/Checkbox'
import { TextInput } from '../controls/TextInput'
import { SignalSlot } from './components/SignalSlot'
import { Editor } from './Editor'
import G from '../../common/globals'

/**
 * Display panel editor — the static message: text (DOM `TextInput`; free text
 * needs the OS keyboard, same as the station name), the icon (rendered on the
 * sprite, so picking one shows in-world immediately) and the root flags. The
 * per-condition message list (`control_behavior.parameters[]`) is deferred —
 * the static message is the common case, and a condition list is the decider
 * editor's row pattern once it's wanted.
 */
export class DisplayPanelEditor extends Editor {
    public constructor(entity: Entity) {
        super(446, 210, entity)

        this.addLabel(140, 46, 'Text:')
        const textBox = new TextInput(G.app.renderer, 250, entity.displayPanelText, 500)
        textBox.position.set(140, 65)
        this.addChild(textBox)
        textBox.on('changed', () => {
            this.m_Entity.displayPanelText = textBox.text
        })

        this.addLabel(140, 106, 'Icon:')
        const icon = new SignalSlot(
            this.m_Entity.displayPanelIcon,
            s => {
                this.m_Entity.displayPanelIcon = s
            },
            false,
            'Panel icon'
        )
        icon.position.set(200, 97)
        this.addChild(this.registerControl('icon', icon))

        const alwaysShow = new Checkbox(
            this.m_Entity.displayPanelAlwaysShow,
            'Always show (not just when hovered)'
        )
        alwaysShow.position.set(140, 143)
        alwaysShow.on('changed', () => {
            this.m_Entity.displayPanelAlwaysShow = alwaysShow.checked
        })
        this.addChild(this.registerControl('alwaysShow', alwaysShow))

        const showInChart = new Checkbox(this.m_Entity.displayPanelShowInChart, 'Show in map')
        showInChart.position.set(140, 169)
        showInChart.on('changed', () => {
            this.m_Entity.displayPanelShowInChart = showInChart.checked
        })
        this.addChild(this.registerControl('showInChart', showInChart))

        this.onEntityChange('displayPanel', () => {
            textBox.text = this.m_Entity.displayPanelText
            icon.signal = this.m_Entity.displayPanelIcon
            alwaysShow.checked = this.m_Entity.displayPanelAlwaysShow
            showInChart.checked = this.m_Entity.displayPanelShowInChart
        })

        this.declareClearableSlots()
    }
}
