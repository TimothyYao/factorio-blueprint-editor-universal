import { test, expect, type Page } from '@playwright/test'
import { longPressOneFinger } from './touchGestures'

/**
 * Clearing a slot (module / filter / recipe).
 *
 * Desktop has always cleared a slot by right-clicking it, which touch cannot do.
 * There are now two touch-reachable routes to the same action, and this spec
 * guards both plus the desktop path that used to be the only one:
 *
 *  1. **Long-press the slot** — `bindSlotGestures`, now wired into *every* slot
 *     (modules, filters, quickbar) rather than only the circuit ones.
 *  2. **"✕ Clear" in the picker** the slot opens — discoverable, and the only
 *     route that needs no gesture at all.
 *
 * Slots live in the PixiJS canvas, so the DOM has nothing to query: `?test`
 * installs `window.__FBE_TEST__` (packages/editor/src/common/testHook.ts), which
 * opens the editor and reports the slot's on-screen centre to press for real.
 */

// An assembling-machine-2 (recipe + 2 speed modules), a beacon (2 speed modules)
// and a fast-splitter with an iron-plate filter — one of each clearable slot
// kind, pre-filled so a clear has something to remove. Built by hand against the
// 2.0 `items` / `filter` shapes.
const BP =
    '0eNq1kl1qwzAQhK9S9lkqsfPTRlcpIcjyJl0qr4y0DjHGdy+yS9K0pVBIn8SI3ZnRhwaofIdtJBYwA5BgA+bTnQJvK/RgwHm0UScfJD0c6CxdRFBwwpgoMJj1ptyuttv1qnxals8LBeQCJzAvAyQ6svXZXvoWwcwpCtg2WdmUsKk88VE31r0Soy5hVEBc4xlMMe4UIAsJ4ew3iX7PXVNhBFP87qSgDYlkKjlANnxcK+inc1QQ0dFUCj06iYHJaUfRdZQfn5vOoVTn9Y+g1CLWugl153GqOo8NQLwnPiFLiP28dlUrBUmsewOzUOBCl4kX424c1X3di1v3Xfb/gqy8IKvQusDfIW1uIN0TQ/GvGIq/YFheMBxsEp1aTyIYf/gyE4vNxOJAPs9ce1IMrFtvBSHHjO/kmB6J'

const isMobileProject = (): boolean => test.info().project.name === 'mobile-chromium'

type SlotKind = 'modules' | 'filters'

interface ClearHook {
    openEditorSlot: (name: string, kind: SlotKind, index: number) => { x: number; y: number } | null
    inventoryClearButtonPos: () => { x: number; y: number } | null
    entityModules: (name: string) => (string | null)[] | null
    entityFilters: (name: string) => (string | null)[] | null
}

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

/** Canvas offset — the probe returns canvas-relative coords, input needs page coords. */
async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
    const box = await page.locator('#editor').boundingBox()
    return { x: box?.x ?? 0, y: box?.y ?? 0 }
}

// Each probe call is its own inline `page.evaluate` with its own `window` cast:
// the callback is serialized into the browser, so it can't close over a shared
// helper defined here. Same shape the other canvas specs use.

/** Open `entity`'s editor and return slot `index`'s on-screen centre. */
async function openSlot(
    page: Page,
    entity: string,
    kind: SlotKind,
    index: number
): Promise<{ x: number; y: number }> {
    const pos = await page.evaluate(
        args => {
            const w = window as unknown as { __FBE_TEST__?: ClearHook }
            if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
            return w.__FBE_TEST__.openEditorSlot(args.entity, args.kind, args.index)
        },
        { entity, kind, index }
    )
    expect(pos, `${kind} slot ${index} of ${entity} should be locatable`).not.toBeNull()
    return pos
}

