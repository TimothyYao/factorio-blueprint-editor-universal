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
export { Editor, Book, Blueprint, GridPattern, EditorMode, FD, inputMode, installTestHook }
export { DATA_ROOT, DATA_PACK, DEFAULT_DATA_PACK, setDataPack }
export { loadPackManifest, getCanonicalDataPack, canonicalPackId, canonicalPacks }
export { graphicsOptions }
export type { InputMode, EditorTestState, FbeTestHook, PackManifestEntry }
export default {
    registerAction,
    callAction,
    forEachAction,
    resetKeybinds,
    importKeybinds,
    exportKeybinds,
}
