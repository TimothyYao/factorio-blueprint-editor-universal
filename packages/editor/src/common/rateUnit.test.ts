import { describe, it, expect } from 'vitest'
import { formatRate } from '../UI/RatesPanel'
import { ratePeriodLabel } from './rateUnit'

describe('formatRate units', () => {
    it('keeps per-second as /s with thousandths under 10', () => {
        expect(formatRate(0.043, 's')).toBe('0.043/s')
        expect(formatRate(1.5, 's')).toBe('1.5/s')
    })

    it('scales to /m and /h from a per-second value', () => {
        expect(formatRate(0.25, 'm')).toBe('15/m')
        expect(formatRate(0.25, 'h')).toBe('900/h')
    })

    it('labels the entity-info period to match the unit', () => {
        expect(ratePeriodLabel('s')).toBe('Per second')
        expect(ratePeriodLabel('m')).toBe('Per minute')
        expect(ratePeriodLabel('h')).toBe('Per hour')
    })
})
