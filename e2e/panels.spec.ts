import { test, expect, type Page } from '@playwright/test'
import type { EditorTestState } from '@fbe/editor'

/**
 * UI coverage for the mobile-layout work:
 *  - the INFO / shortcuts panel (responsive, openable/closable without a keyboard)
 *  - the dat.gui settings pane (touch layout: closes properly, hides Keybinds)
 *  - the quickbar (canvas-rendered, asserted via the `?test` window hook)
 *
 * The quickbar is drawn in the PixiJS canvas, so the DOM has nothing to query;
 * loading with `?test` installs window.__FBE_TEST__, which exposes its logical
 * bounds/scale (see packages/editor/src/common/testHook.ts).
 */

const isMobileProject = (): boolean => test.info().project.name === 'mobile-chromium'

/** Read the opt-in canvas-state probe (only present when the page is loaded with `?test`). */
async function readTestState(page: Page): Promise<EditorTestState> {
    return (await page.evaluate(() => {
        const w = window as unknown as { __FBE_TEST__?: { getState: () => unknown } }
        if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
        return w.__FBE_TEST__.getState()
    })) as EditorTestState
}

/** Wait for the editor to finish booting (settings pane + handlers are wired then). */
async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
    // attached, not visible: a closed pane has zero height (its open/close bar is hidden)
    await page.locator('.dg.main').waitFor({ state: 'attached' })
}

/** Toggle the dat.gui pane via the top-left Settings button. */
async function toggleSettingsPane(page: Page): Promise<void> {
    await page.locator('#settings-button').click()
}

test.describe('INFO / shortcuts panel', () => {
    test('opens from the corner panel and closes with the ✕ (no keyboard needed)', async ({
        page,
    }) => {
        await page.goto('/')
        await waitForAppReady(page)

        const panel = page.locator('#info-panel')
        await expect(panel).not.toHaveClass(/active/)

        // Touch devices have no keyboard, so the corner hint must toggle the panel.
        await page.locator('#corner-panel').click()
        await expect(panel).toHaveClass(/active/)

        await page.locator('#info-panel-close').click()
        await expect(panel).not.toHaveClass(/active/)
    })

    test('fits within the viewport (no portrait overflow)', async ({ page }) => {
        await page.goto('/')
        await waitForAppReady(page)

        await page.locator('#corner-panel').click()
        const panel = page.locator('#info-panel')
        await expect(panel).toHaveClass(/active/)

        const viewport = page.viewportSize()
        const box = await panel.boundingBox()
        expect(box).not.toBeNull()
        // width: min(640px, 90vw) and a bounded, scrollable height keep it on-screen
        expect(box!.width).toBeLessThanOrEqual(viewport!.width)
        expect(box!.height).toBeLessThanOrEqual(viewport!.height)
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.y).toBeGreaterThanOrEqual(0)
    })
})

test.describe('settings pane (dat.gui)', () => {
    test('toggles from the top-left Settings button; no bottom bar over the quickbar', async ({
        page,
    }) => {
        await page.goto('/')
        await waitForAppReady(page)

        // dat.gui's built-in open/close bar (which overlapped the quickbar) is hidden
        await expect(page.locator('.dg.main .close-button')).toBeHidden()

        const inputModeRow = page.locator('.dg li.cr', { hasText: 'Input Mode' })
        const openAtStart = await inputModeRow.isVisible()

        await toggleSettingsPane(page)
        await (openAtStart ? expect(inputModeRow).toBeHidden() : expect(inputModeRow).toBeVisible())

        await toggleSettingsPane(page)
        await (openAtStart ? expect(inputModeRow).toBeVisible() : expect(inputModeRow).toBeHidden())
    })

    test('collapses fully when closed in mobile mode', async ({ page }) => {
        test.skip(!isMobileProject(), 'mobile-only: pane starts closed and uses touch rows')

        await page.goto('/')
        await waitForAppReady(page)

        // mobile mode tags <body> and the pane defaults closed
        await expect(page.locator('body')).toHaveClass(/mobile/)

        // Regression: taller touch rows must not out-rank dat.gui's closed-collapse,
        // otherwise controllers (Input Mode, Debug, …) stay visible when closed.
        // Assert on the row <li> (which collapses to height:0), not its inner
        // label — a clipped child still reports its own bounding box.
        const inputModeRow = page.locator('.dg li.cr', { hasText: 'Input Mode' })
        await expect(inputModeRow).not.toBeVisible()

        // opening the pane (the close button toggles it) reveals the controls
        await toggleSettingsPane(page)
        await expect(inputModeRow).toBeVisible()
    })

    test('hides the keyboard-only Keybinds folder in mobile mode', async ({ page }) => {
        test.skip(!isMobileProject(), 'mobile-only')

        await page.goto('/')
        await waitForAppReady(page)

        // open the pane so visibility reflects our hide, not the closed state
        await toggleSettingsPane(page)

        // a normal folder is shown; the Keybinds folder is hidden
        await expect(
            page.getByText('Oil Outpost Generator Settings', { exact: true })
        ).toBeVisible()
        await expect(page.getByText('Keybinds', { exact: true })).not.toBeVisible()
    })

    test('keeps folders collapsed until tapped in mobile mode', async ({ page }) => {
        test.skip(!isMobileProject(), 'mobile-only')

        await page.goto('/')
        await waitForAppReady(page)
        await toggleSettingsPane(page) // open the pane (folders default collapsed)

        // Regression: the touch row-height override must not leak through a closed
        // folder via the open root <ul>, which left folders stuck expanded.
        const folderRow = page.locator('.dg li.cr', { hasText: 'Pumpjack Modules' })
        await expect(folderRow).not.toBeVisible()

        // tapping the folder title expands it (click the left edge to dodge toasts)
        await page
            .getByText('Oil Outpost Generator Settings', { exact: true })
            .click({ position: { x: 10, y: 5 } })
        await expect(folderRow).toBeVisible()
    })

    test('keeps the Keybinds folder on desktop', async ({ page }) => {
        test.skip(isMobileProject(), 'desktop-only')

        await page.goto('/')
        await waitForAppReady(page)

        await expect(page.locator('body')).not.toHaveClass(/mobile/)
        // desktop pane defaults open, so the folder title is visible
        await expect(page.getByText('Keybinds', { exact: true })).toBeVisible()
    })
})

