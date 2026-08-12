import { test, expect, type Page } from '@playwright/test'

// Tile-brush controls on touch: the PAINT d-pad's corners carry Size − / +
// (the keyboard's [ / ] ratchet — the brush was stuck at 2×2 on mobile) and
// Erase (desktop's right-click mine — laid tiles were unremovable on touch),
// shown only while the cursor is a *tile* brush. Tiles render on the <canvas>,
// so these assert against the `?test` state hook (`paint.tileSize`,
// `blueprint.tileCount`). See docs/mobile-controls.md.

interface TilesState {
    paint: {
        active: boolean
        visible: boolean
        tile: { x: number; y: number } | null
        /** Non-null exactly while a tile brush is held. */
        tileSize: number | null
    }
    blueprint: { entityCount: number; tileCount: number }
}

function getState(page: Page): Promise<TilesState> {
    return page.evaluate(() =>
        (
            window as unknown as { __FBE_TEST__: { getState: () => TilesState } }
        ).__FBE_TEST__.getState()
    )
}

const tileCount = async (page: Page): Promise<number> => (await getState(page)).blueprint.tileCount

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

// Boot in mobile mode with items seeded into the quickbar (loaded from
// localStorage on boot); pressing a slot key picks one up (enters paint).
// Slot 1 = landfill (the tile brush under test), slot 2 = a plain entity for
// the gating comparison.
async function gotoWithQuickbar(page: Page): Promise<void> {
    await page.addInitScript(() => {
        window.localStorage.setItem(
            'quickbarItemNames',
            JSON.stringify(['landfill', 'transport-belt'])
        )
    })
    await page.goto('/?test')
    await waitForLoaded(page)
    await page.locator('#editor').focus()
}

async function holdSlot(page: Page, slot: '1' | '2'): Promise<void> {
    await page.keyboard.press(slot)
    await expect.poll(async () => (await getState(page)).paint.active).toBe(true)
}

// Two clearly-separated points in the open canvas (away from the top chrome,
// the left rail and the bottom d-pad) — far enough apart that two 2×2 brush
// footprints can't overlap.
const TILE_A = { x: 180, y: 480 }
const TILE_B = { x: 340, y: 620 }

// The d-pad's geometry is fixed/unobstructed, but the actionability wait is
// flaky under parallel render-loop contention (see actionToolbar.spec), so
// d-pad taps force-click like touchPlacement's Place test does.
const dpad = (page: Page, title: string) => page.locator(`#paint-dpad button[title="${title}"]`)

test.describe('touch tile brush (size + erase)', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'mobile-chromium',
            'the tile d-pad controls exist on the mobile project only'
        )
    })

    test('Size and Erase show for a tile brush only — and re-gate on a live cursor swap', async ({
        page,
    }) => {
        await gotoWithQuickbar(page)

        // Entity brush: the d-pad shows, but the tile-only corners are gated off.
        await holdSlot(page, '2')
        await expect(page.locator('#paint-dpad')).toHaveClass(/visible/)
        await expect(dpad(page, 'Size +')).toBeHidden()
        await expect(dpad(page, 'Size -')).toBeHidden()
        await expect(dpad(page, 'Erase')).toBeHidden()
        expect((await getState(page)).paint.tileSize).toBeNull()

        // Swap to the tile brush without leaving PAINT (spawnPaintContainer
        // re-emits the mode) — the corners must appear live.
        await holdSlot(page, '1')
        await expect(dpad(page, 'Size +')).toBeVisible()
        await expect(dpad(page, 'Size -')).toBeVisible()
        await expect(dpad(page, 'Erase')).toBeVisible()
        expect((await getState(page)).paint.tileSize).toBe(2)
    })

    test('Size + grows the brush; placing paints the larger square', async ({ page }) => {
        await gotoWithQuickbar(page)
        await holdSlot(page, '1')

        // Position/preview the ghost (first tap never commits).
        await page.locator('#editor').tap({ position: TILE_A })
        expect(await tileCount(page)).toBe(0)

        await dpad(page, 'Size +').click({ force: true })
        await expect.poll(async () => (await getState(page)).paint.tileSize).toBe(3)

        await dpad(page, 'Place').click({ force: true })
        await expect.poll(() => tileCount(page)).toBe(9)
        expect((await getState(page)).blueprint.entityCount).toBe(0) // tiles aren't entities
    })

    test('Size - shrinks the brush down to a single tile', async ({ page }) => {
        await gotoWithQuickbar(page)
        await holdSlot(page, '1')
        await page.locator('#editor').tap({ position: TILE_A })

        await dpad(page, 'Size -').click({ force: true })
        await expect.poll(async () => (await getState(page)).paint.tileSize).toBe(1)
        // The ratchet clamps at 1 — another tap must not underflow.
        await dpad(page, 'Size -').click({ force: true })
        await expect.poll(async () => (await getState(page)).paint.tileSize).toBe(1)

        await dpad(page, 'Place').click({ force: true })
        await expect.poll(() => tileCount(page)).toBe(1)
    })

    test('Erase removes the tiles under the ghost footprint — and only those', async ({ page }) => {
        test.slow() // several sequential taps against one render loop

        await gotoWithQuickbar(page)
        await holdSlot(page, '1')

        // Place a 2×2 patch at A (tap to position, tap again to commit).
        await page.locator('#editor').tap({ position: TILE_A })
        await page.locator('#editor').tap({ position: TILE_A })
        await expect.poll(() => tileCount(page)).toBe(4)

        // Move the preview elsewhere: erasing there hits nothing — the eraser
        // only clears the brush footprint, not the whole blueprint.
        await page.locator('#editor').tap({ position: TILE_B })
        await dpad(page, 'Erase').click({ force: true })
        expect(await tileCount(page)).toBe(4)

        // Back over the patch: Erase collects it, and the brush stays in hand.
        await page.locator('#editor').tap({ position: TILE_A })
        await dpad(page, 'Erase').click({ force: true })
        await expect.poll(() => tileCount(page)).toBe(0)
        expect((await getState(page)).paint.active).toBe(true)
    })
})
