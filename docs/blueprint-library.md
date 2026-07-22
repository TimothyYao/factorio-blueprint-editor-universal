# Blueprint Library (design + tracking companion)

Companion to **issue #50**. This is the durable design record; the issue is the
index/checklist. Keep them reconciled (see the "Keep issues in sync" rule in
`CLAUDE.md`): if this doc says ✅ and the issue box is unchecked, one of them is
wrong.

## What it is

An **in-app, persistent, organized home** for blueprint projects — "a blueprint
book that's inherent to the app." You can keep iterating on projects over time
without exporting strings to some external place, and without the risk of
silently overwriting work. Local-only for now (no account needed), with a
trajectory toward an OAuth-locked external backend (e.g. Firebase) later.

## Locked design decisions

- **Organization: folders / tree.** Projects live in a nestable tree.
- **Top tier is per modpack.** The tree's top level is one node per data pack
  (`vanilla-2.0`, `space-age`, `space-exploration`); under each, ad-hoc user
  folders + blueprints. This is also how a blueprint's **pack** is encoded
  (positionally — by which pack subtree it lives in).
- **Storage: a rich JSON document in IndexedDB, from the start.** We are _not_
  storing the library as one native blueprint string. Because an OAuth'd external
  backend (e.g. Firebase) is the intended trajectory, a structured document is
  both feasible and convenient — it holds the tree, per-leaf pack, timestamps,
  and version snapshots natively. IndexedDB (not localStorage) is the v1 backing
  store; its larger quota and structured-clone storage suit book-sized payloads,
  and a single JSON document maps cleanly onto a future Firebase doc. The store
  sits behind a `LibraryStore` interface so the backend can be swapped.
- **Native blueprint string = the interchange projection only.** Export _any_
  node (a single blueprint, a folder, a pack, the whole library) to a native
  Factorio string; import a pasted string by grafting it as a subtree under a
  chosen parent. The native string is for portability/sharing, never the system
  of record.
- **Per-modpack scratchpad — always live, never versioned.** Each pack subtree
  always has a Scratchpad: the default landing place for transient work, replacing
  today's single `fbe:blueprint` autosave (global, silently overwritten). It's
  continuously autosaved but holds **no versions** — you can't Save a checkpoint
  into it, only **Save as…** a named copy. It's never reported as "modified".
- **The active leaf _is_ the working context.** Opening an entry makes it the
  active leaf; the canvas edits it directly, and the active project's name is
  shown in a top-centre indicator. Each pack remembers its own active leaf
  (persisted), so a reload reopens what you were working on.
- **Autosave (live) vs. Save (checkpoint) — a backup model.** A leaf has two
  things: its **live `encoded`** (continuously autosaved on `visibilitychange`,
  so uncommitted edits are _persisted_ and survive reloads) and **`snapshots[]`**
  — explicit version checkpoints (last N kept, pruned, identical/empty saves
  skipped). "Modified" is **derived, not transient**: it's simply `encoded ≠
