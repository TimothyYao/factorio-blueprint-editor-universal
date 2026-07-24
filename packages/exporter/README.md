# Factorio data exporter

A Rust CLI that produces the data the editor renders: it runs Factorio headless
with a small injected mod, dumps a curated slice of `data.raw` to `data.json`,
and compresses every referenced sprite into a `.basis` atlas. Output is written
**per pack** under `data/output/<id>/`, served on `:8081` for the website's dev
server to proxy.

> This tool is **out of band from normal feature work** — it's large,
> credentialed, and the committed atlas is what the app/e2e builds actually use.
> You only need it to (re)generate a pack's data. See the root `CLAUDE.md`.

## Prerequisites

- Rust (stable) — `cargo` on `PATH`.
- A Factorio account that owns the game. Put credentials in a `.env` here:
  ```
  FACTORIO_USERNAME=your-name
  FACTORIO_TOKEN=your-token
  ```
  (Token is on your factorio.com profile.) These are used both to **download
  Factorio** and, for third-party mod packs, to let Factorio fetch mods from the
  portal.
- `basisu` — committed alongside this crate (`./basisu`), invoked per sprite.

The pinned Factorio version is `FACTORIO_VERSION` in `src/main.rs`. The download
is cached under `data/factorio/`; only that directory is replaced on a version
change — the committed `data/output/` packs are left untouched.

## Packs

`data/output/packs.json` is the manifest the editor and exporter share. Each
entry:

```json
{ "id": "space-age", "label": "Space Age (2.0)", "factorioVersion": "2.0",
  "mods": ["base", "space-age", "quality", "elevated-rails"] }
```

The exporter reads `id` (the output sub-directory) and `mods` (which mods to
enable for the run). **List `mods` in Factorio load order** (dependencies first,
e.g. `base` before `space-age`): the order decides which mod wins when two
define the same locale key — exactly as in-game — so e.g. Space Age's renames
must come after `base`. The `vanilla-2.0` and `space-age` packs use only mods
that **ship inside the Factorio install** (the `base`/`space-age`/… data dirs),
so they need no portal download; the `space-exploration` pack pulls its 33 mods
from the portal (see *Adding a new pack*).

## Regenerating a pack

```bash
# from packages/exporter/
cargo run -- --pack vanilla-2.0     # or --pack space-age
cargo run                           # no flag → the manifest's `default` pack
```

What a run does:

1. Ensures the pinned Factorio is downloaded (`data/factorio/`).
2. Writes `mods/mod-list.json` enabling exactly that pack's `mods` (plus the
   injected `export-data` mod); every other known mod is explicitly disabled, so
   regenerating `vanilla-2.0` after `space-age` correctly drops the DLC.
3. Runs Factorio against the `export-data` scenario (server mode, no display),
   which writes `data.json` **and** `active-mods.json` (the actually-loaded mod
   set). Localised names/descriptions are resolved against only the enabled
   mods' top-level `locale/en/*.cfg` (in the `mods` load order above), so a
   pack's strings match what it actually loads. The download is the full
   graphical build, not the `headless` package — the sprite step (5) reads the
   real `.png` files off disk, which `headless` doesn't ship.
4. **Verifies** the loaded mods match the pack's declared `mods` — a mismatch
   aborts *before* the long atlas build rather than producing a mislabeled pack.
5. Writes `data/output/<id>/data.json` and compresses each referenced sprite to
   `data/output/<id>/<__mod__>/…​.basis` (incremental — an mtime/size cache in
   `metadata.json` skips unchanged sprites on reruns).

When the run finishes it serves `data/output/` on `http://localhost:8081`. Point
the website at it (`VITE_DATA_URL`) or just commit the new `data/output/<id>/`.

## Browser artifact

