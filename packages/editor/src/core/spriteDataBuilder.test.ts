import { describe, it, expect } from 'vitest'
import { loadData } from './factorioData'
import { havePackData, readPackData } from './packDataFiles'
import { clearSpriteDataCache, getSpriteData } from './spriteDataBuilder'
import { resolveSpriteFilename } from './spriteCensus'

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