newest snapshot` (uncommitted edits), recomputed on load and shown as the
  indicator's dot. **Restore** (Phase 3 UI; `restoreSnapshot` exists) overwrites
  the live content with a chosen version — explicit-only, so it does _not_
  auto-snapshot, and the UI should confirm when there are uncommitted edits to
  overwrite; saving afterward records the restored content as the new newest
  version. So history is **time-linear, per-leaf, no branches/tags** — a backup,
  not a VCS. The **scratchpad is exempt** (always live, no versions, never
  modified). **Save As** makes a new named leaf and switches to it.
- **"Open a new project" + recents.** Loading the site with a `?source=` URL
  creates an _implied separate entry_ under an auto-created **"Imported"** folder
  (it joins recents and never clobbers the scratchpad). An explicit "new project"
  action resets the scratchpad and, when there are unsaved changes, prompts first.
  A **recents** list keeps the last N entries opened. (What becomes a recent vs.
  what merely modifies the scratchpad, and how imported _books_ decompose into a
  folder of blueprints, are deliberately deferred — the model carries what's
  needed so we can decide later.)

## The modpack-encoding problem

A native blueprint-book string has **no field for which data pack renders it**,
but the editor needs one (`DATA_PACK` in `editor/src/common/globals.ts`; a
blueprint references prototype names that only exist in a given pack — `loadBp`
in `website/src/index.ts` already errors on a pack mismatch).

Because storage is a rich document, the pack is just a field on each pack subtree
(and inherited by its leaves) — no encoding gymnastics needed internally. The
problem only resurfaces at the **native interchange boundary**:

- **Export:** encode the pack positionally. When exporting a whole pack or the
  whole library, name the top-level book(s) after the pack id (`label` == pack
  id) so the pack survives as far as a native string can carry it.
- **Import:** the top-level book label _is_ the pack hint; `importString` returns
  it as `packHint` for routing.

> Resolved (Phase 4): the pack-label mechanism is the **top-level `label` == pack
> id** convention (`exportPack`/`exportLibrary` apply it; `importString` surfaces
> it as `packHint`). The UI doesn't yet route by it — Import… grafts into the
> browsed pack — so honouring `packHint` (and prompting when it's unrecognised) is
> the remaining follow-up.

## Architecture / seams (reuse, don't reinvent)

- **Currency:** `encode(Blueprint|Book) → string` and
  `getBlueprintOrBookFromSource(source) → Blueprint|Book` (`editor/src/core/bpString.ts`,
  re-exported from `@fbe/editor`). A leaf stores the encoded string as its
  payload; the editor consumes/produces it through these. (`decode` itself is not
  exported — go through `getBlueprintOrBookFromSource`.)
- **Generalize the existing autosave:** `website/src/blueprintStorage.ts`
  persists _one_ encoded string and is pure + unit-tested. The library is the
  same idea scaled to a tree of named entries — model the pure parts the same way
  (deterministic, unit-tested), with the IndexedDB backing behind an interface.
- **Open onto the canvas:** `loadBp(bpOrBook)` in `website/src/index.ts` is the
  single swap-in point. "Open leaf" = `loadBp(await getBlueprintOrBookFromSource(entry.encoded))`;
  read the leaf's pack and offer to switch `DATA_PACK` (via `setDataPack`) when it
  differs from the active pack — reusing the cross-pack guard already in
  `loadBp`.
- **Per-entry copy:** reuse the existing `copyBlueprintToClipboard` / `encode`.
- **Native nesting already exists:** `Book` / `IBlueprintBook`
  (`editor/src/core/Book.ts`) model nested books + labels + icons — folders map
  onto nested books, which is what makes native subtree export/import natural.
- **UI is DOM for list/grid chrome** (settings pane, action rail, toasts are DOM
  overlays; the canvas is Pixi). The library browser is a mobile-aware DOM panel,
  reserving a viewport inset like the action rail does.

## Risks

- **Durability** — IndexedDB is wiped by "clear site data," so the **full export
  is load-bearing**, not a nice-to-have, until the external backend lands.
- **Quota/scale** — IndexedDB is far roomier than localStorage, but books +
  snapshots still add up; prune snapshots to N and watch quota.
- **Cross-pack open** — opening a leaf saved under a pack the app isn't currently
  on; handled by the pack-switch-on-open above.

## Data model + code map

A single `LibraryState` document, in `packages/website/src/library/`:

- `packs: Record<packId, PackTree>` — top tier, one per modpack.
- `PackTree`: `{ pack, scratchpad: BlueprintEntry, children: LibraryNode[], recents: string[], activeId? }`.
- `LibraryNode = FolderEntry | BlueprintEntry` (folders nest via `children`).
- `BlueprintEntry`: `{ id, kind:'blueprint', name, encoded, createdAt, updatedAt, snapshots: Snapshot[] }`.
- `FolderEntry`: `{ id, kind:'folder', name, children, createdAt, updatedAt, description?, icons?, activeIndex? }`
  — a folder _is_ a Factorio book, so it carries the book's metadata (Phase 5a).
- `Snapshot`: `{ encoded, savedAt }` (newest first, capped at N).

- `model.ts` — pure types + deterministic tree ops (id/now injectable),
  unit-tested. Content ops split the two write paths: `updateEntryContent`
  (autosave, no checkpoint) vs. `checkpointEntry` (explicit Save) /
  `restoreSnapshot` / `deleteSnapshot` / `hasUncheckpointedChanges`; plus
  `ensureFolder` for the "Imported" area.
- `store.ts` — `LibraryStore` interface + `IndexedDBLibraryStore` (real backing) +
  `InMemoryLibraryStore` (tests / SSR fallback) + `createLibraryStore()` picker.
- `interchange.ts` — pure, editor-free native-string export/import (Phase 4). Uses
  the same `0`+base64(deflate(JSON)) codec via pako directly, so folders ↔ nested
  blueprint-books and it's unit-testable. `exportNode`/`exportPack`/`exportLibrary`
  (pack/library books labelled by pack id) and `importString` (decompose a book
  into a folder subtree).
- `controller.ts` — `LibraryController`: owns session state (active pack + active
  leaf), deals only in encoded strings (no editor import → unit-tested). The
  active-pack working-context API (autosave/Save/Save As/open/import/newScratch),
  plus pack-scoped organize ops (createFolder/rename/move/duplicate/remove),
  cross-pack `copyToPack`/`moveToPack` + `setActiveForPack` (the cross-pack-open
  handoff), and version ops (`restore`/`deleteSnapshot`/`getEntry`).
  `cloneNode`/`duplicateNode` in `model.ts` drop version history.
- `libraryPanel.ts` — the DOM browser overlay (no framework, matches the site
  chrome): a pack drop-down (browse any pack), per-row "⋯" menus
  (rename/duplicate/move/copy/delete/versions/export), a destination picker
  spanning packs, an in-panel modal confirm, a version-history viewer (restore /
  delete a saved version), and Import… / Export pack / Export all actions.
  Verified by running the app + `e2e/library.spec.ts`.
- Wiring in `index.ts`: the active leaf replaces the legacy single-slot autosave
  (migrated into the scratchpad once), the active-project indicator, and the
  `#library-button` / `#active-project` chrome.

