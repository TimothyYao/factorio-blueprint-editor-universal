import EventEmitter from 'eventemitter3'

/**
 * Whether quality UI is shown. Orthogonal to the data pack — Quality is its
 * own mod and can run on otherwise-vanilla games, so this must not be keyed
 * to space-age. Default on. Turning it off hides pickers and badges; it never
 * strips quality from the blueprint (issue #5 slice 2).
 */
const STORAGE_KEY = 'fbe:quality'

function loadPersisted(): boolean | null {
    try {
        const v = localStorage.getItem(STORAGE_KEY)
        if (v === 'true') return true
        if (v === 'false') return false
        return null
    } catch {
        return null
    }
}

interface QualityUiEvents {
    change: [boolean]
}

class QualityUiController extends EventEmitter<QualityUiEvents> {
    private _enabled: boolean

    public constructor() {
        super()
        this._enabled = loadPersisted() ?? true
    }

    public get enabled(): boolean {
        return this._enabled
    }

    public set enabled(next: boolean) {
        if (next === this._enabled) return
        this._enabled = next
        try {
            localStorage.setItem(STORAGE_KEY, String(next))
        } catch {
            /* persistence is best-effort */
        }
        this.emit('change', next)
    }
}

/** Process-wide quality-UI gate. Read `.enabled`, set it, or listen for `'change'`. */
export const qualityUi = new QualityUiController()
