import { Entity } from '../../core/Entity'
import { RoboportStatSignalKey } from '../../core/Entity'
import { Checkbox } from '../controls/Checkbox'
import { CycleButton } from '../controls/CycleButton'
import { SignalSlot } from './components/SignalSlot'
import { Editor } from './Editor'

/** Display labels for `read_items_mode`, index-aligned with the define (0/1/2). */
const READ_MODES = ['none', 'logistics', 'missing req.'] as const

const STAT_SIGNALS: { key: RoboportStatSignalKey; label: string; control: string }[] = [
    {
        key: 'available_logistic_output_signal',
        label: 'Available logistic robots',
        control: 'availLogistic',
    },
    {
        key: 'total_logistic_output_signal',
        label: 'Total logistic robots',
        control: 'totalLogistic',
    },
    {
        key: 'available_construction_output_signal',
        label: 'Available construction',
        control: 'availConstruction',
    },
    {
        key: 'total_construction_output_signal',
        label: 'Total construction',
        control: 'totalConstruction',
    },
    { key: 'roboport_count_output_signal', label: 'Roboport count', control: 'roboportCount' },
]

/**
 * Roboport editor — the post-2.0 circuit surface: what the port reads onto the
 * network (`read_items_mode`: nothing / the logistic network's contents / its
 * missing requests) and the robot statistics (`read_robot_stats` plus the five
 * output signals, shown only while stats are on). Signal slots left empty mean
 * the game's built-in defaults — nothing is seeded, matching how the game
 * keeps them implicit until picked.
 */
export class RoboportEditor extends Editor {
    public constructor(entity: Entity) {
        super(446, 340, entity)

        this.addLabel(140, 54, 'Read items:')
        const readMode = new CycleButton<(typeof READ_MODES)[number]>(
            READ_MODES as unknown as (typeof READ_MODES)[number][],
            READ_MODES[this.m_Entity.roboportReadItemsMode] ?? 'none',
            v => {
                this.m_Entity.roboportReadItemsMode = READ_MODES.indexOf(v)
            },
            100
        )
        readMode.position.set(230, 45)
        this.addChild(this.registerControl('readItemsMode', readMode))

        const readStats = new Checkbox(this.m_Entity.roboportReadRobotStats, 'Read robot stats')
        readStats.position.set(140, 97)
        readStats.on('changed', () => {
            this.m_Entity.roboportReadRobotStats = readStats.checked
            refreshSlots()
        })
        this.addChild(this.registerControl('readRobotStats', readStats))

        const slots = STAT_SIGNALS.map(({ key, label, control }, i) => {
            const y = 124 + i * 40
            const text = this.addLabel(140, y + 10, `${label}:`)
            const slot = new SignalSlot(
                this.m_Entity.getRoboportStatSignal(key),
                s => this.m_Entity.setRoboportStatSignal(key, s),
                true,
                label
            )
            slot.position.set(330, y)
            this.addChild(this.registerControl(control, slot))
            return { key, slot, text }
        })

        const refreshSlots = (): void => {
            const show = this.m_Entity.roboportReadRobotStats
            for (const s of slots) s.slot.visible = s.text.visible = show
        }
        refreshSlots()

        this.onEntityChange('controlBehavior', () => {
            readMode.value = READ_MODES[this.m_Entity.roboportReadItemsMode] ?? 'none'
            readStats.checked = this.m_Entity.roboportReadRobotStats
            for (const s of slots) s.slot.signal = this.m_Entity.getRoboportStatSignal(s.key)
            refreshSlots()
        })

        this.declareClearableSlots()
    }
}
