import { describe, it, expect } from 'vitest'
import { resolveSync, isEffectivelyEmpty } from './sync'
import { LibraryState, BlueprintEntry } from './model'

// Minimal LibraryState fixtures. For the rev-comparison branches only `rev` /
// `writerId` matter (the resolver never inspects content when `baseRev` is a
// number); content is set up only for the never-synced / empty-vs-non-empty rows.

function scratchpad(encoded = ''): BlueprintEntry {
    return {
        id: 's',
        kind: 'blueprint',
        name: 'Scratchpad',
        encoded,
        createdAt: 0,
        updatedAt: 0,
        snapshots: [],
    }
}

/** A doc with real content (a leaf in a pack). */
function full(rev: number, writerId: string): LibraryState {
    return {
        version: 2,
        rev,
        updatedAt: rev,
        writerId,
        packs: {
            'vanilla-2.0': {
                pack: 'vanilla-2.0',
                scratchpad: scratchpad(),
                children: [
                    {
                        id: 'bp',
                        kind: 'blueprint',
                        name: 'mall',
                        encoded: '0aaa',
                        createdAt: 0,
                        updatedAt: 0,
                        snapshots: [],
                    },
                ],
                recents: [],
            },
        },
    }
}

/** A doc with a pack but no content (empty children, blank scratchpad). */
function emptyPack(rev: number, writerId: string): LibraryState {
    return {
        version: 2,
        rev,
        updatedAt: rev,
        writerId,
        packs: {
            'vanilla-2.0': {
                pack: 'vanilla-2.0',
                scratchpad: scratchpad(),
                children: [],
                recents: [],
            },
        },
    }
}

/** A doc with zero packs. */
function bare(rev = 0, writerId = ''): LibraryState {
    return { version: 2, packs: {}, rev, updatedAt: rev, writerId }
}

const ME = 'device-A'
const OTHER = 'device-B'

describe('isEffectivelyEmpty', () => {
    it('is true for a doc with no packs', () => {
        expect(isEffectivelyEmpty(bare())).toBe(true)
    })
    it('is true for packs that are empty (no children, blank scratchpad)', () => {
        expect(isEffectivelyEmpty(emptyPack(0, ''))).toBe(true)
    })
    it('is false once a pack has children', () => {
        expect(isEffectivelyEmpty(full(0, ''))).toBe(false)
    })
    it('is false once a scratchpad has content', () => {
        const doc = emptyPack(0, '')
        doc.packs['vanilla-2.0'].scratchpad = scratchpad('0work')
        expect(isEffectivelyEmpty(doc)).toBe(false)
    })
})

describe('resolveSync — remote / local presence', () => {
    it('pushes when the remote has no document yet', () => {
        const local = full(3, ME)
        const d = resolveSync(local, null, null, ME)
        expect(d.action).toBe('push')
        expect(d.doc).toBe(local)
    })
    it('noops when neither side has a document', () => {
        expect(resolveSync(null, null, null, ME).action).toBe('noop')
    })
    it('pulls when there is no local document but a remote exists', () => {
        const remote = full(3, OTHER)
        const d = resolveSync(null, remote, null, ME)
        expect(d.action).toBe('pull')
        expect(d.doc).toBe(remote)
    })
})

describe('resolveSync — remote unchanged since base (remote.rev === baseRev)', () => {
    it('pushes when local advanced past base', () => {
        const local = full(5, ME)
        const d = resolveSync(local, full(3, ME), 3, ME)
        expect(d.action).toBe('push')
        expect(d.doc).toBe(local)
    })
    it('noops when local is also at base', () => {
        expect(resolveSync(full(3, ME), full(3, ME), 3, ME).action).toBe('noop')
    })
    it('noops with equal revs even when the writer differs (rev is the signal)', () => {
        expect(resolveSync(full(3, ME), full(3, OTHER), 3, ME).action).toBe('noop')
    })
})

describe('resolveSync — remote is our own echo (remote.rev > baseRev, same writer)', () => {
    it('pulls when the echo is newer than or equal to local', () => {
        const remote = full(5, ME)
        const d = resolveSync(full(3, ME), remote, 3, ME)
        expect(d.action).toBe('pull')
        expect(d.doc).toBe(remote)
    })
    it('pulls when the echo rev equals local rev', () => {
        expect(resolveSync(full(5, ME), full(5, ME), 3, ME).action).toBe('pull')
    })
    it('pushes when local somehow ran ahead of our own echo', () => {
        const local = full(6, ME)
        const d = resolveSync(local, full(5, ME), 3, ME)
        expect(d.action).toBe('push')
        expect(d.doc).toBe(local)
    })
})

describe('resolveSync — another device advanced the remote (remote.rev > baseRev, other writer)', () => {
    it('fast-forward pulls when local is unchanged since base', () => {
        const remote = full(5, OTHER)
        const d = resolveSync(full(3, ME), remote, 3, ME)
        expect(d.action).toBe('pull')
        expect(d.doc).toBe(remote)
    })
    it('conflicts when local also advanced', () => {
        const d = resolveSync(full(4, ME), full(5, OTHER), 3, ME)
        expect(d.action).toBe('conflict')
        expect(d.doc).toBeNull()
    })
})

describe('resolveSync — remote regressed below base', () => {
    it('pushes local (remote was rolled back / restored older)', () => {
        const local = full(3, ME)
        const d = resolveSync(local, full(1, OTHER), 3, ME)
        expect(d.action).toBe('push')
        expect(d.doc).toBe(local)
    })
})

describe('resolveSync — never synced (baseRev null) with existing local data', () => {
    it('pulls when local is empty and remote has data', () => {
        const remote = full(2, OTHER)
        const d = resolveSync(emptyPack(1, ME), remote, null, ME)
        expect(d.action).toBe('pull')
        expect(d.doc).toBe(remote)
    })
    it('pushes when remote is empty and local has data', () => {
        const local = full(2, ME)
        const d = resolveSync(local, emptyPack(1, OTHER), null, ME)
        expect(d.action).toBe('push')
        expect(d.doc).toBe(local)
    })
    it('conflicts when both sides carry real data', () => {
        const d = resolveSync(full(2, ME), full(4, OTHER), null, ME)
        expect(d.action).toBe('conflict')
        expect(d.doc).toBeNull()
    })
    it('pulls to establish a base when both sides are empty', () => {
        const remote = emptyPack(1, OTHER)
        const d = resolveSync(bare(0, ME), remote, null, ME)
        expect(d.action).toBe('pull')
        expect(d.doc).toBe(remote)
    })
})