Alongside the editor's `data.json` + `.basis` atlas, every run also produces a
**browser artifact** under `data/output/<id>/browser/` — a compact, curated
catalog + a CSS-friendly icon sheet, for the DOM consumers (the Factorio Item
Browser fork, and fbe's own blueprint-library panel). It's a few MB per pack, not
the tens-to-hundreds of MB the editor atlas is, and it's built from **Factorio's
own dump flags** rather than the injected `export-data` mod:

```
browser/
  catalog.json    items / fluids / recipes / technologies (labels, descriptions,
                  order, machine stats, baked recipe producers, real research-unit
                  counts) — display-ordered, hidden prototypes excluded
  icons.webp      icon sheet: 64 px cells on a 2 px gutter (66 px stride),
                  lossless WebP (PNG fallback → icons.png if WebP encoding fails,
                  the name then flows through icons.json's sheet.file)
  icons.json      iconId → sheet rect map (icons are content-deduped)
```

It runs **three separate Factorio invocations** (the dump flags don't combine),
each preceded by stale-output deletion and verified by its output files appearing
(Factorio's exit code is not a reliable success signal — the icon dump can crash
on shutdown *after* writing every file):

1. `--dump-data`             → `script-output/data-raw-dump.json` (the catalog)
2. `--dump-prototype-locale` → `script-output/<cat>-locale.json` (names, and
   descriptions when present — otherwise names/descriptions fall back to the same
   `locale/en/*.cfg` resolution the editor artifact uses)
3. `--dump-icon-sprites`     → `script-output/<folder>/<name>.png` (composed into
   the sheet)

> **`--dump-icon-sprites` needs a graphics backend.** Unlike the other two flags
> it renders sprites to PNG and spawns a game window, so it won't run truly
> headless. On a desktop it just works; on a headless box run the whole exporter
> under `xvfb-run`, e.g. `xvfb-run -a cargo run -- --pack vanilla-2.0`.

The dump runs rewrite `mod-list.json` with the injected `export-data` mod
**disabled** — it extends `data.raw` with placeholder prototypes the dumps must
not see; a later editor run re-enables it.

The manifest (`data/output/packs.json`) is updated additively per pack after a
successful run (written atomically via tmp-and-rename): `artifacts`
(`["editor","browser"]` — truthfully, `"browser"` only once this run produced
it), `browserSchemaVersion` (currently `1`), and `generated` (a UTC ISO-8601
timestamp, doubling as a cache-buster). Existing fields and key order are
preserved, though the serializer normalizes formatting (inline arrays expand) —
a one-time diff on first touch, stable after that.

`--browser-only` skips the long editor atlas build but still runs
setup/download/mod-install (cached; the dumps need the install) and the browser
step — handy for iterating on the catalog/icons against an already-generated
pack. `--skip-browser` is the inverse: editor pipeline only, no dump runs — the
escape hatch for a truly headless editor-only regen (no graphics backend
needed). The two flags are mutually exclusive.

```bash
cargo run -- --pack vanilla-2.0 --browser-only
```

A plain `cargo run -- --pack <id>` produces **both** the editor and browser
artifacts.

## Adding a new pack

1. Add an entry to `packs.json` with a new `id` and its `mods` (load order).
2. For **third-party mods** (e.g. Space Exploration), also pin each portal mod
   under `versions` (`"name": "version"`) in that entry, and set
   `FACTORIO_USERNAME` / `FACTORIO_TOKEN` in `.env`.
3. `cargo run -- --pack <id>`.

For packs whose mods ship with the game (DLC) that's steps 1 + 3 only. For
third-party packs, `download_portal_mods` (in `setup.rs`) fetches each pinned mod
from the mod portal into a zip cache (`data/mod-portal-cache/`, kept *outside*
the Factorio install), extracts it to `<factorio>/mods/<name>/`, and verifies the
extracted version against the pin before the long atlas build. The sprite-path
mapping is mod-agnostic (`__<mod>__/…` → `<mod>/…`). The `space-exploration` pack
(33 pinned portal mods) is generated exactly this way.
