import { describe, it, expect, beforeAll } from 'vitest'
import { loadData } from './factorioData'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import type { IEntity, ItemFilter, SplitterFilter, BlueprintInsertPlan } from '../types'
import { havePackData, readPackData } from './packDataFiles'

/**
 * Quality fidelity (issue #5 slice 0): write paths must not drop quality, and
 * an absent quality key must stay keyless (filter "any", not normal `=`).
 */

const have = havePackData('vanilla-2.0')

const raw = (e: Entity): IEntity => (e as unknown as { m_rawEntity: IEntity }).m_rawEntity

const make = (name: string, data?: Partial<IEntity>): Entity => {
    const bp = new Blueprint()
    return bp.createEntity({
        name,
        position: { x: 1.5, y: 1.5 },
        ...data,
    } as IEntity)
}

describe.skipIf(!have)('quality fidelity', () => {
    beforeAll(() => loadData(readPackData('vanilla-2.0')))

    it('types and omits entity quality when normal', () => {
        const e = make('assembling-machine-2', { quality: 'legendary' })
        expect(e.quality).toBe('legendary')
        expect(raw(e).quality).toBe('legendary')

        e.quality = 'normal'
        expect(e.quality).toBeUndefined()
        expect(raw(e).quality).toBeUndefined()
    })

    it('paste settings does not copy entity quality (game parity)', () => {
        const src = make('assembling-machine-2', { quality: 'rare' })
        const dst = make('assembling-machine-2')
        dst.pasteSettings(src)
        expect(dst.quality).toBeUndefined()
        expect(raw(dst).quality).toBeUndefined()
    })

    it('keeps inserter filter quality through a rewrite, and keyless stays keyless', () => {
        const e = make('fast-inserter', {
            filters: [
                { index: 1, name: 'iron-plate', quality: 'epic', comparator: '≥' },
                { index: 2, name: 'copper-plate' },
            ],
        })

        e.filters = [
            { index: 1, name: 'iron-plate', quality: 'epic', comparator: '≥' },
            { index: 2, name: 'copper-plate' },
        ]

        const filters = raw(e).filters as ItemFilter[]
        expect(filters[0]).toEqual({
            index: 1,
            name: 'iron-plate',
            quality: 'epic',
            comparator: '≥',
        })
        expect(filters[1]).toEqual({ index: 2, name: 'copper-plate' })
        expect(filters[1].quality).toBeUndefined()
    })

    it('splitter filter writes quality and comparator, not just the name', () => {
        const e = make('splitter', {
            filter: { name: 'iron-plate', quality: 'uncommon', comparator: '=' },
            output_priority: 'left',
        })

        e.filters = [{ index: 1, name: 'iron-plate', quality: 'legendary', comparator: '≠' }]

        expect(raw(e).filter).toEqual({
            name: 'iron-plate',
            quality: 'legendary',
            comparator: '≠',
        } satisfies SplitterFilter)
    })

    it('a quality-only splitter edit does not no-op', () => {
        const e = make('fast-splitter', {
            filter: { name: 'iron-plate' },
            output_priority: 'left',
        })
        e.filters = [{ index: 1, name: 'iron-plate', quality: 'rare', comparator: '=' }]
        expect((raw(e).filter as SplitterFilter).quality).toBe('rare')
    })

    it('writes quality-only splitter filters without an item name', () => {
        const e = make('splitter', { output_priority: 'left' })
        e.filters = [{ index: 1, quality: 'uncommon', comparator: '≥' }]
        expect(raw(e).filter).toEqual({
            quality: 'uncommon',
            comparator: '≥',
        } satisfies SplitterFilter)
        expect(e.filters).toEqual([{ index: 1, quality: 'uncommon', comparator: '≥' }])
    })

    it('writes quality-only inserter filters without an item name', () => {
        const e = make('fast-inserter')
        e.filters = [{ index: 1, quality: 'legendary', comparator: '=' }]
        const filters = raw(e).filters as ItemFilter[]
        expect(filters).toEqual([{ index: 1, quality: 'legendary', comparator: '=' }])
        expect(filters[0].name).toBeUndefined()
    })

    it('reads quality-only splitter filters from imported raw data', () => {
        const e = make('express-splitter', {
            filter: { quality: 'epic', comparator: '=' },
            output_priority: 'right',
        })
        expect(e.filters).toEqual([{ index: 1, quality: 'epic', comparator: '=' }])
    })

    it('modules group insert-plans by name and quality', () => {
        const e = make('assembling-machine-2')
        e.modules = [{ name: 'speed-module', quality: 'rare' }, { name: 'speed-module' }]

        const items = raw(e).items as BlueprintInsertPlan[]
        const rare = items.find(i => i.id.quality === 'rare')
        const normal = items.find(i => i.id.name === 'speed-module' && !i.id.quality)
        expect(rare?.id).toEqual({ name: 'speed-module', quality: 'rare' })
        expect(normal?.id).toEqual({ name: 'speed-module' })
        expect(e.modules[0]).toEqual({ name: 'speed-module', quality: 'rare' })
        expect(e.modules[1]).toEqual({ name: 'speed-module' })
    })

    it('recipe change that keeps a module also keeps its quality', () => {
        const e = make('assembling-machine-2', { recipe: 'iron-gear-wheel' })
        e.modules = [{ name: 'speed-module', quality: 'epic' }]
        e.recipe = 'copper-cable'
        expect(e.modules[0]).toEqual({ name: 'speed-module', quality: 'epic' })
    })

    it('round-trips a quality-rich blueprint through serialize', () => {
        const bp = new Blueprint()
        const asm = bp.createEntity({
            name: 'assembling-machine-2',
            position: { x: 1.5, y: 1.5 },
            quality: 'legendary',
        } as IEntity)
        asm.modules = [{ name: 'productivity-module', quality: 'rare' }]
        bp.createEntity({
            name: 'fast-inserter',
            position: { x: 3.5, y: 1.5 },
            filters: [{ index: 1, name: 'iron-plate', quality: 'uncommon', comparator: '=' }],
        } as IEntity)
        bp.createEntity({
            name: 'splitter',
            position: { x: 5.5, y: 1.5 },
            output_priority: 'left',
            filter: { name: 'copper-plate', quality: 'epic' },
        } as IEntity)

        const ser = bp.serialize()
        const a = ser.entities.find(en => en.name === 'assembling-machine-2')
        const ins = ser.entities.find(en => en.name === 'fast-inserter')
        const spl = ser.entities.find(en => en.name === 'splitter')
        expect(a?.quality).toBe('legendary')
        expect((a?.items as BlueprintInsertPlan[])[0].id.quality).toBe('rare')
        expect((ins?.filters as ItemFilter[])[0].quality).toBe('uncommon')
        expect((spl?.filter as SplitterFilter).quality).toBe('epic')
    })

    it('types recipe_quality independently of entity quality', () => {
        const e = make('assembling-machine-2', { recipe: 'iron-gear-wheel' })
        e.recipeQuality = 'epic'
        expect(e.recipeQuality).toBe('epic')
        expect(raw(e).recipe_quality).toBe('epic')
        e.recipe = undefined
        expect(raw(e).recipe_quality).toBeUndefined()
    })
})
