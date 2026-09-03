import {
    BeaconPrototype,
    CraftingMachinePrototype,
    ModulePrototype,
    RecipePrototype,
} from 'factorio:prototype'
import { IPoint } from '../types'
import FD, { getModule, isCraftingMachine } from './factorioData'
import { beaconEffectMultiplier } from './beaconEffects'
import { getIngredientAmount, getProductAmountWithProductivity } from './recipeAmounts'
import type { IModuleSlot } from './Entity'
import {
    qualityCraftingSpeedMul,
    qualityEffectChance,
    qualityRollDistribution,
    scalePositiveEffect,
} from './quality'

/**
 * Blueprint-wide production/consumption rate maths (issue: RateCalculator-style
 * ratio overview, inspired by raiguard's mod — but computed offline).
 *
 * The in-game mod reads *live* engine values (`entity.crafting_speed` already
 * includes every module/beacon/force bonus). A blueprint has no engine, so this
 * module reconstructs those bonuses from prototype data: sum the machine's own
 * module effects, add each in-range beacon's transmitted effects (scaled by the
 * 2.0 profile falloff — see beaconEffects.ts), then turn recipe amounts into
 * per-second rates via the machine's effective crafting speed.
 *
 * Deliberately scoped to *crafting machines* (assembling machines, furnaces,
 * rocket silos — `isCraftingMachine`):
 *   - furnaces in a blueprint carry no recipe (the game infers it from input),
 *     so they are counted but contribute no rates — see
 *     `BlueprintRates.machinesWithoutRecipe`;
 *   - mining drills need `resource` prototypes the data packs don't ship (and
 *     the ore under a drill isn't in the blueprint anyway);
 *   - power (boilers/generators/solar) is a possible follow-up, tracked in
 *     docs/rate-calculator.md.
 *
 * Everything here is framework-free and pure given prototypes — the only FD
 * dependency is the `collect` step that resolves blueprint entity names, so the
 * maths stays unit-testable with literal prototypes (see craftingRates.test.ts).
 */

/** Additive bonus totals a machine ends up with (0 = no modules/beacons). */
export interface MachineEffects {
    speed: number
    productivity: number
    consumption: number
    /** Total quality chance from quality modules (0–1 scale, 0 = no quality modules). */
    quality: number
}

/** An axis-aligned footprint on the tile grid: tile-space center + size. */
export interface Footprint {
    position: IPoint
    size: IPoint
}

/** A beacon that may influence machines: its prototype + the modules it holds. */
export interface ResolvedModule {
    prototype: ModulePrototype
    quality?: string
}

export type ModuleInput = ModulePrototype | ResolvedModule

export interface BeaconSource {
    prototype: BeaconPrototype
    modules: ModuleInput[]
    /** Beacon entity quality — scales `distribution_effectivity`. */
    quality?: string
    footprint: Footprint
}

/** A crafting machine to be rated. `recipe` undefined = counted but rate-less. */
export interface CraftingMachineSource {
    prototype: CraftingMachinePrototype
    recipe?: RecipePrototype
    modules: ModuleInput[]
    /** Entity quality — scales crafting_speed by 1 + 0.3 × level. */
    quality?: string
    /** Quality of the set recipe — non-fluid outputs inherit this quality. */
    recipeQuality?: string
    footprint: Footprint
}

function asResolved(module: ModuleInput): ResolvedModule {
    if (module && typeof module === 'object' && 'prototype' in module && module.prototype) {
        return module
    }
    return { prototype: module as ModulePrototype }
}

/**
 * Whether `beacon`'s supply area reaches `machine`. The supply area is the
 * beacon's own footprint grown by `supply_area_distance` on every side; a
 * shared edge is a *miss* (collision boxes sit strictly inside the tile grid,
 * so an edge-adjacent machine is out of range) — the same strict-inequality
 * semantics as PixiJS's `Rectangle.intersects`, which the entity info panel
 * used before this was extracted.
 */
export function beaconReaches(beacon: BeaconSource, machine: Footprint): boolean {
    const distance = beacon.prototype.supply_area_distance ?? 0
    const reachX = distance + beacon.footprint.size.x / 2 + machine.size.x / 2
    const reachY = distance + beacon.footprint.size.y / 2 + machine.size.y / 2
    const dx = Math.abs(machine.position.x - beacon.footprint.position.x)
    const dy = Math.abs(machine.position.y - beacon.footprint.position.y)
    return dx < reachX && dy < reachY
}

/**
 * Sum a machine's own module effects with every in-range beacon's transmitted
 * effects. Beacon effects are scaled per-beacon by `beaconEffectMultiplier`
 * (distribution_effectivity × the 2.0 profile falloff, honouring
 * `beacon_counter`), so mixed beacon types each see their own counts.
 *
 * The totals are clamped the way the engine clamps them: consumption and speed
 * bottom out at -80% (a machine never runs below 20% speed/power no matter how
 * many productivity modules drag it down), and productivity never goes
 * negative. The old entity-info-panel code only clamped consumption; speed is
 * clamped here too so a heavily-moduled SE setup can't produce a zero or
 * negative crafting rate.
 */
