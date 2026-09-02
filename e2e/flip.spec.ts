import { test, expect, type Page } from '@playwright/test'

// Desktop H/V flip (Factorio 2.0 bindings). Shift+F/G used to be the binds
// and *only* flipped a pasted-blueprint ghost — a held entity or hovered
// building was a silent no-op, which is why "flip isn't working" on desktop.
// These drive the paint-ghost and hover paths via the `?test` hook.

interface FlipState {
    paint: { active: boolean; direction: number | null }
    blueprint: { entityCount: number }
    marquee: { count: number; direction: number | null }
}

const getState = (page: Page): Promise<FlipState> =>
    page.evaluate(() =>
        (
            window as unknown as { __FBE_TEST__: { getState: () => FlipState } }
        ).__FBE_TEST__.getState()
    )

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

async function gotoHoldingBelt(page: Page): Promise<void> {
    await page.addInitScript(() => {
        window.localStorage.setItem('quickbarItemNames', JSON.stringify(['transport-belt']))
    })
    await page.goto('/?test')
    await waitForLoaded(page)
    await page.locator('#editor').focus()
    const at = { x: 320, y: 360 }
    await page.mouse.move(at.x, at.y)
    await page.keyboard.press('1')
    await expect.poll(async () => (await getState(page)).paint.active).toBe(true)
}

test.describe('desktop entity flip (H / V)', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'desktop-chromium',
            'desktop keybinds run on the desktop project only'
        )
    })

    test('V flips a north-facing paint ghost to south', async ({ page }) => {
        await gotoHoldingBelt(page)
        expect((await getState(page)).paint.direction).toBe(0)

        await page.keyboard.press('v')
        await expect.poll(async () => (await getState(page)).paint.direction).toBe(8)

        await page.keyboard.press('v')
        await expect.poll(async () => (await getState(page)).paint.direction).toBe(0)
    })

    test('H flips an east-facing paint ghost to west', async ({ page }) => {
        await gotoHoldingBelt(page)
        await page.keyboard.press('r') // 0 → 4 (east)
        await expect.poll(async () => (await getState(page)).paint.direction).toBe(4)

        await page.keyboard.press('h')
        await expect.poll(async () => (await getState(page)).paint.direction).toBe(12)
    })

    test('V flips a placed entity under the cursor', async ({ page }) => {
        await gotoHoldingBelt(page)
        const at = { x: 320, y: 360 }
        await page.mouse.click(at.x, at.y)
        await expect.poll(async () => (await getState(page)).blueprint.entityCount).toBe(1)

        await page.keyboard.press('Escape')
        await page.mouse.move(at.x + 80, at.y + 80)
        await page.mouse.move(at.x, at.y)

        await page.keyboard.press('v')
        // Placed-entity facing isn't on `paint`; re-pipette to read it.
        await page.keyboard.press('q')
        await expect.poll(async () => (await getState(page)).paint.active).toBe(true)
        expect((await getState(page)).paint.direction).toBe(8)
    })
})
