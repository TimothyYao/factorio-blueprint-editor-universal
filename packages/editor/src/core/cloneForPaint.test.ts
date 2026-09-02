import { describe, it, expect, beforeAll } from 'vitest'
import { loadData } from './factorioData'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import type { IEntity } from '../types'
import { havePackData, readPackData } from './packDataFiles'

/**
 * Q-pick / copy must carry alt-mode fields onto the paint ghost: recipe (and
 * therefore fluid boxes), modules, filters, inserter vectors, orientation,
 * and the blueprint `mirror` bit. `cloneForPaint` is the snapshot both
 * pipette and a single-entity copy feed into `PaintEntityContainer`.
 */

const have = havePackData('space-age')

const make = (data: Partial<IEntity> & { name: string }): Entity => {
    const bp = new Blueprint()
    return bp.createEntity({
        position: { x: 1.5, y: 1.5 },
        ...data,
    } as IEntity)
}

describe.skipIf(!have)('cloneForPaint', () => {
    beforeAll(() => loadData(readPackData('space-age')))

    it('drops identity but keeps recipe, mirror, and direction', () => {
        const e = make({
            name: 'chemical-plant',
            recipe: 'advanced-oil-processing',
            direction: 4,
            mirror: true,
        })
        const snap = e.cloneForPaint()
        expect(snap.entity_number).toBeUndefined()
        expect(snap.position).toEqual({ x: 0, y: 0 })
        expect(snap.name).toBe('chemical-plant')
        expect(snap.recipe).toBe('advanced-oil-processing')
        expect(snap.direction).toBe(4)
        expect(snap.mirror).toBe(true)
        expect(e.assemblerHasFluidInputs).toBe(true)
        const ghost = new Entity({ ...snap, entity_number: 0 }, e.Blueprint)
        expect(ghost.recipe).toBe('advanced-oil-processing')
        expect(ghost.assemblerHasFluidInputs).toBe(true)
        expect(ghost.mirror).toBe(true)
    })

    it('keeps inserter pickup/drop overrides', () => {
        const e = make({
            name: 'inserter',
            pickup_position: { x: 0, y: -1 },
            drop_position: { x: 0.25, y: 1 },
        })
        const snap = e.cloneForPaint()
        expect(snap.pickup_position).toEqual({ x: 0, y: -1 })
        expect(snap.drop_position).toEqual({ x: 0.25, y: 1 })
    })

    it('keeps splitter lane priority (the alt-mode arrows)', () => {
        const e = make({
            name: 'splitter',
            input_priority: 'left',
            output_priority: 'right',
        })
        const snap = e.cloneForPaint()
        expect(snap.input_priority).toBe('left')
        expect(snap.output_priority).toBe('right')
    })

    it('keeps combinator conditions', () => {
        const e = make({
            name: 'arithmetic-combinator',
            control_behavior: {
                arithmetic_conditions: {
                    first_signal: { type: 'item', name: 'iron-plate' },
                    second_constant: 2,
                    operation: '*',
                    output_signal: { type: 'item', name: 'iron-plate' },
                },
            },
        })
        const snap = e.cloneForPaint()
        expect(snap.control_behavior?.arithmetic_conditions?.operation).toBe('*')
        expect(snap.control_behavior?.arithmetic_conditions?.first_signal?.name).toBe('iron-plate')
    })
})