## Iterative slices (mirror of issue #50)

- [x] **Phase 0 — Store + model.** Rich JSON document; pure model + tree ops +
      tests; `LibraryStore` interface with IndexedDB + in-memory impls.
- [x] **Phase 1 — Scratchpad + open/save (minimal UI).** Per-pack scratchpad as
      the working context; autosave → active leaf; explicit Save (checkpoint) /
      Save As; DOM panel to browse + Open a leaf; active-project indicator;
      `?source=` URL → implied "Imported" leaf + recents; "new project" with the
      unsaved-changes prompt; per-leaf "Copy string"; legacy-autosave migration.
- [x] **Phase 2 — Organization + multi-pack.** Folders (create / rename / delete /
      duplicate); move/reparent within a pack; a pack drop-down to browse any
      pack's tree (Open from a non-active pack switches via `setDataPack`);
      cross-pack copy/move (optimistic, version history dropped). "⋯" row menus +
      destination picker.
- [x] **Phase 3 — Versioning UI.** A per-leaf version-history viewer (⋯ →
      "Versions…"): lists saved versions newest-first with relative timestamps,
      Restore (overwrites live content; reloads the canvas + confirms when it's
      the active leaf with unsaved edits) and Delete-a-version. Model already
      prunes to N.
- [x] **Phase 4 — Export / import hierarchy.** Export any node → native string
      (leaf → its bp string; folder → nested book; pack/library → book labelled by
      pack id — the modpack-label convention). Import a pasted string, decomposing
      a book into a folder subtree. ⋯ "Export as book" + Import… / Export pack /
      Export all. (Import is paste-only and grafts into the browsed pack; URL
      import + pack-routing-by-label are deferred.)