const readModules = (page: Page, entity: string): Promise<(string | null)[] | null> =>
    page.evaluate(
        name => (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.entityModules(name),
        entity
    )

const readFilters = (page: Page, entity: string): Promise<(string | null)[] | null> =>
    page.evaluate(
        name => (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.entityFilters(name),
        entity
    )

const readClearButton = (page: Page): Promise<{ x: number; y: number } | null> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.inventoryClearButtonPos()
    )

/**
 * Press-and-hold a slot using whichever input the project actually has. The hold
 * is deliberately much longer than the recognizer's 500 ms — see
 * `longPressOneFinger` for why a short hold degrades into a tap rather than
 * failing outright.
 */
async function holdToClear(page: Page, at: { x: number; y: number }): Promise<void> {
    if (isMobileProject()) {
        await longPressOneFinger(page, at)
        return
    }
    const o = await canvasOrigin(page)
    await page.mouse.move(o.x + at.x, o.y + at.y)
    await page.mouse.down()
    await page.waitForTimeout(1_500)
    await page.mouse.up()
}

/** Quick tap / click — the *activate* half of the same slot gesture. */
async function tap(page: Page, at: { x: number; y: number }): Promise<void> {
    const o = await canvasOrigin(page)
    if (isMobileProject()) await page.touchscreen.tap(o.x + at.x, o.y + at.y)
    else await page.mouse.click(o.x + at.x, o.y + at.y)
}

test.describe('clearing a filled slot', () => {
    test('long-press clears a module slot', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        // Guard the fixture: with an empty slot the clear is a no-op and the test
        // would pass vacuously.
        expect(await readModules(page, 'assembling-machine-2')).toEqual([
            'speed-module',
            'speed-module',
        ])

        const slot = await openSlot(page, 'assembling-machine-2', 'modules', 0)
        await holdToClear(page, slot)

        // Slot 0 emptied, slot 1 untouched — a long-press clears the slot it was
        // on, not the whole grid.
        await expect
            .poll(() => readModules(page, 'assembling-machine-2'))
            .toEqual([null, 'speed-module'])
    })

    test('a long-press that clears does not also open the picker', async ({ page }) => {
        // Activate and clear share one pointerdown: a hold that clears must swallow
        // the tap, or you would clear the slot *and* be left in the item selector.
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const slot = await openSlot(page, 'beacon', 'modules', 0)
        await holdToClear(page, slot)

        await expect.poll(() => readModules(page, 'beacon')).toEqual([null, 'speed-module'])
        // Only the beacon editor is open — no picker stacked on top, so its
        // ✕ Clear probe finds nothing.
        expect(await readClearButton(page)).toBeNull()
    })

    test('the picker offers ✕ Clear for a filled slot, and it empties the slot', async ({
        page,
    }) => {
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const slot = await openSlot(page, 'assembling-machine-2', 'modules', 1)
        await tap(page, slot)

        const clearBtn = await readClearButton(page)
        expect(clearBtn, '✕ Clear should be offered for a filled slot').not.toBeNull()

        await tap(page, clearBtn)
        await expect
            .poll(() => readModules(page, 'assembling-machine-2'))
            .toEqual(['speed-module', null])
    })

    test('an empty module slot opens a picker with no ✕ Clear', async ({ page }) => {
        // Nothing to clear ⇒ no dead button. Clear the slot first, then reopen it.
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const slot = await openSlot(page, 'assembling-machine-2', 'modules', 0)
        await holdToClear(page, slot)
        await expect
            .poll(() => readModules(page, 'assembling-machine-2'))
            .toEqual([null, 'speed-module'])

        await tap(page, slot)
        expect(await readClearButton(page), 'an empty slot has nothing to clear').toBeNull()
    })

    test('right-click still clears a module slot', async ({ page }) => {
        // The desktop path predates the touch work and is what the refactor onto
        // bindSlotGestures could plausibly have broken.
        test.skip(isMobileProject(), 'desktop-only: touch has no right-click')

        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const slot = await openSlot(page, 'assembling-machine-2', 'modules', 0)
        const o = await canvasOrigin(page)
        await page.mouse.click(o.x + slot.x, o.y + slot.y, { button: 'right' })

        await expect
            .poll(() => readModules(page, 'assembling-machine-2'))
            .toEqual([null, 'speed-module'])
    })

    test('clearing a splitter filter empties it instead of throwing', async ({ page }) => {
        // Regression: Entity's splitter setter indexed filters[0] of an array the
        // `filters` setter had already emptied, so clearing the only filter threw a
        // TypeError — leaving the filter in place on desktop and touch alike.
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const errors: string[] = []
        page.on('pageerror', e => errors.push(e.message))

        expect(await readFilters(page, 'fast-splitter')).toEqual(['iron-plate'])

        const slot = await openSlot(page, 'fast-splitter', 'filters', 0)
        await holdToClear(page, slot)

        await expect.poll(() => readFilters(page, 'fast-splitter')).toEqual([])
        expect(errors, 'clearing the filter must not throw').toEqual([])
    })
})
