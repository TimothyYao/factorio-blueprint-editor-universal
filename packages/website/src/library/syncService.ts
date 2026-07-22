// Blueprint library — sync orchestration.
//
// Phase 6 puts the single library document behind an OAuth-locked remote (see
// `firebase.ts`) alongside the local IndexedDB store. `sync.ts` is the *decision*
// half (the pure `resolveSync` table); this file is the *action* half — it drives
// the actual reads/writes, tracks the base revision, and reports status. It holds
// **no** firebase imports (the remote is injected behind the tiny
// `RemoteLibraryDoc` interface), so the whole orchestration is unit-testable in
// the node env with a fake remote / store / storage / timer, the same discipline
// as the rest of `library/`.
//
// Two pieces live here:
//   - `SyncedLibraryStore` — a `LibraryStore` decorator handed to the controller.
//     It writes local first (never lose local durability), then schedules a
//     debounced remote push. `load` / `clear` delegate to the local store —
//     reconciliation with the remote is *explicit* (`SyncService.reconcile`), not
//     hidden inside a load, so the app controls when the canvas might change.
//   - `SyncService` — owns the attached remote, the per-user base revision, the
//     status callback, and the reconcile / push / pull / conflict flows.

import { LibraryState } from './model'
import { LibraryStore } from './store'
import { resolveSync } from './sync'

/**
 * The minimal remote-document contract `SyncService` drives. `firebase.ts`
 * implements it against a Firestore doc; tests drive a fake. Kept deliberately
 * tiny — the sync *policy* lives in `resolveSync` / `SyncService`, not here.
 *
 * `save` is transactional: it must compare the remote doc's current `rev` against
 * `expectedRemoteRev` (both `null` ⇒ "expected absent, still absent") and, if they
 * differ, return `'stale'` *without writing* — closing the push/push race two
 * devices can hit between resolving and writing. `clear` is optional (only the
 * firebase impl needs it; `SyncService` never deletes the remote).
 */
export interface RemoteLibraryDoc {
    load(): Promise<LibraryState | null>
    save(state: LibraryState, expectedRemoteRev: number | null): Promise<'ok' | 'stale'>
    clear?(): Promise<void>
}

/**
 * The sync surface state, for the panel's status glyph:
 *   - `disabled`   — firebase isn't configured (this build is local-only).
 *   - `signed-out` — configured, but no user attached.
 *   - `syncing`    — a reconcile / push is in flight.
 *   - `synced`     — local and remote agree.
 *   - `conflict`   — both sides diverged; awaiting the user's keep-mine/take-theirs.
 *   - `error`      — a remote op failed (e.g. the 1 MiB doc cap, permissions).
 *   - `offline`    — a remote op failed and the browser reports no connectivity.
 */
export type SyncStatus =
    | 'disabled'
    | 'signed-out'
    | 'syncing'
    | 'synced'
    | 'conflict'
    | 'error'
    | 'offline'

/** The two docs a conflict hands back to the caller's prompt. */
export interface ConflictInfo {
    local: LibraryState
    remote: LibraryState
}

export type ConflictChoice = 'keep-mine' | 'take-theirs'

/** Injected timer so the debounce is deterministic in tests. */
export interface TimerLike {
    setTimeout(fn: () => void, ms: number): unknown
    clearTimeout(handle: unknown): void
}

/** Injected key/value storage for the per-user base revision (localStorage in prod). */
export interface StorageLike {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
}

const realTimers: TimerLike = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/** localStorage key for the per-user sync base (see `SyncService`). */
export const SYNC_BASE_KEY = 'fbe:library:sync'

/** The persisted base record: which user, and the remote rev we last synced at. */
interface StoredBase {
    uid: string
    baseRev: number
}

/**
 * A `LibraryStore` that writes to a local store first (durability), then mirrors
 * the write to the remote via `SyncService` on a trailing debounce. Reads and
 * clears go straight to the local store — the app reconciles with the remote
 * explicitly, so a `load()` never surprises the canvas with someone else's edits.
 */
export class SyncedLibraryStore implements LibraryStore {
    private pending: unknown = null
    private latest: LibraryState | null = null

    public constructor(
        private readonly local: LibraryStore,
        private readonly service: SyncService,
        private readonly debounceMs = 2000,
        private readonly timers: TimerLike = realTimers
    ) {}

    public load(): Promise<LibraryState | null> {
        return this.local.load()
    }

    public async save(state: LibraryState): Promise<void> {
        // Local durability first — the remote is best-effort on top of it.
        await this.local.save(state)
        this.latest = state
        if (!this.service.hasRemote()) return
        // Trailing debounce: a burst of autosaves collapses into one remote push.
        if (this.pending != null) this.timers.clearTimeout(this.pending)
        this.pending = this.timers.setTimeout(() => {
            this.pending = null
            void this.service.push(this.latest as LibraryState)
        }, this.debounceMs)
    }

