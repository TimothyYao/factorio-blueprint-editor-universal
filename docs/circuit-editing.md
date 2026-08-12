# Circuit editing

How the editor inspects and edits the **logical** side of wires — combinator
conditions, enable/disable conditions, constant-combinator signals and read/set
modes — as opposed to the physical red/green/copper wires (which
`WiresPanel` + `PaintWireContainer` already draw). Companion to the tracking
issue **#31**.

## Status

| Area                                                                                                                                                       | State            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Read / inspect** (info panel + combinator overlay)                                                                                                       | ✅ shipped — #36 |
| **Edit** (combinator + enable-condition editors, signal picker, network ids)                                                                               | ✅ shipped — #44 |
| **Train stop** — full 2.0 surface (priority, colour, circuit pane)                                                                                         | ✅ shipped — #92 |
| **Decider 2.0 multi-condition/multi-output** with per-operand red/green network filters                                                                    | ✅ shipped       |
| **Lamp / roboport / display-panel / provider-chest editors**, inserter read mode, chest circuit mode                                                       | ✅ shipped       |
| Selector per-op params; constant multi-section + `is_on` + slots past 18; arithmetic operand networks; display-panel conditional messages (`parameters[]`) | ⏳ deferred      |

> **Historical note (fixed):** this table used to claim the deferred decider
> edited "its primary clause, so nothing is lost". That was wrong — the old
> editor _committed_ 1-element `conditions`/`outputs` arrays, deleting every
> other clause of a multi-clause 2.0 combinator on any edit. The full-form
> editor's working model (`core/deciderClauses.ts`) writes the complete lists
> back on every commit, and `deciderClauses.test.ts` pins that invariant.

## Mod-safety architecture (the load-bearing decision)

The _set_ of configurable `control_behavior` fields per entity **type** is fixed
by the Factorio version (engine), not by mods — mods only add new prototypes of
existing types and new signals/items/fluids. So:

1. **Route off `entity.type`, never a hardcoded name** — `editorKindFor` in
   `UI/editors/factory.ts` switches on `type` for combinators, so any modded
   prototype of those types gets the editor.
2. **Build the signal universe from `FD` at runtime** — items ∪ fluids ∪
   virtual-signals — never hardcode signal names. This is the only genuinely
   dynamic piece.
3. **Post-2.0 only** — `sections`, decider `conditions[]`/`outputs[]`, `wires[]`.

## Reading (core/`Entity`, `EntityInfoPanel`, `OverlayContainer`)

Read-only getters on `Entity` decode `control_behavior`: `combinatorConditions`,
`combinatorConstant`/`combinatorFirstConstant`, `operator`, `circuitCondition`,
`constantCombinatorSignals`, `circuitModeSummary` (read/set-mode flags),
`circuitNetworks`. `EntityInfoPanel.renderCircuitInfo` renders a "Circuit
network" summary; `OverlayContainer` draws the operation glyph + signal icons on
combinator sprites.

## Editing (`UI/`, `UI/editors/`)

Mutators on `Entity` (`arithmeticConditions`, `deciderConditions`,
`constantCombinatorSection`, `circuitCondition`, `circuitEnabled`,
`selectorOperation`, …) clone-mutate-write `control_behavior` through
`history`, so **undo/redo and the blueprint-string round-trip come for free**,
and emit the `controlBehavior` event so the overlay / info panel / open editor
refresh.

Reusable building blocks:

- **`SignalPicker`** (`UI/SignalPicker.ts`) — the data-driven signal chooser:
  items / fluids / virtual-signals tabs, a scrollable masked grid, and a
  confirm-required bottom bar (preview name + ✓ Confirm, matching
  `InventoryDialog`). The item-only `InventoryDialog` can't show fluids/virtuals,
  hence a dedicated dialog. A **✕ None** button clears the slot.
