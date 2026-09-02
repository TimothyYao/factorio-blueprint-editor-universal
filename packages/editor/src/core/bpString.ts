import { Buffer } from 'buffer'
import Ajv, { ErrorObject, KeywordDefinition } from 'ajv'
import pako from 'pako'
import { IBlueprint, IBlueprintBook, IBlueprintBookEntry } from '../types'
import FD from './factorioData'
import blueprintSchema from './blueprintSchema.json'
import { Blueprint } from './Blueprint'
import { Book } from './Book'

class CorruptedBlueprintStringError {
    public error: unknown
    public constructor(error: unknown) {
        this.error = error
    }
}

class BookWithNoBlueprintsError {
    public error = 'Blueprint book contains no blueprints!'
}

class ModdedBlueprintError {
    public errors: ErrorObject[]
    public constructor(errors: ErrorObject[]) {
        this.errors = errors
    }
}

class TrainBlueprintError {
    public errors: ErrorObject[]
    public constructor(errors: ErrorObject[]) {
        this.errors = errors
    }
}

const keywords: KeywordDefinition[] = [
    {
        keyword: 'entityName',
        validate: (data: string) => !!FD.entities[data],
        errors: false,
        schema: false,
    },
    {
        keyword: 'itemName',
        validate: (data: string) => !!FD.items[data],
        errors: false,
        schema: false,
    },
    {
        keyword: 'fluidName',
        validate: (data: string) => !!FD.fluids[data],
        errors: false,
        schema: false,
    },
    {
        keyword: 'recipeName',
        validate: (data: string) => !!FD.recipes[data],
        errors: false,
        schema: false,
    },
    {
        keyword: 'tileName',
        validate: (data: string) => !!FD.tiles[data],
        errors: false,
        schema: false,
    },
    {
        keyword: 'itemFluidSignalRecipeEntityName',
        validate: () => true,
        errors: false,
        schema: false,
    },
]

type StringData = { blueprint?: IBlueprint; blueprint_book?: IBlueprintBook }

const validate = new Ajv({
    keywords,
    verbose: true,
    strict: true,
    allowUnionTypes: true,
}).compile<StringData>(blueprintSchema)

const nameMigrations: Record<string, string> = {
    // if (blueprintVersion < getFactorioVersion(0, 17, 0))
    '"raw-wood"': '"wood"',
    '"science-pack-1"': '"automation-science-pack"',
    '"science-pack-2"': '"logistic-science-pack"',
    '"science-pack-3"': '"chemical-science-pack"',
    '"high-tech-science-pack"': '"utility-science-pack"',
    ',"recipe":"wood"': '',
    ',"recipe":"steel-axe"': '',
    ',"recipe":"iron-axe"': '',

    // if (blueprintVersion < getFactorioVersion(0, 17, 10))
    '"grass-1"': '"landfill"',

    // if (blueprintVersion < getFactorioVersion(2, 0, 0))
    ',"recipe":"rocket-control-unit"': '',
    ',"name":"rocket-control-unit"': ',"name":"raw-fish"',
    '"stack-inserter"': '"bulk-inserter"',
    '"stack-filter-inserter"': '"bulk-inserter"',
    '"filter-inserter"': '"fast-inserter"',
    '"effectivity-module"': '"efficiency-module"',
    '"effectivity-module-2"': '"efficiency-module-2"',
    '"effectivity-module-3"': '"efficiency-module-3"',
    '"used-up-uranium-fuel-cell"': '"depleted-uranium-fuel-cell"',
    // '"straight-rail"': '"legacy-straight-rail"', -- must be done later since straight-rail are still in the game post 2.0
    '"curved-rail"': '"legacy-curved-rail"',
    '"logistic-chest-storage"': '"storage-chest"',
    '"logistic-chest-buffer"': '"buffer-chest"',
    '"logistic-chest-requester"': '"requester-chest"',
    '"logistic-chest-active-provider"': '"active-provider-chest"',
    '"logistic-chest-passive-provider"': '"passive-provider-chest"',
    '"fusion-reactor-equipment"': '"fission-reactor-equipment"',
    '"empty-barrel"': '"barrel"',
    '"fill-water-barrel"': '"water-barrel"',
    '"fill-crude-oil-barrel"': '"crude-oil-barrel"',
    '"fill-petroleum-gas-barrel"': '"petroleum-gas-barrel"',
    '"fill-light-oil-barrel"': '"light-oil-barrel"',
    '"fill-heavy-oil-barrel"': '"heavy-oil-barrel"',
    '"fill-lubricant-barrel"': '"lubricant-barrel"',
    '"fill-sulfuric-acid-barrel"': '"sulfuric-acid-barrel"',
}
const nameMigrationsRegex = new RegExp(Object.keys(nameMigrations).join('|'), 'g')

let loadWarnings: string[] = []

