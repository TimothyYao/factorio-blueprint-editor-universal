import { test, expect, type Page } from '@playwright/test'

/**
 * Quality UI (issue #5): the `fbe:quality` toggle hides badges/labels without
 * stripping export data; the entity-quality setter writes the raw key.
 */

const LEGENDARY_ASM =
    '0eJxNzMEOwiAMgOF36RmMEnGBVzHGsNnMJtBNYOpCeHeZXjw1bfp/BXq/4ByJM9gClDGA/bsJeGJMNDFYfVLmaIzu9kp3RglAzpQJE9hz+S3rlZfQYwR7EMAuYLNcShh6TzzK4IY7MUrV2HlKLd7cAu/2v9MC1u+sAh6L801rtccR+ebi2pKIA80bSXFiOaKL8nVH9FAvtX4AJuJCmQ=='

const isMobileProject = (): boolean => test.info().project.name === 'mobile-chromium'

interface QualityHook {
    qualityEnabled: () => boolean
    setQualityEnabled: (enabled: boolean) => void
    entityQuality: (name: string) => string | null
    setEntityQuality: (name: string, quality: string | undefined) => boolean
    entityInfoName: (name: string) => string | null
    serializedEntity: (name: string) => { quality?: string } | null
}

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, {
        timeout: 60_000,
    })
}

test.describe('quality UI', () => {
    test('info-panel name and export honor the quality toggle', async ({ page }) => {
        await page.goto(`/?test&pack=space-age&source=${encodeURIComponent(LEGENDARY_ASM)}`)
        await waitForAppReady(page)

        const nameOn = await page.evaluate(() => {
            const w = window as unknown as { __FBE_TEST__: QualityHook }
            return w.__FBE_TEST__.entityInfoName('assembling-machine-2')
        })
        expect(nameOn).toMatch(/Legendary/)
        expect(
            await page.evaluate(() => {
                const w = window as unknown as { __FBE_TEST__: QualityHook }
                return w.__FBE_TEST__.entityQuality('assembling-machine-2')
            })
        ).toBe('legendary')

        await page.evaluate(() => {
            const w = window as unknown as { __FBE_TEST__: QualityHook }
            w.__FBE_TEST__.setQualityEnabled(false)
        })
        const nameOff = await page.evaluate(() => {
            const w = window as unknown as { __FBE_TEST__: QualityHook }
            return w.__FBE_TEST__.entityInfoName('assembling-machine-2')
        })
        expect(nameOff).not.toMatch(/Legendary/)
        expect(
            await page.evaluate(() => {
                const w = window as unknown as { __FBE_TEST__: QualityHook }
                return w.__FBE_TEST__.serializedEntity('assembling-machine-2')?.quality
            })
        ).toBe('legendary')

        await page.evaluate(() => {
            const w = window as unknown as { __FBE_TEST__: QualityHook }
            w.__FBE_TEST__.setQualityEnabled(true)
            w.__FBE_TEST__.setEntityQuality('assembling-machine-2', 'rare')
        })
        expect(
            await page.evaluate(() => {
                const w = window as unknown as { __FBE_TEST__: QualityHook }
                return w.__FBE_TEST__.entityQuality('assembling-machine-2')
            })
        ).toBe('rare')
        expect(
            await page.evaluate(() => {
                const w = window as unknown as { __FBE_TEST__: QualityHook }
                return w.__FBE_TEST__.entityInfoName('assembling-machine-2')
            })
        ).toMatch(/Rare/)

        // Settings checkbox is present on desktop (dat.gui). Mobile still has the pane.
        if (!isMobileProject()) {
            await expect(page.locator('.dg.main')).toContainText('Quality')
        }
    })
})
