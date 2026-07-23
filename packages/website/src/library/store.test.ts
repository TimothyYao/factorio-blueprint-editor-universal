import { describe, it, expect } from 'vitest'
import { InMemoryLibraryStore, migrate } from './store'
import { createLibrary, ensurePack, makeBlueprint, addNode, LIBRARY_VERSION } from './model'

// IndexedDB isn't available in the node test env, so these cover the in-memory
// store (the test/fallback backend) and the pure `migrate` guard. The IDB impl
// is verified by running the app.

function sampleLibrary() {
    const state = createLibrary()
    const tree = ensurePack(state, 'vanilla-2.0')
    addNode(tree, makeBlueprint('mall', '0aaa'))
    return state
}

describe('InMemoryLibraryStore', () => {
    it('returns null before anything is saved', async () => {
        const store = new InMemoryLibraryStore()
        expect(await store.load()).toBeNull()
    })

    it('round-trips a saved library', async () => {
        const store = new InMemoryLibraryStore()
        await store.save(sampleLibrary())
        const loaded = await store.load()
        expect(loaded?.packs['vanilla-2.0'].children).toHaveLength(1)
        expect(loaded?.packs['vanilla-2.0'].children[0].name).toBe('mall')
    })

    it('isolates stored state from later caller mutation (clones on save & load)', async () => {
        const store = new InMemoryLibraryStore()
        const state = sampleLibrary()
        await store.save(state)

        // Mutating the original after save must not leak into the store.
        ensurePack(state, 'vanilla-2.0').children[0].name = 'mutated'
        const a = await store.load()
        expect(a?.packs['vanilla-2.0'].children[0].name).toBe('mall')

        // Mutating one load result must not affect the next load.
        a!.packs['vanilla-2.0'].children[0].name = 'mutated-again'
        const b = await store.load()
        expect(b?.packs['vanilla-2.0'].children[0].name).toBe('mall')
    })

    it('clears the saved library', async () => {
        const store = new InMemoryLibraryStore()
        await store.save(sampleLibrary())
        await store.clear()
        expect(await store.load()).toBeNull()
    })
})

describe('migrate', () => {
    it('passes through a valid document and stamps the version', () => {
        const state = sampleLibrary()
        state.version = 0
        expect(migrate(state)?.version).toBe(LIBRARY_VERSION)
    })

    it('rejects null / malformed documents', () => {
        expect(migrate(null)).toBeNull()
        expect(migrate({} as never)).toBeNull()
    })

    it('backfills the v2 sync fields on a v1 document', () => {
        // A v1 doc had only { version, packs } — no rev / updatedAt / writerId. Its
        // nodes carry per-node updatedAt stamps; updatedAt is seeded from the
        // newest of those (here 555, on the deeper leaf).
        const v1 = {
            version: 1,
            packs: {
                'vanilla-2.0': {
                    pack: 'vanilla-2.0',
                    scratchpad: {
                        id: 'scratchpad:vanilla-2.0',
                        kind: 'blueprint',
                        name: 'Scratchpad',
                        encoded: '',
                        createdAt: 100,
                        updatedAt: 200,
                        snapshots: [],
                    },
                    children: [
                        {
                            id: 'f',
                            kind: 'folder',
                            name: 'Logistics',
                            createdAt: 100,
                            updatedAt: 300,
                            children: [
                                {
                                    id: 'bp',
                                    kind: 'blueprint',
                                    name: 'mall',
                                    encoded: '0aaa',
                                    createdAt: 100,
                                    updatedAt: 555,
                                    snapshots: [],
                                },
                            ],
                        },
                    ],
                    recents: [],
                },
            },
        }
        const out = migrate(v1 as never)!
        expect(out.version).toBe(LIBRARY_VERSION)
        expect(out.rev).toBe(0)
        expect(out.writerId).toBe('')
        expect(out.updatedAt).toBe(555) // max per-node updatedAt in the doc
    })

    it('falls back to updatedAt 0 when a v1 doc has no nodes to date from', () => {
        const v1 = { version: 1, packs: {} }
        const out = migrate(v1 as never)!
        expect(out.rev).toBe(0)
        expect(out.writerId).toBe('')
        expect(out.updatedAt).toBe(0)
    })

    it('leaves an already-v2 document’s sync fields untouched', () => {
        const state = sampleLibrary() // createLibrary → already v2-shaped
        state.rev = 7
        state.updatedAt = 12345
        state.writerId = 'device-Z'
        const out = migrate(state)!
        expect(out.rev).toBe(7)
        expect(out.updatedAt).toBe(12345)
        expect(out.writerId).toBe('device-Z')
    })
})
