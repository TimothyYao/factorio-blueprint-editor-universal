import { existsSync, readFileSync } from 'fs'

/**
 * Test-only access to the exporter's per-pack data.json files. data/output is
 * no longer committed — the data plane (trisiak/factorio-pack-data) serves it —
 * so data-driven suites gate themselves on `havePackData` and self-skip on a
 * fresh clone. CI fetches the JSON tiers before vitest (see ci.yml), so the
 * ratchets/audits always run there; locally, run the exporter or curl the
 * data.json tiers into place to re-enable them.
 */
export const packDataPath = (pack: string): string =>
    `packages/exporter/data/output/${pack}/data.json`

export const havePackData = (pack: string): boolean => existsSync(packDataPath(pack))

export const readPackData = (pack: string): string => readFileSync(packDataPath(pack), 'utf8')
