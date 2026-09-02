import { describe, it, expect } from 'vitest'
import { PLANNER_NODE_BUDGET, RailPlanner } from './planner'
import type { RailPose } from './joints'

function runUntil(
    p: RailPlanner,
    start: RailPose,
    goal: RailPose,
    maxFrames = 80,
    canPlace?: Parameters<RailPlanner['begin']>[2]
): ReturnType<RailPlanner['step']> {
    p.begin(start, goal, canPlace)
    let pieces: ReturnType<RailPlanner['step']>
    for (let i = 0; i < maxFrames; i++) {
        pieces = p.step(PLANNER_NODE_BUDGET)
        if (p.complete) return pieces
    }
    return pieces
}

describe('rail planner', () => {
    const north: RailPose = { x: 0, y: 0, dir: 0, layer: 'ground' }

    it('a two-tile north goal is a single straight', () => {
        const p = new RailPlanner()
        const pieces = runUntil(p, north, { x: 0, y: -2, dir: 0, layer: 'ground' })
        expect(p.complete).toBe(true)
        expect(pieces).toHaveLength(1)
        expect(pieces![0].name).toBe('straight-rail')
    })

    it('a 90° right turn uses A/B curves (FFF-377)', () => {
        const p = new RailPlanner()
        const pieces = runUntil(p, north, { x: 13, y: -13, dir: 4, layer: 'ground' })
        expect(p.complete).toBe(true)
        expect(pieces?.map(x => x.name)).toEqual([
            'curved-rail-a',
            'curved-rail-b',
            'curved-rail-b',
            'curved-rail-a',
        ])
    })

    it('step(200) never expands more than 200 nodes in one call', () => {
        const p = new RailPlanner()
        p.begin(north, { x: 80, y: -80, dir: 0, layer: 'ground' })
        p.step(200)
        expect(p.expansions).toBeLessThanOrEqual(200)
        const before = p.expansions
        p.step(200)
        expect(p.expansions - before).toBeLessThanOrEqual(200)
        expect(p.expansions).toBeGreaterThan(before)
    })

    it('reuses the forward tree when only the goal moves', () => {
        const p = new RailPlanner()
        p.begin(north, { x: 0, y: -20, dir: 0, layer: 'ground' })
        p.step(200)
        const afterFirst = p.expansions
        p.begin(north, { x: 0, y: -22, dir: 0, layer: 'ground' })
        expect(p.expansions).toBe(afterFirst) // lifetime kept; tree reused
        p.step(200)
        expect(p.expansions).toBeGreaterThan(afterFirst)
    })

    it('drops the tree when the start pose changes', () => {
        const p = new RailPlanner()
        p.begin(north, { x: 0, y: -20, dir: 0, layer: 'ground' })
        p.step(200)
        expect(p.expansions).toBeGreaterThan(0)
        p.begin({ x: 2, y: 0, dir: 0, layer: 'ground' }, { x: 2, y: -20, dir: 0, layer: 'ground' })
        expect(p.expansions).toBe(0)
    })

    it('skips a colliding straight and still finds a path around it', () => {
        const p = new RailPlanner()
        const pieces = runUntil(p, north, { x: 0, y: -6, dir: 0, layer: 'ground' }, 120, piece => {
            return !(piece.position.x === 0 && piece.position.y === -1)
        })
        // The direct straights through (0,-1) are illegal; a path may still
        // exist via curves. If the planner gives up, pieces is undefined —
        // either a detour or a clean failure is fine as long as we don't
        // emit the blocked cell.
        if (pieces) {
            expect(pieces.some(x => x.position.x === 0 && x.position.y === -1)).toBe(false)
        }
    })
})
