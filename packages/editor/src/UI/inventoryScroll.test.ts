import { describe, it, expect } from 'vitest'
import { ITEM_PITCH, ITEM_SIZE, isItemTappable, maxItemScroll } from './inventoryScroll'

// The dialog's item viewport: 8 rows of pitch (InventoryDialog.ITEMS_H).
const VIEW_H = 8 * ITEM_PITCH

/** Pixi-bounds height of a grid of `rows` rows: it ends at the last button's
 * bottom edge, so the trailing 2px gap is not part of it. */
const contentHeight = (rows: number): number => rows * ITEM_PITCH - (ITEM_PITCH - ITEM_SIZE)

describe('maxItemScroll', () => {
    it('is 0 when the group fits the viewport', () => {
        expect(maxItemScroll(contentHeight(8), VIEW_H)).toBe(0)
        expect(maxItemScroll(0, VIEW_H)).toBe(0)
    })

    it('is the overflow when the group is taller than the viewport', () => {
        expect(maxItemScroll(contentHeight(12), VIEW_H)).toBe(4 * ITEM_PITCH - 2)
    })
})

describe('isItemTappable', () => {
    it('accepts fully visible rows and rejects the first clipped one (unscrolled)', () => {
        for (let row = 0; row < 8; row++) {
            expect(isItemTappable(row * ITEM_PITCH, 0, VIEW_H)).toBe(true)
        }
        expect(isItemTappable(8 * ITEM_PITCH, 0, VIEW_H)).toBe(false)
    })

    it('keeps the last row tappable at full scroll (regression: unclickable last row)', () => {
        // A group taller than the viewport, scrolled all the way down. Because
        // the content height ends at the last button's edge (no trailing gap),
        // the bottom row lands 2px lower than the unscrolled grid's bottom row —
        // gating on ITEM_PITCH instead of ITEM_SIZE rejected exactly this case.
        const rows = 12
        const scroll = maxItemScroll(contentHeight(rows), VIEW_H)
        const lastRowY = (rows - 1) * ITEM_PITCH
        expect(scroll).toBeGreaterThan(0)
        expect(isItemTappable(lastRowY, scroll, VIEW_H)).toBe(true)
        // ...while rows scrolled off the top are rejected,
        expect(isItemTappable(0, scroll, VIEW_H)).toBe(false)
        // and the topmost partially-clipped row is too.
        expect(isItemTappable(3 * ITEM_PITCH, scroll, VIEW_H)).toBe(false)
    })

    it('rejects rows hanging below the viewport mid-scroll', () => {
        // Mid-scroll the rows stay pitch-aligned, so the 9th visible row starts
        // exactly at the viewport's bottom edge and must not be tappable.
        const scroll = 4 * ITEM_PITCH
        expect(isItemTappable(scroll + VIEW_H, scroll, VIEW_H)).toBe(false)
        expect(isItemTappable(scroll + 7 * ITEM_PITCH, scroll, VIEW_H)).toBe(true)
    })
})
