import { describe, it, expect, beforeAll } from 'vitest'
import { loadData } from './factorioData'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import type { IEntity } from '../types'
import { havePackData, readPackData } from './packDataFiles'

/**
 * Train-stop settings — the post-2.0 priority + circuit `control_behavior`
 * write path behind `TrainStopEditor`. These pin the raw serialized shapes,
 * since they land directly in the exported blueprint string: the game omits
 * every default (priority 50, `send_to_train: true`, unset flags), so writing
 * an explicit default would diverge from a native export, and a wrong field
 * name would silently drop the setting on import into Factorio.
 *
 * `Blueprint`/`Entity` are framework-free, so this runs in the node
 * environment without a canvas (same harness as logisticChestFilters.test.ts).
 */

const have = havePackData('vanilla-2.0')

/** The raw entity as it would serialize into the blueprint string. */
const raw = (e: Entity): IEntity => (e as unknown as { m_rawEntity: IEntity }).m_rawEntity

const makeStop = (data?: Partial<IEntity>): Entity => {
    const bp = new Blueprint()
    return bp.createEntity({
        name: 'train-stop',
        position: { x: 1, y: 1 },
        station: 'Test stop',
        ...data,
    } as IEntity)
}

describe.skipIf(!have)('train stop settings', () => {
    beforeAll(() => loadData(readPackData('vanilla-2.0')))

    describe('priority', () => {
        it('defaults to 50 and omits the default from the raw entity', () => {
            const e = makeStop()
            expect(e.trainStopPriority).toBe(50)
            expect(raw(e).priority).toBeUndefined()

            e.trainStopPriority = 51
            e.trainStopPriority = 50
            expect(raw(e).priority).toBeUndefined()
        })

        it('writes a non-default priority and clamps to 0-255', () => {
            const e = makeStop()
            e.trainStopPriority = 12
            expect(raw(e).priority).toBe(12)

            e.trainStopPriority = 999
            expect(raw(e).priority).toBe(255)

            e.trainStopPriority = -3
            expect(raw(e).priority).toBe(0)
            expect(e.trainStopPriority).toBe(0)
        })
    })

    describe('send to train', () => {
        it('defaults ON and only ever serializes false', () => {
            // The one inverted flag: the game omits `true` (its default) and the
            // info-panel summary counts on absence meaning enabled.
            const e = makeStop()
            expect(e.sendToTrain).toBe(true)

            e.sendToTrain = false
            expect(raw(e).control_behavior.send_to_train).toBe(false)
            expect(e.sendToTrain).toBe(false)

            e.sendToTrain = true
            expect(raw(e).control_behavior.send_to_train).toBeUndefined()
        })
    })

    describe('read from train', () => {
        it('stores true and clears back to undefined, not false', () => {
            const e = makeStop()
            e.readFromTrain = true
            expect(raw(e).control_behavior.read_from_train).toBe(true)

            e.readFromTrain = false
            expect(raw(e).control_behavior.read_from_train).toBeUndefined()
        })
    })

    describe('flag + signal outputs', () => {
        it('enabling seeds the game-default letter signal', () => {
            const e = makeStop()
            e.readStoppedTrain = true
            expect(raw(e).control_behavior.read_stopped_train).toBe(true)
            expect(raw(e).control_behavior.train_stopped_signal).toEqual({
                type: 'virtual',
                name: 'signal-T',
            })

            e.setTrainsLimit = true
            expect(raw(e).control_behavior.trains_limit_signal).toEqual({
                type: 'virtual',
                name: 'signal-L',
            })

            e.readTrainsCount = true
            expect(raw(e).control_behavior.trains_count_signal).toEqual({
                type: 'virtual',
                name: 'signal-C',
            })

            e.setPriority = true
            expect(raw(e).control_behavior.set_priority).toBe(true)
            expect(raw(e).control_behavior.priority_signal).toEqual({
                type: 'virtual',
                name: 'signal-P',
            })
        })

        it('leaves an explicitly chosen signal alone when toggling the flag', () => {
            const e = makeStop()
            e.trainStoppedSignal = { type: 'virtual', name: 'signal-A' }
            e.readStoppedTrain = true
            expect(raw(e).control_behavior.train_stopped_signal).toEqual({
                type: 'virtual',
                name: 'signal-A',
            })

            // Disabling drops the flag but keeps the choice for a re-enable; a
            // signal next to an unset flag is inert and Factorio accepts it.
            e.readStoppedTrain = false
            expect(raw(e).control_behavior.read_stopped_train).toBeUndefined()
            expect(raw(e).control_behavior.train_stopped_signal).toEqual({
                type: 'virtual',
                name: 'signal-A',
            })
        })

        it('a signal change alone does not flip its flag', () => {
            const e = makeStop()
            e.trainsLimitSignal = { type: 'virtual', name: 'signal-Z' }
            expect(raw(e).control_behavior.set_trains_limit).toBeUndefined()
            expect(e.setTrainsLimit).toBe(false)
        })
    })

    describe('sign colour', () => {
        it('writes the root-level color and clears back to absent', () => {
            // Absence = the prototype default (the renderer falls back to the
            // prototype's own tint), so reset must remove the key, not write a
            // "default colour" guess.
            const e = makeStop()
            expect(e.trainStopColor).toBeUndefined()

            const red = { r: 1, g: 0, b: 0, a: 0.5 }
            e.trainStopColor = red
            expect(raw(e).color).toEqual(red)

            e.trainStopColor = undefined
            expect(raw(e).color).toBeUndefined()
        })

        it('setting the same colour again is a no-op (no history churn)', () => {
            const e = makeStop()
            e.trainStopColor = { r: 1, g: 0, b: 0, a: 0.5 }
            const before = raw(e).color
            e.trainStopColor = { r: 1, g: 0, b: 0, a: 0.5 }
            // Same value object identity — an equal write short-circuits before
            // touching history, so the raw reference is untouched.
            expect(raw(e).color).toBe(before)
        })
    })

    describe('summary + preserved siblings', () => {
        it('reports the enabled flags in the circuit summary', () => {
            const e = makeStop()
            e.readFromTrain = true
            e.setPriority = true
            const lines = e.circuitModeSummary
            // send_to_train defaults ON, so it reads as enabled without being set.
            expect(lines).toContain('Sends to train')
            expect(lines).toContain('Reads from train')
            expect(lines).toContain('Sets priority from circuit ← signal-P')
        })

        it('does not disturb unrelated control_behavior keys', () => {
            // An imported blueprint can carry circuit_enabled/circuit_condition;
            // the clone-mutate-write path must keep them across a flag toggle.
            const e = makeStop({
                control_behavior: {
                    circuit_enabled: true,
                    circuit_condition: { comparator: '<', constant: 5 },
                },
            })
            e.readTrainsCount = true
            expect(raw(e).control_behavior.circuit_enabled).toBe(true)
            expect(raw(e).control_behavior.circuit_condition).toEqual({
                comparator: '<',
                constant: 5,
            })
        })
    })
})
