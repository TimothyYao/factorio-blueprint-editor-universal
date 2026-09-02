# Factorio data exporter

A Rust CLI that produces the data the editor renders: it runs Factorio headless
with a small injected mod, dumps a curated slice of `data.raw` to `data.json`,
and compresses every referenced sprite into a `.basis` atlas. Output is written
**per pack** under `data/output/<id>/`, served on `:8081` for the website's dev
server to proxy.

> This tool is **out of band from normal feature work** — it's large and
> credentialed. You only need it to (re)generate a pack's data. See the root
> `CLAUDE.md`.

## Where the output goes (read this first)

**`data/output/` is a local working directory, not a deliverable.** It is
gitignored: generated pack data is no longer committed to this repo. The copy of
record — and what every deployed build, PR preview and e2e run actually fetches —
is published by the dedicated data plane,
[`TimothyYao/factorio-pack-data`](https://github.com/TimothyYao/factorio-pack-data),
at `https://timothyyao.github.io/factorio-pack-data/` (GitHub Pages, CORS `*`). Its
deploy workflow is what publishes generated output; there is nothing to commit
back here after a run.

Two consequences for a local run:

- **The manifest lives there too.** `packs/packs.json` in the data repo is the
  manifest of record. Before running the exporter, copy it to
  `data/output/packs.json` (it is the file this CLI reads for pack ids/mods and
  additively updates after a run):

  ```bash
  mkdir -p data/output   # a fresh clone has no data/ at all
  curl -fsSL https://timothyyao.github.io/factorio-pack-data/packs.json \
      -o data/output/packs.json
  ```

  If you change it — a new pack, a version pin, a label — the edit belongs in the
  data repo, not here.
- **Feeding the local website** with what you just generated is the `:8081`
  server below plus the dev server's `/data` proxy (the default in `vite`
  dev), or `VITE_DATA_URL=http://127.0.0.1:8081` for a production/preview build.

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
change — any `data/output/` packs you already generated are left untouched.

## Packs

`data/output/packs.json` is the manifest the editor and exporter share — a local
copy of the data repo's `packs/packs.json` (see above). Each entry:

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

When the run finishes it serves `data/output/` on `http://localhost:8081`, which
is what `npm run start:website` proxies `/data` to — so a dev server renders the
pack you just generated with no extra wiring (a production/preview build needs
`VITE_DATA_URL=http://127.0.0.1:8081`). To **publish** it, hand the output to
the data repo; nothing is committed here.

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

The local manifest (`data/output/packs.json`) is updated additively per pack
after a successful run (written atomically via tmp-and-rename): `artifacts`
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

## Slim mode (graphics variants)

`--slim <rect-report.json>` builds a **graphics-only variant** of an
already-generated pack into `data/output/<id>-slim/` — the same game data with a
much smaller texture set. See `docs/slim-graphics.md` in the repo root for the
design; the short version:

```bash
# 1. the rect report — the editor's own sprite census, from the repo root
npm run rect-report -- vanilla-2.0 packages/exporter/data/rect-report-vanilla-2.0.json

# 2. the variant — from packages/exporter/
cargo run --release -- --pack vanilla-2.0 --slim ./data/rect-report-vanilla-2.0.json
```

The variant directory is a full editor tier:

```
data/output/vanilla-2.0-slim/
  data.json      byte-identical to the base pack's (same prototypes ⇒ blueprints
                 and the in-app library are portable between variants)
  textures.json  path → { crop: [x, y, w, h], scale } — how each shipped file maps
                 back to the ORIGINAL image, applied by the editor's getTexture.
                 Keys are the `.png` paths exactly as data.json spells them; an
                 absent entry is the identity, which is why full packs need none.
  __base__/…     the .basis set, cropped + downscaled
```

Per texture: crop to the rect report's union bounding box (the region the editor
can actually sample — trailing animation frames and unused layers fall away),
downscale **0.5×** (Lanczos3; Factorio ships ~2× HR art, so this is roughly native
resolution), pad to a power of two, then the same `basisu` invocation as the
editor tier. Crop rectangles are snapped outward to even coordinates so the
downscaled texel grid stays aligned with the original's.

Notes:

- **Nothing is dropped.** A file referenced by `data.json` but *absent* from the
  rect report (never sampled by the census — UI-only art, unreferenced layers) is
  still shipped, downscaled but uncropped. The census covers what the editor
  *draws*; a dropped file that some code path does reach would be a visible hole,
  while keeping it costs only the 4× the downscale gives anyway. The run log
  counts both buckets.
- **No Factorio launch, no credentials, no download.** Slim mode reads the base
  pack's `data.json` and the source PNGs straight out of the install (the same
  `mod_root` lookup the editor tier uses), so it can't be combined with
  `--browser-only` / `--skip-browser` (a variant carries no browser tier).
- Incremental: `metadata.json` stamps `(len, mtime, crop, scale)` per source, so
  an updated rect report rebuilds exactly the textures whose crop moved. Stale
  `.basis` files are pruned, as in the editor tier.
- The local `packs.json` gains the variant entry additively
  (`variantOf`, `graphics: "slim"`, `artifacts: ["editor"]`) so the dev server can
  select it; the entry of record belongs in the data repo.
- Verify with `npm test` — `slimPackCensus.test.ts` replays the whole sprite
  census against the generated `textures.json` and asserts every rect resolves
  inside the shipped textures. It self-skips when the variant hasn't been built.

## Adding a new pack

1. Add an entry to `packs.json` with a new `id` and its `mods` (load order). The
   entry belongs in the data repo's `packs/packs.json` (the manifest of record);
   add it to your local `data/output/packs.json` too so this run picks it up.
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