function getAndClearLoadWarnings(): string[] {
    const warnings = loadWarnings
    loadWarnings = []
    return warnings
}

function stripUnknownEntities(data: StringData): string[] {
    const strippedNames = new Set<string>()
    const stripBlueprint = (bp: IBlueprint): void => {
        if (bp.entities) {
            const before = bp.entities.length
            bp.entities = bp.entities.filter(e => {
                if (!FD.entities[e.name]) {
                    strippedNames.add(e.name)
                    return false
                }
                return true
            })
            if (bp.entities.length < before) {
                console.warn(`Stripped ${before - bp.entities.length} unknown entities`)
            }
        }
    }

    const stripBook = (entries: IBlueprintBookEntry[] = []): void => {
        for (const entry of entries) {
            if (entry.blueprint) stripBlueprint(entry.blueprint)
            if (entry.blueprint_book) stripBook(entry.blueprint_book.blueprints)
        }
    }

    if (data.blueprint) {
        stripBlueprint(data.blueprint)
    } else if (data.blueprint_book) {
        stripBook(data.blueprint_book.blueprints)
    }
    return [...strippedNames]
}

function decode(str: string): Promise<Blueprint | Book> {
    return new Promise((resolve, reject) => {
        try {
            const decodedStr = Buffer.from(str.slice(1), 'base64')
            const data = pako
                .inflate(decodedStr, { to: 'string' })
                .replace(nameMigrationsRegex, match => nameMigrations[match])
            const parsedData = JSON.parse(data)
            resolve(parsedData)
        } catch (e) {
            reject(new CorruptedBlueprintStringError(e))
        }
    }).then(data => {
        console.log(data)
        loadWarnings = []
        if (!validate(data)) {
            const errors = validate.errors
            // Log validation warnings but try to load the blueprint anyway
            console.warn('Blueprint validation warnings (loading anyway):', JSON.stringify(errors))
            loadWarnings.push('Blueprint had validation warnings (loaded anyway)')
        }
        // Always strip unknown entities - they crash during rendering if they
        // reach Blueprint.ts (e.g., mod entities like ee-infinity-loader)
        const strippedNames = stripUnknownEntities(data as StringData)
        if (strippedNames.length > 0) {
            loadWarnings.push(
                `Skipped ${strippedNames.length} unknown entit${strippedNames.length === 1 ? 'y' : 'ies'}: ${strippedNames.join(', ')}`
            )
        }

        const bpData = data as StringData
        if (bpData.blueprint_book === undefined) {
            return new Blueprint(bpData.blueprint)
        } else {
            const hasBlueprint = (entries: IBlueprintBookEntry[] = []): boolean => {
                for (const entry of entries) {
                    if (entry.blueprint) return true
                    if (entry.blueprint_book && hasBlueprint(entry.blueprint_book.blueprints))
                        return true
                }
                return false
            }
            if (hasBlueprint(bpData.blueprint_book.blueprints)) {
                return new Book(bpData.blueprint_book)
            } else {
                throw new BookWithNoBlueprintsError()
            }
        }
    })
}

function encode(bpOrBook: Blueprint | Book): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            const keyName = bpOrBook instanceof Blueprint ? 'blueprint' : 'blueprint_book'
            const data = { [keyName]: bpOrBook.serialize() }
            const string = JSON.stringify(data)
            resolve(`0${Buffer.from(pako.deflate(string)).toString('base64')}`)
        } catch (e) {
            reject(e)
        }
    })
}

