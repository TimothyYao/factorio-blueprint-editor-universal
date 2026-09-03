import { Container, Text } from 'pixi.js'
import FD from '../core/factorioData'
import {
    BeaconPrototype,
    CraftingMachinePrototype,
    InserterPrototype,
    TransportBeltConnectablePrototype,
} from 'factorio:prototype'
import G from '../common/globals'
import { inputMode } from '../common/input'
import util from '../common/util'
import { ISignal } from '../types'
import {
    BeaconSource,
    beaconReaches,
    computeMachineEffects,
    resolveModuleNames,
} from '../core/craftingRates'
import { getIngredientAmount, getProductAmountWithProductivity } from '../core/recipeAmounts'
import { Entity } from '../core/Entity'
import { createCircuitNetworkBadges } from './circuitNetworkBadges'
import F from './controls/functions'
import { qualityCraftingSpeedMul, qualityDisplayName } from '../core/quality'
import { qualityUi } from '../common/qualityUi'
import { Panel } from './controls/Panel'
import { fitToWidthScale } from './quickbarLayout'
import { styles } from './style'

function template(strings: TemplateStringsArray, ...keys: (number | string)[]) {
    return (...values: (unknown | Record<string, unknown>)[]) => {
        const result = [strings[0].replace('\n', '')]
        keys.forEach((key, i) => {
            result.push(
                typeof key === 'number'
                    ? (values as string[])[key]
                    : (values[0] as Record<string, string>)[key],
                strings[i + 1]
            )
        })
        return result.join('')
    }
}

const entityInfoTemplate = template`
Crafting speed: ${'craftingSpeed'} ${'speedMultiplier'}
Power consumption: ${'energyUsage'} kW ${'energyMultiplier'}
Productivity bonus: ${'productivityBonus'}`

const SIZE_OF_ITEM_ON_BELT = 0.25

const getBeltSpeed = (beltSpeed: number): number => beltSpeed * 60 * (1 / SIZE_OF_ITEM_ON_BELT) * 2

const containerToContainer = (rotationSpeed: number, n: number): number => rotationSpeed * 60 * n

/**
    nr of items to ignore the time it takes to place them on a belt

    because: first item is being placed instantly and also in front so
    this also reduces the time it takes to put down the second item by about 75%
*/
const NR_OF_ITEMS_TO_IGNORE = 1.75
const containerToBelt = (rotationSpeed: number, beltSpeed: number, n: number): number => {
    const armTime = 1 / (rotationSpeed * 60)
    const itemTime = (1 / (beltSpeed * 60)) * SIZE_OF_ITEM_ON_BELT
    return n / (armTime + itemTime * Math.max(n - NR_OF_ITEMS_TO_IGNORE, 0))
}
// TODO: add beltToContainer

const roundToTwo = (n: number): number => Math.round(n * 100) / 100
const roundToFour = (n: number): number => Math.round(n * 10000) / 10000

/** One side of a recipe row: an item/fluid token with its (resolved) amount. */
export interface EntityInfoStack {
    type: string
    name: string
    amount: number
}

/**
 * Pure, render-free projection of what the entity info panel shows — the seam
 * that lets the website's DOM bottom sheet (#89 Phase 2) present the same facts
 * without touching Pixi. Built by `buildEntityInfo` below, which shares this
 * module's helpers (effect maths, belt/inserter speeds) with the canvas panel
 * so the two presentations can't drift. Delivered to the DOM via the
 * `fbe:entityinfo` CustomEvent (see `UIContainer.updateEntityInfoPanel`).
 */
export interface EntityInfoData {
    /** Localised entity name, with a `(Legendary)` suffix when the entity has quality. */
    name: string
    /** Stat lines (crafting speed / power / productivity, belt or inserter speed). */
    lines: string[]
    /** The set recipe, as authored (per craft). */
    recipe?: { time: number; ingredients: EntityInfoStack[]; results: EntityInfoStack[] }
    /** Per-second in/out with module/beacon effects + productivity applied. */
    effectiveRecipe?: { ingredients: EntityInfoStack[]; results: EntityInfoStack[] }
    /**
     * Circuit summary as plain text (mode flags, enable condition). The canvas
     * panel renders this section icon-rich; the sheet's v1 degrades to text —
     * upgrading it to icon tokens is a noted follow-up.
     */
    circuit: string[]
}

function entityDisplayName(entity: Entity): string {
    const base = String(FD.entities[entity.name].localised_name)
    if (!qualityUi.enabled) return base
    const q = qualityDisplayName(entity.quality)
    return q ? `${base} (${q})` : base
}

