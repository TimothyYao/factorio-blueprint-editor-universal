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

    test('item picker quality places on the ghost without the entity editor', async ({ page }) => {
        await page.goto('/?test&pack=space-age')
        await waitForAppReady(page)

        const ghost = await page.evaluate(() => {
            const w = window as unknown as {
                __FBE_TEST__: QualityHook & {
                    spawnPaintItem: (name: string, quality?: string) => void
                    getState: () => { paint: { quality: string | null; overlayInfoCount: number } }
                }
            }
            w.__FBE_TEST__.spawnPaintItem('assembling-machine-2', 'legendary')
            return w.__FBE_TEST__.getState().paint
        })
        expect(ghost.quality).toBe('legendary')
        expect(ghost.overlayInfoCount).toBeGreaterThan(0)

        await page.evaluate(() => {
            const w = window as unknown as {
                __FBE_TEST__: QualityHook & { confirmPlacement: () => void }
            }
            w.__FBE_TEST__.confirmPlacement()
        })
        expect(
            await page.evaluate(() => {
                const w = window as unknown as { __FBE_TEST__: QualityHook }
                return w.__FBE_TEST__.entityQuality('assembling-machine-2')
            })
        ).toBe('legendary')
        expect(
            await page.evaluate(() => {
                const w = window as unknown as { __FBE_TEST__: QualityHook }
                return w.__FBE_TEST__.serializedEntity('assembling-machine-2')?.quality
            })
        ).toBe('legendary')
    })
})

// User-provided legendary-beacon + electromagnetic-plant blueprint. The
// legendary beacon's supply area is 19×19 (Quality wiki +1 tile/level).
const LEGENDARY_BEACON_BP =
    '0eJytkt1uhCAQhd9lrnHj7yZ62ddoNhvUiSFFsIC2xvjuHdS22+7Sq14pHOacmQ8WqOWIgxHKQbWAaLSyUD0vYEWnuPR7bh4QKjDYCPphoHjv1yixcUb3vFPoRBMNkpPHykCoFt+hStYLA1ROOIG75Z+FDAZt6axWPpPqYwazd2HQCsrelfiwnK9q7Gs0UKUU6LDfE0Tri4+c15FLOhn1uh0lRhlFHFskSuxQtdzMW8e7AdWrq1ATJWgSNsPvVc7AOt68UBMrCyhJUEmDShZU8vXyeoiPumaf91HBYGhA4jP9GNa7HiBq5HSt94Sj+FRskKP0VNxxfpz6i34WpG8HxPa/2CdB9skNe0/L8/KWfuyvh81gQmO3wYpzWuZlSZ+szM40puQ10jOHp5vTbwTCj0SGH5DgDp8='

test.describe('beacon supply area quality', () => {
    test('legendary beacon reports a 19×19 supply area', async ({ page }, testInfo) => {
        await page.goto(`/?test&pack=space-age&source=${encodeURIComponent(LEGENDARY_BEACON_BP)}`)
        await waitForAppReady(page)
        await expect
            .poll(async () => {
                return page.evaluate(() => {
                    const w = window as unknown as {
                        __FBE_TEST__: { getState: () => { blueprint: { entityCount: number } } }
                    }
                    return w.__FBE_TEST__.getState().blueprint.entityCount
                })
            })
            .toBeGreaterThan(0)

        const lines = await page.evaluate(() => {
            const w = window as unknown as {
                __FBE_TEST__: { entityInfoLines: (name: string) => string[] | null }
            }
            return w.__FBE_TEST__.entityInfoLines('beacon')
        })
        expect(lines).toContain('Supply area: 19×19')

        await page.evaluate(() => {
            const w = window as unknown as {
                __FBE_TEST__: {
                    centerView: () => void
                    zoom: (zoomIn: boolean) => void
                    hoverEntity: (name: string) => boolean
                }
            }
            w.__FBE_TEST__.centerView()
            for (let i = 0; i < 8; i++) w.__FBE_TEST__.zoom(false)
            w.__FBE_TEST__.hoverEntity('beacon')
        })

        await page.screenshot({
            path: testInfo.outputPath('legendary-beacon-supply-area.png'),
            fullPage: true,
        })
    })
})
