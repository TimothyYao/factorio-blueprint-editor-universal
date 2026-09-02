# Quality support: tiers on entities, filters, modules, and signals

Design record + tracker for adding Factorio 2.0 **Quality** to the editor —
rendering it, round-tripping it, and editing it. Grounded on the
[Quality wiki page](https://wiki.factorio.com/Quality) and
[FFF-375](https://www.factorio.com/blog/post/fff-375); checkboxes below are
the backlog, tick them as slices land.

## What quality is (the facts the design leans on)

- **Five tiers** in vanilla gameplay, with _tier strength_ in brackets:
  Normal (0), Uncommon (1), Rare (2), Epic (3), Legendary (5) — legendary is
  a 2-strength jump over epic. Conventional colors: gray, green, blue,
  purple, orange (exact RGBA lives in `data.raw.quality[*].color`; mods can
  add tiers).
- Quality applies to **items, entities and equipment**; **fluids have no
  quality**. Effects are per-strength and additive (+30% crafting speed,
  +30% module effects, +1 tile reach on poles, … per strength level).
- **Quality is a separate mod.** Owning Space Age is required, but the mod
  can be enabled independently of the rest of Space Age — a "vanilla +
  quality" game is a real, supported configuration. This is why quality UI
  here must **not** be keyed to the `space-age` data pack: a `vanilla-2.0`
  user may absolutely be building for a quality-enabled save.
- **In-game precedent for the toggle:** the game keeps quality _invisible_ —
  all GUIs and interactions — until quality modules are researched or when
  the mod is off (FFF-375). That's the model for our settings toggle: hide
  the UI, never touch the data.

### Where quality appears in the blueprint string (2.0 format)

| Surface           | JSON shape                                               | Editor seam today                                                                           |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Entity itself     | `entity.quality?: string`                                | untyped (commented-out in `types.ts`), survives round-trip via `additionalProperties: true` |
| Inserter filters  | `filters: ItemFilter[]` with `quality?` + `comparator?`  | typed; **dropped on edit** (UI rebuilds `{index, name}`)                                    |
| Splitter filter   | `filter: SplitterFilter` with `quality?` + `comparator?` | typed; **dropped on edit** (setter writes `{ name }`)                                       |
| Module requests   | `items: BlueprintInsertPlan[]`, `id: { name, quality? }` | typed; **dropped on edit** (setter writes `id: { name }`)                                   |
| Logistic requests | `LogisticFilter.quality?` + `comparator?`                | typed **and preserved** (merge in `logisticChestFilters` setter)                            |
| Recipe            | `recipe_quality?: string`                                | typed; no accessor, no UI                                                                   |
| CB signals        | `SignalID.quality?`                                      | schema allows; `ConstantCombinatorEditor` hardcodes `quality: 'normal'`                     |
| Selector CB       | `quality_filter` / quality-transfer params               | ops selectable; params not edited                                                           |

Filter-quality semantics (matters for UI copy): **absent `quality` means
"any quality"** — it is _not_ the same as `quality: 'normal'` with `=`.
When `quality` is present, `comparator` defaults to `=`; the full set is
`=` `≠` `<` `>` `≤` `≥` (the same unicode `ComparatorString` the repo
already uses for circuit conditions). Entity-level `quality`, by contrast,
simply defaults to normal when absent.

## Current state (why this is mostly a "stop dropping it" project)

The 2.0-format migration already put quality into the _types and schema_:
`ItemFilter` / `SplitterFilter` / `BlueprintInsertPlan` / `LogisticFilter`
in `editor/src/types.ts` all carry `quality?`, `blueprintSchema.json`
validates it, and `bpString` neither strips unknown fields on decode nor
scrubs on encode — so an _untouched_ imported blueprint keeps its quality.
One write path already defends it consciously: the logistic-chest setter
(`Entity.ts`, `logisticChestFilters`) merges edits onto the existing raw
filter precisely so `quality`/`comparator` survive a count change (pinned by
`logisticChestFilters.test.ts`).

Everything else loses it the moment you edit, because the editor-facing
shape is quality-blind:

- `IFilter` (`core/Entity.ts`) is `{index, name, count?}`; the `Filters`
  UI component rebuilds slots in that shape, and the **inserter** setter
  writes the rebuilt array raw — one filter edit wipes quality from _all_
  slots of that inserter.
- The **splitter** setter reduces to a bare name: `filter = { name }`,
  dropping `quality` _and_ `comparator`.
- The **modules** setter builds `id: { name: module }` and keys slots by
  name only — two stacks of the same module at different qualities can't
  even be represented.
- Nothing _renders_ quality anywhere (no badges, no info-panel line), FD has
  no quality tier metadata (`loadData` doesn't read one; the exporter
  doesn't dump `data.raw.quality`), and there's no setting.

## Design decisions

### 1. A "Quality" toggle, on by default, orthogonal to the data pack

A boolean setting following the Dark Mode / Debug pattern in
`website/src/settingsPane.ts` (localStorage key `fbe:quality`, checkbox in
the pane), surfaced to the editor package as a tiny controller in
`editor/src/common/` mirroring `input.ts` (persisted value + change event,
so PixiJS UI can react without a reload). **Default: on** — quality is part
of the 2.0 blueprint format on every pack, including `vanilla-2.0`, because
the mod is orthogonal to Space Age content.

What the toggle gates: badges, the picker's quality row, the entity-quality
row in editors, the info-panel line. What it must **never** do: strip or
normalize quality data on import, edit, or export. Toggled off with a
quality-rich blueprint loaded, every byte still round-trips — exactly the
game's "invisible until researched" behavior. (This also keeps the toggle
safe to flip mid-session: it's pure presentation.)

### 2. Tier metadata: built-in table first, data-driven later

The editor ships a small built-in tier table (name, strength level, color,
localised label) for the five vanilla tiers in a new `core/quality.ts`.
Badges are **drawn, not sampled**: a PixiJS `Graphics` diamond tinted per
tier, composited into the icon container. Rationale:

- Works identically on **every pack**. The `vanilla-2.0` dump is base-game
  only — `data.raw.quality` there holds just `normal` (+`quality-unknown`),
  and no pack currently exports quality prototypes or their icons at all.
  A drawn badge has no atlas dependency, no re-dump, no data-plane change.
- Degrades gracefully: an unknown tier name from a modded blueprint renders
  a neutral badge with the raw name in the tooltip/info panel instead of
  throwing (same defensive posture as the SA-aware draw branches).

A later, optional slice makes it data-driven — exporter dumps
`data.raw.quality` (name, `level`, `color`, localised name, hidden flag)
into `data.json`, `loadData` exposes `FD.qualities`, and the built-in table
becomes the fallback when a pack predates the field. That's what makes
mod-added tiers first-class; it's a data-repo/exporter change and per
CLAUDE.md stays out of band until asked.

### 3. Editor-facing filter shape grows quality

`IFilter` gains `quality?: string; comparator?: ComparatorString`. The
three lossy write paths adopt the logistic setter's proven pattern:

- **Inserter** (`inserterFilters` setter + `Filters.m_UpdateFilters`): the
  UI carries quality/comparator through its rebuild, and the setter merges
  per-index onto existing raw filters so untouched slots keep their fields.
- **Splitter** (`splitterFilter` get/setter): read and write the full
  `{ name, quality?, comparator? }` object (still deleting the key outright
  on clear, per the existing comment about empty `filter: {}`).
- **Modules** (`modules` get/setter + `Modules` component): slots become
  `(name, quality?)` pairs; the setter groups insert-plans by that pair
  instead of by name. This is the one place the _getter's public type_
  changes (`(string | undefined)[]` → pair objects), so its consumers
  (`Modules`, `EntityInfoPanel`, oil-outpost generator's module fill) move
  in the same commit.

Round-trip fidelity per path gets a unit test in the mold of
`logisticChestFilters.test.ts` — that file is the spec for "edit one field,
prove the rest survived".

### 4. Picking quality: a quality row inside `InventoryDialog`

The game's own filter GUI puts the quality choice inside the item-select
panel, and that's the right shape here too: `createInventory`
(`UIContainer.ts` → `InventoryDialog.ts`) grows an opt-in quality row —
six slots (**Any** + the five tiers) plus a comparator cycle button that
appears once a specific tier is chosen. The selection callback widens
compatibly: `(name, quality?, comparator?)`, with existing call sites
unaffected. Call sites that opt in: `Filters.activate` (inserters,
splitters) and `Modules.openPicker`; the logistic-chest path comes free via
`Filters`.

Mobile first, per this fork's focus: the row uses the standard 38px slot
grid (`bindSlotGestures` targets), no hover-only affordances, and "Any"
is visually distinct from "Normal =" because the semantic difference is
real (see above). When the quality toggle is off — or the dialog's caller
doesn't opt in (signal contexts come later) — the row simply isn't built,
so the dialog's height math stays untouched for the common case.

Rejected alternative: a secondary tap/long-press on the editor's filter
slot opening a separate quality picker. It adds a second interaction layer
to slots whose tap and long-press are both taken (`bindSlotGestures`:
activate / clear), and it diverges from the game's muscle memory.

### 5. Entity-level quality: typed accessor + editor row + alt-mode badge

- `IEntity.quality?: string` (finally un-commenting the TODO in
  `types.ts`), plus an `Entity.quality` get/set going through the history
  system like every other entity property.
- The shared entity editor frame (`UI/editors/Editor.ts`) gains a compact
  quality selector row (tier badges, tap to set; normal = key removed from
  the raw entity), shown when the toggle is on.
- `EntityInfoPanel` title line shows the tier badge + localised tier name
  next to the entity name.
- `OverlayContainer` draws a small tier badge in the entity's corner for
  non-normal quality — mirroring the game's alt-mode, and the only way to
  _scan_ a pasted quality build at a glance.
- Paint/copy flows (`PaintEntityContainer`, pipette, copy-entity-settings)
  carry `quality` with them, same as direction and recipe.

### 6. Badge rendering is one seam

A single helper (working name `F.CreateQualityBadge(quality, size)`) used
by icon composition (`F.CreateIcon` / `CreateIconWithAmount` in
`UI/controls/functions.ts` grow an optional `quality` argument),
`OverlayContainer.createIconWithBackground`, the editor slots, and the info
panel. Badge sits bottom-left of the icon (game convention), scales with
`maxSize`, and renders nothing for normal/undefined.

## Out of scope (recorded so it's a decision, not an omission)

- **Quality math/simulation** — quality-chance rolls, upcycling ratios,
  recycler loops. The editor edits blueprints; it doesn't simulate.
- **Rate calculator awareness** (`docs/rate-calculator.md`): quality
  changes machine crafting speed and module effects, so rates for a
  quality build are genuinely different. Real, useful, and cleanly
  separable — a follow-up once tiers are in `FD`.
- **Upgrade-planner-style bulk quality changes** and deconstruction-planner
  quality filters — no planner editing exists in the editor at all yet.
- **Per-quality entity stats in the info panel** (health, speed tables from
  the wiki) — needs data the dump doesn't carry; revisit with slice 6.

## Slices

Each slice is independently shippable and leaves the app consistent;
fidelity comes before UI so nothing visible ever writes lossy data.

- [ ] **0 — Fidelity (no UI).** Type `IEntity.quality`; `IFilter` grows
      `quality`/`comparator`; inserter/splitter/module write paths preserve
      quality per §3; unit tests per path (mirroring
      `logisticChestFilters.test.ts`) + one whole-blueprint round-trip test
      over a quality-rich string (entity quality, filtered inserter +
      splitter, quality modules, requester with comparator).
- [ ] **1 — Read path.** `core/quality.ts` (built-in tier table),
      `F.CreateQualityBadge`, badges through `CreateIcon` /
      `CreateIconWithAmount` and `OverlayContainer` (slot icons, module
      icons, splitter filter overlay, entity corner badge), info-panel
      tier line. Unknown tiers render the neutral fallback.
- [ ] **2 — Toggle.** `fbe:quality` controller in `editor/src/common/`
      (default **on**, persisted, change event), checkbox in
      `settingsPane.ts`, all slice-1 surfaces gated. e2e: import quality
      blueprint → badges visible; toggle off → gone; export → string
      unchanged either way.
- [ ] **3 — Write path.** `InventoryDialog` quality row + comparator cycle
      (§4); wired into `Filters` (inserters **and** splitters — the two
      surfaces this plan was asked to consider — plus logistic chests for
      free) and `Modules`; entity-quality row in the shared editor frame;
      paint/copy carries quality. e2e: set a rare `≥` filter on an inserter
      via the picker on both `desktop-chromium` and `mobile-chromium`,
      assert the exported string.
- [ ] **4 — Extended surfaces.** Signal quality in the signal picker +
      constant combinator (stop hardcoding `'normal'`; omit the key when
      normal), combinator condition signals, `recipe_quality` via a quality
      row on the recipe picker, selector-combinator `quality_filter`
      params. Info panel shows signal quality it already receives from
      `constantCombinatorSignals`.
- [ ] **5 — Data-driven tiers (optional, out-of-band).** Exporter dumps
      `data.raw.quality` → `FD.qualities` with built-in fallback; badge
      colors/labels and the picker row become data-driven; mod-added tiers
      work. Needs a data-plane re-dump — coordinate per CLAUDE.md.
- [ ] **6 — Docs + issue sync.** Cross-link from `docs/mobile-controls.md`
      (the picker row is a mobile surface) and `docs/rate-calculator.md`
      (the recorded follow-up); file/close tracking issues per the working
      agreements.

## Risks and edge cases

- **"Any" vs "normal" confusion** is the likeliest UX bug: absent quality
  on a _filter_ means any tier passes; picking Normal `=` blocks everything
  else. The picker row must present these as distinct states, and slice-0
  tests must cover "filter with no quality key stays keyless after edit".
- **Modules getter type change** (slice 0) is the only breaking internal
  API; its three consumers move atomically in that commit.
- **Schema strictness:** nested defs in `blueprintSchema.json` use
  `additionalProperties: false` — any newly-written field must already be
  in the schema (quality/comparator are; verify per surface as slices land,
  since Ajv failures downgrade to load-anyway warnings and would hide it).
- **Packs without the quality mod** (`vanilla-2.0`, `space-exploration`):
  quality strings in blueprints are still valid and must render — that's
  the point of the built-in tier table. Conversely nothing should _require_
  `FD.qualities` to exist (slice 5 is additive).
- **History/undo:** every new setter goes through `m_BP.history` like its
  siblings, so undo of a quality change needs no special casing — but the
  merge-style setters must compare deeply enough that a no-op edit doesn't
  spam history (the logistic setter's cheap-identity-check pattern).
