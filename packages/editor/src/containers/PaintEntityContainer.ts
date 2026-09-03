import { Container } from 'pixi.js'
import { DirectionType, FilterPriority, IEntity, IPoint } from '../types'
import FD, { getEntitySize, getPossibleRotations } from '../core/factorioData'
import {
    constrainToPossibleDirections,
    entityUsesMirroring,
    flipDirection,
    flipSwapsSplitterPriority,
} from '../core/flip'
import { UndergroundBeltPrototype } from 'factorio:prototype'
import { Entity } from '../core/Entity'
import util from '../common/util'
import { EntitySprite } from './EntitySprite'
import { VisualizationArea } from './VisualizationArea'
import { PaintContainer } from './PaintContainer'
import { BlueprintContainer } from './BlueprintContainer'
import { OverlayContainer } from './OverlayContainer'

export class PaintEntityContainer extends PaintContainer {
    private visualizationArea: VisualizationArea
    private directionType: DirectionType
    private direction: number
    private mirrored: boolean
    /**
     * Placeable settings cloned from Q-pick / copy (recipe, modules, filters,
     * combinator conditions, inserter vectors, quality, …). Identity fields
     * are filled in at redraw/place. Empty object = a hotbar pick with
     * prototype defaults.
     */
    private readonly settings: IEntity
    /** This is only a reference */
    private undergroundLine: Container

    public constructor(
        bpc: BlueprintContainer,
        name: string,
        direction: number,
        template?: IEntity
    ) {
        super(bpc, name)

        this.direction = direction
        this.settings = template
            ? util.duplicate(template)
            : ({ name, position: { x: 0, y: 0 } } as IEntity)
        this.settings.name = name
        this.settings.position = { x: 0, y: 0 }
        this.mirrored = !!this.settings.mirror
        const fd = FD.entities[name]
        // Underground belts: pipette remaps output→input direction; pairing
        // then flips `directionType` as the ghost nears another belt. Loaders
        // keep the picked input/output. Hotbar loaders default to output.
        if (fd.type === 'underground-belt') {
            this.directionType = 'input'
        } else if (fd.type === 'loader') {
            this.directionType = this.settings.type ?? 'output'
        } else {
            this.directionType = this.settings.type ?? 'input'
        }

        this.visualizationArea = this.bpc.underlayContainer.create(this.name, this.position)
        this.visualizationArea.highlight()
        this.bpc.underlayContainer.activateRelatedAreas(this.name)

        this.attachUpdateOn16()
        this.moveAtCursor()
        this.redraw()
    }

    /** The held ghost's current facing (0/4/8/12 for cardinal). Exposed for tests. */
    public getDirection(): number {
        return this.direction
    }

    /** Blueprint `mirror` bit of the held ghost. Exposed for tests. */
    public getMirror(): boolean {
        return this.mirrored
    }

    /** Recipe carried on the ghost (Q-pick / copy). Exposed for tests. */
    public getRecipe(): string | undefined {
        return this.settings.recipe
    }

    private facingDirection(): number {
        return this.directionType === 'input' ? this.direction : (this.direction + 8) % 16
    }

    /**
     * Stub Entity for sprite + alt-mode overlay. Not added to the blueprint —
     * `createEntityInfo` / `getParts` only read prototype + this snapshot.
     */
    private ghostEntity(): Entity {
        const raw = util.duplicate(this.settings)
        raw.entity_number = 0
        raw.name = this.name
        raw.position = { x: 0, y: 0 }
        raw.direction = this.facingDirection()
        raw.mirror = this.mirrored || undefined
        if (!raw.mirror) delete raw.mirror
        const fd = FD.entities[this.name]
        if (fd.type === 'underground-belt' || fd.type === 'loader') {
            raw.type = this.directionType
        }
        return new Entity(raw, this.bpc.bp)
    }

    private swapPriority(priority?: FilterPriority): FilterPriority | undefined {
        if (priority === 'left') return 'right'
        if (priority === 'right') return 'left'
        return priority
    }

