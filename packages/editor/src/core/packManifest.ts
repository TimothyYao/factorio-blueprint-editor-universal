// The `packs.json` manifest, and the canonical-pack-id rule that graphics
// variants hang off (docs/slim-graphics.md).
//
// Framework-free on purpose: `globals.ts` owns the fetch (and re-exports these),
// while the rules themselves stay unit-testable in the node env.

/**
 * One `packs.json` entry, as far as the app cares. `variantOf`/`graphics` are the
 * additive fields a **graphics variant** carries: a slim pack is the same game
 * data as its base pack with a smaller texture set, so it declares
 * `variantOf: "<base id>"` and (informationally) which tier it ships. Unknown
 * fields are ignored — the manifest of record lives in the data plane.
 */
export interface PackManifestEntry {
    id: string
    label?: string
    /** Base pack this is a graphics-only variant of. Absent on a base pack. */
    variantOf?: string
    /** Graphics tier this entry ships, e.g. `slim`. Absent = full quality. */
    graphics?: string
    artifacts?: string[]
    default?: boolean
}

/**
 * The CANONICAL pack id of `id`: `variantOf ?? id`. This is the id everything
 * that scopes *user state* keys on — the blueprint library's top tier, the
 * per-pack scratchpad / active leaf, cross-pack copy checks — because a graphics
 * variant is the same game data: a blueprint made on `vanilla-2.0` is native to
 * `vanilla-2.0-slim` and vice versa. Only the persisted `DATA_PACK` choice (which
 * textures to fetch) uses the variant id. An id absent from the manifest is its
 * own canonical id, which is also the behaviour with no manifest at all.
 */
export function canonicalPackId(manifest: PackManifestEntry[], id: string): string {
    return manifest.find(p => p.id === id)?.variantOf ?? id
}

/**
 * The manifest collapsed to its canonical packs — one entry per *game data* set,
 * with variants folded into the base they belong to. This is the list to offer
 * anywhere user state is being addressed (the library panel's pack drop-down),
 * as opposed to the settings pane's pack *selector*, which is about which
 * textures to load and therefore lists variants individually.
 *
 * A canonical id takes its label from the base entry when the manifest has one;
 * otherwise from the first variant that references it (a data plane could publish
 * only a slim tier of some pack). Manifest order is preserved.
 */
export function canonicalPacks(manifest: PackManifestEntry[]): { id: string; label: string }[] {
    const out: { id: string; label: string }[] = []
    const index = new Map<string, number>()
    for (const p of manifest) {
        const id = p.variantOf ?? p.id
        const isBase = !p.variantOf
        const existing = index.get(id)
        if (existing === undefined) {
            index.set(id, out.length)
            out.push({ id, label: isBase ? (p.label ?? id) : id })
        } else if (isBase) {
            // A base entry always wins the label over a variant-derived one.
            out[existing].label = p.label ?? id
        }
    }
    return out
}

/**
 * The manifest ordered for the settings pane's pack selector: base packs in
 * manifest order, each immediately followed by its own variants. dat.gui's
 * dropdown has no option groups, so adjacency + a label that names the tier is
 * how variants are "grouped". Variants without a label get one synthesized from
 * their base's label and `graphics` tier (e.g. "Vanilla 2.0 (slim)").
 */
export function packSelectorOptions(
    manifest: PackManifestEntry[]
): { id: string; label: string }[] {
    const label = (p: PackManifestEntry): string => {
        if (p.label) return p.label
        if (!p.variantOf) return p.id
        const base = manifest.find(b => b.id === p.variantOf)
        const baseLabel = base?.label ?? p.variantOf
        return p.graphics ? `${baseLabel} (${p.graphics})` : `${baseLabel} (variant)`
    }
    const out: { id: string; label: string }[] = []
    const emitted = new Set<string>()
    const emit = (p: PackManifestEntry): void => {
        if (emitted.has(p.id)) return
        emitted.add(p.id)
        out.push({ id: p.id, label: label(p) })
    }
    for (const p of manifest) {
        if (p.variantOf) continue
        emit(p)
        for (const v of manifest) if (v.variantOf === p.id) emit(v)
    }
    // Orphan variants (base not in the manifest) still deserve an entry.
    for (const p of manifest) emit(p)
    return out
}
