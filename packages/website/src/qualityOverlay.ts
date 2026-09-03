import { qualityBadgeDataUrl, qualityColorCss } from '@fbe/editor'

/**
 * Wrap an icon with the same bottom-left quality diamond menus and blueprint
 * overlays use (`CreateQualityBadge` → dump icon via `G.getTexture`). Falls
 * back to a tinted CSS diamond when the atlas hasn't produced a data URL yet
 * (textures still loading, or a pack with no quality icons).
 */
export function wrapIconWithQuality(icon: HTMLElement, quality?: string): HTMLElement {
    if (!quality || quality === 'normal') return icon
    const wrap = document.createElement('span')
    wrap.className = 'q-icon-wrap'
    const badge = document.createElement('span')
    badge.className = 'q-overlay'
    badge.title = quality
    const src = qualityBadgeDataUrl(quality, 12)
    if (src) {
        badge.classList.add('q-overlay-art')
        badge.style.backgroundImage = `url("${src}")`
    } else {
        badge.style.backgroundColor = qualityColorCss(quality)
    }
    wrap.append(icon, badge)
    return wrap
}