    private get size(): IPoint {
        return getEntitySize(FD.entities[this.name], this.direction)
    }

    /** The held ghost is grabbable by touch (drag-to-move). */
    public override containsWorldPoint(x: number, y: number): boolean {
        return this.worldBoundsContain(x, y)
    }

    public hide(): void {
        this.bpc.underlayContainer.deactivateActiveAreas()
        this.destroyUndergroundLine()
        super.hide()
    }

    public show(): void {
        this.bpc.underlayContainer.activateRelatedAreas(this.name)
        this.updateUndergroundLine()
        super.show()
    }

    public destroy(): void {
        this.visualizationArea.destroy()
        this.bpc.underlayContainer.deactivateActiveAreas()
        this.destroyUndergroundLine()
        super.destroy()
    }

    public override getItemName(): string {
        return Entity.getItemName(this.name)
    }

    private checkBuildable(): void {
        const position = this.getGridPosition()
        const direction =
            this.directionType === 'input' ? this.direction : (this.direction + 8) % 16

        if (
            this.bpc.bp.entityPositionGrid.checkFastReplaceableGroup(
                this.name,
                direction,
                position
            ) ||
            this.bpc.bp.entityPositionGrid.checkSameEntityAndDifferentDirection(
                this.name,
                direction,
                position
            ) ||
            this.bpc.bp.entityPositionGrid.isAreaAvailable(this.name, position, direction)
        ) {
            this.blocked = false
        } else {
            this.blocked = true
        }
    }

    private updateUndergroundBeltRotation(): void {
        const fd = FD.entities[this.name]
        if (fd.type === 'underground-belt') {
            const otherEntity = this.bpc.bp.entityPositionGrid.getOpposingEntity(
                this.name,
                (this.direction + 8) % 16,
                {
                    x: this.x / 32,
                    y: this.y / 32,
                },
                this.direction,
                (fd as UndergroundBeltPrototype).max_distance
            )
            if (otherEntity) {
                const oe = this.bpc.bp.entities.get(otherEntity)
                this.directionType = oe.directionType === 'input' ? 'output' : 'input'
            } else {
                if (this.directionType === 'output') {
                    this.directionType = 'input'
                }
            }
            this.redraw()
        }
    }

    private updateUndergroundLine(): void {
        this.destroyUndergroundLine()
        this.undergroundLine = this.bpc.overlayContainer.createUndergroundLine(
            this.name,
            this.getGridPosition(),
            this.directionType === 'input' ? this.direction : (this.direction + 8) % 16,
            this.name === 'pipe-to-ground' ? (this.direction + 8) % 16 : this.direction
        )
    }

    private destroyUndergroundLine(): void {
        if (this.undergroundLine) {
            this.undergroundLine.destroy()
        }
    }

    public override rotate(ccw = false): void {
        const ghost = this.ghostEntity()
        const pr = getPossibleRotations(
            FD.entities[this.name],
            ghost.assemblerHasFluidInputs || ghost.assemblerHasFluidOutputs
        )
        if (pr.length === 0) return
        this.direction = pr[(pr.indexOf(this.direction) + (ccw ? 3 : 1)) % pr.length]

        this.redraw()
        this.moveAtCursor()
    }

    public override flip(vertical: boolean): void {
        const fd = FD.entities[this.name]
        if (entityUsesMirroring(fd)) this.mirrored = !this.mirrored
        const ghost = this.ghostEntity()
        const pr = getPossibleRotations(
            fd,
            ghost.assemblerHasFluidInputs || ghost.assemblerHasFluidOutputs
        )
        if (pr.length !== 0) {
            const next = constrainToPossibleDirections(
                this.direction,
                flipDirection(this.direction, vertical),
                pr
            )
            this.direction = next
        }
        if (flipSwapsSplitterPriority(this.direction, vertical)) {
            this.settings.input_priority = this.swapPriority(this.settings.input_priority)
            this.settings.output_priority = this.swapPriority(this.settings.output_priority)
        }
        this.redraw()
        this.moveAtCursor()
    }