- [ ] **Phase 5 — Folders are books.** A folder carries the book's metadata, so a
      folder _is_ a Factorio book (no separate "book node" kind).
    - [x] **5a — book metadata.** `FolderEntry` carries `description` / `icons` /
          `activeIndex`; `interchange` preserves them on export **and** decompose
          (fixes the export-as-book fidelity gap); clone/duplicate copy them; folder
          ⋯ "Edit description…"; the description shows on hover (a ⓘ hint).
    - [x] **5b — open a folder as a book.** A folder's "Open" button loads it as a
          navigable Book onto the canvas (flip through it with the settings BP Book
          Index slider). It's a **view**: the working context + autosave are
          suspended (`viewingBook` in `index.ts`), so the book is never written back
          into a leaf; the indicator shows "📖 <folder>" and Save is disabled.
          Opening a leaf / New project exits the view. Active-pack only (rendering
          needs the pack's atlas). No write-back / reordering (deferred).
    - [ ] **5c — render icons** in the panel (atlas/sprite extraction). Storing /
          round-tripping icons is free (5a); drawing them is the separate hard bit.
          _(deferred — not planned unless it becomes cheap)_
- [ ] **Phase 6 — External backend.** OAuth-locked remote store (Firebase)
      alongside the `LibraryStore`; last-write-wins sync. _(in progress — the
      Firebase integration slice has landed; see "Phase 6 — cloud sync" below.
      Live-project setup + the emulator-debugging slice remain.)_

## Phase 6 — cloud sync (Firebase)

The library document — a single JSON doc — now has an optional Firebase remote
alongside the local IndexedDB store. Signed-in users get their library mirrored
to the cloud and reconciled across devices; **signed out or on an unconfigured
build it's exactly the previous local-only editor** (no sign-in UI, no SDK even
loaded).

### Files

- **`library/firebase.ts`** — the _only_ file that imports the `firebase` SDK,
  via **dynamic `import()`** inside a lazy init, so (a) an unconfigured build
  never loads it and (b) Vite code-splits it into its own lazy chunk (it does not
  bloat the entry chunk). Owns config (`firebaseConfigured()`), auth (`signIn`
  via Google **popup-first, with a redirect fallback**; `signOutUser`; `onAuth`,
  which wires `onAuthStateChanged` and also completes `getRedirectResult` on
  return — so the fallback path finishes cleanly), and `createRemote(uid)`, the
  `RemoteLibraryDoc` over the Firestore doc.

    > **Why popup-first (not redirect).** This static deployment serves the app
    > from `trisiak.github.io` while the auth handler lives on a _different_ origin
    > (`authDomain` = `*.firebaseapp.com`). The redirect flow stores its result
    > under that authDomain origin and reads it back through a cross-origin iframe;
    > Chrome 115+'s **third-party storage partitioning** partitions that iframe's
    > storage away from the top-level site, so `getRedirectResult` silently resolves
    > `null` and the user lands back signed out. Firebase's recommended fix is to
    > serve the same-origin `/__/auth` handler, but GitHub Pages can't proxy it — so
    > `signIn` uses `signInWithPopup`, whose credential returns over `postMessage` to
    > the still-open opener (a same-origin handle) and never touches partitioned
    > storage. Redirect is retained only as a fallback for `auth/popup-blocked` /
    > `auth/operation-not-supported-in-this-environment` (a user-dismissed or
    > double-clicked popup is _not_ a fallback trigger). Don't flip this back to
    > redirect-first without a same-origin auth handler in place.

