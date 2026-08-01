import { Container, Sprite } from 'pixi.js'
import G from '../../common/globals'
import { inputMode } from '../../common/input'
import { colors } from '../style'
import F from './functions'

/** Panel */
/**
 * Base Panel for usage whenever a permanent panel shall be shown to the user
 *
 * Per default the panel
 *  + is visible (this.visible = true)
 *  + is interactive (this.eventMode = 'static')
 *  + has interactive children (this.interactiveChildren = true)
 *  + automatically calls 'setPosition()' on Browser Resizing
 *  + does not automatically set its position (hint: override setPosition())
 */
export abstract class Panel extends Container {
    /** Background Graphic */
    private readonly m_Background: Sprite

    private _setPosition: () => void

    /**
     * Constructor
     *
     * @param width - Width of the Control
     * @param height - Height of the Control
     * @param background - Background Color of the Control
     * @param alpha - Background Alpha of the Control (1...no transparency)
     * @param border - Border Width of the Control (0...no border)
     */
    public constructor(
        width: number,
        height: number,
        background: number = colors.controls.panel.background.color,
        alpha: number = colors.controls.panel.background.alpha,
        border: number = colors.controls.panel.background.border
    ) {
        super()

        this.eventMode = 'static'
        this.interactiveChildren = true

        this.m_Background = F.DrawRectangle(width, height, background, alpha, border, false)
        this.addChild(this.m_Background)

        this._setPosition = () => this.setPosition()
        window.addEventListener('resize', this._setPosition)
        // Some panels are mode-dependent (the quickbar hides on mobile; the wires
        // panel re-anchors when it does), so reposition on input-mode changes too.
        inputMode.on('change', this._setPosition)
        // The action rail insets the canvas via renderer.resize (no window 'resize'),
        // so edge-anchored panels must re-anchor on this explicit signal too.
        window.addEventListener('fbe:viewportchange', this._setPosition)

        this.setPosition()
    }

    public destroy(): void {
        window.removeEventListener('resize', this._setPosition)
        window.removeEventListener('fbe:viewportchange', this._setPosition)
        inputMode.off('change', this._setPosition)
        super.destroy({ children: true })
    }

    /**
     * Place the panel's top-left at (x, y) but clamp it so the panel — at its
     * current scale — stays fully within `G.safeArea` (the viewport minus the
     * bands reserved for DOM chrome; the whole screen when nothing is
     * reserved). Lets edge-anchored and centered panels degrade gracefully on
     * narrow (portrait) screens instead of spilling off an edge or sliding
     * under the rail / top chrome.
     */
    protected clampToSafeArea(x: number, y: number): void {
        const sa = G.safeArea
        const w = this.width * this.scale.x
        const h = this.height * this.scale.y
        this.position.set(
            Math.max(sa.x, Math.min(x, sa.x + sa.width - w)),
            Math.max(sa.y, Math.min(y, sa.y + sa.height - h))
        )
    }

    /** Width of the Control */
    public get width(): number {
        return this.m_Background.width
    }

    /** Height of the Control */
    public get height(): number {
        return this.m_Background.height
    }

    /** Called by when the browser is resized */
    protected abstract setPosition(): void
}