/**
 * This class creates a panel to show detailed informations about each entity (as the original game and maybe more).
 * @function updateVisualization (Update informations and show/hide panel)
 * @function setPosition (top right corner of the screen)
 * @extends /controls/panel (extends Container)
 * @see instantiation in /index.ts - event in /containers/entity.ts
 */
export class EntityInfoPanel extends Panel {
    private title: Text
    private m_EntityName: Text
    private m_QualityBadge: Container
    private m_entityInfo: Text
    private m_RecipeContainer: Container
    private m_RecipeIOContainer: Container
    private m_CircuitContainer: Container

    public constructor() {
        super(270, 270)

        this.eventMode = 'none'
        this.visible = false

        this.title = new Text({ text: 'Information', style: styles.dialog.title })
        this.title.anchor.set(0.5, 0)
        this.title.position.set(super.width / 2, 2)
        this.addChild(this.title)

        this.m_EntityName = new Text({ text: '', style: styles.dialog.label })
        this.m_QualityBadge = new Container()
        this.m_entityInfo = new Text({ text: '', style: styles.dialog.label })
        this.m_RecipeContainer = new Container()
        this.m_RecipeIOContainer = new Container()
        this.m_CircuitContainer = new Container()

        this.addChild(
            this.m_QualityBadge,
            this.m_EntityName,
            this.m_entityInfo,
            this.m_RecipeContainer,
            this.m_RecipeIOContainer,
            this.m_CircuitContainer
        )
    }