- **`library/syncService.ts`** — orchestration, **no firebase imports** (so it's
  node-unit-tested with a fake remote). `SyncedLibraryStore` is a `LibraryStore`
  decorator handed to the controller: it writes local first (durability), then
  debounces a remote push (~2 s trailing, `flush()` on tab-hide). `SyncService`
  owns the attached remote, the per-user base revision, the status callback, and
  the `reconcile` / push / pull / conflict flows, driving the pure `resolveSync`
  from `sync.ts`.
- **`library/sync.ts`** — the pure last-write-wins resolver (landed earlier):
  `resolveSync(local, remote, baseRev, writerId)` → push / pull / conflict / noop.
- **`index.ts`** — wiring only: wraps the store, subscribes `onAuth` (attach a
  per-uid remote + reconcile on sign-in; detach on sign-out), reconciles on
  `visibilitychange`→visible, flushes on →hidden, and on a pull re-inits the
  controller + panel and (guardedly) reopens the active entry onto the canvas.
- **`library/libraryPanel.ts`** — the header sync widget (Sign in / account +
  status glyph + Sign out) and the conflict chooser modal (see the conflict
  prompt below). In the `conflict` state the ⚠ status glyph is itself a
  re-entry point: clicking it re-opens the chooser (via a `reopenConflict`
  callback) against the live pending conflict, so a prompt dismissed by an
  overlay click is reachable again without a reload.

### The LWW / baseRev model

Sync is **whole-document last-write-wins**, keyed off the doc-level `rev` (a
monotonic counter stamped by `stampWrite` on every persisted write) and
`writerId` (which install wrote last). `baseRev` is the remote `rev` this device
last synced against, tracked **outside** the document in `localStorage`
(`fbe:library:sync`, JSON `{ uid, baseRev }`) — **per-user**, so switching
accounts never reuses a stale base. `resolveSync` compares `remote.rev` /
`local.rev` against `baseRev` (and uses `writerId` to fast-forward our own remote
echoes) to decide push / pull / conflict / noop. Remote writes go through a
Firestore **transaction** that rejects (`'stale'`) if the remote `rev` moved
since we resolved, closing the two-device push/push race; on `'stale'` the
service reloads and re-resolves.

### Conflicts and the conflict prompt

A conflict is surfaced to the user with keep-mine / take-theirs (keep-mine
re-stamps the local doc as a strictly-newer winner — rev bumped past the
remote's, fresh writer/clock — so it dominates other devices instead of being
regress-pushed away; take-theirs pulls). `resolveSync` raises `conflict` in two
structurally different situations, carried through as `SyncDecision.conflictKind`
→ `ConflictInfo.kind` so the prompt words itself correctly rather than parsing
the `reason` string:

- **`diverged`** — both sides advanced from a shared base; the cloud copy is
  genuinely later work from another device. Prompt: _"Cloud copy is newer — it
  was changed on another device."_ with both `updatedAt` timestamps.
- **`first-attach`** — never synced from this device (`baseRev` null); the local
  and remote libraries are unrelated histories, so _neither_ is "newer". Prompt:
  _"This device and the cloud have different libraries."_ plus a line noting you
  signed in on a device that already has its own library and keeping one discards
  the other. The timestamps are still shown but framed neutrally (this device /
  cloud), with no "newer" claim.

Both kinds also offer a third, **non-destructive "Neither — sign out"** abort,
for a user who signed in with messy/incompatible local state and wants to back up
first. At the conflict path the service has neither pulled nor pushed, so **local
IndexedDB and the cloud doc are both untouched**; sign-out (→ `onAuth(null)` →
`SyncService.detach()`) just clears the pending conflict and returns to
signed-out, leaving both stores exactly as they were. Sign-out is an app-level
action wired in `index.ts` (`handleConflict`), not a resolver outcome — the
widened prompt choice (`keep-mine | take-theirs | sign-out`) lives only at the
panel seam; `SyncService.ConflictChoice` stays the two real resolutions.

A prompt dismissed by an overlay/backdrop click leaves the status at ⚠
`conflict`; clicking that glyph re-opens the chooser against the live pending
conflict (`SyncService.getConflict()`, kept fresh by `raiseConflict`'s
replace-latest dedupe). The panel guards against stacking a second modal.

