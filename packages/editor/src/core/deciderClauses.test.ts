import { describe, it, expect, beforeAll } from 'vitest'
import { loadData } from './factorioData'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import type { IEntity } from '../types'
import { havePackData, readPackData } from './packDataFiles'
import {
    readDeciderClauses,
    writeDeciderClauses,
    networkSelection,
    toNetworkField,
} from './deciderClauses'

/**
 * Decider clause model — the regression this pins is data loss: the old editor
 * read `conditions[0]`/`outputs[0]` and committed 1-element arrays, so touching
 * any control of a multi-clause 2.0 decider silently deleted the other clauses.
 * The editor now round-trips through read/writeDeciderClauses, whose contract
 * (everything read is written back) is what these tests hold in place.
 */

const have = havePackData('vanilla-2.0')

const raw = (e: Entity): IEntity => (e as unknown as { m_rawEntity: IEntity }).m_rawEntity

const THREE_CLAUSES = {
    conditions: [
        { first_signal: { type: 'virtual', name: 'signal-A' }, comparator: '>', constant: 10 },
        {
            first_signal: { type: 'virtual', name: 'signal-B' },
            comparator: '=',
            constant: 0,
            compare_type: 'and',
            first_signal_networks: { red: true, green: false },
        },
        { first_signal: { type: 'virtual', name: 'signal-C' }, comparator: '<', constant: 5 },
    ],
    outputs: [
        { signal: { type: 'virtual', name: 'signal-X' } },
        {
            signal: { type: 'virtual', name: 'signal-Y' },
            copy_count_from_input: false,
            constant: 7,
            networks: { red: false, green: true },
        },
    ],
} as const

describe('decider clause model (framework-free)', () => {
    it('round-trips every clause — the editor commit path cannot drop rows', () => {
        const clauses = readDeciderClauses(JSON.parse(JSON.stringify(THREE_CLAUSES)))
        expect(clauses.conditions).toHaveLength(3)
        expect(clauses.outputs).toHaveLength(2)

        // Simulate the editor's real flow: mutate one row, write all back.
        clauses.conditions[0].comparator = '≥'
        const written = writeDeciderClauses(clauses)

        expect(written.conditions).toHaveLength(3)
        expect(written.outputs).toHaveLength(2)
        expect(written.conditions[0].comparator).toBe('≥')
        // Untouched rows survive verbatim, per-operand networks included.
        expect(written.conditions[1]).toEqual(THREE_CLAUSES.conditions[1])
        expect(written.outputs[1]).toEqual(THREE_CLAUSES.outputs[1])
    })

    it('copies rows, so editor-side mutation cannot alias the entity state', () => {
        const dc = JSON.parse(JSON.stringify(THREE_CLAUSES))
        const clauses = readDeciderClauses(dc)
        clauses.conditions[2].constant = 999
        expect(dc.conditions[2].constant).toBe(5)
    })

    it('lifts a pre-2.0 flat condition into one editable row', () => {
        const clauses = readDeciderClauses({
            first_signal: { type: 'virtual', name: 'signal-A' },
            comparator: '>',
            constant: 3,
            output_signal: { type: 'virtual', name: 'signal-O' },
            copy_count_from_input: false,
        })
        expect(clauses.conditions).toEqual([
            expect.objectContaining({
                first_signal: { type: 'virtual', name: 'signal-A' },
                comparator: '>',
                constant: 3,
            }),
        ])
        expect(clauses.outputs).toEqual([
            { signal: { type: 'virtual', name: 'signal-O' }, copy_count_from_input: false },
        ])
        // …and re-serializes in the 2.0 shape only (no legacy flat fields).
        const written = writeDeciderClauses(clauses)
        expect(written.first_signal).toBeUndefined()
        expect(written.output_signal).toBeUndefined()
    })

    it('seeds one blank row each for an unconfigured combinator', () => {
        const clauses = readDeciderClauses({})
        expect(clauses.conditions).toHaveLength(1)
        expect(clauses.outputs).toHaveLength(1)
    })

    it('normalizes the network filter with both-on as the omitted default', () => {
        expect(networkSelection(undefined)).toEqual({ red: true, green: true })
        expect(networkSelection({ green: false })).toEqual({ red: true, green: false })
        expect(toNetworkField(true, true)).toBeUndefined()
        expect(toNetworkField(true, false)).toEqual({ red: true, green: false })
    })
})

describe.skipIf(!have)('decider clauses through the entity', () => {
    beforeAll(() => loadData(readPackData('vanilla-2.0')))

    it('a full-array commit preserves clauses across the history write', () => {
        const bp = new Blueprint()
        const e = bp.createEntity({
            name: 'decider-combinator',
            position: { x: 0.5, y: 1 },
            control_behavior: {
                decider_conditions: JSON.parse(JSON.stringify(THREE_CLAUSES)),
            },
        } as unknown as IEntity)

        // The exact write the editor performs for a comparator change on row 0.
        const clauses = readDeciderClauses(e.deciderConditions)
        clauses.conditions[0].comparator = '≠'
        e.deciderConditions = writeDeciderClauses(clauses)

        const dc = raw(e).control_behavior.decider_conditions
        expect(dc.conditions).toHaveLength(3)
        expect(dc.outputs).toHaveLength(2)
        expect(dc.conditions[0].comparator).toBe('≠')
        expect(dc.conditions[1].first_signal_networks).toEqual({ red: true, green: false })
    })
})
