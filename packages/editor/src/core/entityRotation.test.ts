import { describe, it, expect, beforeAll } from 'vitest'
import FD, { loadData, getPossibleRotations, getEntitySize } from './factorioData'
import { havePackData, readPackData } from './packDataFiles'
import { Blueprint } from './Blueprint'
import type { IEntity } from '../types'

/**
 * Rotation of Space Age buildings whose footprint or artwork is directional:
 * the recycler (2×4 furnace), fusion generator (3×5), and fusion reactor
 * (square, two-direction-only). Placed entities used to step 180° whenever
 * width ≠ height, so R never reached east/west.
 */

const have = havePackData('space-age')

describe.skipIf(!have)('space-age entity rotation', () => {
    beforeAll(() => loadData(readPackData('space-age')))

    it('recycler is a 4-way 2×4 furnace', () => {
        const e = FD.entities.recycler
        expect(getPossibleRotations(e)).toEqual([0, 4, 8, 12])
        expect(getEntitySize(e, 0)).toEqual({ x: 2, y: 4 })
        expect(getEntitySize(e, 4)).toEqual({ x: 4, y: 2 })
    })

    it('fusion generator is 4-way 3×5', () => {
        const e = FD.entities['fusion-generator']
        expect(getPossibleRotations(e)).toEqual([0, 4, 8, 12])
        expect(getEntitySize(e, 0)).toEqual({ x: 3, y: 5 })
        expect(getEntitySize(e, 4)).toEqual({ x: 5, y: 3 })
    })

    it('fusion reactor is two-direction-only', () => {
        const e = FD.entities['fusion-reactor']
        expect(getPossibleRotations(e)).toEqual([0, 4])
        expect(getEntitySize(e, 0)).toEqual(getEntitySize(e, 4))
    })

    it('R on a placed recycler steps 90° and swaps the footprint', () => {
        const bp = new Blueprint()
        const ent = bp.createEntity({
            name: 'recycler',
            position: { x: 1, y: 2 },
        } as IEntity)
        expect(ent.direction).toBe(0)
        expect(ent.size).toEqual({ x: 2, y: 4 })
        ent.rotate()
        expect(ent.direction).toBe(4)
        expect(ent.size).toEqual({ x: 4, y: 2 })
        ent.rotate()
        expect(ent.direction).toBe(8)
        expect(ent.size).toEqual({ x: 2, y: 4 })
    })

    it('R on a placed fusion generator steps 90°', () => {
        const bp = new Blueprint()
        const ent = bp.createEntity({
            name: 'fusion-generator',
            position: { x: 1.5, y: 2.5 },
        } as IEntity)
        expect(ent.direction).toBe(0)
        ent.rotate()
        expect(ent.direction).toBe(4)
        expect(ent.size).toEqual({ x: 5, y: 3 })
        ent.rotate()
        expect(ent.direction).toBe(8)
    })

    it('R on a placed fusion reactor toggles north/east', () => {
        const bp = new Blueprint()
        const ent = bp.createEntity({
            name: 'fusion-reactor',
            position: { x: 3, y: 3 },
        } as IEntity)
        expect(ent.direction).toBe(0)
        ent.rotate()
        expect(ent.direction).toBe(4)
        ent.rotate()
        expect(ent.direction).toBe(0)
    })

    it('refuses a 90° recycler rotate that would overlap a neighbour', () => {
        const bp = new Blueprint()
        const recycler = bp.createEntity({
            name: 'recycler',
            position: { x: 1, y: 2 },
        } as IEntity)
        // Tile (2,1) is inside the east-facing 4×2 footprint but not the
        // north-facing 2×4, so a chest there should block the 90° turn.
        bp.createEntity({
            name: 'wooden-chest',
            position: { x: 2.5, y: 1.5 },
        } as IEntity)
        expect(recycler.direction).toBe(0)
        recycler.rotate()
        expect(recycler.direction).toBe(0)
    })
})