export function computeMachineEffects(
    machineModules: ModuleInput[],
    beacons: BeaconSource[]
): MachineEffects {
    let speed = 0
    let productivity = 0
    let consumption = 0
    let quality = 0

    const add = (module: ModuleInput, multiplier: number): void => {
        const r = asResolved(module)
        const e = r.prototype.effect
        if (e.speed) speed += scalePositiveEffect(e.speed, r.quality) * multiplier
        if (e.productivity)
            productivity += scalePositiveEffect(e.productivity, r.quality) * multiplier
        if (e.consumption) consumption += scalePositiveEffect(e.consumption, r.quality) * multiplier
        if (e.quality) quality += qualityEffectChance(e.quality, r.quality) * multiplier
    }

    for (const module of machineModules) add(module, 1)

    for (const beacon of beacons) {
        const multiplier = beaconEffectMultiplier(
            beacon.prototype,
            beacons.filter(b => b.prototype.name === beacon.prototype.name).length,
            beacons.length,
            beacon.quality
        )
        for (const module of beacon.modules) add(module, multiplier)
    }

    return {
        speed: Math.max(speed, -0.8),
        productivity: Math.max(productivity, 0),
        consumption: Math.max(consumption, -0.8),
        quality: Math.max(quality, 0),
    }
}

/** One material's flow through a single machine, in units (items/fluid) per second. */
export interface RateContribution {
    name: string
    type: 'item' | 'fluid'
    rate: number
    quality?: string
}

/**
 * Per-second ingredient/product rates of one machine crafting one recipe —
 * the RateCalculator core formula:
 *
 *   crafts/s = crafting_speed × (1 + speed bonus) / energy_required
 *   rate     = amount × crafts/s        (products additionally × productivity)
 *
 * Products resolve probabilistic yields to their Expected Value and honour the
 * 2.0 catalyst rule (`ignored_by_productivity`) via
 * `getProductAmountWithProductivity`; productivity only applies at all when the
 * recipe opts in (`allow_productivity`), mirroring the engine and the module
 * filter in factorioData.ts. A missing `energy_required` defaults to 0.5s
 * (the prototype default — ~28% of vanilla recipes omit it).
 */
export function craftingMachineRates(
    machine: CraftingMachinePrototype,
    recipe: RecipePrototype,
    effects: MachineEffects,
    machineQuality?: string,
    recipeQuality?: string
): { ingredients: RateContribution[]; products: RateContribution[] } {
    const energyRequired = recipe.energy_required || 0.5
    const craftsPerSecond =
        (machine.crafting_speed * qualityCraftingSpeedMul(machineQuality) * (1 + effects.speed)) /
        energyRequired
    const productivity = recipe.allow_productivity ? effects.productivity : 0

    const products: RateContribution[] = []
    const inputQuality = recipeQuality || undefined
    const dist = effects.quality > 0 ? qualityRollDistribution(effects.quality, inputQuality) : null

    for (const r of recipe.results ?? []) {
        const baseRate = getProductAmountWithProductivity(r, productivity) * craftsPerSecond
        if (r.type === 'fluid' || !dist || dist.length <= 1) {
            // Fluids ignore quality; no quality modules → single output tier.
            // If recipe has quality, tag non-fluid items with it.
            products.push({
                name: r.name,
                type: r.type,
                rate: baseRate,
                quality: r.type === 'fluid' ? undefined : inputQuality,
            })
        } else {
            for (const d of dist) {
                const rate = baseRate * d.fraction
                if (rate < 1e-10) continue
                products.push({
                    name: r.name,
                    type: r.type,
                    rate,
                    quality: d.quality === 'normal' ? undefined : d.quality,
                })
            }
        }
    }

    return {
        ingredients: (recipe.ingredients ?? []).map(i => ({
            name: i.name,
            type: i.type,
            rate: getIngredientAmount(i) * craftsPerSecond,
        })),
        products,
    }
}

/** Aggregated flow of one material across the whole selection. */
export interface ItemRateTotals {
    name: string
    type: 'item' | 'fluid'
    quality?: string
    /** Units produced per second across all machines (≥ 0). */
    production: number
    /** Units consumed per second across all machines (≥ 0). */
    consumption: number
    /** How many machines produce / consume it (for "add N more" reasoning). */
    producers: number
    consumers: number
    /**
     * The producing / consuming machines by prototype name (e.g.
     * `assembling-machine-2` → 3), so the UI can label a count with the actual
     * machine's icon — a bare "×80" reads as a rate multiplier.
     */
    producerMachines: Map<string, number>
    consumerMachines: Map<string, number>
}

