import { describe, it, expect, beforeAll } from 'vitest'
import pako from 'pako'
import { loadData } from './factorioData'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import { encode } from './bpString'
import type { IEntity } from '../types'
import { havePackData, readPackData } from './packDataFiles'

/**
 * Factorio 2.0 blueprint `mirror` bit — the field that lands in the exported
 * string. Lua runtime uses `LuaEntity.mirroring`; the JSON concept is
 * `BlueprintEntity.mirror` (optional boolean). The game omits the key when
 * the entity is not mirrored; writing `false` would still import, but native
 * exports never include it.
 *
 * These pin that shape so H/V flip stays import-compatible: a wrong field
 * name (`mirroring`) would be ignored by Factorio and the flip would vanish
 * on paste.
 */

const have = havePackData('space-age')

const raw = (e: Entity): IEntity => (e as unknown as { m_rawEntity: IEntity }).m_rawEntity

const make = (name: string, data?: Partial<IEntity>): Entity => {
    const bp = new Blueprint()
    return bp.createEntity({
        name,
        position: { x: 1, y: 1 },
        ...data,
    } as IEntity)
}

describe.skipIf(!have)('entity blueprint mirror field', () => {
    beforeAll(() => loadData(readPackData('space-age')))

    it('omits mirror on a freshly placed chemical plant', () => {
        const e = make('chemical-plant')
        expect(e.mirror).toBe(false)
        expect(raw(e).mirror).toBeUndefined()
        expect(JSON.stringify(e.serialize())).not.toContain('"mirror"')
    })

    it('writes mirror:true after a horizontal flip (north plant keeps direction 0)', () => {
        const e = make('chemical-plant')
        e.flip(false)
        expect(e.mirror).toBe(true)
        expect(e.direction).toBe(0)
        expect(raw(e).mirror).toBe(true)
        const json = JSON.stringify(e.serialize())
        expect(json).toContain('"mirror":true')
        expect(json).not.toContain('"mirror":false')
    })

    it('drops mirror again after a second horizontal flip', () => {
        const e = make('chemical-plant')
        e.flip(false)
        e.flip(false)
        expect(e.mirror).toBe(false)
        expect(raw(e).mirror).toBeUndefined()
        expect(JSON.stringify(e.serialize())).not.toContain('"mirror"')
    })

    it('pairs east→west with the mirror bit (same transform as in-game H)', () => {
        const e = make('chemical-plant', { direction: 4 })
        e.flip(false)
        expect(e.direction).toBe(12)
        expect(e.mirror).toBe(true)
        const s = e.serialize()
        expect(s.direction).toBe(12)
        expect(s.mirror).toBe(true)
    })

    it('does not emit mirror on belts (direction-only flip)', () => {
        const e = make('transport-belt', { direction: 4 })
        e.flip(false)
        expect(e.direction).toBe(12)
        expect(e.mirror).toBe(false)
        expect(raw(e).mirror).toBeUndefined()
        expect(JSON.stringify(e.serialize())).not.toContain('"mirror"')
    })

    it('writes mirror:true on a flipped recycler', () => {
        const e = make('recycler')
        e.flip(false)
        expect(e.mirror).toBe(true)
        expect(JSON.stringify(e.serialize())).toContain('"mirror":true')
    })

    it('round-trips mirror through Blueprint serialize / reconstruct', () => {
        const bp = new Blueprint()
        const e = bp.createEntity({
            name: 'chemical-plant',
            position: { x: 0.5, y: 0.5 },
        } as IEntity)
        e.flip(false)
        const serialized = bp.serialize()
        const entity = serialized.entities?.find(ent => ent.name === 'chemical-plant')
        expect(entity?.mirror).toBe(true)

        const reloaded = new Blueprint(serialized)
        const loaded = [...reloaded.entities.values()].find(ent => ent.name === 'chemical-plant')
        expect(loaded?.mirror).toBe(true)
        expect(JSON.stringify(loaded?.serialize())).toContain('"mirror":true')
    })

    it('encodes mirror:true into the blueprint string payload', async () => {
        const bp = new Blueprint()
        bp.createEntity({
            name: 'chemical-plant',
            position: { x: 0.5, y: 0.5 },
            mirror: true,
        } as IEntity)
        const str = await encode(bp)
        expect(str.startsWith('0')).toBe(true)
        const inflated = pako.inflate(Buffer.from(str.slice(1), 'base64'), {
            to: 'string',
        }) as string
        expect(inflated).toContain('"mirror":true')
        expect(inflated).not.toContain('"mirror":false')
    })
})
