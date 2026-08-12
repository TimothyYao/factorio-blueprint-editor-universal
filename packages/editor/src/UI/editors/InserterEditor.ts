import { Entity } from '../../core/Entity'
import { Switch } from '../controls/Switch'
import { Enable } from '../controls/Enable'
import { Checkbox } from '../controls/Checkbox'
import { CycleButton } from '../controls/CycleButton'
import { Editor } from './Editor'

/** `hand_read_mode` labels, index-aligned with the define: hold = 0, pulse = 1. */
const HAND_READ_MODES = ['hold', 'pulse'] as const

/** Inserter Editor */
export class InserterEditor extends Editor {
    public constructor(entity: Entity) {
        super(446, 300, entity)

        if (this.m_Entity.filterSlots > 0) {
            const filterMode = this.m_Entity.filterMode

            const filterModeWhitelist = new Enable(filterMode === 'whitelist', 'Whitelist')
            filterModeWhitelist.position.set(140, 45)
            this.addChild(filterModeWhitelist)

            const filterModeSwitch = new Switch(['whitelist', 'blacklist'], filterMode)
            filterModeSwitch.position.set(210, 45)
            this.addChild(filterModeSwitch)

            const filterModeBlacklist = new Enable(filterMode === 'blacklist', 'Blacklist')
            filterModeBlacklist.position.set(260, 45)
            this.addChild(filterModeBlacklist)

            // Add Filters
            this.addLabel(140, 56 + 25, `Filter${this.m_Entity.filterSlots === 1 ? '' : 's'}:`)
            this.addFilters(208, 70)

            // Events
            filterModeWhitelist.on('changed', () => {
                this.m_Entity.filterMode = filterModeWhitelist.active ? 'whitelist' : 'blacklist'
            })

            filterModeSwitch.on('changed', () => {
                this.m_Entity.filterMode = filterModeSwitch.value
            })

            filterModeBlacklist.on('changed', () => {
                this.m_Entity.filterMode = filterModeBlacklist.active ? 'blacklist' : 'whitelist'
            })

            this.onEntityChange('filterMode', filterMode => {
                filterModeSwitch.value = filterMode
                filterModeWhitelist.active = filterMode === 'whitelist'
                filterModeBlacklist.active = filterMode === 'blacklist'
            })
        }

        this.addLabel(12, 170, 'Circuit network')
        this.addCircuitCondition(12, 190)

        // Read the held item onto the network. The mode cycle only shows while
        // reading is on; enabling seeds pulse (the game's UI default — NB the
        // define is hold=0/pulse=1, opposite to the belt's).
        const readHand = new Checkbox(this.m_Entity.inserterReadHandContents, 'Read hand contents')
        readHand.position.set(230, 190)
        readHand.on('changed', () => {
            this.m_Entity.inserterReadHandContents = readHand.checked
            refreshMode()
        })
        this.addChild(this.registerControl('readHandContents', readHand))

        const readModeButton = new CycleButton<(typeof HAND_READ_MODES)[number]>(
            HAND_READ_MODES as unknown as (typeof HAND_READ_MODES)[number][],
            HAND_READ_MODES[this.m_Entity.inserterHandReadMode] ?? 'hold',
            v => {
                this.m_Entity.inserterHandReadMode = HAND_READ_MODES.indexOf(v)
            },
            60
        )
        readModeButton.position.set(254, 216)
        this.addChild(this.registerControl('handReadMode', readModeButton))

        const refreshMode = (): void => {
            readModeButton.visible = this.m_Entity.inserterReadHandContents
        }
        refreshMode()

        this.onEntityChange('controlBehavior', () => {
            readHand.checked = this.m_Entity.inserterReadHandContents
            readModeButton.value = HAND_READ_MODES[this.m_Entity.inserterHandReadMode] ?? 'hold'
            refreshMode()
        })
    }
}
