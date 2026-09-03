import EventEmitter from 'eventemitter3'

/**
 * Display unit for production rates. Maths stay per-second; this only scales
 * what the rates panel / entity-info IO row print. Persisted like qualityUi.
 */
export type RateUnit = 's' | 'm' | 'h'

export const RATE_UNITS: readonly RateUnit[] = ['s', 'm', 'h']

export const RATE_UNIT_MUL: Record<RateUnit, number> = { s: 1, m: 60, h: 3600 }

const STORAGE_KEY = 'fbe:rateUnit'

function loadPersisted(): RateUnit | null {
    try {
        const v = localStorage.getItem(STORAGE_KEY)
        if (v === 's' || v === 'm' || v === 'h') return v
        return null
    } catch {
        return null
    }
}

interface RateUnitEvents {
    change: [RateUnit]
}

class RateUnitController extends EventEmitter<RateUnitEvents> {
    private _unit: RateUnit

    public constructor() {
        super()
        this._unit = loadPersisted() ?? 's'
    }

    public get unit(): RateUnit {
        return this._unit
    }

    public set unit(next: RateUnit) {
        if (next === this._unit) return
        this._unit = next
        try {
            localStorage.setItem(STORAGE_KEY, next)
        } catch {
            /* persistence is best-effort */
        }
        this.emit('change', next)
    }

    public get multiplier(): number {
        return RATE_UNIT_MUL[this._unit]
    }

    public cycle(): RateUnit {
        const i = RATE_UNITS.indexOf(this._unit)
        this.unit = RATE_UNITS[(i + 1) % RATE_UNITS.length]
        return this._unit
    }
}

/** Process-wide rate-display unit. Read `.unit` / `.multiplier`, or `'change'`. */
export const rateUnit = new RateUnitController()

export function ratePeriodLabel(unit: RateUnit = rateUnit.unit): string {
    switch (unit) {
        case 'm':
            return 'Per minute'
        case 'h':
            return 'Per hour'
        default:
            return 'Per second'
    }
}