    public clear(): Promise<void> {
        if (this.pending != null) {
            this.timers.clearTimeout(this.pending)
            this.pending = null
        }
        return this.local.clear()
    }

    /**
     * Push any pending write to the remote *now*, cancelling the debounce. Called
     * on `visibilitychange` → hidden (the tab may be discarded next), so the
     * latest local content reaches the remote before the page goes away.
     */
    public async flush(): Promise<void> {
        if (this.pending != null) {
            this.timers.clearTimeout(this.pending)
            this.pending = null
        }
        if (this.latest && this.service.hasRemote()) {
            await this.service.push(this.latest)
        }
    }
}

/** Options for `SyncService` — everything nondeterministic is injected. */
export interface SyncServiceOptions {
    /** The raw local store (the one `SyncedLibraryStore` wraps) — pull writes here. */
    local: LibraryStore
    /** This install's write attribution (mirrors the controller's writerId). */
    writerId: string
    /** Base-revision persistence. Defaults to `localStorage`. */
    storage?: StorageLike
    /** Fired whenever the status changes (drives the panel's glyph). */
    onStatus?: (status: SyncStatus) => void
    /** Fired after a pull adopts a remote doc locally (re-init the controller/panel). */
    onPulled?: (remote: LibraryState) => void
    /** Fired when both sides diverged — the caller prompts and calls `resolveConflict`. */
    onConflict?: (info: ConflictInfo) => void
}

/**
 * Owns the live sync state: the attached remote (or null), the per-user base
 * revision, the current status, and the reconcile / push / pull / conflict flows.
 * All effects are injected, so it's pure orchestration and fully unit-testable.
 */
export class SyncService {
    private remote: RemoteLibraryDoc | null = null
    private uid: string | null = null
    /** The remote `rev` we last successfully synced against; `null` = never synced. */
    private baseRev: number | null = null
    private status: SyncStatus = 'disabled'
    private pendingConflict: ConflictInfo | null = null

    private readonly local: LibraryStore
    private readonly writerId: string
    private readonly storage: StorageLike | null
    private readonly onStatus?: (status: SyncStatus) => void
    private readonly onPulled?: (remote: LibraryState) => void
    private readonly onConflict?: (info: ConflictInfo) => void

    public constructor(opts: SyncServiceOptions) {
        this.local = opts.local
        this.writerId = opts.writerId
        this.storage = opts.storage ?? safeLocalStorage()
        this.onStatus = opts.onStatus
        this.onPulled = opts.onPulled
        this.onConflict = opts.onConflict
    }

    public hasRemote(): boolean {
        return this.remote !== null
    }

    public getStatus(): SyncStatus {
        return this.status
    }

    public getConflict(): ConflictInfo | null {
        return this.pendingConflict
    }

    /**
     * Attach a remote for `uid` and reconcile. The base revision is loaded
     * per-user (a stored base from a *different* account never applies — switching
     * accounts must not reuse a stale base), so a first attach for a new user
     * starts from `null` and goes by content (see `resolveSync`).
     */
    public attach(uid: string, remote: RemoteLibraryDoc): void {
        this.remote = remote
        this.uid = uid
        const stored = this.readBase()
        this.baseRev = stored && stored.uid === uid ? stored.baseRev : null
        void this.reconcile()
    }

    /** Detach the remote (sign-out) — back to local-only, status `signed-out`. */
    public detach(): void {
        this.remote = null
        this.uid = null
        this.baseRev = null
        this.pendingConflict = null
        this.setStatus('signed-out')
    }

    /**
     * Load both sides, decide with `resolveSync`, and act. The entry point on
     * attach (sign-in / boot with a signed-in user) and on returning to the tab
     * (`visibilitychange` → visible), where the remote may have moved.
     */
    public async reconcile(): Promise<void> {
        if (!this.remote) return
        this.setStatus('syncing')
        let local: LibraryState | null
        let remote: LibraryState | null
        try {
            ;[local, remote] = await Promise.all([this.local.load(), this.remote.load()])
        } catch (e) {
            this.fail(e)
            return
        }
        const decision = resolveSync(local, remote, this.baseRev, this.writerId)
        switch (decision.action) {
            case 'push':
                await this.doPush(decision.doc as LibraryState, this.baseRev)
                break
            case 'pull':
                await this.doPull(decision.doc as LibraryState)
                break
            case 'conflict':
                this.raiseConflict(local as LibraryState, remote as LibraryState)
                break
            case 'noop':
                // Nothing to do; if a remote is present its rev is our base already.
                if (remote) this.setBase(remote.rev)
                this.setStatus('synced')
                break
        }
    }

