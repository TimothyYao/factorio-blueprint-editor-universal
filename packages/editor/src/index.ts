import { Book } from './core/Book'
import { Blueprint } from './core/Blueprint'
import { EditorMode, GridPattern } from './containers/BlueprintContainer'
import {
    registerAction,
    callAction,
    forEachAction,
    resetKeybinds,
    importKeybinds,
    exportKeybinds,
} from './actions'
import { Editor } from './Editor'
import { inputMode, InputMode } from './common/input'
import { qualityUi } from './common/qualityUi'
import { rateUnit, ratePeriodLabel } from './common/rateUnit'
import type { RateUnit } from './common/rateUnit'
import { installTestHook } from './common/testHook'
import type { EditorTestState, FbeTestHook } from './common/testHook'
import FD from './core/factorioData'
import {
    DATA_ROOT,
    DATA_PACK,
    DEFAULT_DATA_PACK,
    setDataPack,
    loadPackManifest,
    getCanonicalDataPack,
} from './common/globals'
import { canonicalPackId, canonicalPacks, graphicsOptions } from './core/packManifest'
import type { PackManifestEntry } from './core/packManifest'

export * from './core/bpString'
export {
    Editor,
    Book,
    Blueprint,
    GridPattern,
    EditorMode,
    FD,
    inputMode,
    qualityUi,
    rateUnit,
    ratePeriodLabel,
    installTestHook,
}
export { DATA_ROOT, DATA_PACK, DEFAULT_DATA_PACK, setDataPack }
export { loadPackManifest, getCanonicalDataPack, canonicalPackId, canonicalPacks }
export { graphicsOptions }
export type { InputMode, EditorTestState, FbeTestHook, PackManifestEntry, RateUnit }
// The render-free entity-info projection consumed by the website's DOM bottom
// sheet (#89 Phase 2); delivered at runtime via the `fbe:entityinfo` event.
export type { EntityInfoData, EntityInfoStack } from './UI/EntityInfoPanel'
// Likewise for the rates readout (`fbe:rates`); formatRate keeps the DOM
// drawer's numbers formatted exactly like the canvas panel's.
export type { RatesData, RatesEntryData } from './UI/RatesPanel'
export { formatRate } from './UI/RatesPanel'
export { qualityColorCss } from './core/quality'
export { qualityBadgeDataUrl } from './UI/controls/functions'
export default {
    registerAction,
    callAction,
    forEachAction,
    resetKeybinds,
    importKeybinds,
    exportKeybinds,
}
