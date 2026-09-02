import { describe, expect, it } from 'vitest'
import { ActionRegistry, isMacPlatform } from './actions'

function key(opts: {
    key: string
    code: string
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
}): KeyboardEvent {
    return opts as KeyboardEvent
}

describe('isMacPlatform', () => {
    it('detects macOS from platform', () => {
        expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true)
        expect(isMacPlatform({ platform: 'MacARM' })).toBe(true)
    })

    it('detects iOS devices that also use Command on a hardware keyboard', () => {
        expect(isMacPlatform({ platform: 'iPhone' })).toBe(true)
        expect(isMacPlatform({ platform: 'iPad' })).toBe(true)
        expect(isMacPlatform({ platform: 'iPod' })).toBe(true)
    })

    it('falls back to userAgent when platform is empty', () => {
        expect(
            isMacPlatform({
                platform: '',
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            })
        ).toBe(true)
    })

    it('is false on Windows and Linux', () => {
        expect(isMacPlatform({ platform: 'Win32', userAgent: 'Windows NT 10.0' })).toBe(false)
        expect(isMacPlatform({ platform: 'Linux x86_64', userAgent: 'X11; Linux x86_64' })).toBe(
            false
        )
    })

    it('is false when navigator is missing', () => {
        expect(isMacPlatform(undefined)).toBe(false)
    })
})

describe('ActionRegistry Command (Meta) chords', () => {
    it('fires undo on Command+Z and not on Control+Z when bound to meta', () => {
        let undo = 0
        const actions = new ActionRegistry({
            undo: {
                trigger: { code: 'KeyZ' },
                modifiers: { meta: true },
                callbacks: {
                    onPress: () => {
                        undo += 1
                        return true
                    },
                },
            },
        })
        actions.pressKey(key({ key: 'z', code: 'KeyZ', ctrlKey: true }))
        expect(undo).toBe(0)
        actions.pressKey(key({ key: 'z', code: 'KeyZ', metaKey: true }))
        expect(undo).toBe(1)
    })

    it('fires redo on Command+Y when bound to meta', () => {
        let redo = 0
        const actions = new ActionRegistry({
            redo: {
                trigger: { code: 'KeyY' },
                modifiers: { meta: true },
                callbacks: {
                    onPress: () => {
                        redo += 1
                        return true
                    },
                },
            },
        })
        actions.pressKey(key({ key: 'y', code: 'KeyY', metaKey: true }))
        expect(redo).toBe(1)
    })

    it('still fires Control+Z when bound to control (non-Mac default)', () => {
        let undo = 0
        const actions = new ActionRegistry({
            undo: {
                trigger: { code: 'KeyZ' },
                modifiers: { control: true },
                callbacks: {
                    onPress: () => {
                        undo += 1
                        return true
                    },
                },
            },
        })
        actions.pressKey(key({ key: 'z', code: 'KeyZ', metaKey: true }))
        expect(undo).toBe(0)
        actions.pressKey(key({ key: 'z', code: 'KeyZ', ctrlKey: true }))
        expect(undo).toBe(1)
    })

    it('serializes Command in the keyCombo string', () => {
        const actions = new ActionRegistry({
            undo: {
                trigger: { code: 'KeyZ' },
                modifiers: { meta: true },
                callbacks: { onPress: () => true },
            },
        })
        expect(actions.get('undo').keyCombo).toBe('Command+KeyZ')
    })

    it('parses Command and Meta when remapping a combo', () => {
        const actions = new ActionRegistry({
            undo: {
                trigger: { code: 'KeyZ' },
                modifiers: { control: true },
                callbacks: { onPress: () => true },
            },
        })
        const action = actions.get('undo')
        action.keyCombo = 'Command+KeyZ'
        expect(action.keyCombo).toBe('Command+KeyZ')
        action.keyCombo = 'Meta+KeyY'
        expect(action.keyCombo).toBe('Command+KeyY')
    })
})