    public updateVisualization(entity?: Entity): void {
        this.m_RecipeContainer.removeChildren()
        this.m_RecipeIOContainer.removeChildren()
        this.m_CircuitContainer.removeChildren()
        this.m_QualityBadge.removeChildren()

        if (!entity) {
            this.visible = false
            this.m_EntityName.text = ''
            this.m_entityInfo.text = ''
            return
        }

        this.visible = true
        let nextY = this.title.position.y + this.title.height + 10

        let nameX = 10
        const badge = F.CreateQualityBadge(entity.quality, 14)
        if (badge) {
            badge.position.set(nameX, nextY)
            this.m_QualityBadge.addChild(badge)
            nameX += 18
        }
        this.m_EntityName.text = `Name: ${entityDisplayName(entity)}`
        this.m_EntityName.position.set(nameX, nextY)
        nextY = this.m_EntityName.position.y + this.m_EntityName.height + 10

        if (entity.entityData.type === 'assembling-machine') {
            // Details for assembling machines with or without recipe. The
            // module/beacon effect summing (incl. the 2.0 per-beacon profile
            // falloff and the engine's -80% clamps) lives in core/craftingRates
            // so the blueprint-wide rates panel computes the exact same numbers.
            const { speed, productivity, consumption } = computeMachineEffects(
                resolveModuleNames(entity.modules),
                findBeaconsReaching(entity)
            )
            const machineData = entity.entityData as CraftingMachinePrototype
            const newCraftingSpeed =
                machineData.crafting_speed * qualityCraftingSpeedMul(entity.quality) * (1 + speed)
            const newEnergyUsage =
                parseInt(machineData.energy_usage.slice(0, -2)) * (1 + consumption)

            const fmt = (n: number): string =>
                `(${Math.sign(n) === 1 ? '+' : '-'}${roundToTwo(Math.abs(n) * 100)}%)`

            // Productivity has no base value to modify (unlike speed/power), so
            // render it as a bare signed percentage rather than a parenthesised
            // multiplier.
            const pct = (n: number): string =>
                `${Math.sign(n) === -1 ? '-' : '+'}${roundToTwo(Math.abs(n) * 100)}%`

            // Show modules effect and some others informations
            this.m_entityInfo.text = entityInfoTemplate({
                craftingSpeed: roundToFour(newCraftingSpeed),
                speedMultiplier: speed ? fmt(speed) : '',
                energyUsage: roundToTwo(newEnergyUsage),
                energyMultiplier: consumption ? fmt(consumption) : '',
                productivityBonus: pct(productivity),
            })

            this.m_entityInfo.position.set(10, nextY)
            nextY = this.m_entityInfo.position.y + this.m_entityInfo.height + 10

            // Details for assembling machines with a recipe. The recipe can be
            // unset (e.g. when it's driven from the circuit network via
            // `set_recipe`), so guard rather than early-return — otherwise the
            // circuit section rendered at the end of this method is skipped.
            const recipe = entity.recipe ? FD.recipes[entity.recipe] : undefined
            if (recipe !== undefined) {
                // Show the original recipe
                this.m_RecipeContainer.addChild(
                    new Text({
                        text: 'Recipe:',
                        style: styles.dialog.label,
                    })
                )
                F.CreateRecipe(
                    this.m_RecipeContainer,
                    0,
                    20,
                    recipe.ingredients,
                    recipe.results,
                    recipe.energy_required
                )
                this.m_RecipeContainer.position.set(10, nextY)
                nextY = this.m_RecipeContainer.position.y + this.m_RecipeContainer.height + 20

                // Show recipe that takes entity effects into account
                this.m_RecipeIOContainer.addChild(
                    new Text({
                        text: 'Recipe (takes entity effects into account):',
                        style: styles.dialog.label,
                    })
                )
                const energy_required = recipe.energy_required || 0.5
                // Productivity only applies to recipes that opt into it; when
                // `allow_productivity` is false the engine ignores the bonus
                // entirely (and, with it, each product's `ignored_by_productivity`
                // catalyst floor). This mirrors the module filter in
                // factorioData.ts, which blocks productivity modules on such
                // recipes in the first place.
                const effectiveProductivity = recipe.allow_productivity ? productivity : 0
                // A product/ingredient can express a random yield via
                // amount_min/amount_max and/or probability with no plain `amount`
                // (e.g. SE's cryonite crushing sand by-product); resolve each to
                // its Expected Value up front so the rate never comes out NaN.
                // We collapse to a bare { type, name, amount } here — dropping the
                // randomness fields — so the already-scaled amount survives
                // CreateRecipe re-resolving it (which would otherwise re-apply the
                // probability a second time). Products scale by productivity via
                // getProductAmountWithProductivity, which honours the catalyst
                // rule (`ignored_by_productivity`) so e.g. cryonite's water output
                // — pure catalyst — is left untouched by productivity modules.
                F.CreateRecipe(
                    this.m_RecipeIOContainer,
                    0,
                    20,
                    recipe.ingredients.map(i => ({
                        type: i.type,
                        name: i.name,
                        amount: roundToTwo(
                            (getIngredientAmount(i) * newCraftingSpeed) / energy_required
                        ),
                    })),
                    recipe.results.map(r => ({
                        type: r.type,
                        name: r.name,
                        amount: roundToTwo(
                            (getProductAmountWithProductivity(r, effectiveProductivity) *
                                newCraftingSpeed) /
                                energy_required
                        ),
                    })),
                    1
                )
                this.m_RecipeIOContainer.position.set(10, nextY)
                nextY = this.m_RecipeIOContainer.position.y + this.m_RecipeIOContainer.height + 20
            }
        }

        const isBelt = (e: Entity): boolean =>
            e.entityData.type === 'transport-belt' ||
            e.entityData.type === 'underground-belt' ||
            e.entityData.type === 'splitter' ||
            e.entityData.type === 'loader'

        if (entity.entityData.type === 'inserter') {
            // Details for inserters
            let speed = containerToContainer(
                (entity.entityData as InserterPrototype).rotation_speed,
                entity.inserterStackSize
            )
            const tiles = entity.name === 'long-handed-inserter' ? 2 : 1
            // const fromP = util.rotatePointBasedOnDir([0, -tiles], entity.direction)
            const toP = util.rotatePointBasedOnDir([0, tiles], entity.direction)
            // const from = G.bp.entities.get(
            //     G.bp.entityPositionGrid.getCellAtPosition(
            //         util.sumprod(entity.position, fromP)
            //     )
            // )
            const to = G.bp.entityPositionGrid.getEntityAtPosition(
                util.sumprod(entity.position, toP)
            )
            if (to && isBelt(to)) {
                speed = containerToBelt(
                    (entity.entityData as InserterPrototype).rotation_speed,
                    (to.entityData as TransportBeltConnectablePrototype).speed,
                    entity.inserterStackSize
                )
            }
            this.m_entityInfo.text = `Speed: ${roundToTwo(
                speed
            )} items/s\n> changes if inserter unloads to a belt`
            this.m_entityInfo.position.set(10, nextY)
            nextY = this.m_entityInfo.position.y + this.m_entityInfo.height + 20
        }

        if (isBelt(entity)) {
            // Details for belts
            this.m_entityInfo.text = `Speed: ${roundToTwo(
                getBeltSpeed((entity.entityData as TransportBeltConnectablePrototype).speed)
            )} items/s`
            this.m_entityInfo.position.set(10, nextY)
            nextY = this.m_entityInfo.position.y + this.m_entityInfo.height + 20
        }

        // Phase 0a (read-only): surface circuit settings already in the blueprint —
        // combinator conditions, constant-combinator contents and enable conditions.
        nextY = this.renderCircuitInfo(entity, nextY)
    }

