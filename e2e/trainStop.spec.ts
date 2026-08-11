import { test, expect, type Page, type Locator } from '@playwright/test'

/**
 * Train-stop editor text entry (#56).
 *
 * The station-name and trains-limit fields are DOM `<input>`s overlaid on the
 * canvas (`UI/controls/TextInput.ts`) — the one editor UI that is *not* drawn
 * by PixiJS, because free text needs the OS keyboard. That overlay used to be
 * broken everywhere DPR > 1: the CSS transform double-applied the device pixel
 * ratio (pixi-text-input math predating PixiJS v8's logical `renderer.width`),
 * landing the input off-screen — a tap focused <body>, so no caret and no
 * virtual keyboard — and it inherited `user-select: none` from <html>.
 *
 * These specs guard the fix on both projects: the inputs must sit inside the
 * viewport (the off-screen regression), a real tap/click must focus them, and
 * typed text must round-trip into the blueprint entity (read back through
 * `?test`'s `entityTrainStop`, so it has to have been committed, not merely
 * rendered in the DOM).
 */

const isMobileProject = (): boolean => test.info().project.name === 'mobile-chromium'

// The clearSlots fixture: storage/requester/provider chests + a train stop
// (station "Test stop", no trains limit).
const CHEST_BP =
    '0eNp9ksFuwjAQRH8F7dmpIIQW/B29VRFywkJXMrbr3SCiyP9eOaERFaUna0fjN+OVB2hshyGSE9ADkOAZ9J2mwJoGLWhoLZpYsPXCi/YTWRZHukoXERRcMDJ5B3rzWu6q3W5TlW/rcrtUQK13DPpjAKaTMzaHSB8Q9JSlwJlznlh8NCcsRjQkBeQOeAW9SrUCdEJCOIHGod+77txgBL16glAQPJOMtQa4gl6+bBT045kURPzqkGV/JCsYOXsY22yfUn7iFcyOX+otk6J3RbBG8hpa3+U1rlKd6pTUQ9VyvnZLx/isbHlX9g/SeiYFw0wXLEL0Fzo8B1b/A6sZKNGQK1h8eIRsR0SVFLCYSYf3/BVGe370N6lYxgY='

interface TrainStopHook {
    openEntityEditor: (name: string) => boolean
    entityTrainStop: (name: string) => { station: string; manualTrainsLimit: number | null } | null
}

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

async function openTrainStopEditor(page: Page): Promise<void> {
    const opened = await page.evaluate(() => {
        const w = window as unknown as { __FBE_TEST__?: TrainStopHook }
        if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
        return w.__FBE_TEST__.openEntityEditor('train-stop')
    })
    expect(opened, 'the train-stop editor should open').toBe(true)
}

const readTrainStop = (
    page: Page
): Promise<{ station: string; manualTrainsLimit: number | null } | null> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: TrainStopHook }).__FBE_TEST__.entityTrainStop(
            'train-stop'
        )
    )

/** Tap (mobile project) / click (desktop) the input where it actually renders. */
async function tapInput(page: Page, input: Locator): Promise<void> {
    const box = await input.boundingBox()
    expect(box, 'the input should render on-screen').not.toBeNull()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    if (isMobileProject()) await page.touchscreen.tap(x, y)
    else await page.mouse.click(x, y)
}

// The two fields are told apart by shape: the station name allows 100 chars,
// the trains limit 3 (and is digit-only / numeric-keyboard).
const stationInput = (page: Page): Locator => page.locator('input[maxlength="100"]')
const limitInput = (page: Page): Locator => page.locator('input[maxlength="3"]')

test.describe('train-stop editor text fields', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)
        await openTrainStopEditor(page)
    })

    test('the DOM inputs land inside the viewport, over the dialog', async ({ page }) => {
        // The regression this pins: at DPR > 1 the overlay transform pushed the
        // input below the canvas (top ≈ 1054px on an 839px viewport), so any
        // in-viewport assertion failed the moment the double-scale came back.
        const viewport = page.viewportSize()
        for (const input of [stationInput(page), limitInput(page)]) {
            await expect(input).toBeVisible()
            const box = await input.boundingBox()
            expect(box).not.toBeNull()
            expect(box.x).toBeGreaterThanOrEqual(0)
            expect(box.y).toBeGreaterThanOrEqual(0)
            expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
            expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
        }
    })

    test('the inputs are selectable despite the app-wide user-select: none', async ({ page }) => {
        // <html> sets user-select: none (canvas app); an input inheriting it has
        // no caret — and on some mobile browsers taps won't focus it at all.
        for (const input of [stationInput(page), limitInput(page)]) {
            expect(await input.evaluate(el => getComputedStyle(el).userSelect || 'text')).toBe(
                'text'
            )
        }
    })

    test('tapping the station name focuses it and typing renames the station', async ({ page }) => {
        const input = stationInput(page)
        await expect(input).toHaveValue('Test stop')

        await tapInput(page, input)
        await expect(input, 'a tap on the field must focus it (#56)').toBeFocused()

        // Replace rather than append — the caret lands wherever the tap hit.
        await page.keyboard.press('ControlOrMeta+a')
        await page.keyboard.type('Iron Pickup')

        await expect(input).toHaveValue('Iron Pickup')
        expect((await readTrainStop(page)).station).toBe('Iron Pickup')
    })

    test('the trains-limit field takes digits and requests the numeric keyboard', async ({
        page,
    }) => {
        const input = limitInput(page)
        // `inputmode=numeric` is what pops the digit keyboard on touch.
        await expect(input).toHaveAttribute('inputmode', 'numeric')

        await tapInput(page, input)
        await expect(input).toBeFocused()
        await page.keyboard.type('12')

        await expect(input).toHaveValue('12')
        const state = await readTrainStop(page)
        expect(state.manualTrainsLimit).toBe(12)

        // The digit-restriction still applies: letters must not get through.
        await page.keyboard.type('x')
        await expect(input).toHaveValue('12')
    })
})
