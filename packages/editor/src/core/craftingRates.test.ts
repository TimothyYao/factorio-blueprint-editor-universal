import { describe, it, expect } from 'vitest'
import {
    BeaconPrototype,
    CraftingMachinePrototype,
    ModulePrototype,
    RecipePrototype,
} from 'factorio:prototype'
import {
    BeaconSource,
    CraftingMachineSource,
    MachineEffects,
    aggregateRates,
    beaconReaches,
    computeMachineEffects,
    craftingMachineRates,
} from './craftingRates'

// Literal prototypes carrying real vanilla-2.0 values, so these double as a
// regression check on the assumptions the rates panel makes about pack data.

const asm2 = {
    name: 'assembling-machine-2',
    type: 'assembling-machine',
    crafting_speed: 0.75,
} as CraftingMachinePrototype

const asm3 = {
    name: 'assembling-machine-3',
    type: 'assembling-machine',
    crafting_speed: 1.25,
} as CraftingMachinePrototype

// electronic-circuit: 1 iron-plate + 3 copper-cable -> 1 circuit, 0.5s,
// allow_productivity (an intermediate).
const electronicCircuit = {
    name: 'electronic-circuit',
    energy_required: 0.5,
    allow_productivity: true,
    ingredients: [
        { type: 'item', name: 'iron-plate', amount: 1 },
        { type: 'item', name: 'copper-cable', amount: 3 },
    ],
    results: [{ type: 'item', name: 'electronic-circuit', amount: 1 }],
} as unknown as RecipePrototype

// copper-cable: 1 plate -> 2 cable, 0.5s, allow_productivity.
const copperCable = {
    name: 'copper-cable',
    energy_required: 0.5,
    allow_productivity: true,
    ingredients: [{ type: 'item', name: 'copper-plate', amount: 1 }],
    results: [{ type: 'item', name: 'copper-cable', amount: 2 }],
} as unknown as RecipePrototype

// A fluid-bearing recipe (plastic-bar): productivity-allowed, mixed item/fluid
// inputs — checks that fluids flow through the same rate pipeline as items.
const plasticBar = {
    name: 'plastic-bar',
    energy_required: 1,
    allow_productivity: true,
    ingredients: [
        { type: 'fluid', name: 'petroleum-gas', amount: 20 },
        { type: 'item', name: 'coal', amount: 1 },
    ],
    results: [{ type: 'item', name: 'plastic-bar', amount: 2 }],
} as unknown as RecipePrototype

// A recipe with productivity disallowed (like vanilla non-intermediates).
const ironChest = {
    name: 'iron-chest',
    energy_required: 0.5,
    ingredients: [{ type: 'item', name: 'iron-plate', amount: 8 }],
    results: [{ type: 'item', name: 'iron-chest', amount: 1 }],
} as unknown as RecipePrototype

const speedModule = {
    name: 'speed-module',
    effect: { speed: 0.2, consumption: 0.5 },
} as ModulePrototype

const prodModule = {
    name: 'productivity-module',
    effect: { productivity: 0.04, consumption: 0.4, speed: -0.05, pollution: 0.05 },
} as ModulePrototype

const vanillaBeacon = {
    name: 'beacon',
    type: 'beacon',
    distribution_effectivity: 1.5,
    profile: [1, 0.7071, 0.5773, 0.5],
    beacon_counter: 'same_type',
    supply_area_distance: 3,
} as unknown as BeaconPrototype

const NO_EFFECTS: MachineEffects = { speed: 0, productivity: 0, consumption: 0 }

const machine = (
    prototype: CraftingMachinePrototype,
    recipe: RecipePrototype | undefined,
    x = 0,
    y = 0,
    modules: ModulePrototype[] = []
): CraftingMachineSource => ({
    prototype,
    recipe,
    modules,
    footprint: { position: { x, y }, size: { x: 3, y: 3 } },
})

