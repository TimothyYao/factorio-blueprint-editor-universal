import { test, expect, type Page } from '@playwright/test'

// URL-based blueprint import (`?source=https://…`). The loader tries a plain
// cross-origin fetch first — pastebin's raw endpoint (and most other import
// hosts) send CORS headers nowadays, so this is the path that works on a
// static deploy like GitHub Pages, which has no `/corsproxy` — and falls back
// to the server-side proxy only when the browser blocks the direct fetch.
// Both hops are stubbed with route interception so the suite stays
// deterministic (no live pastebin dependency, and the preview server has no
// proxy to hit anyway).

// A self-contained vanilla-2.0 blueprint string (a wooden chest). Same fixture
// as persistence.spec.ts.
const CHEST =
    '0eJxtjs0OgjAQhN9lztUgoRD6KsYYfjbapGwJLSohfXcX9ODBy2x2M9/MrmjdTONkOcKssJEGmJ+bwoOmYD3D6DKvi7rWRZ5VVVEquKYlJ+5xc4R4iCTS3UUFs53nAHOWTO7pBXNSCPbGjdt6uBlIyKf3PfGXSemiQBxttPQh92W58jy0NO0J/ziF0QeBth9XSFN21ArLPiUzpTfn9ku6'

/** Wait until the editor has finished loading (data + atlas in, loading screen off). */
async function waitForReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

// The opt-in canvas-state probe (present only with `?test`).
type TestHookWindow = { __FBE_TEST__: { getState(): { blueprint: { entityCount: number } } } }
const entityCount = (page: Page): Promise<number> =>
    page.evaluate(
        () => (window as unknown as TestHookWindow).__FBE_TEST__.getState().blueprint.entityCount
    )

test.describe('blueprint import from a URL', () => {
    test('imports a pastebin URL via the direct fetch — no proxy involved', async ({ page }) => {
        await page.route('https://pastebin.com/raw/CHESTBP', route =>
            route.fulfill({ status: 200, contentType: 'text/plain', body: CHEST })
        )
        const proxyHits: string[] = []
        page.on('request', req => {
            if (req.url().includes('/corsproxy')) proxyHits.push(req.url())
        })

        await page.goto(`/?test&source=${encodeURIComponent('https://pastebin.com/CHESTBP')}`)
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)
        expect(proxyHits).toEqual([])
    })

    test('falls back to /corsproxy when the direct fetch is blocked', async ({ page }) => {
        // A blocked cross-origin fetch surfaces as a rejected promise (the CORS
        // failure mode), which is what the loader's fallback keys on.
        await page.route('https://pastebin.com/raw/CHESTBP', route => route.abort())
        await page.route('**/corsproxy?url=*', route =>
            route.fulfill({ status: 200, contentType: 'text/plain', body: CHEST })
        )

        await page.goto(`/?test&source=${encodeURIComponent('https://pastebin.com/CHESTBP')}`)
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)
    })
})