- **`NumericKeypad` / `NumericField`** (`UI/`) — a fully canvas-rendered numeric
  pad. The DOM-overlay `TextInput` was broken on touch/high-DPI (off-screen,
  no keyboard — #56, since fixed); the keypad stays the choice for circuit
  numeric entry — fewer taps than an OS keyboard for small numbers.
- **`SignalSlot`, `Operand`** (signal _or_ signed constant, single slot),
  **`CycleButton`** (tap-to-cycle operators), **`CircuitCondition`** (enable
  checkbox + condition row) — `UI/editors/components/`.
- **`bindSlotGestures`** (`UI/controls/gestures.ts`) — tap activates a slot,
  long-press (or right-click) **clears** it (touch has no right-click). Now the
  contract for **every** slot in the editor, not just the circuit ones — the
  module / filter / quickbar slots were moved onto it (see
  `docs/mobile-controls.md`).
- **`createCircuitNetworkBadges`** — red/green network ids (connected components
  of the wire graph, combinator input/output separate), shown in the info panel
  and at the top of each editor.

Editors: `ArithmeticCombinatorEditor`, `DeciderCombinatorEditor`,
`ConstantCombinatorEditor`, `SelectorCombinatorEditor` and a shared
`CircuitConditionEditor` (pumps/belts); `InserterEditor`/`MiningEditor` embed
the circuit condition via `Editor.addCircuitCondition`.

`DeciderCombinatorEditor` is the **full 2.0 form**: dynamic condition rows
(per-row AND/OR chaining, per-operand red/green **`NetworkToggle`** filters)
and output rows (copy-count networks, or a fixed value via `NumericField`).
The working model is the complete clause lists (`core/deciderClauses.ts` —
framework-free, unit-tested; also lifts a pre-2.0 flat condition into an
editable row), and row add/remove rebuilds the fixed-height dialog
(commit → close → reopen).

The read-mode arc (roboport / display-panel / inserter / logistic chests):

- **`LampEditor`** — static colour (shared `ColorSwatches` row + ✕ reset),
  `always_on`, enable condition, and `use_colors` with its three modes
  (mapping / RGB-component signals / packed-RGB signal; slots show per mode).
- **`RoboportEditor`** — `read_items_mode` (none / logistics / missing
  requests) and `read_robot_stats` + the five stat output signals (nothing
  seeded — absent = the game's built-in default).
- **`DisplayPanelEditor`** — root text (DOM `TextInput`, #56), icon (renders
  on the sprite immediately via the `displayPanel` event), `always_show`,
  `show_in_chart`. The per-condition message list (`parameters[]`) is
  deferred.
- **`InserterEditor`** grew `circuit_read_hand_contents` + the hold/pulse
  cycle. NB the define trap: inserter `hand_read_mode` is hold=0/pulse=1 —
  _opposite_ to the belt's `content_read_mode` — and the info-panel summary
  used the belt mapping for both, reporting inserters inverted (fixed).
- **`ChestEditor`** carries `circuit_mode_of_operation` (send contents / set
  requests / none) for **every** logistic container — providers, which
  request nothing, open a circuit-only editor now instead of none.

`TrainStopEditor` carries the full post-2.0 train-stop surface — see the
paragraph below.

**Validation:** `npm run test:circuits` runs the circuit-arc unit suites
(clause model + every setter file) and the four Playwright specs
(`circuitEditors` / `circuit-editing` / `trainStop` / `clearSlots`) on both
projects — the one command to green before touching any of this.

`TrainStopEditor` carries the full post-2.0 train-stop surface: station name +
manual limit (DOM `TextInput`, #56), **priority** (root-level 0–255,
`NumericField`, 50-the-default omitted from the export like the game does),
the **sign colour** (a preset swatch row + ✕ reset writing root-level `color`;
`EntityContainer` rebuilds the sprite on the `color` event so the tint is
live; reset removes the field = the prototype default) and a circuit pane — the shared enable condition plus the six flags
(`send_to_train` — default ON, only `false` is ever serialized —
`read_from_train`, and the four flag+signal outputs `read_stopped_train` /
`set_trains_limit` / `read_trains_count` / `set_priority`, each seeding the
game's default letter signal T/L/C/P on enable). Serialized shapes pinned in
`core/trainStopSettings.test.ts`; probe-driven e2e in `e2e/trainStop.spec.ts`
(`trainStopControlPos` + `entityTrainStop`).

> **Known debt (#59):** these editors lay out controls with absolute
> coordinates + hardcoded dialog sizes — no shared form-layout system. Fine for
> now (combinator editing isn't the main use case); revisit before the deferred
> multi-condition UIs land.

## Touch

Editing is touch-usable: selection via the full-size `SignalPicker` (the editor
itself stays compact), big tap targets, `pointerdown` handlers, the canvas
keypad (no OS keyboard), and long-press to clear. The base `Dialog` scales the
whole editor to fit a narrow viewport.

Because a long-press is invisible, each editor also carries a dim footer hint
naming the gesture — _"Hold a slot to clear it"_ / _"Right-click a slot to clear
it"_ per input mode. Editors declare they have clearable slots via
`Editor.declareClearableSlots()`; the combinator editors call it directly, and
`addRecipe`/`addModules`/`addFilters`/`addCircuitCondition` call it for you.

## Related tickets

- **#31** — tracking issue / index.
- **#49** — ✅ highlight a hovered entity's circuit network (#60): boxes the
  connected entities (`OverlayContainer.showNetworkHighlight` via
  `WireConnections.getConnectedNetwork`) so the network reads at a glance.
- **#56** — ✅ DOM `TextInput` fixed for touch/high-DPI (the PixiJS-v8
  transform double-scale, inherited `user-select: none`, unitless font-size):
  station name / trains limit now focus and type on a phone; chest counts had
  already moved to `NumericKeypad`. e2e: `e2e/trainStop.spec.ts`.
- **#59** — ad-hoc editor layout / shared form-layout helper.
