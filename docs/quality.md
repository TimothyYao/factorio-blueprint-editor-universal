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

Quality-module first-roll chance is `effect.quality × next_probability`
(`0.25 × 0.1` = 2.5% for Q3 in 2.0 dumps), then × (1 + 0.3 × module
level), floored to 0.1% — wiki legendary Q3 is **+6.2%**, not 25% or
62.5%. Five of those in an electromagnetic plant is **31%**, not 312.5%.
Rolls then follow the wiki ladder: stay `1−Q`, +1 `Q×0.9`, +2 `Q×0.09`,
+3 `Q×0.009`, legendary tail `Q×0.001`.

## Slices

0. Fidelity — typed writes, no drop
1. Read path — badges / info panel
2. Toggle — `fbe:quality`
3. Write path — pickers, entity row, pipette
4. Signals / combinators / `recipe_quality` / selector params
5. Rate calculator
6. Data-driven `FD.qualities` (data plane dump)
7. This doc + `rate-calculator.md` cross-link
