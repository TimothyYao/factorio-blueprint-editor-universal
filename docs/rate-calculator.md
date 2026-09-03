# Rate calculator (production ratio overview)

> Tracking issue: [#87](https://github.com/trisiak/factorio-blueprint-editor/issues/87)
> — its checklist mirrors the backlog below; keep the two in sync.
> Quality multipliers: [`quality.md`](./quality.md) / issue #5.

A blueprint-wide production/consumption readout in the spirit of raiguard's
[RateCalculator](https://mods.factorio.com/mod/RateCalculator) mod: for every
material any machine in the blueprint touches, how much is produced and
consumed per second, so ratio problems ("do 3 cable assemblers feed 2 circuit
assemblers?") are visible at a glance without launching the game.

**Toggle:** the `showRates` action — `T` on desktop, the **Rates** button on
the mobile action rail — or the panel's own ✕ to dismiss (so it can't get
stranded over the blueprint when the toggle is buried in the rail's ⋯
overflow). `/s` `/m` `/h` on the panel (and the mobile drawer) switch the
display unit; the maths stay per-second. The panel pins to the right edge
_below_ the entity info panel's anchor — the top-left belongs to the
website's logo/settings DOM overlay, which a canvas panel would sit
underneath — and updates live while open: entity add/remove, recipe
changes, module changes, undo/redo, and blueprint loads all recompute.

## How it works

The in-game mod reads _live_ engine values — `entity.crafting_speed`,
`entity.productivity_bonus` etc. already include every module/beacon/force
bonus because the engine computed them. A blueprint has no engine, so the
editor reconstructs those bonuses from prototype data:

- **`core/craftingRates.ts`** — the framework-free maths (unit-tested in
  `craftingRates.test.ts`): sums a machine's own module effects with each
  in-range beacon's transmitted effects (2.0 profile falloff via
  `core/beaconEffects.ts`; supply-area semantics where a shared edge is a
  miss), clamps the way the engine does (speed/consumption ≥ −80%,
  productivity ≥ 0), and turns recipe amounts into per-second rates:
  `rate = amount × crafting_speed × (1 + 0.3 × entity quality level) × (1 + speed) / energy_required`,
  products additionally scaled by productivity when the recipe allows it
  (honouring the 2.0 catalyst rule via `core/recipeAmounts.ts`). Positive
  module effects scale by `(1 + 0.3 × module quality level)`; negatives are
  unchanged. Quality-module chance is `effect.quality × next_probability`
  (2.0 dumps store Q3 as `0.25` → 2.5%), then quality-scaled and floored
  to 0.1% (wiki legendary Q3 = +6.2%). Beacon transmission uses
  `distribution_effectivity + distribution_effectivity_bonus_per_quality_level × beacon level`
  (vanilla 1.5 → 2.5 legendary).
- **`UI/RatesPanel.ts`** — the PixiJS panel. Materials are bucketed the way
  the mod presents them: **products** (only produced), **intermediates**
  (produced _and_ consumed — shown as a colored net rate with its breakdown),
  **ingredients** (only consumed). Product/ingredient rows carry one machine
  icon + ×n pair _per machine type_ (largest first, overflow folded into a
  "+k" tail), so a mixed bank never collapses into one merged count — and the
  count can't read as a rate multiplier. A footer counts rated machines and
  calls out machines skipped for lack of a recipe.
- `UI/EntityInfoPanel.ts` consumes the same core functions for its single
  machine readout, so the two views can never disagree.

E2E coverage: `e2e/rates.spec.ts` (desktop keybind + mobile hook, real pack
data). Test seams: `getState().ratesPanelVisible`, `toggleRatesPanel()`,
`ratesPanelLines()` in `common/testHook.ts`.

## Scope (v1) and backlog

In scope now — **crafting machines only** (assembling machines, furnaces,
rocket silos), with modules and beacons. Fluid ingredients/products flow
through the same pipeline as items, so fluid-using recipes (oil processing,
plastic, …) are already covered.

Known limits / deliberate deferrals, roughly in priority order:

- [ ] **Furnaces show as "without recipe".** A blueprint doesn't record a
      furnace's recipe (the game infers it from input). The footer counts them
      honestly; a per-furnace recipe picker in the calculator UI would close
      the gap.
- [ ] **Fluid producers beyond recipes** (secondary per the feature owner):
      boilers (`energy_consumption` ÷ steam Δ-enthalpy), generators
      (`fluid_usage_per_tick`), offshore pumps (`pumping_speed`). All the data
      is in the packs; each is a small additive handler in
      `core/craftingRates.ts`.
- [ ] **Mining drills** — blocked on data: the exporter's dump list
      (`packages/exporter/src/export-data/data-final-fixes.lua`,
      `placeableEntityPrototypes`) doesn't include `resource` prototypes, so no
      `mining_time`/results ship; and the ore under a drill isn't in the
      blueprint anyway (the mod reads the map). Needs a data-plane regen in
      `TimothyYao/factorio-pack-data` plus a per-drill ore choice in the UI.
- [ ] **Electricity / power rates** — explicitly out of scope for now (feature
      owner). Would need an energy-string parser (`"375kW"`, `"1.8MW"` — port
      of `packages/exporter/src/browser/catalog.rs`'s `parse_energy`); note the
      entity info panel's `parseInt(energy_usage.slice(0, -2))` shares this
      gap.
- [ ] **Rocket silo launch overhead** — the silo is rated as a plain crafting
      machine; the launch sequence's dead time isn't modelled.
- [ ] **Selection-scoped calculation** — v1 rates the whole blueprint (most
      blueprints are focused enough that this is the useful default). The
      touch marquee / a copy-mode-style drag could scope it later.
- [ ] **Timescales / belt divisors / multipliers** — per-minute display,
      "how many belts is this", ×N scaling, as in the mod's toolbar.
- [ ] **Machine `allowed_effects` are not enforced** (parity with the entity
      info panel): a machine that disallows e.g. speed effects would still have
      them counted if a blueprint smuggled such modules in.