    public override canFlip(): boolean {
        const fd = FD.entities[this.name]
        const ghost = this.ghostEntity()
        return (
            getPossibleRotations(
                fd,
                ghost.assemblerHasFluidInputs || ghost.assemblerHasFluidOutputs
            ).length !== 0 || entityUsesMirroring(fd)
        )
    }

    public override canFlipOrRotateByCopying(): boolean {
        return false
    }

    public override rotatedEntities(_ccw?: boolean): Entity[] {
        return undefined
    }

    public override flippedEntities(_vertical: boolean): Entity[] {
        return undefined
    }

    protected override redraw(): void {
        this.removeChildren()
        const ghost = this.ghostEntity()
        const sprites = EntitySprite.getParts(ghost)
        this.addChild(...sprites)
        // Same alt-mode overlay placed entities get (recipe / modules / filters,
        // fluid arrows, inserter pickup/drop, combinator glyphs). Ghost Entity
        // is not in the blueprint — it only carries the Q-pick / copy snapshot.
        OverlayContainer.attachEntityInfo(this, ghost, { x: 0, y: 0 })
    }

    public override moveAtCursor(): void {
        if (!this.visible) return

        const railRelatedNames = [
            'legacy-straight-rail',
            'straight-rail',
            'half-diagonal-rail',
            'legacy-curved-rail',
            'curved-rail-a',
            'curved-rail-b',
            'train-stop',
        ]
        const firstRailPos = this.bpc.bp.getFirstRailRelatedEntityPos()

        if (railRelatedNames.includes(this.name) && firstRailPos) {
            // grid offsets
            const oX =
                -Math.abs(
                    (Math.abs(this.bpc.gridData.x32) % 2) - (Math.abs(firstRailPos.x - 1) % 2)
                ) + 1
            const oY =
                -Math.abs(
                    (Math.abs(this.bpc.gridData.y32) % 2) - (Math.abs(firstRailPos.y - 1) % 2)
                ) + 1

            this.setPosition({
                x: (this.bpc.gridData.x32 + oX) * 32,
                y: (this.bpc.gridData.y32 + oY) * 32,
            })
        } else {
            this.setNewPosition(this.size)
        }

        this.updateUndergroundBeltRotation()
        this.updateUndergroundLine()

        this.visualizationArea.moveTo(this.position)

        this.checkBuildable()
    }

    public override removeContainerUnder(): void {
        if (!this.visible) return

        const entities = this.bpc.bp.entityPositionGrid.getEntitiesInArea({
            ...this.getGridPosition(),
            w: this.size.x,
            h: this.size.y,
        })
        this.bpc.bp.removeEntities(entities)
        this.checkBuildable()
    }

    public override placeEntityContainer(): void {
        if (!this.visible) return

        const fd = FD.entities[this.name]
        const position = this.getGridPosition()
        const direction =
            this.directionType === 'input' ? this.direction : (this.direction + 8) % 16

        if (this.bpc.bp.fastReplaceEntity(this.name, direction, position)) return

        const snEnt = this.bpc.bp.entityPositionGrid.checkSameEntityAndDifferentDirection(
            this.name,
            direction,
            position
        )
        if (snEnt) {
            snEnt.direction = direction
            snEnt.mirror = this.mirrored
            return
        }

        if (this.bpc.bp.entityPositionGrid.isAreaAvailable(this.name, position, direction)) {
            const raw = util.duplicate(this.settings)
            delete raw.entity_number
            raw.name = this.name
            raw.position = position
            raw.direction = direction
            raw.mirror = this.mirrored || undefined
            if (!raw.mirror) delete raw.mirror
            if (fd.type === 'underground-belt' || fd.type === 'loader') {
                raw.type = this.directionType
            }
            this.bpc.bp.createEntity(raw, true)

            if (fd.type === 'underground-belt' || this.name === 'pipe-to-ground') {
                this.direction = (direction + 8) % 16
                this.redraw()
                this.destroyUndergroundLine()
            }
        }

        this.checkBuildable()
    }
}
