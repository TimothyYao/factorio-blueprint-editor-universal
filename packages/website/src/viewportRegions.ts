import { Editor, inputMode } from '@fbe/editor'

// Viewport regions (#89 Phase 1): the website side of the layout authority.
//
// The action rail already reserves a *left* band; this module does the same for
// the *top* — the strip occupied by the fixed top DOM chrome (the corner logo
// and the active-project pill). The reservation goes through
// `editor.setViewportInsets({ top })`, which bounds `G.safeArea` — the rect the
// Pixi panels anchor and clamp within — so panels that anchor to the top
// (entity-info, rates) start *below* the chrome instead of being covered by it.
// DOM always renders above the canvas, so reserving the band is the only way a
// canvas panel can win. The canvas itself stays full-bleed: the world renders
// under the chrome and shows through the empty parts of the bands. Measured
// live (ResizeObserver), not hardcoded: the pill's height is styling, the
// logo's is an image.
//
// Mobile-only, like the rail: on desktop the chrome and the top-right panels
// don't meet at normal window widths, and the desktop layout stays untouched
// per the current focus. Each edge has one writer — the rail owns `left`, this
// module owns `top`; `setViewportInsets` merges partials, so they compose.
//
// Follow-up idea (deliberately not built yet): with the top band reserved, the
// rail could *wrap around the corner* in portrait — overflow buttons flowing
// along the band instead of hiding behind the ⋯ sheet. Tracked in #89.
export function initViewportRegions(editor: Editor): void {
    const chrome = ['corner-panel', 'active-project']
        .map(id => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null)

    // Skip the redundant renderer.resize when nothing moved — layout() re-runs
    // on window resizes, where the chrome's bottom edge usually hasn't changed.
    let lastTop = -1
    const layout = (): void => {
        let top = 0
        if (inputMode.mode === 'mobile') {
            for (const el of chrome) {
                const r = el.getBoundingClientRect()
                // A hidden element reports a zero rect — don't reserve for it.
                if (r.height > 0) top = Math.max(top, Math.ceil(r.bottom))
            }
        }
        if (top !== lastTop) {
            lastTop = top
            editor.setViewportInsets({ top })
        }
    }

    layout()
    inputMode.on('change', layout)
    window.addEventListener('resize', layout)
    // The pill's width tracks the active project's name; the logo image loads
    // async. Re-measure when the chrome itself changes size. (Not wired to
    // `fbe:viewportchange` — that event is *caused* by setViewportInsets, and
    // the chrome is position:fixed, unaffected by the canvas resizing.)
    if ('ResizeObserver' in window) {
        const observer = new ResizeObserver(layout)
        for (const el of chrome) observer.observe(el)
    }
}
