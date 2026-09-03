import { storedQuality } from '../core/quality'

/** One quickbar cell. A plain string is the pre-quality save format. */
export type QuickbarStored = string | { name: string; quality?: string } | null | undefined

export function parseQuickbarSlot(raw: unknown): { name: string; quality?: string } | undefined {
    if (typeof raw === 'string' && raw.length > 0) return { name: raw }
    if (raw && typeof raw === 'object' && typeof (raw as { name?: unknown }).name === 'string') {
        const name = (raw as { name: string }).name
        if (!name) return undefined
        return { name, quality: storedQuality((raw as { quality?: string }).quality) }
    }
    return undefined
}

export function serializeQuickbarSlot(name: string | undefined, quality?: string): QuickbarStored {
    if (!name) return undefined
    const q = storedQuality(quality)
    return q ? { name, quality: q } : name
}
