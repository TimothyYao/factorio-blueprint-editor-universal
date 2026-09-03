import { qualityColorCss } from '@fbe/editor'

/**
 * Wrap an icon element with the same bottom-left diamond overlay the canvas
 * `CreateQualityBadge` draws. Letter prefixes (U/R/E/L) are not used — the
 * diamond is the quality mark everywhere else in the editor.
 */
export function wrapIconWithQuality(icon: HTMLElement, quality?: string): HTMLElement {
    if (!quality || quality === 'normal') return icon
    const wrap = document.createElement('span')
    wrap.className = 'q-icon-wrap'
    const badge = document.createElement('span')
    badge.className = 'q-overlay'
    badge.title = quality
    badge.style.backgroundColor = qualityColorCss(quality)
    wrap.append(icon, badge)
    return wrap
}