    /**
     * Push the latest local doc (the debounced store save / `flush`). A cheap
     * single transactional write in the common case; only if the remote moved
     * under us (a `'stale'` result) do we reload + re-resolve.
     */
    public async push(local: LibraryState): Promise<void> {
        if (!this.remote) return
        await this.doPush(local, this.baseRev)
    }

    /**
     * Answer a raised conflict: `keep-mine` force-pushes local over the remote
     * (expecting the remote rev we prompted with — re-read inside the push flow if
     * it moved again); `take-theirs` pulls the remote copy.
     */
    public async resolveConflict(choice: ConflictChoice): Promise<void> {
        const c = this.pendingConflict
        if (!c || !this.remote) return
        this.pendingConflict = null
        if (choice === 'keep-mine') {
            await this.doPush(c.local, c.remote.rev)
        } else {
            await this.doPull(c.remote)
        }
    }

    // --- internals ----------------------------------------------------------

    /**
     * Transactionally write `local`, expecting the remote to be at `expectedRev`.
     * On `'stale'` (someone wrote between our resolve and this save) reload the
     * remote and re-resolve; the outcome may be another push (retry), a pull, or a
     * conflict. Bounded so a pathological write-race can't spin forever.
     */
    private async doPush(local: LibraryState, expectedRev: number | null): Promise<void> {
        this.setStatus('syncing')
        for (let attempt = 0; attempt < 3; attempt++) {
            let res: 'ok' | 'stale'
            try {
                res = await (this.remote as RemoteLibraryDoc).save(local, expectedRev)
            } catch (e) {
                this.fail(e)
                return
            }
            if (res === 'ok') {
                this.setBase(local.rev)
                this.setStatus('synced')
                return
            }
            // Stale: the remote moved. Reload and re-resolve against what's there.
            let remoteNow: LibraryState | null
            try {
                remoteNow = await (this.remote as RemoteLibraryDoc).load()
            } catch (e) {
                this.fail(e)
                return
            }
            const decision = resolveSync(local, remoteNow, this.baseRev, this.writerId)
            if (decision.action === 'push') {
                expectedRev = remoteNow ? remoteNow.rev : null
                continue
            }
            if (decision.action === 'pull') {
                await this.doPull(decision.doc as LibraryState)
                return
            }
            if (decision.action === 'conflict') {
                this.raiseConflict(local, remoteNow as LibraryState)
                return
            }
            // noop — nothing left to write.
            this.setStatus('synced')
            return
        }
        // Exhausted the retry budget against a doc that keeps moving.
        this.setStatus('error')
    }

    /** Adopt a remote doc locally, advance the base, and notify the caller. */
    private async doPull(remote: LibraryState): Promise<void> {
        try {
            await this.local.save(remote)
        } catch (e) {
            this.fail(e)
            return
        }
        this.setBase(remote.rev)
        this.setStatus('synced')
        this.onPulled?.(remote)
    }

    private raiseConflict(local: LibraryState, remote: LibraryState): void {
        this.pendingConflict = { local, remote }
        this.setStatus('conflict')
        this.onConflict?.(this.pendingConflict)
    }

    private setStatus(status: SyncStatus): void {
        if (status === this.status) return
        this.status = status
        this.onStatus?.(status)
    }

    private setBase(rev: number): void {
        this.baseRev = rev
        if (!this.uid || !this.storage) return
        try {
            this.storage.setItem(SYNC_BASE_KEY, JSON.stringify({ uid: this.uid, baseRev: rev }))
        } catch {
            /* storage blocked — the base falls back to in-memory for the session */
        }
    }

    private readBase(): StoredBase | null {
        if (!this.storage) return null
        try {
            const raw = this.storage.getItem(SYNC_BASE_KEY)
            if (!raw) return null
            const parsed = JSON.parse(raw)
            if (typeof parsed?.uid === 'string' && typeof parsed?.baseRev === 'number') {
                return parsed
            }
        } catch {
            /* corrupt / unavailable — treat as no stored base */
        }
        return null
    }

    /** Map a failed remote op onto `offline` (no connectivity) or `error`. */
    private fail(error: unknown): void {
        console.error('Library sync failed', error)
        const online = typeof navigator === 'undefined' || navigator.onLine !== false
        this.setStatus(online ? 'error' : 'offline')
    }
}

/** `localStorage` if usable, else `null` (private mode / node) — base stays in memory. */
function safeLocalStorage(): StorageLike | null {
    try {
        return globalThis.localStorage ?? null
    } catch {
        return null
    }
}