function getBlueprintOrBookFromSource(source: string): Promise<Blueprint | Book> {
    if (source === undefined) return Promise.resolve(new Blueprint())

    // trim whitespace
    const DATA = source.replace(/\s/g, '')

    let bpString
    if (DATA[0] === '0') {
        bpString = Promise.resolve(DATA)
    } else {
        bpString = new Promise<URL>((resolve, reject) => {
            const url = `https://${DATA.replace(/https?:\/\//g, '')}`
            try {
                resolve(new URL(url))
            } catch (e) {
                reject(e)
            }
        }).then((url: URL) => {
            console.log(`Loading data from: ${url}`)
            const pathParts = url.pathname.slice(1).split('/')

            // Try the plain cross-origin fetch first: most import hosts answer
            // it nowadays — pastebin's raw endpoint, the GitHub gist API and
            // Google Docs exports all send CORS headers (verified 2026-09), and
            // it is the only path that works on a static deploy (GitHub Pages
            // has no server side). Only when the browser blocks the direct
            // fetch (a CORS-less host, e.g. gitlab.com raw — that surfaces as a
            // rejected promise, not a non-ok response) fall back to the
            // server-side `/corsproxy`, which exists only where the deploy
            // provides it (a Cloudflare Pages Function — see
            // functions/corsproxy.js and
            // https://github.com/trisiak/factorio-blueprint-editor/issues/17).
            const fetchData = (url: string): Promise<Response> =>
                fetch(url)
                    .catch(() => fetch(`/corsproxy?url=${encodeURIComponent(url)}`))
                    .then(response => {
                        if (response.ok) return response
                        throw new Error('Network response was not ok.')
                    })

            // factorioprints.com and factorio.school share one database — the
            // school is a search frontend over the prints Firebase DB, so a
            // /view/<key> on either site names the same record. The Firebase
            // REST endpoint sends CORS headers (verified 2026-09) which makes
            // it the only route that works on GitHub Pages; the school's own
            // API (no CORS → proxy-only) is kept as a fallback for records
            // that exist only on its side of the periodic sync.
            const fetchFromFactorioPrintsDB = (key: string): Promise<string> =>
                fetchData(
                    `https://facorio-blueprints.firebaseio.com/blueprints/${key}/blueprintString.json`
                )
                    .then(r => r.json())
                    .then((str: string | null) => {
                        // Firebase answers a missing key with 200 + `null`.
                        if (str === null) throw new Error('Blueprint not found.')
                        return str
                    })
            const fetchFromFactorioSchoolAPI = (key: string): Promise<string> =>
                fetchData(`https://www.factorio.school/api/blueprint/${key}`)
                    .then(r => r.json())
                    .then(data => data.blueprintString.blueprintString)

            // NOTE: hastebin support was dropped — Toptal's takeover put the
            // /raw endpoint behind an API key (401 for anonymous fetches).
            switch (url.hostname.replace(/^www\./, '').split('.')[0]) {
                case 'pastebin':
                    return fetchData(`https://pastebin.com/raw/${pathParts[0]}`).then(r => r.text())
                case 'factoriobin': {
                    // FactorioBin's documented mini-API: append /blueprint.txt
                    // to any post URL — including a book child like
                    // /post/<id>/3 — for a 302 to the raw string on
                    // cdn.factoriobin.com (a bare CDN link falls through to the
                    // default case below). Neither host sends CORS headers
                    // (verified 2026-09), so this route needs the /corsproxy.
                    const postPath = url.pathname.replace(/\/(blueprint\.txt)?\/*$/, '')
                    return fetchData(`https://factoriobin.com${postPath}/blueprint.txt`).then(r =>
                        r.text()
                    )
                }
                case 'factoriocodex':
                    // factoriocodex.com/blueprints/<id> — the (undocumented,
                    // verified 2026-09) JSON API carries the raw string on each
                    // entry of `versions`; `current_version` names the live
                    // one. No CORS headers, so this route needs the /corsproxy.
                    return fetchData(
                        `https://www.factoriocodex.com/api/v1/blueprints/${pathParts[1]}`
                    )
                        .then(r => r.json())
                        .then(data => {
                            const versions: { version_number: number; blueprint_string: string }[] =
                                data.versions ?? []
                            const current =
                                versions.find(v => v.version_number === data.current_version) ??
                                versions[versions.length - 1]
                            if (current === undefined) throw new Error('Blueprint not found.')
                            return current.blueprint_string
                        })
                case 'gist':
                    return fetchData(`https://api.github.com/gists/${pathParts[1]}`)
                        .then(r => r.json())
                        .then(data => data.files[Object.keys(data.files)[0]].content)
                case 'gitlab':
                    return fetchData(`https://gitlab.com/${pathParts.join('/')}/raw`).then(r =>
                        r.text()
                    )
                case 'factorioprints':
                    return fetchFromFactorioPrintsDB(pathParts[1])
                case 'factorio': // factorio.school
                    if (pathParts[0] === 'api') {
                        return fetchData(url.href).then(r => r.text())
                    }

                    return fetchFromFactorioPrintsDB(pathParts[1]).catch(() =>
                        fetchFromFactorioSchoolAPI(pathParts[1])
                    )
                case 'dropbox': {
                    // Share links (/s/<id>/<name> and the newer
                    // /scl/fi/<id>/<name>?rlkey=…) land on an HTML preview;
                    // swapping the host for dl.dropboxusercontent.com serves
                    // the raw file instead — same path, same rlkey — and that
                    // host sends CORS headers (verified 2026-09), so it works
                    // without the proxy.
                    const raw = new URL(url.href)
                    raw.hostname = 'dl.dropboxusercontent.com'
                    raw.searchParams.delete('dl')
                    return fetchData(raw.href).then(r => r.text())
                }
                case 'docs':
                    return fetchData(
                        `https://docs.google.com/document/d/${pathParts[2]}/export?format=txt`
                    ).then(r => r.text())
                default:
                    return fetchData(url.href).then(r => r.text())
            }
        })
    }

    return bpString.then(decode)
}

export {
    ModdedBlueprintError,
    TrainBlueprintError,
    CorruptedBlueprintStringError,
    BookWithNoBlueprintsError,
    encode,
    getBlueprintOrBookFromSource,
    getAndClearLoadWarnings,
}
