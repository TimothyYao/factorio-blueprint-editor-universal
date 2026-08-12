import { describe, it, expect, beforeAll } from 'vitest'
import { loadData } from './factorioData'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import type { IEntity } from '../types'
import { havePackData, readPackData } from './packDataFiles'

/**
 * The circuit read/set-mode write paths behind the roboport, display-panel,
 * inserter and logistic-chest editor additions. As everywhere, defaults store
 * `undefined` so the export matches the game's omit-the-default convention —
 * and the inserter's `hand_read_mode` is pinned explicitly because its define
 * is numbered opposite to the belt's (hold=0/pulse=1 vs pulse=0/hold=1), a
 * trap this codebase already fell into once (the info-panel summary reported
 * inserters inverted).
 */

const have = havePackData('vanilla-2.0')

const raw = (e: Entity): IEntity => (e as unknown as { m_rawEntity: IEntity }).m_rawEntity

const make = (name: string, data?: Partial<IEntity>): Entity => {
    const bp = new Blueprint()
    return bp.createEntity({ name, position: { x: 1, y: 1 }, ...data } as IEntity)
}

describe.skipIf(!have)('inserter read mode', () => {
    beforeAll(() => loadData(readPackData('vanilla-2.0')))

    it('enabling read seeds pulse (the UI default = 1), disabling clears the flag', () => {
        const e = make('fast-inserter')
        e.inserterReadHandContents = true
        expect(raw(e).control_behavior.circuit_read_hand_contents).toBe(true)
        expect(raw(e).control_behavior.circuit_hand_read_mode).toBe(1)

        e.inserterReadHandContents = false
        expect(raw(e).control_behavior.circuit_read_hand_contents).toBeUndefined()
    })

    it('hold is the define default (0) and stores as absent', () => {
        const e = make('fast-inserter')
        e.inserterReadHandContents = true
        e.inserterHandReadMode = 0 // hold
        expect(raw(e).control_behavior.circuit_hand_read_mode).toBeUndefined()
        expect(e.inserterHandReadMode).toBe(0)

        e.inserterHandReadMode = 1 // pulse
        expect(raw(e).control_behavior.circuit_hand_read_mode).toBe(1)
    })

    it('the info-panel summary names the inserter mode correctly', () => {
        // Regression: the summary used the belt mapping (1 = hold) for
        // inserters too, reporting them inverted.
        const e = make('fast-inserter', {
            control_behavior: { circuit_read_hand_contents: true, circuit_hand_read_mode: 1 },
        })
        expect(e.circuitModeSummary).toContain('Reads hand contents (pulse)')
    })
})

describe.skipIf(!have)('roboport circuit settings', () => {
    beforeAll(() => loadData(readPackData('vanilla-2.0')))

    it('read_items_mode omits none (0) and round-trips logistics/missing requests', () => {
        const e = make('roboport')
        expect(e.roboportReadItemsMode).toBe(0)

        e.roboportReadItemsMode = 1
        expect(raw(e).control_behavior.read_items_mode).toBe(1)
        expect(e.circuitModeSummary).toContain('Reads logistics contents')

        e.roboportReadItemsMode = 2
        expect(raw(e).control_behavior.read_items_mode).toBe(2)
        expect(e.circuitModeSummary).toContain('Reads missing requests')

        e.roboportReadItemsMode = 0
        expect(raw(e).control_behavior.read_items_mode).toBeUndefined()
    })

    it('read_robot_stats toggles and the stat signals write by field name', () => {
        const e = make('roboport')
        e.roboportReadRobotStats = true
        expect(raw(e).control_behavior.read_robot_stats).toBe(true)

        e.setRoboportStatSignal('available_logistic_output_signal', {
            type: 'virtual',
            name: 'signal-A',
        })
        expect(raw(e).control_behavior.available_logistic_output_signal).toEqual({
            type: 'virtual',
            name: 'signal-A',
        })
        expect(e.getRoboportStatSignal('available_logistic_output_signal')).toEqual({
            type: 'virtual',
            name: 'signal-A',
        })
        // No seeding on enable: the other four stay absent (= game defaults).
        expect(raw(e).control_behavior.total_logistic_output_signal).toBeUndefined()
    })
})

describe.skipIf(!have)('display panel', () => {
    beforeAll(() => loadData(readPackData('vanilla-2.0')))

    it('writes text/icon/flags at the root and clears back to absent', () => {
        const e = make('display-panel')
        e.displayPanelText = 'Iron outpost'
        e.displayPanelIcon = { type: 'virtual', name: 'signal-info' }
        e.displayPanelAlwaysShow = true
        e.displayPanelShowInChart = true

        expect(raw(e).text).toBe('Iron outpost')
        expect(raw(e).icon).toEqual({ type: 'virtual', name: 'signal-info' })
        expect(raw(e).always_show).toBe(true)
        expect(raw(e).show_in_chart).toBe(true)

        e.displayPanelText = ''
        e.displayPanelAlwaysShow = false
        expect(raw(e).text).toBeUndefined()
        expect(raw(e).always_show).toBeUndefined()
    })
})

describe.skipIf(!have)('logistic chest circuit mode', () => {
    beforeAll(() => loadData(readPackData('vanilla-2.0')))

    it('omits send-contents (0) and round-trips set-requests/none on any mode', () => {
        for (const name of ['requester-chest', 'passive-provider-chest']) {
            const e = make(name)
            expect(e.chestCircuitMode).toBe(0)

            e.chestCircuitMode = 1 // set requests
            expect(raw(e).control_behavior.circuit_mode_of_operation).toBe(1)

            e.chestCircuitMode = 2 // none
            expect(raw(e).control_behavior.circuit_mode_of_operation).toBe(2)

            e.chestCircuitMode = 0
            expect(raw(e).control_behavior.circuit_mode_of_operation).toBeUndefined()
        }
    })
})
