import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import FD, { loadData, namesMissingFromInventoryLayout } from './factorioData'
import { Entity } from './Entity'
import type { IEntity } from '../types'
import type { Blueprint } from './Blueprint'

/**
 * Recipe picker completeness.
 *
 * The recipe/module/item picker (InventoryDialog) renders its choices by walking
 * `inventoryLayout` and showing the entries present in a filter — so a name in
 * the filter but *absent* from the layout was silently unselectable. This bit
 * modded recipes the exporter couldn't place: a recipe inherits its subgroup
 * from its product in Factorio, but the dump only carries an explicit subgroup,
 * so product-inheriting recipes fall out of the layout. In Space Exploration
 * that made `se-iron-ingot-to-plate` (iron ingot → iron plate in an assembling
 * machine) impossible to pick even though the machine accepts it.
 *
 * `namesMissingFromInventoryLayout` surfaces exactly those orphans, which the
 * dialog appends as an "Other" tab. The invariant here: the picker's selectable
 * set — layout names ∪ orphans — must cover every recipe a crafting machine
 * accepts, in every pack.
 */
const stubBP = undefined as unknown as Blueprint

function layoutNames(): Set<string> {
    const present = new Set<string>()
    for (const group of FD.inventoryLayout) {
        const subgroups = Array.isArray(group.subgroups) ? group.subgroups : []
        for (const subgroup of subgroups) {
            const items = Array.isArray(subgroup.items) ? subgroup.items : []
            for (const item of items) present.add(item.name)
        }
    }
    return present
}

function acceptedRecipesFor(name: string): string[] {
    return new Entity({ entity_number: 1, name, position: { x: 0, y: 0 } } as IEntity, stubBP)
        .acceptedRecipes
}

describe('namesMissingFromInventoryLayout', () => {
    it('reports only names absent from the layout', () => {
        loadData(readFileSync('packages/exporter/data/output/space-exploration/data.json', 'utf8'))
        const present = layoutNames()
        const somePresent = [...present].slice(0, 5)
        const absent = '__definitely-not-in-any-layout__'
        const missing = namesMissingFromInventoryLayout([...somePresent, absent])
        // Present names are never reported; a name that isn't in the layout is.
        for (const n of somePresent) expect(missing).not.toContain(n)
        expect(missing).toContain(absent)
    })
})

describe('SE iron-ingot-to-plate is pickable (regression)', () => {
    it('assembling-machine-2 accepts it and the layout now places it', () => {
        loadData(readFileSync('packages/exporter/data/output/space-exploration/data.json', 'utf8'))
        const accepted = acceptedRecipesFor('assembling-machine-2')
        expect(accepted).toContain('se-iron-ingot-to-plate')
        // With the layout fix it's placed in its product's subgroup (`iron`),
        // so it's directly pickable — no longer relegated to the "Other" tab.
        expect(layoutNames().has('se-iron-ingot-to-plate')).toBe(true)
        expect(namesMissingFromInventoryLayout(accepted)).not.toContain('se-iron-ingot-to-plate')
    })
})

describe('layout has no duplicate names (regression)', () => {
    it.each(['vanilla-2.0', 'space-age', 'space-exploration'])('%s', pack => {
        loadData(readFileSync(`packages/exporter/data/output/${pack}/data.json`, 'utf8'))
        const seen = new Set<string>()
        const dups: string[] = []
        for (const group of FD.inventoryLayout) {
            const subgroups = Array.isArray(group.subgroups) ? group.subgroups : []
            for (const subgroup of subgroups) {
                const items = Array.isArray(subgroup.items) ? subgroup.items : []
                for (const item of items) {
                    if (seen.has(item.name)) dups.push(item.name)
                    seen.add(item.name)
                }
            }
        }
        expect(dups, `duplicate layout entries: ${dups.join(', ')}`).toEqual([])
    })
})

describe.each(['vanilla-2.0', 'space-age', 'space-exploration'])(
    'acceptedRecipes excludes hidden recipes: %s',
    pack => {
        it('never offers a hidden recipe (recipe-unknown, *-recycling, …)', () => {
            loadData(readFileSync(`packages/exporter/data/output/${pack}/data.json`, 'utf8'))
            const offered = new Set<string>()
            for (const [name, e] of Object.entries(FD.entities)) {
                if (e.type !== 'assembling-machine' && e.type !== 'furnace') continue
                for (const r of acceptedRecipesFor(name)) offered.add(r)
            }
            const hiddenOffered = [...offered].filter(
                r => (FD.recipes[r] as { hidden?: boolean }).hidden
            )
            expect(hiddenOffered, `hidden recipes offered: ${hiddenOffered.join(', ')}`).toEqual([])
            // Sanity: the placeholder is present in the data but must not be offered.
            if (FD.recipes['recipe-unknown']) expect(offered.has('recipe-unknown')).toBe(false)
        })
    }
)

describe.each(['vanilla-2.0', 'space-age', 'space-exploration'])(
    'recipe picker covers every accepted recipe: %s',
    pack => {
        it('layout ∪ orphans is exhaustive for crafting machines', () => {
            loadData(readFileSync(`packages/exporter/data/output/${pack}/data.json`, 'utf8'))
            const present = layoutNames()
            const gaps: string[] = []
            for (const [name, e] of Object.entries(FD.entities)) {
                if (e.type !== 'assembling-machine' && e.type !== 'furnace') continue
                const accepted = acceptedRecipesFor(name)
                if (accepted.length === 0) continue
                const orphans = new Set(namesMissingFromInventoryLayout(accepted))
                for (const recipe of accepted) {
                    if (!present.has(recipe) && !orphans.has(recipe)) {
                        gaps.push(`${name}:${recipe}`)
                    }
                }
            }
            expect(gaps, `unpickable accepted recipes: ${gaps.join(', ')}`).toEqual([])
        })
    }
)
