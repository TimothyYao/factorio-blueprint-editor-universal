import { test, expect, type Page } from '@playwright/test'

/**
 * Alt-mode overlay icons on beacons (module contents), matching the recipe
 * icons assembling machines already get. Vanilla beacons set
 * `module_icons_suppressed` because the 3D visualisations show the modules;
 * we still draw the dark-background overlay so quality is visible and the
 * slots stay readable at a glance.
 *
 * The canvas is PixiJS, so the assertion is the test-hook child count plus a
 * screenshot for visual QA.
 */

// Assembling-machine-2 (recipe + 2 speed modules) and a beacon (2 speed
// modules) — same fixture as clearSlots / rates. The assembler is the
// already-working recipe-icon control; the beacon is the regression.
const BP =
    '0eNq1kl1qwzAQhK9S9lkqsfPTRlcpIcjyJl0qr4y0DjHGdy+yS9K0pVBIn8SI3ZnRhwaofIdtJBYwA5BgA+bTnQJvK/RgwHm0UScfJD0c6CxdRFBwwpgoMJj1ptyuttv1qnxals8LBeQCJzAvAyQ6svXZXvoWwcwpCtg2WdmUsKk88VE31r0Soy5hVEBc4xlMMe4UIAsJ4ew3iX7PXVNhBFP87qSgDYlkKjlANnxcK+inc1QQ0dFUCj06iYHJaUfRdZQfn5vOoVTn9Y+g1CLWugl153GqOo8NQLwnPiFLiP28dlUrBUmsewOzUOBCl4kX424c1X3di1v3Xfb/gqy8IKvQusDfIW1uIN0TQ/GvGIq/YFheMBxsEp1aTyIYf/gyE4vNxOJAPs9ce1IMrFtvBSHHjO/kmB6J'

interface OverlayHook {
    entityOverlayChildCount: (name: string) => number | null
    entityModules: (name: string) => (string | null)[] | null
    entityRecipe: (name: string) => string | null
    centerView: () => void
}

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, {
        timeout: 60_000,
    })
}

test.describe('beacon alt-mode module icons', () => {
    test('beacons draw module icons the same way assemblers draw recipe icons', async ({
        page,
    }, testInfo) => {
        await page.goto(`/?test&pack=space-age&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        await page.evaluate(() => {
            const w = window as unknown as { __FBE_TEST__: OverlayHook }
            w.__FBE_TEST__.centerView()
        })

        const recipe = await page.evaluate(() => {
            const w = window as unknown as { __FBE_TEST__: OverlayHook }
            return w.__FBE_TEST__.entityRecipe('assembling-machine-2')
        })
        expect(recipe).toBeTruthy()

        const beaconModules = await page.evaluate(() => {
            const w = window as unknown as { __FBE_TEST__: OverlayHook }
            return w.__FBE_TEST__.entityModules('beacon')
        })
        expect(beaconModules?.filter(Boolean).length).toBeGreaterThan(0)

        await expect
            .poll(() =>
                page.evaluate(() => {
                    const w = window as unknown as { __FBE_TEST__: OverlayHook }
                    return w.__FBE_TEST__.entityOverlayChildCount('assembling-machine-2')
                })
            )
            .toBeGreaterThan(0)

        await expect
            .poll(() =>
                page.evaluate(() => {
                    const w = window as unknown as { __FBE_TEST__: OverlayHook }
                    return w.__FBE_TEST__.entityOverlayChildCount('beacon')
                })
            )
            .toBeGreaterThan(0)

        const shot = await page.screenshot()
        await testInfo.attach('beacon-module-alt-icons', {
            body: shot,
            contentType: 'image/png',
        })
    })
})
