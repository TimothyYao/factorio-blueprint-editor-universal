# Quality support

> Tracking issue: [#5](https://github.com/TimothyYao/factorio-blueprint-editor-universal/issues/5).
> Rate math lives in [`rate-calculator.md`](./rate-calculator.md).

Factorio 2.0 Quality on entities, filters, modules, recipes, and signals.
Grounded on the [Quality wiki](https://wiki.factorio.com/Quality) and
[FFF-375](https://www.factorio.com/blog/post/fff-375).

## Toggle

`qualityUi` (`packages/editor/src/common/qualityUi.ts`) persists `fbe:quality`
(default **on**). Settings → **Quality**. Off hides badges and pickers; it never
strips quality from the blueprint or export.

## Read path

`F.CreateQualityBadge` — dump icon, else a Pixi diamond. Bottom-left on item
icons; entity-corner overlay; info-panel name + diamond. Fluids stay unbadged.
Picker chips are icon-only (no labels) so they fit a phone editor.

## Write path

Opt-in quality row on `InventoryDialog` (Filters, Modules, Recipe, **and
the Items picker** used to place entities). Shared entity-quality chips on
every editor remain. Pick quality in Items, then tap a building — the paint
ghost and a subsequent place carry that tier, so you don't need the recipe
menu just to set quality. Pipette / paint still carry entity quality.
Quickbar slots persist `{ name, quality }` (plain strings stay valid) and
badge the icon. Paste-settings still does **not** copy entity quality
(game parity).

## Rates

See `rate-calculator.md`: crafting speed × (1 + 0.3 × entity level); positive
module effects scale the same; beacon `distribution_effectivity` +=
`distribution_effectivity_bonus_per_quality_level` × beacon level.

Beacon **supply area** grows with the same +1 tile per quality level the
[Quality wiki](https://wiki.factorio.com/Quality) lists for electric poles
(`QualityPrototype::beacon_supply_area_distance_bonus`, default
`clamp(level, 0, 64)`). A vanilla 3×3 / distance-3 beacon is 9×9 at Normal
and 19×19 at Legendary. The hover/paint aura and the rate maths
(`beaconReaches`) share that helper so a machine just outside the Normal
9×9 is counted once the beacon is Rare or better. A pack that dumps
`quality_affects_supply_area_distance: false` keeps the flat wiki 9×9.

## Slices

0. Fidelity — typed writes, no drop
1. Read path — badges / info panel
2. Toggle — `fbe:quality`
3. Write path — pickers, entity row, pipette
4. Signals / combinators / `recipe_quality` / selector params
5. Rate calculator
6. Data-driven `FD.qualities` (data plane dump)
7. This doc + `rate-calculator.md` cross-link
