/**
 * Inventory item-grid scroll math, kept free of PixiJS so it can be unit-tested
 * without a renderer (same idea as quickbarLayout.ts). The InventoryDialog lays
 * its 36px item buttons on a 38px pitch (2px gap), clips the grid to an
 * 8-row viewport and scrolls the active group vertically. Pixi masks clip
 * rendering but **not** hit-testing, so the dialog must additionally gate each
 * button's interactivity to the viewport — that gate lives here.
 */

/** Rendered size (px) of an inventory item button. */
export const ITEM_SIZE = 36

/** Grid pitch (px): a button plus the 2px gap to the next one. */
export const ITEM_PITCH = 38

/**
 * How far a group of content height `contentHeight` can scroll within a
 * `viewHeight` viewport (0 when it already fits).
 */
export function maxItemScroll(contentHeight: number, viewHeight: number): number {
    return Math.max(0, contentHeight - viewHeight)
}

/**
 * Whether the button at content-space `itemY` is fully inside the viewport at
 * `scroll` — i.e. should stay tappable. Measured against the button's rendered
 * ITEM_SIZE, *not* the ITEM_PITCH: a group's content height ends at the last
 * button's bottom edge (rows * pitch − gap), so at full scroll the bottom row
 * sits exactly ITEM_SIZE above the viewport's bottom edge. Gating on the pitch
 * demanded the trailing 2px gap fit too, which left that row fully visible but
 * unclickable. The ±1 tolerance absorbs float transform jitter.
 */
export function isItemTappable(itemY: number, scroll: number, viewHeight: number): boolean {
    const top = itemY - scroll
    return top >= -1 && top + ITEM_SIZE <= viewHeight + 1
}
