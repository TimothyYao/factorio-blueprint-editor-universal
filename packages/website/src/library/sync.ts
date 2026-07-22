// Blueprint library — pure last-write-wins / conflict resolver.
//
// Phase 6 puts the library document behind an OAuth-locked remote (e.g.
// Firebase) alongside the local store. Two devices editing the same single
// document need a sync story; this file is the *decision* half of it — a pure
// function that, given the local doc, the remote doc, and the revision this
// device last synced against, says whether to push, pull, do nothing, or raise a
// conflict for the user. It performs **no** I/O and mutates nothing, so the
// tricky part (the decision table) is exhaustively unit-testable in node, the
// same discipline as the rest of `library/`.
//
// The whole model turns on `LibraryState.rev`, the monotonic counter stamped by
// `stampWrite` on every persisted write, plus `writerId`, the id of the install
// that made the last write:
//
//   - `baseRev` — the remote `rev` this device last successfully synced against
//     (pulled or pushed). It is tracked *outside* the document, locally, by the
//     caller (a later slice); the resolver just takes it as an argument. `null`
//     means "this device has never synced".
//   - remote.rev vs baseRev tells us whether the remote moved since we last saw
//     it; local.rev vs baseRev tells us whether we have local edits to lose.
//   - when the remote moved, `writerId` tells us whether *we* moved it (an echo
//     of our own earlier push, or a previous session on this device) or another
//     device did — the former we can safely adopt, the latter may conflict.

import { LibraryState } from './model'

export type SyncAction = 'push' | 'pull' | 'conflict' | 'noop'

/**
 * What the caller should do. Serializable and self-describing:
 *  - `push`     — send `doc` (the local document) to the remote.
 *  - `pull`     — adopt `doc` (the remote document) locally.
 *  - `conflict` — both sides diverged; `doc` is null and the caller surfaces a
 *                 "remote is newer — keep mine / take theirs" choice (it already
 *                 holds both docs it passed in).
 *  - `noop`     — nothing to do.
 * `reason` is a short human-readable note for logs / the sync UI.
 */
export interface SyncDecision {
    action: SyncAction
    reason: string
    /** The document to act on: local for `push`, remote for `pull`, else null. */
    doc: LibraryState | null
}

function decide(action: SyncAction, reason: string, doc: LibraryState | null): SyncDecision {
    return { action, reason, doc }
}

/**
 * True if a document carries no real user content — every pack is empty (no
 * children) and every scratchpad is blank. Such a doc is safe to discard in
 * favour of a non-empty side, which lets a first-attach on a device that only
 * has a pristine, auto-created library adopt the remote (or seed an empty remote)
 * without prompting. Recents / activeId are ignored — they're not content.
 */
export function isEffectivelyEmpty(state: LibraryState): boolean {
    for (const pack of Object.values(state.packs)) {
        if (pack.children.length > 0) return false
        if (pack.scratchpad.encoded) return false
    }
    return true
}

/**
 * Decide how to reconcile the local and remote documents. Pure — no I/O, no
 * mutation. See the decision table in the module header; every branch below
 * corresponds to a row and is covered in `sync.test.ts`.
 */
export function resolveSync(
    local: LibraryState | null,
    remote: LibraryState | null,
    baseRev: number | null,
    writerId: string
): SyncDecision {
    // No remote document yet → this device seeds it (unless we've nothing to
    // seed, in which case there's simply nothing to do).
    if (!remote) {
        if (!local) return decide('noop', 'no document on either side', null)
        return decide('push', 'remote has no document yet — seed it from this device', local)
    }

    // No local document but a remote exists → adopt the remote wholesale.
    if (!local) return decide('pull', 'no local document — adopt the remote', remote)

    // Never synced from this device (no base to compare against). This is a first
    // attach on a device that already has its own local data. Revisions from two
    // independent histories aren't comparable, so we go by content: if exactly one
    // side is effectively empty, prefer the non-empty one; if both carry real
    // data, it's a genuine conflict; if both are empty there's nothing to lose, so
    // adopt the remote to establish a shared base.
    if (baseRev === null) {
        const localEmpty = isEffectivelyEmpty(local)
        const remoteEmpty = isEffectivelyEmpty(remote)
        if (localEmpty && !remoteEmpty) {
            return decide('pull', 'first attach; local is empty — take the remote', remote)
        }
        if (!localEmpty && remoteEmpty) {
            return decide('push', 'first attach; remote is empty — seed it from local', local)
        }
        if (localEmpty && remoteEmpty) {
            return decide('pull', 'first attach; both sides empty — adopt the remote', remote)
        }
        return decide('conflict', 'first attach with real data on both sides', null)
    }

    // Remote revision fell below our base — it was rolled back / restored from an
    // older copy. Treat our state as the source of truth and push it forward.
    if (remote.rev < baseRev) {
        return decide('push', 'remote revision regressed below base — push local', local)
    }

    // Remote unchanged since our base → only local edits (if any) matter.
    if (remote.rev === baseRev) {
        return local.rev > baseRev
            ? decide('push', 'remote unchanged since base; local advanced — push', local)
            : decide('noop', 'nothing changed on either side', null)
    }

    // Remote advanced past our base. Whose write was it?
    if (remote.writerId === writerId) {
        // Our own echo — a previous session on this device, or a pull-after-push
        // race that surfaced our own write with a rev we hadn't recorded as base.
        // Adopting it is always safe; the only question is which copy is newer. If
        // our local somehow ran ahead of that echo, push local; otherwise the
        // remote echo already contains (a superset of) our work, so pull it.
        return local.rev > remote.rev
            ? decide('push', 'remote is our own echo but local is newer — push', local)
            : decide('pull', 'remote is our own later write — adopt it', remote)
    }

    // Another device advanced the remote.
    if (local.rev === baseRev) {
        // We have no local edits since base → nothing to lose, fast-forward.
        return decide('pull', 'remote advanced, local unchanged since base — pull', remote)
    }
    // Both sides advanced independently → the caller must resolve it.
    return decide('conflict', 'remote and local both advanced from base', null)
}
