// Blueprint library — Firebase config + SDK access.
//
// This is the ONLY file in the library that imports the `firebase` SDK, and it
// does so via **dynamic import** inside a lazy init: an unconfigured build never
// touches the SDK at all, and even a configured build keeps the (large) SDK out
// of the entry chunk — Vite code-splits the `import('firebase/*')` calls into a
// separate lazily-loaded chunk. Everything the rest of the app needs is behind
// the small functions exported here; `syncService.ts` (which orchestrates sync)
// holds no firebase imports and drives the remote through `RemoteLibraryDoc`.
//
// Config comes from Vite env vars (`VITE_FIREBASE_*`). Firebase web config is
// *public* (it's shipped in the client bundle by design), so these are ordinary
// build-time values, not secrets — see the deploy workflows. When any of the four
// required values is missing the build is "unconfigured" and every function here
// is inert, so the app falls back to exactly the local-only behaviour.

import type { LibraryState } from './model'
import type { RemoteLibraryDoc } from './syncService'

/** The public Firebase web config, read from Vite's `import.meta.env`. */
const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

/** True only when all four required config values are present. */
export function firebaseConfigured(): boolean {
    return !!(config.apiKey && config.authDomain && config.projectId && config.appId)
}

/** A minimal, SDK-agnostic view of the signed-in user. */
export interface AuthUser {
    uid: string
    email: string | null
}

// The lazily-loaded SDK bundle: the module namespaces plus the initialised
// instances. Loaded once, on first use of any auth/remote function.
interface FirebaseBits {
    auth: import('firebase/auth').Auth
    db: import('firebase/firestore').Firestore
    authMod: typeof import('firebase/auth')
    storeMod: typeof import('firebase/firestore')
}

let bitsPromise: Promise<FirebaseBits> | null = null

/**
 * Dynamically import and initialise the SDK once. The three `import(...)` calls
 * are what Vite splits into a separate chunk, so an unconfigured build (which
 * never calls this) ships none of it. Emulator wiring (for the debugging slice)
 * is applied here when `VITE_FIREBASE_USE_EMULATORS` is truthy — note Firestore
 * runs on 8091, not the default 8080, which collides with the vite dev/preview
 * server.
 */
function bits(): Promise<FirebaseBits> {
    if (bitsPromise) return bitsPromise
    bitsPromise = (async () => {
        const [appMod, authMod, storeMod] = await Promise.all([
            import('firebase/app'),
            import('firebase/auth'),
            import('firebase/firestore'),
        ])
        const app = appMod.initializeApp(config)
        const auth = authMod.getAuth(app)
        const db = storeMod.getFirestore(app)
        if (import.meta.env.VITE_FIREBASE_USE_EMULATORS) {
            authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
            storeMod.connectFirestoreEmulator(db, '127.0.0.1', 8091)
        }
        return { auth, db, authMod, storeMod }
    })()
    return bitsPromise
}

/**
 * Start a Google sign-in via **redirect** (not popup — popups are unreliable /
 * blocked on mobile, which is this fork's focus). The page navigates away and
 * returns; `onAuth` completes the redirect on the way back in.
 */
export function signIn(): void {
    if (!firebaseConfigured()) return
    void bits()
        .then(({ auth, authMod }) => {
            const provider = new authMod.GoogleAuthProvider()
            return authMod.signInWithRedirect(auth, provider)
        })
        .catch(error => console.error('Library sign-in failed', error))
}

/** Sign the current user out (back to local-only). */
export function signOutUser(): void {
    if (!firebaseConfigured()) return
    void bits()
        .then(({ auth, authMod }) => authMod.signOut(auth))
        .catch(error => console.error('Library sign-out failed', error))
}

/**
 * Observe the auth state. Before wiring the observer we **await
 * `getRedirectResult`** so a returning `signInWithRedirect` finishes cleanly (its
 * error, if any, surfaces here rather than being swallowed), then the first
 * `onAuthStateChanged` callback already reflects the post-redirect user.
 */
export function onAuth(cb: (user: AuthUser | null) => void): void {
    if (!firebaseConfigured()) {
        cb(null)
        return
    }
    void bits()
        .then(async ({ auth, authMod }) => {
            await authMod.getRedirectResult(auth).catch(error => {
                console.error('Library redirect sign-in did not complete', error)
                return null
            })
            authMod.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null))
        })
        .catch(error => {
            console.error('Library auth init failed', error)
            cb(null)
        })
}

/**
 * Build the remote-document handle for a user. The doc lives at
 * `users/{uid}/library/state` — the even-segment *document* under the odd-segment
 * `users/{uid}/library` *collection* (Firestore alternates collection/doc, so the
 * state has to sit one level deeper than a bare `users/{uid}/library`).
 *
 * The library state is stored as a **JSON string field** rather than a native
 * Firestore map, with the three sync-metadata fields mirrored top-level:
 * `{ json, rev, updatedAt, writerId }`. Firestore rejects nested arrays and
 * `undefined` values, both of which the library document legitimately contains
 * (e.g. `icons`, optional fields); a JSON-string round-trip sidesteps both and
 * preserves the exact local shape byte-for-byte. The top-level `rev` is what the
 * transactional `save` compares for staleness without having to parse `json`.
 *
 * NOTE (whole-doc LWW limitation): Firestore caps a document at 1 MiB. A library
 * that grows past that will fail to save; the failure surfaces as a sync `error`
 * (see `SyncService.fail`) rather than crashing. Chunking large libraries is a
 * future concern, out of scope for this whole-doc last-write-wins model.
 */
export function createRemote(uid: string): RemoteLibraryDoc {
    const ref = async (): Promise<{
        bits: FirebaseBits
        doc: import('firebase/firestore').DocumentReference
    }> => {
        const b = await bits()
        return { bits: b, doc: b.storeMod.doc(b.db, 'users', uid, 'library', 'state') }
    }

    return {
        async load(): Promise<LibraryState | null> {
            const { bits: b, doc } = await ref()
            const snap = await b.storeMod.getDoc(doc)
            if (!snap.exists()) return null
            const data = snap.data()
            if (typeof data.json !== 'string') return null
            try {
                return JSON.parse(data.json) as LibraryState
            } catch {
                // A corrupt stored blob shouldn't strand sync — treat it as absent.
                return null
            }
        },

        async save(state: LibraryState, expectedRemoteRev: number | null): Promise<'ok' | 'stale'> {
            const { bits: b, doc } = await ref()
            // A transaction so the rev-compare and the write are atomic: this is
            // what closes the push/push race two devices hit between resolving and
            // writing. On a rev mismatch we bail with 'stale' and let the caller
            // reload + re-resolve.
            return b.storeMod.runTransaction(b.db, async tx => {
                const snap = await tx.get(doc)
                const currentRev: number | null = snap.exists()
                    ? ((snap.data().rev as number | undefined) ?? null)
                    : null
                // Differs (including "expected absent but now present", or vice
                // versa, since both map to a null/number mismatch) ⇒ stale.
                if (currentRev !== expectedRemoteRev) return 'stale' as const
                tx.set(doc, {
                    json: JSON.stringify(state),
                    rev: state.rev,
                    updatedAt: state.updatedAt,
                    writerId: state.writerId,
                })
                return 'ok' as const
            })
        },

        async clear(): Promise<void> {
            const { bits: b, doc } = await ref()
            await b.storeMod.deleteDoc(doc)
        },
    }
}