    /**
     * Renders a read-only summary of an entity's circuit/control_behavior settings
     * into `m_CircuitContainer`, returning the new layout cursor `y`. Returns `y`
     * unchanged for entities with nothing circuit-related to show.
     *
     * This is deliberately read-only (Phase 0): it proves we can decode every
     * post-2.0 control_behavior shape across the data packs before any editing UI
     * is built on top. Signal tokens fall back to plain text when the data pack
     * has no icon for them, so modded/virtual signals never crash the panel.
     */
    private renderCircuitInfo(entity: Entity, startY: number): number {
        const container = this.m_CircuitContainer
        const ICON = 20
        const ROW_H = 24

        // Is there anything circuit-related to show?
        const isCombinator =
            entity.type === 'arithmetic-combinator' ||
            entity.type === 'decider-combinator' ||
            entity.type === 'selector-combinator'
        const isConstant = entity.type === 'constant-combinator'
        // A stored condition only takes effect while circuit_enabled is on —
        // the editor keeps the condition across an unchecked box (so re-enabling
        // restores it), and showing it then would misreport the entity as gated.
        const hasEnableCond = entity.circuitEnabled && entity.circuitCondition !== undefined
        const modeLines = entity.circuitModeSummary
        const networks = entity.circuitNetworks
        if (
            !isCombinator &&
            !isConstant &&
            !hasEnableCond &&
            modeLines.length === 0 &&
            networks.length === 0
        )
            return startY

        const hasIcon = (name?: string): boolean =>
            !!name && !!(FD.items[name] || FD.fluids[name] || FD.recipes[name] || FD.signals[name])

        // Render a signal icon (or a plain-text fallback / a constant) into `row`
        // at horizontal offset `x`, returning the next free x.
        const placeToken = (
            row: Container,
            x: number,
            signal?: ISignal,
            constant?: number
        ): number => {
            if (signal?.name && hasIcon(signal.name)) {
                const icon = F.CreateIcon(signal.name, ICON, false)
                icon.position.set(x, 0)
                row.addChild(icon)
                return x + ICON + 4
            }
            const text = signal?.name ?? (constant !== undefined ? String(constant) : '?')
            const label = new Text({ text, style: styles.dialog.label })
            label.position.set(x, 2)
            row.addChild(label)
            return x + label.width + 4
        }

        const placeText = (row: Container, x: number, text: string): number => {
            const label = new Text({ text, style: styles.dialog.label })
            label.position.set(x, 2)
            row.addChild(label)
            return x + label.width + 4
        }

        let y = startY
        const header = new Text({ text: 'Circuit network:', style: styles.dialog.label })
        header.position.set(10, y)
        container.addChild(header)
        y += header.height + 6

        // Network ids (red/green numbers, like the game) when wired.
        if (networks.length > 0) {
            const row = new Container()
            const lbl = placeText(row, 0, 'Networks:')
            const badges = createCircuitNetworkBadges(entity)
            badges.position.set(lbl, 2)
            row.addChild(badges)
            row.position.set(10, y)
            container.addChild(row)
            y += ROW_H
        }

        if (entity.type === 'selector-combinator') {
            // Selectors are word-operations ('select', 'count', 'random', …); the
            // index signal only exists for 'select', so show it conditionally.
            const row = new Container()
            let x = placeText(row, 0, `Operation: ${entity.operator ?? 'select'}`)
            const idx = entity.combinatorConditions?.first_signal
            if (idx?.name) {
                x = placeText(row, x, '·')
                placeToken(row, x, idx)
            }
            row.position.set(10, y)
            container.addChild(row)
            y += ROW_H
        } else if (isCombinator) {
            const { first_signal, second_signal, output_signal } = entity.combinatorConditions ?? {}
            const row = new Container()
            let x = 0
            // Either operand may be a constant instead of a signal; the missing
            // second operand defaults to 0 (matching how Factorio omits it).
            x = placeToken(row, x, first_signal, entity.combinatorFirstConstant)
            x = placeText(row, x, String(entity.operator ?? ''))
            x = placeToken(row, x, second_signal, entity.combinatorConstant ?? 0)
            x = placeText(row, x, '→')
            placeToken(row, x, output_signal)
            row.position.set(10, y)
            container.addChild(row)
            y += ROW_H
        } else if (isConstant) {
            const signals = entity.constantCombinatorSignals
            if (signals.length === 0) {
                const label = new Text({ text: '(empty)', style: styles.dialog.label })
                label.position.set(10, y)
                container.addChild(label)
                y += ROW_H
            } else {
                // Wrap signal icons (with their counts) into rows of 6.
                const PER_ROW = 6
                const STEP = 38
                signals.forEach((s, i) => {
                    const col = i % PER_ROW
                    const line = Math.floor(i / PER_ROW)
                    if (hasIcon(s.name)) {
                        F.CreateIconWithAmount(
                            container,
                            10 + col * STEP,
                            y + line * STEP,
                            s.name,
                            s.count
                        )
                    } else {
                        const label = new Text({ text: s.name, style: styles.dialog.label })
                        label.position.set(10 + col * STEP, y + line * STEP)
                        container.addChild(label)
                    }
                })
                y += (Math.floor((signals.length - 1) / PER_ROW) + 1) * STEP + 4
            }
        }

        if (hasEnableCond) {
            const cond = entity.circuitCondition
            const row = new Container()
            let x = 0
            x = placeText(row, x, 'Enabled if')
            x = placeToken(row, x, cond.first_signal)
            x = placeText(row, x, cond.comparator ?? '<')
            placeToken(row, x, cond.second_signal, cond.constant ?? 0)
            row.position.set(10, y)
            container.addChild(row)
            y += ROW_H
        }

        // Read/set-mode flags (e.g. "Reads hand contents (hold)", "Sets recipe
        // from circuit") — boolean control_behavior settings rendered as text.
        for (const line of modeLines) {
            const label = new Text({ text: line, style: styles.dialog.label })
            label.position.set(10, y)
            container.addChild(label)
            y += ROW_H - 4
        }

        return y
    }

