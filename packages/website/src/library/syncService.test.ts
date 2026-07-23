import { describe, it, expect } from 'vitest'
import {
    SyncedLibraryStore,
    SyncService,
    SYNC_BASE_KEY,
    RemoteLibraryDoc,
    StorageLike,
    TimerLike,
    SyncStatus,
    ConflictInfo,
} from './syncService'
import { InMemoryLibraryStore } from './store'
import { resolveSync } from './sync'
import { LibraryState, BlueprintEntry } from './model'

// The orchestration is pure logic with injected effects, so these drive it with
// fakes (remote / store / storage / timer), the same discipline as sync.test.ts.

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

/** A doc with real content, at a given rev / writer. */
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

/** A doc with a pack but no content. */
function emptyDoc(rev: number, writerId: string): LibraryState {
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

const ME = 'device-A'
const OTHER = 'device-B'

/** A manually-advanced timer: `setTimeout` records the callback; `run` fires them. */
class FakeTimers implements TimerLike {
    private jobs = new Map<number, () => void>()
    private next = 1
    public setTimeout(fn: () => void): unknown {
        const id = this.next++
        this.jobs.set(id, fn)
        return id
    }
    public clearTimeout(handle: unknown): void {
        this.jobs.delete(handle as number)
    }
    /** Fire every currently-scheduled (not-yet-cleared) callback. */
    public run(): void {
        const pending = [...this.jobs.values()]
        this.jobs.clear()
        for (const fn of pending) fn()
    }
    public count(): number {
        return this.jobs.size
    }
}

/** A fake remote backed by an in-memory doc, with a transactional stale check. */
class FakeRemote implements RemoteLibraryDoc {
    public doc: LibraryState | null
    public saves = 0
    public loads = 0
    public failNextSave = false
    public constructor(initial: LibraryState | null = null) {
        this.doc = initial
    }
    public load(): Promise<LibraryState | null> {
        this.loads++
        return Promise.resolve(this.doc ? structuredClone(this.doc) : null)
    }
    public save(state: LibraryState, expectedRemoteRev: number | null): Promise<'ok' | 'stale'> {
        this.saves++
        if (this.failNextSave) {
            this.failNextSave = false
            return Promise.reject(new Error('remote save failed'))
        }
        const currentRev = this.doc ? this.doc.rev : null
        if (currentRev !== expectedRemoteRev) return Promise.resolve('stale')
        this.doc = structuredClone(state)
        return Promise.resolve('ok')
    }
}

/**
 * A fake remote whose `load` blocks on a promise the test resolves by hand, so we
 * can hold a `reconcile` pass open mid-flight and probe the overlap guard.
 */
class GatedRemote implements RemoteLibraryDoc {
    public doc: LibraryState | null
    public loads = 0
    public saves = 0
    public readonly openGate: () => void
    private readonly gate: Promise<void>
    public constructor(initial: LibraryState | null = null) {
        this.doc = initial
        let open!: () => void
        this.gate = new Promise<void>(resolve => (open = resolve))
        this.openGate = open
    }
    public async load(): Promise<LibraryState | null> {
        this.loads++
        await this.gate
        return this.doc ? structuredClone(this.doc) : null
    }
    public save(state: LibraryState): Promise<'ok' | 'stale'> {
        this.saves++
        this.doc = structuredClone(state)
        return Promise.resolve('ok')
    }
}

/** An in-memory StorageLike. */
class FakeStorage implements StorageLike {
    public map = new Map<string, string>()
    public getItem(k: string): string | null {
        return this.map.has(k) ? (this.map.get(k) as string) : null
    }
    public setItem(k: string, v: string): void {
        this.map.set(k, v)
    }
}

interface Harness {
    local: InMemoryLibraryStore
    remote: FakeRemote
    storage: FakeStorage
    service: SyncService
    statuses: SyncStatus[]
    pulled: LibraryState[]
    conflicts: ConflictInfo[]
}

// A fixed injected clock so the keep-mine winner's re-stamped `updatedAt` is
// deterministic (distinct from the doc revs used as timestamps elsewhere).
const NOW = 777777

function harness(remoteInitial: LibraryState | null = null): Harness {
    const local = new InMemoryLibraryStore()
    const remote = new FakeRemote(remoteInitial)
    const storage = new FakeStorage()
    const statuses: SyncStatus[] = []
    const pulled: LibraryState[] = []
    const conflicts: ConflictInfo[] = []
    const service = new SyncService({
        local,
        writerId: ME,
        now: () => NOW,
        storage,
        onStatus: s => statuses.push(s),
        onPulled: r => pulled.push(r),
        onConflict: c => conflicts.push(c),
    })
    return { local, remote, storage, service, statuses, pulled, conflicts }
}

describe('SyncedLibraryStore', () => {
    it('writes local first and delegates load/clear', async () => {
        const local = new InMemoryLibraryStore()
        const h = harness()
        const store = new SyncedLibraryStore(local, h.service, 2000, new FakeTimers())
        await store.save(full(1, ME))
        // Without a remote attached, nothing is scheduled — local has the doc.
        expect((await store.load())?.rev).toBe(1)
        await store.clear()
        expect(await store.load()).toBeNull()
    })

    it('debounce collapses a burst of saves into a single remote push', async () => {
        const h = harness(emptyDoc(0, OTHER))
        // Attach + reconcile first so a base is established (local starts empty).
        h.service.attach('uid-1', h.remote)
        await flush()
        const timers = new FakeTimers()
        const store = new SyncedLibraryStore(h.local, h.service, 2000, timers)

        const before = h.remote.saves
        await store.save(full(1, ME))
        await store.save(full(2, ME))
        await store.save(full(3, ME))
        // Three saves, one pending timer (each reset the last).
        expect(timers.count()).toBe(1)
        expect(h.remote.saves).toBe(before) // nothing pushed yet
        timers.run()
        await flush()
        // Exactly one push, carrying the latest (rev 3).
        expect(h.remote.saves).toBe(before + 1)
        expect(h.remote.doc?.rev).toBe(3)
    })

    it('flush() pushes the pending write immediately, cancelling the debounce', async () => {
        const h = harness(emptyDoc(0, OTHER))
        h.service.attach('uid-1', h.remote)
        await flush()
        const timers = new FakeTimers()
        const store = new SyncedLibraryStore(h.local, h.service, 2000, timers)

        await store.save(full(5, ME))
        expect(timers.count()).toBe(1)
        await store.flush()
        expect(h.remote.doc?.rev).toBe(5)
        expect(timers.count()).toBe(0) // debounce was cancelled
    })
})

describe('SyncService.attach / reconcile', () => {
    it('seeds an empty remote from local data on first attach', async () => {
        const h = harness(null)
        await h.local.save(full(2, ME))
        h.service.attach('uid-1', h.remote)
        await flush()
        expect(h.remote.doc?.rev).toBe(2)
        expect(h.statuses.at(-1)).toBe('synced')
        // Base persisted per-uid.
        expect(JSON.parse(h.storage.getItem(SYNC_BASE_KEY)!)).toEqual({ uid: 'uid-1', baseRev: 2 })
    })

    it('pulls a non-empty remote onto an empty local on first attach', async () => {
        const h = harness(full(4, OTHER))
        await h.local.save(emptyDoc(1, ME))
        h.service.attach('uid-1', h.remote)
        await flush()
        expect((await h.local.load())?.rev).toBe(4)
        expect(h.pulled.map(p => p.rev)).toEqual([4])
        expect(h.statuses.at(-1)).toBe('synced')
    })

    it('raises a first-attach conflict (kind "first-attach") when both sides carry real data', async () => {
        const h = harness(full(9, OTHER))
        await h.local.save(full(3, ME))
        h.service.attach('uid-1', h.remote)
        await flush()
        expect(h.conflicts).toHaveLength(1)
        expect(h.conflicts[0].kind).toBe('first-attach')
        expect(h.service.getConflict()?.kind).toBe('first-attach')
        expect(h.service.getStatus()).toBe('conflict')
    })

    it('raises a diverged conflict (kind "diverged") when both sides advanced from a shared base', async () => {
        // A prior clean sync established base rev 3; the remote then advanced to 5
        // (another device) and our local advanced to 4 — both moved past base.
        const h = harness(full(5, OTHER))
        h.storage.setItem(SYNC_BASE_KEY, JSON.stringify({ uid: 'uid-1', baseRev: 3 }))
        await h.local.save(full(4, ME))
        h.service.attach('uid-1', h.remote)
        await flush()
        expect(h.conflicts).toHaveLength(1)
        expect(h.conflicts[0].kind).toBe('diverged')
        expect(h.service.getConflict()?.kind).toBe('diverged')
        expect(h.service.getStatus()).toBe('conflict')
    })
})

describe('SyncService.push', () => {
    it('advances baseRev after a successful push', async () => {
        const h = harness(emptyDoc(0, OTHER))
        await h.local.save(emptyDoc(0, OTHER))
        h.service.attach('uid-1', h.remote)
        await flush()
        // Now push a local advance.
        await h.service.push(full(5, ME))
        expect(h.remote.doc?.rev).toBe(5)
        expect(JSON.parse(h.storage.getItem(SYNC_BASE_KEY)!).baseRev).toBe(5)
    })

    it('re-resolves on a stale push: another writer advanced → pull', async () => {
        // Base is rev 1 (a prior clean sync, seeded in storage so first-attach
        // reconcile noops rather than treating two full docs as a conflict).
        const h = harness(full(1, ME))
        h.storage.setItem(SYNC_BASE_KEY, JSON.stringify({ uid: 'uid-1', baseRev: 1 }))
        await h.local.save(full(1, ME))
        h.service.attach('uid-1', h.remote)
        await flush()
        // Simulate the remote moving out from under us before our push lands.
        h.remote.doc = full(5, OTHER)
        // Our local push expects base rev 1 → save returns stale → reload sees rev
        // 5 by another writer with local unchanged since base → pull.
        await h.service.push(full(1, ME))
        expect(h.pulled.at(-1)?.rev).toBe(5)
        expect((await h.local.load())?.rev).toBe(5)
    })
})

describe('SyncService.resolveConflict', () => {
    it('keep-mine pushes a strictly-newer winner and re-inits the controller', async () => {
        const h = harness(full(9, OTHER))
        await h.local.save(full(3, ME))
        h.service.attach('uid-1', h.remote)
        await flush()
        expect(h.service.getStatus()).toBe('conflict')

        await h.service.resolveConflict('keep-mine')
        await flush()
        // The winner carries local's content, but its rev dominates BOTH sides
        // (max(3, 9) + 1) and it's re-stamped with our writer + injected clock —
        // so it can't be regress-pushed away by the other device (see below).
        expect(h.remote.doc?.rev).toBe(10)
        expect(h.remote.doc?.writerId).toBe(ME)
        expect(h.remote.doc?.updatedAt).toBe(NOW)
        expect(h.remote.doc?.packs['vanilla-2.0'].children[0].name).toBe('mall')
        // Saved to the local store too, so local and remote agree on the new rev.
        expect((await h.local.load())?.rev).toBe(10)
        expect((await h.local.load())?.writerId).toBe(ME)
        // onPulled fired with the winner so the controller re-inits off the store
        // (identical active-leaf content — a canvas no-op — but the rev advances).
        expect(h.pulled.at(-1)?.rev).toBe(10)
        expect(h.service.getStatus()).toBe('synced')
        expect(h.service.getConflict()).toBeNull()
    })

    it('keep-mine winner survives the other device`s next reconcile (no silent clobber)', async () => {
        // Device A resolves keep-mine against a remote the other device advanced.
        const h = harness(full(9, OTHER))
        await h.local.save(full(3, ME))
        h.service.attach('uid-1', h.remote)
        await flush()
        await h.service.resolveConflict('keep-mine')
        await flush()
        const pushed = h.remote.doc as LibraryState
        expect(pushed.rev).toBe(10)

        // Now replay device B's next reconcile. B last synced its own rev-9 write,
        // so its baseRev is 9 and its local is that rev-9 doc. Crucially the pushed
        // rev (10) is ABOVE B's base — so resolveSync does NOT hit the
        // `remote.rev < baseRev → push` branch that would silently clobber A's
        // choice. Clean B (no new edits) fast-forwards with a pull.
        const cleanB = resolveSync(full(9, OTHER), pushed, 9, OTHER)
        expect(cleanB.action).toBe('pull')
        // A dirty B (edited past its base) gets a genuine conflict, never a push.
        const dirtyB = resolveSync(full(11, OTHER), pushed, 9, OTHER)
        expect(dirtyB.action).toBe('conflict')
    })

    it('take-theirs pulls the remote copy', async () => {
        const h = harness(full(9, OTHER))
        await h.local.save(full(3, ME))
        h.service.attach('uid-1', h.remote)
        await flush()

        await h.service.resolveConflict('take-theirs')
        await flush()
        expect((await h.local.load())?.rev).toBe(9)
        expect(h.pulled.at(-1)?.rev).toBe(9)
        expect(h.service.getStatus()).toBe('synced')
    })
})

describe('SyncService — conflict de-duplication', () => {
    it('a second conflict while one is pending refreshes the info without re-prompting', async () => {
        const h = harness(full(9, OTHER))
        await h.local.save(full(3, ME))
        h.service.attach('uid-1', h.remote)
        await flush()
        // First attach with real data on both sides → one conflict, one prompt.
        expect(h.conflicts).toHaveLength(1)
        expect(h.service.getConflict()?.remote.rev).toBe(9)

        // The remote moves again, then a reconcile-on-visible re-raises while the
        // modal is still open. onConflict must NOT fire a second time (no stacked
        // overlay), but the stored info is refreshed to the latest docs.
        h.remote.doc = full(12, OTHER)
        await h.service.reconcile()
        await flush()
        expect(h.conflicts).toHaveLength(1) // still one prompt
        expect(h.service.getConflict()?.remote.rev).toBe(12) // but latest info

        // resolveConflict reads pendingConflict live, so keep-mine dominates the
        // *latest* remote (rev 12): winner rev = max(3, 12) + 1 = 13.
        await h.service.resolveConflict('keep-mine')
        await flush()
        expect(h.remote.doc?.rev).toBe(13)
        expect(h.service.getStatus()).toBe('synced')
    })
})

describe('SyncService — reconcile overlap guard', () => {
    it('a reconcile entered while one is in flight bails without a second load', async () => {
        // Local has real data; the remote's load is gated so the pass triggered by
        // attach() hangs mid-flight (past the guard, awaiting both loads).
        const local = new InMemoryLibraryStore()
        await local.save(full(2, ME))
        const remote = new GatedRemote(null)
        const service = new SyncService({ local, writerId: ME, now: () => NOW })

        // attach() fires reconcile #1, which reaches remote.load() (loads → 1) and
        // then blocks on the gate.
        service.attach('uid-1', remote)
        await flush()
        expect(remote.loads).toBe(1)

        // A second reconcile while #1 is still in flight must bail immediately — no
        // extra load, no interleaved resolve.
        await service.reconcile()
        expect(remote.loads).toBe(1)

        // Let #1 finish: local seeds the empty remote (a push), guard clears.
        remote.openGate()
        await flush()
        expect(remote.doc?.rev).toBe(2)
        expect(service.getStatus()).toBe('synced')
        expect(remote.loads).toBe(1) // the blocked-out second reconcile never loaded

        // With the guard cleared a fresh reconcile proceeds normally (loads again).
        await service.reconcile()
        expect(remote.loads).toBe(2)
    })
})

describe('SyncService — per-uid base isolation', () => {
    it('ignores a stored base that belongs to a different user', async () => {
        const h = harness(full(4, OTHER))
        // A stale base from another account sits in storage.
        h.storage.setItem(SYNC_BASE_KEY, JSON.stringify({ uid: 'other-uid', baseRev: 99 }))
        await h.local.save(emptyDoc(1, ME))
        // Attaching as uid-1 must NOT reuse baseRev 99 — with base null and an
        // empty local + non-empty remote, first-attach content rules pull.
        h.service.attach('uid-1', h.remote)
        await flush()
        expect(h.pulled.at(-1)?.rev).toBe(4)
        expect(JSON.parse(h.storage.getItem(SYNC_BASE_KEY)!)).toEqual({ uid: 'uid-1', baseRev: 4 })
    })
})

describe('SyncService — failure handling', () => {
    it('reports error when a remote save throws', async () => {
        const h = harness(emptyDoc(0, OTHER))
        await h.local.save(emptyDoc(0, OTHER))
        h.service.attach('uid-1', h.remote)
        await flush()
        h.remote.failNextSave = true
        await h.service.push(full(2, ME))
        expect(h.service.getStatus()).toBe('error')
    })

    it('detach() goes back to signed-out and drops the remote', () => {
        const h = harness(full(1, OTHER))
        h.service.attach('uid-1', h.remote)
        h.service.detach()
        expect(h.service.hasRemote()).toBe(false)
        expect(h.service.getStatus()).toBe('signed-out')
    })
})

// Let all microtasks settle (the service methods are async, fire-and-forget in
// places like attach()).
function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}
