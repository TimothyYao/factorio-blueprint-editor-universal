import { describe, it, expect, beforeAll } from 'vitest'
import { loadData } from './factorioData'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import type { IEntity } from '../types'
import { havePackData, readPackData } from './packDataFiles'

/**
 * Lamp settings — the post-2.0 write path behind `LampEditor`. Pins the raw
 * serialized shapes: the game omits every default (`always_on` false,
 * `use_colors` false, `color_mode` 0 = colour mapping), so writing an explicit
 * default would diverge from a native export.
 */

const have = havePackData('vanilla-2.0')

const raw = (e: Entity): IEntity => (e as unknown as { m_rawEntity: IEntity }).m_rawEntity

const makeLamp = (data?: Partial<IEntity>): Entity => {
    const bp = new Blueprint()
    return bp.createEntity({
        name: 'small-lamp',
        position: { x: 0.5, y: 0.5 },
        ...data,
    } as IEntity)
}

describe.skipIf(!have)('lamp settings', () => {
    beforeAll(() => loadData(readPackData('vanilla-2.0')))

    it('always_on stores true and clears back to absent', () => {
        const e = makeLamp()
        expect(e.lampAlwaysOn).toBe(false)

        e.lampAlwaysOn = true
        expect(raw(e).always_on).toBe(true)

        e.lampAlwaysOn = false
        expect(raw(e).always_on).toBeUndefined()
    })

    it('use_colors stores true and clears back to absent', () => {
        const e = makeLamp()
        e.lampUseColors = true
        expect(raw(e).control_behavior.use_colors).toBe(true)

        e.lampUseColors = false
        expect(raw(e).control_behavior.use_colors).toBeUndefined()
    })

    it('color_mode omits the colour-mapping default and round-trips the others', () => {
        const e = makeLamp()
        expect(e.lampColorMode).toBe(0)

        e.lampColorMode = 1 // RGB components
        expect(raw(e).control_behavior.color_mode).toBe(1)

        e.lampColorMode = 2 // packed RGB
        expect(raw(e).control_behavior.color_mode).toBe(2)

        e.lampColorMode = 0
        expect(raw(e).control_behavior.color_mode).toBeUndefined()
    })

    it('writes the component and packed signals independently', () => {
        const e = makeLamp()
        e.lampRedSignal = { type: 'virtual', name: 'signal-R' }
        e.lampGreenSignal = { type: 'virtual', name: 'signal-G' }
        e.lampBlueSignal = { type: 'virtual', name: 'signal-B' }
        expect(raw(e).control_behavior.red_signal).toEqual({ type: 'virtual', name: 'signal-R' })
        expect(raw(e).control_behavior.green_signal).toEqual({ type: 'virtual', name: 'signal-G' })
        expect(raw(e).control_behavior.blue_signal).toEqual({ type: 'virtual', name: 'signal-B' })

        e.lampRgbSignal = { type: 'virtual', name: 'signal-white' }
        expect(raw(e).control_behavior.rgb_signal).toEqual({
            type: 'virtual',
            name: 'signal-white',
        })
    })

    it('the static colour reuses the root color path (write + reset)', () => {
        const e = makeLamp()
        e.trainStopColor = { r: 1, g: 0, b: 0, a: 0.5 }
        expect(raw(e).color).toEqual({ r: 1, g: 0, b: 0, a: 0.5 })

        e.trainStopColor = undefined
        expect(raw(e).color).toBeUndefined()
    })

    it('paste settings carries the root-level colour and always_on', () => {
        // Copy-config → paste-config copies control_behavior wholesale, but the
        // colour and always_on live at the entity root — they used to be
        // silently dropped by a paste.
        const bp = new Blueprint()
        const source = bp.createEntity({
            name: 'small-lamp',
            position: { x: 0.5, y: 0.5 },
        } as IEntity)
        const target = bp.createEntity({
            name: 'small-lamp',
            position: { x: 2.5, y: 0.5 },
        } as IEntity)
        source.trainStopColor = { r: 1, g: 0, b: 0, a: 0.5 }
        source.lampAlwaysOn = true
        source.lampUseColors = true

        target.pasteSettings(source)

        expect(raw(target).color).toEqual({ r: 1, g: 0, b: 0, a: 0.5 })
        expect(raw(target).always_on).toBe(true)
        expect(raw(target).control_behavior.use_colors).toBe(true)
    })

    it('the generic enable condition works on a lamp too', () => {
        // The lamp editor embeds the shared CircuitCondition component, which
        // writes through the same entity-agnostic mutators as pumps/belts.
        const e = makeLamp()
        e.circuitEnabled = true
        e.circuitCondition = { comparator: '>', constant: 0 }
        expect(raw(e).control_behavior.circuit_enabled).toBe(true)
        expect(raw(e).control_behavior.circuit_condition).toEqual({ comparator: '>', constant: 0 })
    })
})