test.describe('quickbar', () => {
    test('renders on desktop and fits; retired on mobile', async ({ page }) => {
        await page.goto('/?test')
        await waitForAppReady(page)

        const state = await readTestState(page)
        const viewport = page.viewportSize()!

        if (isMobileProject()) {
            // Retired on mobile — touch users build via the action rail's Items
            // (Recents) + Pick instead of a fixed bottom bar.
            expect(state.quickbar.visible).toBe(false)
            return
        }

        // Desktop: rendered full-size, anchored along the bottom, on-screen.
        // (Regression: a NaN scale during super() once left it invisible.)
        expect(state.quickbar.visible).toBe(true)
        expect(state.quickbar.scale).toBe(1)

        const b = state.quickbar.bounds
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width).toBeLessThanOrEqual(viewport.width + 1)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.y).toBeLessThan(viewport.height)
    })
})

test.describe('wires panel', () => {
    test('desktop: fits within the viewport; mobile: retired (wires live in the rail)', async ({
        page,
    }) => {
        await page.goto('/?test')
        await waitForAppReady(page)

        const state = await readTestState(page)
        const viewport = page.viewportSize()!

        if (isMobileProject()) {
            // Retired on mobile (#89): the bottom band belongs to the contextual
            // PAINT/SELECT clusters; the three wires are rail buttons instead
            // (covered in actionToolbar.spec.ts).
            expect(state.wires.visible).toBe(false)
            return
        }

        // Regression: the wires panel was anchored off the right edge of the
        // (now scaled) quickbar via a hardcoded width, so on a narrow viewport
        // it fell entirely off-screen.
        expect(state.wires.visible).toBe(true)
        const b = state.wires.bounds
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width).toBeLessThanOrEqual(viewport.width + 1)
        expect(b.y + b.height).toBeLessThanOrEqual(viewport.height + 1)
    })
})

// A self-contained vanilla-2.0 blueprint (a single wooden chest) so the
// top-band spec has an entity whose info panel it can open.
const CHEST_BP =
    '0eJxtjs0OgjAQhN9lztUgoRD6KsYYfjbapGwJLSohfXcX9ODBy2x2M9/MrmjdTONkOcKssJEGmJ+bwoOmYD3D6DKvi7rWRZ5VVVEquKYlJ+5xc4R4iCTS3UUFs53nAHOWTO7pBXNSCPbGjdt6uBlIyKf3PfGXSemiQBxttPQh92W58jy0NO0J/ziF0QeBth9XSFN21ArLPiUzpTfn9ku6'

test.describe('top band (#89 Phase 1)', () => {
    test('canvas stays full-bleed; on mobile the top-anchored panels clear the chrome', async ({
        page,
    }) => {
        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)

        const pill = await page.locator('#active-project').boundingBox()
        const logo = await page.locator('#corner-panel').boundingBox()
        const canvas = await page.locator('#editor').boundingBox()
        expect(pill).not.toBeNull()
        expect(logo).not.toBeNull()
        expect(canvas).not.toBeNull()

        // The canvas renders full-bleed on every platform — the world shows
        // through the empty parts of the reserved bands ("restrict the panels,
        // not the world"). The reservation lives in G.safeArea, which the Pixi
        // panels anchor within, so the chrome constraint is asserted on the
        // *panel* below, not on the canvas element.
        expect(canvas!.y).toBe(0)
        expect(canvas!.x).toBe(0)

        // The ?source blueprint imports asynchronously after boot — wait for
        // the chest to actually be in the blueprint before selecting it.
        await expect
            .poll(async () => (await readTestState(page)).blueprint.entityCount, {
                timeout: 30_000,
            })
            .toBeGreaterThan(0)

        // Drive the same signal a hover/tap-select produces.
        const shown = await page.evaluate(() => {
            const w = window as unknown as {
                __FBE_TEST__?: { showEntityInfo: (name: string) => boolean }
            }
            return w.__FBE_TEST__.showEntityInfo('wooden-chest')
        })
        expect(shown).toBe(true)
        const sheet = page.locator('#entity-info-sheet')

        if (!isMobileProject()) {
            // Desktop: the Pixi panel presents (top-right of the safe area,
            // which is the whole screen here); the DOM sheet stays out of it.
            expect((await readTestState(page)).infoPanelVisible).toBe(true)
            await expect(sheet).toBeHidden()
            return
        }

        // Mobile: the DOM bottom sheet presents (#89 Phase 2) — the Pixi panel
        // is retired here, and the sheet (bottom-anchored) trivially clears the
        // top chrome; assert both, plus that it stays out of the bottom band
        // where the contextual EDIT bar lives.
        expect((await readTestState(page)).infoPanelVisible).toBe(false)
        await expect(sheet).toBeVisible()
        await expect(sheet).toContainText('Wooden chest')
        const sb = await sheet.boundingBox()
        const viewport = page.viewportSize()!
        expect(sb!.y).toBeGreaterThanOrEqual(pill!.y + pill!.height)
        expect(sb!.y + sb!.height).toBeLessThanOrEqual(viewport.height - 80)
    })
})
