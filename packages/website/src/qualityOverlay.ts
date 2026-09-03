import { qualityBadgeDataUrl, qualityColorCss } from '@fbe/editor'

/**
 * Wrap an icon with the same 16px dump-icon diamond menus and blueprint
 * overlays use. The data URL is the native atlas size (usually 64px); CSS
 * scales it with `image-rendering: pixelated` so it stays as sharp as the
 * Pixi sprite instead of a bilinear 12px extract.
 */
export function wrapIconWithQuality(icon: HTMLElement, quality?: string): HTMLElement {
    if (!quality || quality === 'normal') return icon
    const wrap = document.createElement('span')
    wrap.className = 'q-icon-wrap'
    const badge = document.createElement('span')
    badge.className = 'q-overlay'
    badge.title = quality
    const src = qualityBadgeDataUrl(quality)
    if (src) {
        badge.classList.add('q-overlay-art')
        badge.style.backgroundImage = `url("${src}")`
    } else {
        badge.style.backgroundColor = qualityColorCss(quality)
    }
    wrap.append(icon, badge)
    return wrap
}
