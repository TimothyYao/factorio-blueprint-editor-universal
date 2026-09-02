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

    test('imports a factoriobin post via /blueprint.txt through the corsproxy fallback', async ({
        page,
    }) => {
        // FactorioBin sends no CORS headers — the browser rejects the direct
        // fetch and the loader retries through /corsproxy (Cloudflare Pages
        // only; the preview server has no proxy, so stub it here). The proxy
        // follows FactorioBin's 302 to cdn.factoriobin.com server-side; we
        // only need to assert the loader builds the right target URL.
        await page.route('https://factoriobin.com/post/CHESTPOST/blueprint.txt', route =>
            route.abort()
        )
        await page.route('**/corsproxy?url=*', route => {
            const target = new URL(route.request().url()).searchParams.get('url')
            expect(target).toBe('https://factoriobin.com/post/CHESTPOST/blueprint.txt')
            return route.fulfill({ status: 200, contentType: 'text/plain', body: CHEST })
        })

        await page.goto(
            `/?test&source=${encodeURIComponent('https://factoriobin.com/post/CHESTPOST')}`
        )
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)
    })

    test('imports a factoriocodex blueprint, picking the current version', async ({ page }) => {
        // The JSON API carries every revision on `versions`; the loader must
        // select the one `current_version` names — v1 here is garbage on
        // purpose, so decoding only succeeds if v2 was picked.
        await page.route('https://www.factoriocodex.com/api/v1/blueprints/777', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    id: 777,
                    current_version: 2,
                    versions: [
                        { version_number: 1, blueprint_string: '0garbage' },
                        { version_number: 2, blueprint_string: CHEST },
                    ],
                }),
            })
        )

        await page.goto(
            `/?test&source=${encodeURIComponent('https://factoriocodex.com/blueprints/777')}`
        )
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)
    })

    test('imports a factorio.school URL via the shared Firebase DB — no proxy involved', async ({
        page,
    }) => {
        // factorio.school /view keys name records in factorioprints' Firebase
        // DB; that endpoint sends CORS headers, so a static deploy can serve
        // school links without ever touching the proxy.
        await page.route(
            'https://facorio-blueprints.firebaseio.com/blueprints/-TESTKEY/blueprintString.json',
            route =>
                route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(CHEST),
                })
        )
        const proxyHits: string[] = []
        page.on('request', req => {
            if (req.url().includes('/corsproxy')) proxyHits.push(req.url())
        })

        await page.goto(
            `/?test&source=${encodeURIComponent('https://www.factorio.school/view/-TESTKEY')}`
        )
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)
        expect(proxyHits).toEqual([])
    })

    test('falls back to the factorio.school API when Firebase has no record', async ({ page }) => {
        // Firebase answers a missing key with 200 + `null` — the loader must
        // then try the school's own API (school-only records exist because the
        // two databases sync periodically, not transactionally).
        await page.route(
            'https://facorio-blueprints.firebaseio.com/blueprints/-SCHOOLONLY/blueprintString.json',
            route => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
        )
        await page.route('https://www.factorio.school/api/blueprint/-SCHOOLONLY', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ blueprintString: { blueprintString: CHEST } }),
            })
        )

        await page.goto(
            `/?test&source=${encodeURIComponent('https://factorio.school/view/-SCHOOLONLY')}`
        )
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)
    })

    test('imports a dropbox share link via dl.dropboxusercontent.com — no proxy involved', async ({
        page,
    }) => {
        // The loader swaps the share-link host for dl.dropboxusercontent.com
        // (same path, rlkey preserved, `dl` dropped) — that host sends CORS
        // headers, so no proxy on a static deploy. Matched via predicate: `?`
        // is a wildcard in route glob patterns, so a query can't be glob-matched.
        const rawHits: string[] = []
        await page.route(
            url => url.hostname === 'dl.dropboxusercontent.com',
            route => {
                rawHits.push(route.request().url())
                return route.fulfill({ status: 200, contentType: 'text/plain', body: CHEST })
            }
        )
        const proxyHits: string[] = []
        page.on('request', req => {
            if (req.url().includes('/corsproxy')) proxyHits.push(req.url())
        })

        await page.goto(
            `/?test&source=${encodeURIComponent(
                'https://www.dropbox.com/scl/fi/abc123/chest.txt?rlkey=r1&dl=0'
            )}`
        )
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)
        expect(proxyHits).toEqual([])
        expect(rawHits).toEqual([
            'https://dl.dropboxusercontent.com/scl/fi/abc123/chest.txt?rlkey=r1',
        ])
    })
})
