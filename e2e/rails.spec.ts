import { test, expect, type Page } from '@playwright/test'
import { dragOneFinger, panTwoFingers } from './touchGestures'

/**
 * Ground rail planner: the `rail` item uses PaintRailContainer (FFF-113
 * bidirectional A*, 200 nodes/frame) instead of stamping a single piece.
 */

interface RailState {
    paint: {
        active: boolean
        kind: 'entity' | 'blueprint' | 'rail' | null
        railPlan: {
            active: boolean
            pieceCount: number
            complete: boolean
        } | null
    }
    blueprint: { entityCount: number }
}

function getState(page: Page): Promise<RailState> {
    return page.evaluate(() =>
        (
            window as unknown as { __FBE_TEST__: { getState: () => RailState } }
        ).__FBE_TEST__.getState()
    )
}

function viewportPan(page: Page): Promise<{ x: number; y: number; scale: number }> {
    return page.evaluate(() =>
        (
            window as unknown as {
                __FBE_TEST__: { viewportPan: () => { x: number; y: number; scale: number } }
            }
        ).__FBE_TEST__.viewportPan()
    )
}

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

async function spawnRail(page: Page): Promise<void> {
    const ok = await page.evaluate(() =>
        (
            window as unknown as { __FBE_TEST__: { spawnRailCursor: () => boolean } }
        ).__FBE_TEST__.spawnRailCursor()
    )
    expect(ok).toBe(true)
    await expect.poll(async () => (await getState(page)).paint.kind).toBe('rail')
}

const FROM = { x: 240, y: 400 }
const TO = { x: 240, y: 280 }

test.describe('rail planner', () => {
    test('desktop click-drag places a path', async ({ page }) => {
        test.skip(test.info().project.name !== 'desktop-chromium', 'desktop drag')
        await page.goto('/?test')
        await waitForLoaded(page)
        await spawnRail(page)
        expect((await getState(page)).blueprint.entityCount).toBe(0)

        const editor = page.locator('#editor')
        await editor.hover({ position: FROM })
        await page.mouse.down()
        await editor.hover({ position: TO })
        await expect.poll(async () => (await getState(page)).paint.railPlan?.complete).toBe(true)
        await page.mouse.up()

        await expect
            .poll(async () => (await getState(page)).blueprint.entityCount)
            .toBeGreaterThan(0)
    })

    test('mobile drag previews then Place commits', async ({ page }) => {
        test.skip(
            test.info().project.name !== 'mobile-chromium',
            'touch linger-plan runs on the mobile project only'
        )
        await page.goto('/?test')
        await waitForLoaded(page)
        await spawnRail(page)

        const editor = page.locator('#editor')
        await editor.tap({ position: FROM })
        const afterTap = await getState(page)
        // Idle tap stamps one straight (manual building).
        expect(afterTap.blueprint.entityCount).toBeGreaterThanOrEqual(1)
        const before = afterTap.blueprint.entityCount

        await dragOneFinger(page, FROM, TO)
        await expect.poll(async () => (await getState(page)).paint.railPlan?.active).toBe(true)
        expect((await getState(page)).blueprint.entityCount).toBe(before)

        await expect.poll(async () => (await getState(page)).paint.railPlan?.complete).toBe(true)
        await page.locator('#paint-dpad button[title="Place"]').click({ force: true })
        await expect
            .poll(async () => (await getState(page)).blueprint.entityCount)
            .toBeGreaterThan(before)
    })

    test('mobile two-finger pan does not abort a lingering plan', async ({ page }) => {
        test.skip(
            test.info().project.name !== 'mobile-chromium',
            'touch linger-plan runs on the mobile project only'
        )
        await page.goto('/?test')
        await waitForLoaded(page)
        await spawnRail(page)

        const editor = page.locator('#editor')
        await editor.tap({ position: FROM })
        await dragOneFinger(page, FROM, TO)
        await expect.poll(async () => (await getState(page)).paint.railPlan?.active).toBe(true)
        const before = await viewportPan(page)

        await panTwoFingers(page, { x: 160, y: 360 }, { x: 280, y: 360 }, { x: 40, y: 50 })

        await expect.poll(async () => (await getState(page)).paint.railPlan?.active).toBe(true)
        const after = await viewportPan(page)
        expect(after.x !== before.x || after.y !== before.y).toBe(true)
    })
})