    protected override setPosition(): void {
        // Mobile renders entity info as the website's DOM bottom sheet (#89
        // Phase 2) — hide the canvas panel there (incl. on a live input-mode
        // switch, which re-runs setPosition; don't force-show on the way back:
        // the next hover re-populates it).
        if (inputMode.mode === 'mobile') this.visible = false

        // Pin to the top-right of the UI safe area (below the top chrome band,
        // clear of the rail); scale down on a safe area narrower than the panel
        // (only sub-~290px regions) and clamp so it never spills out.
        const sa = G.safeArea
        const scale = fitToWidthScale(sa.width, this.width)
        this.scale.set(scale)
        this.clampToSafeArea(sa.x + sa.width - this.width * scale + 1, sa.y)
    }
}

/**
 * Every beacon in the entity's blueprint whose supply area reaches it, resolved
 * to the shape the core rate maths consumes. The supply area is the beacon's
 * own footprint grown by its supply_area_distance on every side — beacons
 * differ wildly here (SE alone spans 2x2/range-2 compact to 5x5/range-14
 * wide), so both come from the actual beacon, not the vanilla
 * `FD.entities.beacon` prototype. Range semantics (shared edge = miss) live in
 * `beaconReaches`.
 */
function findBeaconsReaching(entity: Entity): BeaconSource[] {
    const machine = { position: entity.position, size: entity.size }
    return entity.Blueprint.entities
        .filter(e => e.type === 'beacon')
        .map(beacon => ({
            prototype: beacon.entityData as BeaconPrototype,
            modules: resolveModuleNames(beacon.modules),
            quality: beacon.quality,
            footprint: { position: beacon.position, size: beacon.size },
        }))
        .filter(beacon => beaconReaches(beacon, machine))
}

/**
 * Project `entity` into the render-free `EntityInfoData` the DOM bottom sheet
 * consumes (#89 Phase 2). Mirrors `updateVisualization` section by section —
 * machine effects, recipe + effective per-second IO, belt/inserter speeds,
 * circuit summary — through the same module helpers, so the numbers shown on
 * canvas (desktop) and in DOM (mobile) come from one computation.
 */
