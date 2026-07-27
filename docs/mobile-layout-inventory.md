# Mobile layout inventory

> **Companion doc:** [`mobile-controls.md`](./mobile-controls.md) (status +
> backlog). The action rail is now **mode-gated** (#33). **Layout-v2 tracking
> issue: #89** — its checklist mirrors this doc's 🔴 entries. Keep this
> inventory current as the layout work lands — see CLAUDE.md "Keep issues in
> sync with the work".

A map of **every element that consumes screen space** in the editor, split by
the two rendering layers (PixiJS on the canvas vs. DOM overlays), with anchors,
sizes, and how they collide on a phone. This is the shared reference we design
the mobile layout against — keep it current as the layout work lands.

**Variants are first-class:** every layout decision is judged against desktop
(mouse/keyboard), **portrait touch** and **landscape touch** — the storyboard
platforms (`e2e/storyboard.spec.ts`: Pixel 7 portrait + landscape, desktop
1280, iPhone SE) are the reference set, with iPhone SE as the small-screen
stress case. Resolution is a **responsive axis, not a design target**: bands
may resize and panels reflow/scroll, but no layout may assume a fixed screen
size. Regenerate the strips with `STORYBOARD=1 npx playwright test
storyboard.spec.ts` — before/after strips are the acceptance artifact for
every layout slice.

Reference viewport for concrete numbers: a Pixel-7-ish **portrait** screen,
**412 × 915 CSS px**.

## Layer 0 — the canvas (base)

- **`#editor`** — `position: fixed`, resized to `window.innerWidth × innerHeight`
  (full viewport), z-index `auto` (0). Everything else floats on top of it, and
  **nothing reserves space away from it** — all chrome overlaps live editing area.

## Layer 1 — Pixi UI (drawn _on_ the canvas, via `UIContainer`)

| Element                                         | Anchor                                  | Intrinsic size              | Scaling / behavior                                                                  | Portrait notes                                                                              |
| ----------------------------------------------- | --------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Quickbar** (`QuickbarPanel`, 2 rows)          | bottom-center (desktop)                 | 442 × 100                   | `fitToWidthScale`; **retired on mobile** (hidden)                                   | **Gone on mobile** — actions live in the rail; slots/keybinds still work, desktop unchanged |
| **Wires panel** (`WiresPanel`)                  | beside the quickbar, else bottom-center | 136 × 62                    | clamp on-screen; **always visible**                                                 | 🔴 Permanently occupies the bottom band in _every_ state; shares it with the d-pads (#89)   |
| **Entity-info** (`EntityInfoPanel`)             | top-right, `y=0`                        | 270 × 270 (grows w/ recipe) | fit + clamp; re-anchors on canvas inset                                             | 🔴 Renders **under** the DOM active-project pill (top-center, z5) — its title is covered    |
| **Rates panel** (`RatesPanel`, #87)             | top-right, below the info panel's spot  | 270 × 400                   | fit + clamp; hardcoded `INFO_PANEL_CLEARANCE = 276` offset                          | Toggled (T / rail "Rates"); another fixed top-right tenant placed by convention, not system |
| **Editors** (machine/inserter/chest/splitter/…) | centered                                | 402–**504** × 171–176       | scale-to-fit + clamp                                                                | Centered modal                                                                              |
| **Inventory** (`InventoryDialog`)               | centered                                | **responsive W** × ~520     | width fits the tabs (capped to screen, ≥404); tab/item **scroll** + **Recents tab** | Touch-usable: long-press preview + Pin/Unpin                                                |
| **Paint ghost icon**                            | follows finger (`globalX+16`)           | small                       | tracks pointer                                                                      | Not edge-anchored                                                                           |
| **Debug** (`DebugContainer`)                    | top-left (≈145, 5)                      | text                        | hidden unless `?debug`                                                              | —                                                                                           |

## Layer 2 — DOM overlays (on top of the canvas)

| Element                                          | Anchor                                          | Size                                         | z-index | Mobile behavior                                                                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------- | -------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action rail** (`#action-toolbar`)              | **left gutter** (below the logo + corner btns)  | 44px flush squares + labels; ⋯ overflow      | 4       | **Mobile only**; reserves a left canvas inset (`setViewportInsets`); **1-col portrait / 3-col landscape**, rest in ⋯. **Mode-gated** (#33): only buttons live in the current mode show                                                  |
| **Paint d-pad** (`#paint-dpad`)                  | **bottom-center** (the freed quickbar band)     | 3×3 grid of 52px buttons (▲◀▶▼ + green ✓)  | **21**  | **Mobile + PAINT only**; nudge arrows + Place for steering a held ghost. Above toasts (z20) so they don't swallow its taps; may overlap the (Pixi) wires panel                                                                          |
| **Select d-pad** (`#select-dpad`)                | **bottom-center**, above the select row         | 3×3 grid (▲◀▶▼, empty centre)              | **21**  | **Mobile + SELECT only**; nudges the held selection in place (preserves wiring)                                                                                                                                                         |
| **Select actions** (`#select-actions`)           | **bottom-center** (same band as the d-pads)     | row of 64px buttons (Copy/Cut/Delete/Cancel) | **21**  | **Mobile + SELECT only**; what to do with the box selection (#21). One cluster shown per mode, so these never coexist                                                                                                                   |
| **Edit bar** (`#edit-bar`)                       | **bottom-center** (same band)                   | row of 64px buttons (Select / Edit)          | **21**  | **Mobile + EDIT only**; a tapped entity → promote to selection, or open its editor                                                                                                                                                      |
| **Logo / info** (`#corner-panel`)                | **top-left** (0,0)                              | ~52px logo badge                             | 5       | Tap = info-panel toggle (the "Press I" hint was dropped)                                                                                                                                                                                |
| **Corner buttons** (`#buttons`)                  | **top-left**, under the logo                    | desktop text rows; **mobile 44×44 squares**  | 5       | Github / Settings / **Library** (#50; Discord dropped); **fold into the rail** on mobile (flush dark squares)                                                                                                                           |
| **Active-project pill** (`#active-project`, #50) | **top-center** (`top: 8px, left: 50%`)          | `min(50vw, 360px)` × ~28px                   | 5       | 🔴 **Always visible**; on a 412px screen it spans x≈103–309 while the Pixi entity-info panel spans x≈142–412 at `y=0` — the pill covers the panel's title, and DOM always wins. Nothing signals its footprint to the canvas layer (#89) |
| **Library panel** (`#library-panel`, #50)        | **centered** overlay (like `#info-panel`)       | responsive                                   | 100     | Toggled from the library button / the pill; joins the "centered modals stack by luck" club below                                                                                                                                        |
| **Settings pane** (`.dg.main`)                   | **top-left**, under `#buttons` (ResizeObserver) | 320px desktop / `min(360px,100vw)` mobile    | 5       | Starts **closed** on mobile                                                                                                                                                                                                             |
| **Info panel** (`#info-panel`)                   | **centered**                                    | `min(640px,90vw)` × `≤100dvh−32px`, scrolls  | **100** | Hidden unless toggled; close ✕ top-right                                                                                                                                                                                                |
| **Toasts** (`.toasts-container`)                 | **bottom-right**                                | 320px wide, stacks upward                    | 20      | Same on mobile (transient); container is `pointer-events:none` (toasts themselves stay tappable) so its empty area doesn't eat taps on what's under it                                                                                  |
| **Loading screen** (`#loadingScreen`)            | full-screen                                     | 100vw × 100vh                                | 10      | Boot only                                                                                                                                                                                                                               |

## The competition map (✅ = resolved · 🔴 = live collision, tracked in #89)

**🔴 Top band — re-opened by the library chrome (#50).** The #19 resolution
(actions → left gutter, canvas inset) held until the **active-project pill**
landed top-center: it's a DOM overlay the canvas can't see, sitting exactly on
the Pixi **entity-info** panel's `y=0` top-right anchor in portrait (and over
the inventory dialog's title band when that's open). The original fix — the
buttons moving off the top — is still good; what's missing is the pill's
footprint being _reserved_ (a top inset) rather than squatted.
_(History: "✅ Top band" as of #19; regressed when #50's chrome was added
without an inventory update — exactly the drift this doc warns about.)_

**🔴 Bottom band — the wires panel.** The quickbar retirement removed the big
tenant, but the **wires panel stayed as a permanent always-visible resident**
of the freed band, in every state, sharing it with the PAINT/SELECT d-pads and
action rows (which are modal and deliberate; the wires panel is neither). Its
only job is spawning one of three paint items — an _action_, so it belongs in
the rail. Planned: wires → rail buttons; retire the panel on mobile like the
quickbar (#89). DOM **toasts** (bottom-right) can still pass over the band
briefly, but they're transient.

**✅ Two opposite "action" surfaces.** Resolved by the above — touch actions now
live in one place (the left rail), and the bottom Pixi quickbar is gone.

**🟡 Centered modals stack by luck.** Pixi dialogs/inventory (centered) and the
DOM info-panel (centered, z100) share the middle; they rarely coexist. (Unchanged
— low priority.)

**✅ Inventory group-tab overflow (Space Age).** The tab row + item grid are
**clipped to the dialog** (Pixi masks) and scroll (◀ ▶ tabs / ▲ ▼ items), with
viewport-gated hit-testing. The body width is now **responsive** so the tab scroll
only engages when tabs truly can't fit, and a **Recents tab** + **long-press
preview** (Confirm / Pin-Unpin) make the selector touch-usable.

## Root cause

There is **no layout authority**. The canvas is full-bleed; every DOM overlay is
independently `position: fixed` with hand-picked corners; the Pixi panels
position off `app.screen` with no knowledge of the DOM chrome (or vice-versa).
Nothing carves the viewport into regions, so "don't put X where Y is" is enforced
only by manual coordinates.

The rail (#19) built the fix's first half: `Editor.setViewportInsets` — which
**already accepts all four edges** — shrinks the canvas and re-anchors the Pixi
panels via `fbe:viewportchange`. Only the left edge is used so far; every DOM
element that isn't transient should reserve its band the same way.

## The plan — layout v2 (tracking: #89)

The old "design directions" list is superseded by the phased plan in **#89**
(direction 1, gutters-as-authority, won; direction 2 happened via the quickbar
retirement; direction 3 via the rail's ⋯ overflow). Summary:

1. **Phase 0 — instrument + docs** (this refresh + the storyboard's new states:
   rates, library, PAINT ghost + d-pad, held marquee).
2. **Wires → rail** — the quick win on the bottom band (above).
3. **Phase 1 — generalize the authority**: a website-side region module
   declares the reserved bands per orientation (top bar incl. the pill, left
   rail, bottom band) through `setViewportInsets`; Pixi panels anchor off the
   inset rect. Kills the top-band collision by construction.
4. **Phase 2 — reclassify by role**: actions → rail; status readouts
   (entity-info, rates) → DOM incrementally (portrait bottom sheet / landscape
   side drawer) — unblocked by the data plane's DOM-friendly icon sheet
   (`browser/icons.webp`, 64px cells + `icons.json` rects, CORS `*`); modal
   dialogs stay Pixi, anchored within the inset region.
5. **Phase 3 — DOM icon seam**: icon-id → `background-position` over the
   pack's `icons.webp` (the FIB fork's `IconManager` is the geometry
   reference), glyph fallback; rail first.
6. **Phase 4 — e2e ratchets**: bounds-disjointness assertions via the `?test`
   hook for each resolved collision, so bands can't silently regress again.