### Config (Vite env vars)

Firebase web config is **public** (it ships in the client bundle by design), so
these are ordinary build-time values passed as GitHub repo **variables** (not
secrets) in `pages-prod.yml` / `pages-preview.yml`. All four are required; any
missing ⇒ unconfigured ⇒ local-only build:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

Plus `VITE_FIREBASE_USE_EMULATORS` (truthy) for local debugging against the
emulators.

### Firestore doc shape

Path `users/{uid}/library/state` (the even-segment _document_ under the
odd-segment `users/{uid}/library` _collection_). Stored as a **JSON string
field**: `{ json: JSON.stringify(state), rev, updatedAt, writerId }`, with the
three sync-metadata fields mirrored top-level. Rationale: Firestore rejects
nested arrays and `undefined` values (both legitimately present in the library
doc, e.g. `icons` / optional fields); a JSON-string round-trip sidesteps both and
preserves the exact local shape, while the top-level `rev` lets the transactional
save check staleness without parsing `json`.

**Caveat — 1 MiB doc cap.** Firestore caps a document at 1 MiB; a library that
grows past that fails to save. The failure surfaces as a sync `error` (the panel
glyph), not a crash. Chunking large libraries is out of scope for this whole-doc
LWW model.

### Emulators

`firebase.json` + `firestore.rules` sit at the repo root. `firebase
emulators:start` runs **auth on 9099** and **Firestore on 8091** (`8091`, not the
default 8080, which collides with the vite dev/preview server). Build with
`VITE_FIREBASE_USE_EMULATORS=true` and the editor points at those ports.

### One-time Firebase project setup checklist

1. Create a Firebase project; add a **Web app** and copy its config into the four
   `VITE_FIREBASE_*` repo variables.
2. **Authentication → Sign-in method → enable Google.**
3. **Authentication → Settings → Authorized domains →** add the Pages origin
   (`trisiak.github.io`) so the popup (and redirect-fallback) sign-in is allowed.
4. **Firestore →** create the database, then deploy the rules:
   `firebase deploy --only firestore:rules` (from `firestore.rules`).

## Deferred

- **Cross-pack compatibility check** — copy/move are **optimistic**: no upfront
  validation. Prototypes the target pack lacks are stripped when the entry is
  opened there (the existing `stripUnknownEntities` path). A validated mode
  (fetch the target's prototype names, warn before dropping anything) is a future
  enhancement.
- **Live unsaved-dot** — the indicator's "modified" dot refreshes on autosave
  (tab hide), not on every edit; live tracking needs an editor change event.
- **Richer dialogs** — confirms (delete / discard / pack-switch) use an in-panel
  modal; **Import…** uses a `<textarea>` modal (blueprint strings are thousands of
  chars — `window.prompt` truncates/mangles them, notably on touch). Save As /
  Rename / New folder / Edit description still use `window.prompt` (short names, so
  it's fine); a text-input modal can replace those later.
- **Mobile book navigation** — a pasted book / an opened folder-book (5b) loads,
  but flipping through it uses the desktop **Settings → BP Book Index** slider,
  which isn't usable on touch. An on-canvas book nav is a mobile-controls
  follow-up; until then 5b's navigation is effectively desktop-only.
- **Import routing** — the panel's Import… is paste-only (`0`-strings, no URL
  fetch) and grafts into the _browsed_ pack at root; routing by the top-level
  book label to a matching pack (the `packHint`) is wired in the model but not yet
  used by the UI. The boot-time `?source=` book is still stored as a single
  "Imported" leaf (not decomposed) — only the panel's Import… decomposes.
- **Folder UX polish** — folders are always expanded (no collapse) and move uses
  a destination picker rather than drag-and-drop.

## Not this (for now)

- Multi-device sync (until the external backend lands).
- A built-in blueprint _gallery_ / sharing.