export function buildEntityInfo(entity: Entity): EntityInfoData {
    const data: EntityInfoData = {
        name: entityDisplayName(entity),
        lines: [],
        circuit: [],
    }

    if (entity.entityData.type === 'assembling-machine') {
        const { speed, productivity, consumption } = computeMachineEffects(
            resolveModuleNames(entity.modules),
            findBeaconsReaching(entity)
        )
        const machineData = entity.entityData as CraftingMachinePrototype
        const newCraftingSpeed =
            machineData.crafting_speed * qualityCraftingSpeedMul(entity.quality) * (1 + speed)
        const newEnergyUsage = parseInt(machineData.energy_usage.slice(0, -2)) * (1 + consumption)
        const fmt = (n: number): string =>
            ` (${Math.sign(n) === 1 ? '+' : '-'}${roundToTwo(Math.abs(n) * 100)}%)`
        data.lines.push(
            `Crafting speed: ${roundToFour(newCraftingSpeed)}${speed ? fmt(speed) : ''}`,
            `Power consumption: ${roundToTwo(newEnergyUsage)} kW${consumption ? fmt(consumption) : ''}`,
            `Productivity bonus: ${Math.sign(productivity) === -1 ? '-' : '+'}${roundToTwo(Math.abs(productivity) * 100)}%`
        )

        const recipe = entity.recipe ? FD.recipes[entity.recipe] : undefined
        if (recipe !== undefined) {
            const energy_required = recipe.energy_required || 0.5
            const effectiveProductivity = recipe.allow_productivity ? productivity : 0
            data.recipe = {
                time: energy_required,
                ingredients: recipe.ingredients.map(i => ({
                    type: i.type,
                    name: i.name,
                    amount: roundToTwo(getIngredientAmount(i)),
                })),
                results: recipe.results.map(r => ({
                    type: r.type,
                    name: r.name,
                    amount: roundToTwo(getProductAmountWithProductivity(r, 0)),
                })),
            }
            data.effectiveRecipe = {
                ingredients: recipe.ingredients.map(i => ({
                    type: i.type,
                    name: i.name,
                    amount: roundToTwo(
                        (getIngredientAmount(i) * newCraftingSpeed) / energy_required
                    ),
                })),
                results: recipe.results.map(r => ({
                    type: r.type,
                    name: r.name,
                    amount: roundToTwo(
                        (getProductAmountWithProductivity(r, effectiveProductivity) *
                            newCraftingSpeed) /
                            energy_required
                    ),
                })),
            }
        }
    }

    const isBelt =
        entity.entityData.type === 'transport-belt' ||
        entity.entityData.type === 'underground-belt' ||
        entity.entityData.type === 'splitter' ||
        entity.entityData.type === 'loader'

    if (entity.entityData.type === 'inserter') {
        // Same to-a-belt refinement as the canvas panel: unloading onto a belt
        // is slower than container-to-container.
        let speed = containerToContainer(
            (entity.entityData as InserterPrototype).rotation_speed,
            entity.inserterStackSize
        )
        const tiles = entity.name === 'long-handed-inserter' ? 2 : 1
        const toP = util.rotatePointBasedOnDir([0, tiles], entity.direction)
        const to = G.bp.entityPositionGrid.getEntityAtPosition(util.sumprod(entity.position, toP))
        const toIsBelt =
            to &&
            (to.entityData.type === 'transport-belt' ||
                to.entityData.type === 'underground-belt' ||
                to.entityData.type === 'splitter' ||
                to.entityData.type === 'loader')
        if (toIsBelt) {
            speed = containerToBelt(
                (entity.entityData as InserterPrototype).rotation_speed,
                (to.entityData as TransportBeltConnectablePrototype).speed,
                entity.inserterStackSize
            )
        }
        data.lines.push(
            `Speed: ${roundToTwo(speed)} items/s`,
            '> changes if inserter unloads to a belt'
        )
    }

    if (isBelt) {
        data.lines.push(
            `Speed: ${roundToTwo(
                getBeltSpeed((entity.entityData as TransportBeltConnectablePrototype).speed)
            )} items/s`
        )
    }

    // Circuit summary, textual (the canvas panel's icon-rich rendering is the
    // richer sibling; the sheet upgrades later). Same circuit_enabled gate as
    // the panel — a stored-but-disabled condition is not in effect.
    data.circuit.push(...entity.circuitModeSummary)
    if (entity.circuitEnabled && entity.circuitCondition !== undefined) {
        const c = entity.circuitCondition
        data.circuit.push(
            `Enabled if ${c.first_signal?.name ?? '?'} ${c.comparator ?? '<'} ${
                c.second_signal?.name ?? c.constant ?? 0
            }`
        )
    }

    return data
}
