import { describe, it, expect } from 'vitest'
import {
    cycleHeading,
    headingFromDelta,
    jointsOf,
    poseKey,
    reversePose,
    snapIdlePose,
    snapToRails,
    successors,
    type RailPose,
} from './joints'

const originNorth = (): RailPose => ({ x: 0, y: 0, dir: 0, layer: 'ground' })

describe('rail joints', () => {
    it('a cardinal straight steps two tiles and keeps heading', () => {
        const next = successors(originNorth()).filter(s => s.move === 'straight')
        expect(next).toHaveLength(1)
        expect(next[0].pose).toEqual({ x: 0, y: -2, dir: 0, layer: 'ground' })
        expect(next[0].pieces[0].name).toBe('straight-rail')
        expect(next[0].pieces[0].direction).toBe(0)
    })

    it('left and right from north are curved-A with mirrored X', () => {
        const from = originNorth()
        const right = successors(from).find(s => s.move === 'right')
        const left = successors(from).find(s => s.move === 'left')
        expect(right?.pieces[0].name).toBe('curved-rail-a')
        expect(left?.pieces[0].name).toBe('curved-rail-a')
        expect(right?.pose).toEqual({ x: 1, y: -5, dir: 1, layer: 'ground' })
        expect(left?.pose).toEqual({ x: -1, y: -5, dir: 15, layer: 'ground' })
    })

    it('half-diagonal from heading 1 steps (2,-4)', () => {
        const from: RailPose = { x: 0, y: 0, dir: 1, layer: 'ground' }
        const straight = successors(from).find(s => s.move === 'straight')
        expect(straight?.pieces[0].name).toBe('half-diagonal-rail')
        expect(straight?.pose).toEqual({ x: 2, y: -4, dir: 1, layer: 'ground' })
    })

    it('a 90° right turn is A, B, B, A (FFF-377 control points)', () => {
        let pose: RailPose = originNorth()
        const names: string[] = []
        const expected = [
            { x: 1, y: -5, dir: 1 },
            { x: 4, y: -9, dir: 2 },
            { x: 8, y: -12, dir: 3 },
            { x: 13, y: -13, dir: 4 },
        ]
        for (const want of expected) {
            const right = successors(pose).find(s => s.move === 'right')
            expect(right, `no right from ${poseKey(pose)}`).toBeDefined()
            names.push(right!.pieces[0].name)
            pose = right!.pose
            expect(pose).toMatchObject(want)
        }
        expect(names).toEqual(['curved-rail-a', 'curved-rail-b', 'curved-rail-b', 'curved-rail-a'])
    })

    it('every successor’s outgoing joint is the next piece’s incoming joint', () => {
        const from = originNorth()
        for (const s of successors(from)) {
            const piece = s.pieces[0]
            const joints = jointsOf(piece)
            const incoming = joints.find(j => j.dir === (from.dir + 8) % 16)
            expect(incoming, `incoming joint of ${piece.name}`).toBeDefined()
            expect(incoming!.x).toBe(from.x)
            expect(incoming!.y).toBe(from.y)
            const outgoing = joints.find(j => j.dir === s.pose.dir)
            expect(outgoing).toBeDefined()
            expect(outgoing!.x).toBe(s.pose.x)
            expect(outgoing!.y).toBe(s.pose.y)
        }
    })

    it('each ground pose has exactly three moves (straight/left/right)', () => {
        for (const dir of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
            const s = successors({ x: 0, y: 0, dir, layer: 'ground' })
            const moves = new Set(s.map(x => x.move))
            expect(moves, `dir ${dir}`).toEqual(new Set(['straight', 'left', 'right']))
            expect(s, `dir ${dir} count`).toHaveLength(3)
        }
    })

    it('reversePose meets FFF-113 (same tile, opposite heading)', () => {
        const p: RailPose = { x: 3, y: -4, dir: 2, layer: 'ground' }
        expect(reversePose(p)).toEqual({ x: 3, y: -4, dir: 10, layer: 'ground' })
        expect(reversePose(reversePose(p))).toEqual(p)
    })

    it('cycleHeading walks 8-way even dirs', () => {
        expect(cycleHeading(0)).toBe(2)
        expect(cycleHeading(0, true)).toBe(14)
        expect(cycleHeading(14)).toBe(0)
    })

    it('headingFromDelta is 16-way with 0 = north, y-down', () => {
        expect(headingFromDelta(0, -2)).toBe(0)
        expect(headingFromDelta(2, 0)).toBe(4)
        expect(headingFromDelta(0, 2)).toBe(8)
        expect(headingFromDelta(-2, 0)).toBe(12)
    })

    it('snapIdlePose keeps first-rail even/odd parity', () => {
        const p = snapIdlePose({ x: 4.4, y: 5.6 }, 0, { x: 1, y: 1 })
        expect(Math.abs(p.x) % 2).toBe(1)
        expect(p.dir).toBe(0)
        expect(p.layer).toBe('ground')
        // Front joint of a northbound straight sits one tile north of the
        // odd/odd entity center, so y is even.
        expect(Math.abs(p.y) % 2).toBe(0)
    })

    it('canPlace filters colliding pieces', () => {
        const blocked = successors(originNorth(), piece => piece.name !== 'curved-rail-a')
        expect(blocked.every(s => s.pieces[0].name !== 'curved-rail-a')).toBe(true)
        expect(blocked.some(s => s.move === 'straight')).toBe(true)
    })

    it('snapToRails prefers the nearest joint of an existing piece', () => {
        const rail = { name: 'straight-rail', position: { x: 1, y: -1 }, direction: 0 }
        const pose = snapToRails([rail], { x: 0.2, y: 0.1 }, 0)
        // Prefer the joint that already faces north (dir 0), not the nearer
        // south end, so a follow-up plan continues the track.
        expect(pose).toMatchObject({ x: 1, y: -2, dir: 0, layer: 'ground' })
    })
})
