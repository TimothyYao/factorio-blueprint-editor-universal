import { describe, it, expect } from 'vitest'
import FD, { loadData } from './factorioData'
import { havePackData, readPackData } from './packDataFiles'
import { clearSpriteDataCache, getSpriteData } from './spriteDataBuilder'
import { resolveSpriteFilename } from './spriteCensus'
import { entityUsesMirroring } from './flip'

/**
 * Assembling-machine sprite composition. The electromagnetic plant's coils are
 * an always-draw working visualisation gated to the idle state, sitting on top
 * of `idle_animation` (the base pad). Drawing only the idle animation — which
 * `always_draw_idle_animation` used to do, via an early return — left a bare
 * platform. This pins the idle set (and that we don't stack the warm-up /
 * rotate / cool-down poses).
 */
function visibleFiles(name: string, extra: Record<string, unknown> = {}): string[] {
    const parts = getSpriteData({
        dir: 0,
        name,
        position: { x: 0, y: 0 },
        generateConnector: false,
        ...extra,
    } as Parameters<typeof getSpriteData>[0])
    if (!Array.isArray(parts)) return []
    return parts
        .filter(p => p && !p.draw_as_shadow)
        .map(p => resolveSpriteFilename(p, 0))
        .filter((f): f is string => !!f)
}

describe('assembling-machine sprites (space-age)', () => {
    it.skipIf(!havePackData('space-age'))(
        'electromagnetic plant draws the idle coils on the base, not working poses',
        () => {
            clearSpriteDataCache()
            loadData(readPackData('space-age'))

            const files = visibleFiles('electromagnetic-plant')
            expect(
                files.some(f => f.includes('electromagnetic-plant-base.png')),
                `base pad missing; got: ${files.join(', ')}`
            ).toBe(true)
            expect(
                files.some(f => f.includes('electromagnetic-plant-main-warm-up.png')),
                `idle coils missing; got: ${files.join(', ')}`
            ).toBe(true)
            expect(
                files.some(f => f.includes('electromagnetic-plant-main-rotate')),
                `working rotate pose should not be stacked idle; got: ${files.join(', ')}`
            ).toBe(false)
            expect(
                files.some(f => f.includes('electromagnetic-plant-main-cool-down')),
                `cool-down pose should not be stacked idle; got: ${files.join(', ')}`
            ).toBe(false)
            expect(
                files.some(f => f.includes('electromagnetic-plant-lights')),
                `working lights should not draw idle; got: ${files.join(', ')}`
            ).toBe(false)
        }
    )

    it.skipIf(!havePackData('space-age'))(
        'electromagnetic plant fluid recipe draws layered pipe pictures',
        () => {
            clearSpriteDataCache()
            loadData(readPackData('space-age'))

            const files = visibleFiles('electromagnetic-plant', {
                assemblerHasFluidInputs: true,
                assemblerHasFluidOutputs: true,
            })
            expect(
                files.some(f => f.includes('electromagnetic-plant-pipe-')),
                `pipe connections missing on a fluid recipe; got: ${files.join(', ')}`
            ).toBe(true)
        }
    )

    it.skipIf(!havePackData('space-age'))(
        'centrifuge (always_draw_idle_animation, no idle vis) still draws its body',
        () => {
            clearSpriteDataCache()
            loadData(readPackData('space-age'))

            const files = visibleFiles('centrifuge')
            expect(files.some(f => f.includes('centrifuge-A.png'))).toBe(true)
            expect(files.some(f => f.includes('centrifuge-B.png'))).toBe(true)
            expect(files.some(f => f.includes('centrifuge-C.png'))).toBe(true)
            expect(files.some(f => f.includes('centrifuge-') && f.includes('-light'))).toBe(false)
        }
    )

    it.skipIf(!havePackData('space-age'))(
        'cryogenic plant always-draw glass overlay is included; recipe-tint masks are not',
        () => {
            clearSpriteDataCache()
            loadData(readPackData('space-age'))

            const files = visibleFiles('cryogenic-plant')
            expect(
                files.some(f => f.includes('cryogenic-plant-glass.png')),
                `glass overlay missing; got: ${files.join(', ')}`
            ).toBe(true)
            expect(
                files.some(f => f.includes('-mask')),
                `recipe-tint masks should stay off without a recipe tint; got: ${files.join(', ')}`
            ).toBe(false)
        }
    )

    it.skipIf(!havePackData('space-age'))(
        'mirrored recycler draws the dedicated flipped-N sheet, not a scaled north sprite',
        () => {
            clearSpriteDataCache()
            loadData(readPackData('space-age'))

            const files = visibleFiles('recycler', { mirror: true })
            expect(
                files.some(f => f.includes('recycler-flipped-N.png')),
                `flipped sheet missing; got: ${files.join(', ')}`
            ).toBe(true)
            expect(
                files.some(f => /recycler-N\.png$/.test(f)),
                `unflipped north sheet should not draw when mirrored; got: ${files.join(', ')}`
            ).toBe(false)
        }
    )

    it.skipIf(!havePackData('space-age'))(
        'mirrored chemical plant geometrically flips sprite shift (no flipped sheet)',
        () => {
            clearSpriteDataCache()
            loadData(readPackData('space-age'))

            const bag = {
                dir: 0,
                name: 'chemical-plant',
                position: { x: 0, y: 0 },
                generateConnector: false,
            }
            const plain = getSpriteData(bag as Parameters<typeof getSpriteData>[0])
            const flipped = getSpriteData({
                ...bag,
                mirror: true,
            } as Parameters<typeof getSpriteData>[0])
            expect(Array.isArray(plain) && Array.isArray(flipped)).toBe(true)
            const p0 = (
                plain as unknown as { shift?: number[]; scale?: unknown; flipX?: boolean }[]
            )[0]
            const f0 = (
                flipped as unknown as { shift?: number[]; scale?: unknown; flipX?: boolean }[]
            )[0]
            expect(p0?.shift && f0?.shift).toBeTruthy()
            expect(f0.shift[0]).toBeCloseTo(-p0.shift[0])
            expect(f0.shift[1]).toBeCloseTo(p0.shift[1])
            expect(f0.flipX).toBe(true)
            expect(p0.flipX).toBeFalsy()
            expect(f0.scale).toBe(p0.scale)
        }
    )

    it.skipIf(!havePackData('space-age'))(
        'space-age mirrorable set: recycler + fluid buildings, not belts/pipes',
        () => {
            clearSpriteDataCache()
            loadData(readPackData('space-age'))
            const names = Object.values(FD.entities)
                .filter(e => entityUsesMirroring(e))
                .map(e => e.name)
            for (const n of [
                'recycler',
                'chemical-plant',
                'oil-refinery',
                'foundry',
                'biochamber',
                'cryogenic-plant',
                'electromagnetic-plant',
                'boiler',
                'heat-exchanger',
                'fusion-generator',
                'fusion-reactor',
            ]) {
                expect(names, `expected ${n} to be mirrorable`).toContain(n)
            }
            for (const n of ['pipe', 'pumpjack', 'transport-belt', 'inserter', 'steam-engine']) {
                expect(names, `expected ${n} not to use sprite mirroring`).not.toContain(n)
            }
        }
    )
})

