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

Opt-in quality row on `InventoryDialog` (Filters, Modules, Recipe) and
`SignalPicker`. Shared entity-quality chips on every editor. Pipette / paint
carries entity quality. Paste-settings still does **not** copy entity quality
(game parity).

## Rates

See `rate-calculator.md`: crafting speed × (1 + 0.3 × entity level); positive
module effects scale the same; beacon `distribution_effectivity` +=
`distribution_effectivity_bonus_per_quality_level` × beacon level.

## Slices

0. Fidelity — typed writes, no drop
1. Read path — badges / info panel
2. Toggle — `fbe:quality`
3. Write path — pickers, entity row, pipette
4. Signals / combinators / `recipe_quality` / selector params
5. Rate calculator
6. Data-driven `FD.qualities` (data plane dump)
7. This doc + `rate-calculator.md` cross-link