const beaconAt = (x: number, y: number, modules: ModulePrototype[]): BeaconSource => ({
    prototype: vanillaBeacon,
    modules,
    footprint: { position: { x, y }, size: { x: 3, y: 3 } },
})

describe('computeMachineEffects', () => {
    it('sums the machine own modules additively', () => {
        const effects = computeMachineEffects([speedModule, speedModule], [])
        expect(effects.speed).toBeCloseTo(0.4)
        expect(effects.consumption).toBeCloseTo(1)
        expect(effects.productivity).toBe(0)
    })

    it('collects every axis of a mixed module loadout', () => {
        // A vanilla-ish prod module drags speed down while raising productivity
        // and consumption — all three axes must accumulate independently.
        const effects = computeMachineEffects([prodModule, prodModule], [])
        expect(effects.productivity).toBeCloseTo(0.08)
        expect(effects.speed).toBeCloseTo(-0.1)
        expect(effects.consumption).toBeCloseTo(0.8)
    })

    it('scales beacon modules by the transmission multiplier', () => {
        // One vanilla beacon holding two speed modules: 2 × 0.2 × 1.5 = 0.6.
        const effects = computeMachineEffects([], [beaconAt(0, 0, [speedModule, speedModule])])
        expect(effects.speed).toBeCloseTo(0.6)
    })

    it('applies the 2.0 profile falloff per reaching beacon', () => {
        // Two same-type beacons, one speed module each:
        // each transmits 0.2 × 1.5 × profile[1] (0.7071).
        const beacons = [beaconAt(0, 0, [speedModule]), beaconAt(6, 0, [speedModule])]
        const effects = computeMachineEffects([], beacons)
        expect(effects.speed).toBeCloseTo(2 * 0.2 * 1.5 * 0.7071)
    })

    it('clamps consumption and speed at -80% and productivity at 0', () => {
        const drain = {
            name: 'drain',
            effect: { speed: -0.5, consumption: -0.5, productivity: -0.1 },
        } as ModulePrototype
        const effects = computeMachineEffects([drain, drain, drain], [])
        expect(effects.speed).toBe(-0.8)
        expect(effects.consumption).toBe(-0.8)
        expect(effects.productivity).toBe(0)
    })
})

describe('beaconReaches', () => {
    // Vanilla beacon: 3×3 footprint + 3 supply distance = a 9×9 supply area,
    // so a 3×3 machine overlaps it while the centers are strictly under
    // 4.5 + 1.5 = 6 tiles apart.
    it('reaches a machine whose footprint overlaps the supply area', () => {
        // Exactly 6 tiles apart: supply edge at 1.5 meets machine edge at 1.5 —
        // a shared edge, which must be a miss (strict inequality)…
        expect(
            beaconReaches(beaconAt(6, 0, []), { position: { x: 0, y: 0 }, size: { x: 3, y: 3 } })
        ).toBe(false)
        // …while one tile closer overlaps.
        expect(
            beaconReaches(beaconAt(5, 0, []), { position: { x: 0, y: 0 }, size: { x: 3, y: 3 } })
        ).toBe(true)
    })

    it('is out of range diagonally when either axis is out of range', () => {
        expect(
            beaconReaches(beaconAt(8, 8, []), { position: { x: 0, y: 0 }, size: { x: 3, y: 3 } })
        ).toBe(false)
    })
})

