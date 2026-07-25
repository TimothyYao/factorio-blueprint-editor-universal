import { describe, it, expect } from 'vitest'
import {
    PackManifestEntry,
    canonicalPackId,
    canonicalPacks,
    packSelectorOptions,
} from './packManifest'

/**
 * Graphics variants (docs/slim-graphics.md): a slim pack is the same game data as
 * its base with smaller textures, so everything that scopes USER STATE keys on
 * the canonical id. These are the framework-free seams of that rule; the wiring
 * (library controller construction, the settings dropdown) is verified by running
 * the app.
 */
const MANIFEST: PackManifestEntry[] = [
    { id: 'vanilla-2.0', label: 'Vanilla 2.0', default: true },
    { id: 'space-age', label: 'Space Age (2.0)' },
    { id: 'vanilla-2.0-slim', variantOf: 'vanilla-2.0', graphics: 'slim' },
    { id: 'space-age-slim', label: 'Space Age (slim)', variantOf: 'space-age', graphics: 'slim' },
]

describe('canonicalPackId', () => {
    it('resolves a variant to its base and leaves base packs alone', () => {
        expect(canonicalPackId(MANIFEST, 'vanilla-2.0-slim')).toBe('vanilla-2.0')
        expect(canonicalPackId(MANIFEST, 'vanilla-2.0')).toBe('vanilla-2.0')
        expect(canonicalPackId(MANIFEST, 'space-age-slim')).toBe('space-age')
    })

    it('treats an unknown id (or no manifest at all) as its own canonical id', () => {
        expect(canonicalPackId(MANIFEST, 'some-modpack')).toBe('some-modpack')
        expect(canonicalPackId([], 'vanilla-2.0-slim')).toBe('vanilla-2.0-slim')
    })
})

describe('canonicalPacks', () => {
    it('collapses variants into their base, keeping the base label', () => {
        expect(canonicalPacks(MANIFEST)).toEqual([
            { id: 'vanilla-2.0', label: 'Vanilla 2.0' },
            { id: 'space-age', label: 'Space Age (2.0)' },
        ])
    })

    it('keeps a canonical id whose base entry is not published', () => {
        expect(canonicalPacks([{ id: 'x-slim', variantOf: 'x', graphics: 'slim' }])).toEqual([
            { id: 'x', label: 'x' },
        ])
    })

    it('lets a base entry that comes after its variant still win the label', () => {
        expect(
            canonicalPacks([
                { id: 'x-slim', variantOf: 'x', graphics: 'slim' },
                { id: 'x', label: 'Ex' },
            ])
        ).toEqual([{ id: 'x', label: 'Ex' }])
    })
})

describe('packSelectorOptions', () => {
    it('orders each base pack immediately before its own variants', () => {
        expect(packSelectorOptions(MANIFEST)).toEqual([
            { id: 'vanilla-2.0', label: 'Vanilla 2.0' },
            // No label in the manifest — synthesized from the base + graphics tier.
            { id: 'vanilla-2.0-slim', label: 'Vanilla 2.0 (slim)' },
            { id: 'space-age', label: 'Space Age (2.0)' },
            { id: 'space-age-slim', label: 'Space Age (slim)' },
        ])
    })

    it('still lists a variant whose base is absent', () => {
        expect(packSelectorOptions([{ id: 'x-slim', variantOf: 'x', graphics: 'slim' }])).toEqual([
            { id: 'x-slim', label: 'x (slim)' },
        ])
    })

    it('is the identity on a manifest with no variants', () => {
        expect(packSelectorOptions([{ id: 'a', label: 'A' }, { id: 'b' }])).toEqual([
            { id: 'a', label: 'A' },
            { id: 'b', label: 'b' },
        ])
    })
})