function visibleFilesAt(name: string, dir: number): string[] {
    const parts = getSpriteData({
        dir,
        name,
        position: { x: 0, y: 0 },
        generateConnector: false,
    } as Parameters<typeof getSpriteData>[0])
    if (!Array.isArray(parts)) return []
    return parts
        .filter(p => p && !p.draw_as_shadow)
        .map(p => resolveSpriteFilename(p, dir))
        .filter((f): f is string => !!f)
}

describe('directional sprites (space-age)', () => {
    it.skipIf(!havePackData('space-age'))(
        'recycler, fusion generator, and fusion reactor change sprites with direction',
        () => {
            clearSpriteDataCache()
            loadData(readPackData('space-age'))

            const recyclerN = visibleFilesAt('recycler', 0)
            const recyclerE = visibleFilesAt('recycler', 4)
            expect(recyclerN.some(f => f.includes('recycler-N.png'))).toBe(true)
            expect(recyclerE.some(f => f.includes('recycler-E.png'))).toBe(true)
            expect(recyclerN).not.toEqual(recyclerE)

            const genN = visibleFilesAt('fusion-generator', 0)
            const genE = visibleFilesAt('fusion-generator', 4)
            expect(genN.some(f => f.includes('/north/'))).toBe(true)
            expect(genE.some(f => f.includes('/east/'))).toBe(true)
            expect(genN).not.toEqual(genE)

            const reactorN = visibleFilesAt('fusion-reactor', 0)
            expect(reactorN.some(f => f.includes('fusion-reactor-main.png'))).toBe(true)
            expect(reactorN.some(f => f.includes('fusion-reactor-connection-'))).toBe(true)
        }
    )
})