describe('craftingMachineRates', () => {
    it('computes the base rate: amount × crafting_speed / energy_required', () => {
        // asm2 on electronic-circuit: 0.75 / 0.5 = 1.5 crafts/s.
        const { ingredients, products } = craftingMachineRates(asm2, electronicCircuit, NO_EFFECTS)
        expect(products).toEqual([{ name: 'electronic-circuit', type: 'item', rate: 1.5 }])
        expect(ingredients).toEqual([
            { name: 'iron-plate', type: 'item', rate: 1.5 },
            { name: 'copper-cable', type: 'item', rate: 4.5 },
        ])
    })

    it('defaults a missing energy_required to 0.5s', () => {
        const noEnergy = { ...electronicCircuit, energy_required: undefined } as RecipePrototype
        const { products } = craftingMachineRates(asm2, noEnergy, NO_EFFECTS)
        expect(products[0].rate).toBeCloseTo(1.5)
    })

    it('applies speed to both sides and productivity to products only', () => {
        const effects: MachineEffects = { speed: 0.2, productivity: 0.1, consumption: 0 }
        const { ingredients, products } = craftingMachineRates(asm2, copperCable, effects)
        // 0.75 × 1.2 / 0.5 = 1.8 crafts/s.
        expect(ingredients[0].rate).toBeCloseTo(1.8)
        expect(products[0].rate).toBeCloseTo(2 * 1.8 * 1.1)
    })

    it('ignores productivity when the recipe disallows it', () => {
        const effects: MachineEffects = { speed: 0, productivity: 0.2, consumption: 0 }
        const { products } = craftingMachineRates(asm2, ironChest, effects)
        // 0.75 / 0.5 = 1.5 crafts/s, productivity NOT applied.
        expect(products[0].rate).toBeCloseTo(1.5)
    })

    it('carries fluids through with their type', () => {
        const { ingredients } = craftingMachineRates(asm3, plasticBar, NO_EFFECTS)
        expect(ingredients[0]).toEqual({ name: 'petroleum-gas', type: 'fluid', rate: 25 })
    })
})

describe('aggregateRates', () => {
    it('nets producers against consumers into per-material totals', () => {
        // The classic 3:2 ratio probe: circuits consume 4.5 cable/s per asm2,
        // cable asm2s produce 3 cable/s each.
        const machines = [
            machine(asm2, electronicCircuit, 0, 0),
            machine(asm2, copperCable, 6, 0),
            machine(asm2, copperCable, 12, 0),
        ]
        const { rates, countedMachines, machineCounts } = aggregateRates(machines, [])

        const cable = rates.get('copper-cable')
        expect(cable.production).toBeCloseTo(6)
        expect(cable.consumption).toBeCloseTo(4.5)
        expect(cable.producers).toBe(2)
        expect(cable.consumers).toBe(1)
        // Machine identities behind the counts (the UI labels ×N with the
        // dominant machine's icon).
        expect(cable.producerMachines.get('assembling-machine-2')).toBe(2)
        expect(cable.consumerMachines.get('assembling-machine-2')).toBe(1)

        // Pure ingredient / pure product classify by one side being zero.
        expect(rates.get('copper-plate').production).toBe(0)
        expect(rates.get('electronic-circuit').consumption).toBe(0)

        expect(countedMachines).toBe(3)
        expect(machineCounts.get('assembling-machine-2')).toBe(3)
    })

    it('counts recipe-less machines separately instead of dropping them silently', () => {
        const { countedMachines, machinesWithoutRecipe, rates } = aggregateRates(
            [machine(asm2, electronicCircuit), machine(asm2, undefined, 20, 20)],
            []
        )
        expect(countedMachines).toBe(1)
        expect(machinesWithoutRecipe).toBe(1)
        expect(rates.size).toBe(3)
    })

    it('only applies beacons to machines they reach', () => {
        // Beacon at x=5 with two speed modules reaches the machine at (0,0)
        // (centers 5 < 6 tiles apart) but not the one at (20,0).
        const machines = [machine(asm2, copperCable, 0, 0), machine(asm2, copperCable, 20, 0)]
        const beacons = [beaconAt(5, 0, [speedModule, speedModule])]
        const { rates } = aggregateRates(machines, beacons)
        // Boosted: 0.75 × (1 + 0.6) / 0.5 × 2 = 4.8/s; plain: 3/s.
        expect(rates.get('copper-cable').production).toBeCloseTo(4.8 + 3)
    })
})