export interface BlueprintRates {
    /** Every material any rated machine touches, keyed by prototype name. */
    rates: Map<string, ItemRateTotals>
    /** Machines that contributed rates (crafting machines with a known recipe). */
    countedMachines: number
    /**
     * Crafting machines skipped because they carry no recipe the data pack
     * knows — typically furnaces (whose recipe the game infers from input and a
     * blueprint therefore never records) or machines whose recipe was set from
     * the circuit network. Surfaced so the UI can say "N machines not counted"
     * instead of silently under-reporting.
     */
    machinesWithoutRecipe: number
    /** Counted machines per entity prototype name (e.g. 4× assembling-machine-2). */
    machineCounts: Map<string, number>
}

/**
 * Aggregate per-machine rates into per-material totals. Pure: takes resolved
 * prototypes, so tests can drive it without a loaded data pack.
 */
export function aggregateRates(
    machines: CraftingMachineSource[],
    beacons: BeaconSource[]
): BlueprintRates {
    const rates = new Map<string, ItemRateTotals>()
    const machineCounts = new Map<string, number>()
    let countedMachines = 0
    let machinesWithoutRecipe = 0

    const rateKey = (name: string, quality?: string): string =>
        quality ? `${name}:${quality}` : name

    const totalsFor = (c: RateContribution): ItemRateTotals => {
        const key = rateKey(c.name, c.quality)
        let t = rates.get(key)
        if (!t) {
            t = {
                name: c.name,
                type: c.type,
                quality: c.quality,
                production: 0,
                consumption: 0,
                producers: 0,
                consumers: 0,
                producerMachines: new Map(),
                consumerMachines: new Map(),
            }
            rates.set(key, t)
        }
        return t
    }

    const countMachine = (machines: Map<string, number>, name: string): void => {
        machines.set(name, (machines.get(name) ?? 0) + 1)
    }

    for (const machine of machines) {
        if (!machine.recipe) {
            machinesWithoutRecipe += 1
            continue
        }

        const inRange = beacons.filter(b => beaconReaches(b, machine.footprint))
        const effects = computeMachineEffects(machine.modules, inRange)
        const { ingredients, products } = craftingMachineRates(
            machine.prototype,
            machine.recipe,
            effects,
            machine.quality,
            machine.recipeQuality
        )

        for (const i of ingredients) {
            const t = totalsFor(i)
            t.consumption += i.rate
            t.consumers += 1
            countMachine(t.consumerMachines, machine.prototype.name)
        }
        for (const p of products) {
            const t = totalsFor(p)
            t.production += p.rate
            t.producers += 1
            countMachine(t.producerMachines, machine.prototype.name)
        }

        countedMachines += 1
        machineCounts.set(
            machine.prototype.name,
            (machineCounts.get(machine.prototype.name) ?? 0) + 1
        )
    }

    return { rates, countedMachines, machinesWithoutRecipe, machineCounts }
}

/**
 * The minimal structural view of a blueprint entity the calculator needs —
 * `Entity` satisfies it as-is, but so does a literal in a test. `modules` may
 * be sparse (`Entity.modules` returns `new Array(slots)` with holes).
 */
export interface RateSource {
    name: string
    position: IPoint
    size: IPoint
    recipe?: string
    quality?: string
    recipeQuality?: string
    modules: (string | IModuleSlot | undefined)[]
}

/**
 * Resolve a (possibly sparse) module-name list to prototypes, skipping empty
 * slots and names the loaded pack doesn't know — a foreign blueprint can carry
 * module names this pack doesn't have. Shared with EntityInfoPanel.
 */
export function resolveModuleNames(names: (string | IModuleSlot | undefined)[]): ResolvedModule[] {
    const out: ResolvedModule[] = []
    for (const slot of names) {
        const name = !slot ? undefined : typeof slot === 'string' ? slot : slot.name
        const quality = !slot || typeof slot === 'string' ? undefined : slot.quality
        if (name && FD.items[name]) out.push({ prototype: getModule(name), quality })
    }
    return out
}

/**
 * Resolve blueprint entities against the loaded data pack and compute the
 * whole selection's rates. The one FD-touching entry point — everything it
 * delegates to is pure.
 *
 * A recipe name the pack doesn't know (a blueprint pasted from a different
 * modset) degrades to "machine without recipe" rather than throwing, matching
 * the defensive stance the SA-aware rendering code takes everywhere else.
 */
export function calculateBlueprintRates(sources: RateSource[]): BlueprintRates {
    const machines: CraftingMachineSource[] = []
    const beacons: BeaconSource[] = []

    for (const source of sources) {
        const prototype = FD.entities[source.name]
        if (!prototype) continue
        const footprint = { position: source.position, size: source.size }

        if (prototype.type === 'beacon') {
            beacons.push({
                prototype: prototype as BeaconPrototype,
                modules: resolveModuleNames(source.modules),
                quality: source.quality,
                footprint,
            })
        } else if (isCraftingMachine(prototype)) {
            machines.push({
                prototype,
                recipe: source.recipe ? FD.recipes[source.recipe] : undefined,
                modules: resolveModuleNames(source.modules),
                quality: source.quality,
                recipeQuality: source.recipeQuality,
                footprint,
            })
        }
    }

    return aggregateRates(machines, beacons)
}
