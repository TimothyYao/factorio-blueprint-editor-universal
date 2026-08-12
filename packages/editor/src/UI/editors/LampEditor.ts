import { Entity } from '../../core/Entity'
import { Checkbox } from '../controls/Checkbox'
import { CycleButton } from '../controls/CycleButton'
import { SignalSlot } from './components/SignalSlot'
import { ColorSwatches } from './components/ColorSwatches'
import { Editor } from './Editor'

/** Display labels for `color_mode`, index-aligned with the define (0/1/2). */
const COLOR_MODES = ['mapping', 'RGB', 'packed'] as const

/**
 * Lamp editor — the post-2.0 surface: the static colour (root `color`, preset
 * swatches + ✕ reset), `always_on`, and the circuit pane (enable condition +
 * "use colors" with its three modes: colour *mapping* — the signal's own
 * colour, the default — or reading the colour from *RGB* component signals /
 * one *packed*-RGB signal). The mode's signal slots show only when they apply,
 * mirroring the game's dialog.
 */
export class LampEditor extends Editor {
    public constructor(entity: Entity) {
        super(446, 320, entity)

        this.addLabel(140, 48, 'Color:')
        const swatches = new ColorSwatches(this.m_Entity.trainStopColor, color => {
            this.m_Entity.trainStopColor = color
        })
        swatches.position.set(210, 40)
        this.addChild(swatches)

        const alwaysOn = new Checkbox(this.m_Entity.lampAlwaysOn, 'Always on')
        alwaysOn.position.set(140, 76)
        alwaysOn.on('changed', () => {
            this.m_Entity.lampAlwaysOn = alwaysOn.checked
        })
        this.addChild(this.registerControl('alwaysOn', alwaysOn))

        this.addLabel(12, 110, 'Circuit network')
        this.addCircuitCondition(12, 130)

        const useColors = new Checkbox(this.m_Entity.lampUseColors, 'Use colors')
        useColors.position.set(140, 232)
        useColors.on('changed', () => {
            this.m_Entity.lampUseColors = useColors.checked
            refreshModeRow()
        })
        this.addChild(this.registerControl('useColors', useColors))

        // The mode row (cycle + its signal slots) occupies reserved space below
        // "Use colors"; visibility toggles in place so the dialog keeps one size.
        const modeButton = new CycleButton<(typeof COLOR_MODES)[number]>(
            COLOR_MODES as unknown as (typeof COLOR_MODES)[number][],
            COLOR_MODES[this.m_Entity.lampColorMode] ?? 'mapping',
            v => {
                this.m_Entity.lampColorMode = COLOR_MODES.indexOf(v)
                refreshModeRow()
            },
            70
        )
        modeButton.position.set(140, 258)
        this.addChild(this.registerControl('colorMode', modeButton))

        const red = new SignalSlot(this.m_Entity.lampRedSignal, s => {
            this.m_Entity.lampRedSignal = s
        })
        const green = new SignalSlot(this.m_Entity.lampGreenSignal, s => {
            this.m_Entity.lampGreenSignal = s
        })
        const blue = new SignalSlot(this.m_Entity.lampBlueSignal, s => {
            this.m_Entity.lampBlueSignal = s
        })
        const rgb = new SignalSlot(this.m_Entity.lampRgbSignal, s => {
            this.m_Entity.lampRgbSignal = s
        })
        red.position.set(220, 252)
        green.position.set(260, 252)
        blue.position.set(300, 252)
        rgb.position.set(220, 252)
        this.addChild(
            this.registerControl('redSignal', red),
            this.registerControl('greenSignal', green),
            this.registerControl('blueSignal', blue),
            this.registerControl('rgbSignal', rgb)
        )

        const refreshModeRow = (): void => {
            const use = this.m_Entity.lampUseColors
            const mode = this.m_Entity.lampColorMode
            modeButton.visible = use
            red.visible = green.visible = blue.visible = use && mode === 1
            rgb.visible = use && mode === 2
        }
        refreshModeRow()

        this.onEntityChange('alwaysOn', () => {
            alwaysOn.checked = this.m_Entity.lampAlwaysOn
        })
        this.onEntityChange('color', () => {
            swatches.value = this.m_Entity.trainStopColor
        })
        this.onEntityChange('controlBehavior', () => {
            useColors.checked = this.m_Entity.lampUseColors
            modeButton.value = COLOR_MODES[this.m_Entity.lampColorMode] ?? 'mapping'
            red.signal = this.m_Entity.lampRedSignal
            green.signal = this.m_Entity.lampGreenSignal
            blue.signal = this.m_Entity.lampBlueSignal
            rgb.signal = this.m_Entity.lampRgbSignal
            refreshModeRow()
        })
    }
}
