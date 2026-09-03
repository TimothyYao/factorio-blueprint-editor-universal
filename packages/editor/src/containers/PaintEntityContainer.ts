import { Container } from 'pixi.js'
import { DirectionType, IPoint } from '../types'
import FD, { getEntitySize, getPossibleRotations } from '../core/factorioData'
import { constrainToPossibleDirections, entityUsesMirroring, flipDirection } from '../core/flip'
import { UndergroundBeltPrototype } from 'factorio:prototype'
import { Entity } from '../core/Entity'
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
    /** This is only a reference */
    private undergroundLine: Container

    public constructor(bpc: BlueprintContainer, name: string, direction: number, mirror = false) {
        super(bpc, name)

        this.direction = direction
        this.mirrored = mirror
        this.directionType = FD.entities[name].type === 'loader' ? 'output' : 'input'

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
        const pr = getPossibleRotations(FD.entities[this.name])
        if (pr.length === 0) return
        this.direction = pr[(pr.indexOf(this.direction) + (ccw ? 3 : 1)) % pr.length]

        this.redraw()
        this.moveAtCursor()
    }

    public override flip(vertical: boolean): void {
        const fd = FD.entities[this.name]
        if (entityUsesMirroring(fd)) this.mirrored = !this.mirrored
        const pr = getPossibleRotations(fd)
        if (pr.length !== 0) {
            const next = constrainToPossibleDirections(
                this.direction,
                flipDirection(this.direction, vertical),
                pr
            )
            this.direction = next
        }
        this.redraw()
        this.moveAtCursor()
    }

    public override canFlip(): boolean {
        const fd = FD.entities[this.name]
        return getPossibleRotations(fd).length !== 0 || entityUsesMirroring(fd)
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
        const direction =
            this.directionType === 'input' ? this.direction : (this.direction + 8) % 16
        const sprites = EntitySprite.getParts({
            name: this.name,
            direction,
            directionType: this.directionType,
            mirror: this.mirrored,
        })
        this.addChild(...sprites)
        // Same alt-mode overlay placed entities get (drop/pickup arrows on
        // inserters, output arrow on miners/recyclers, combinator/fluid
        // arrows). Stub Entity is not in the blueprint — createEntityInfo
        // only reads prototype + direction.
        OverlayContainer.attachEntityInfo(
            this,
            new Entity(
                {
                    entity_number: 0,
                    name: this.name,
                    position: { x: 0, y: 0 },
                    direction,
                    mirror: this.mirrored || undefined,
                    type:
                        FD.entities[this.name].type === 'underground-belt' ||
                        FD.entities[this.name].type === 'loader'
                            ? this.directionType
                            : undefined,
                },
                this.bpc.bp
            ),
            { x: 0, y: 0 }
        )
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
            this.bpc.bp.createEntity(
                {
                    name: this.name,
                    position,
                    direction,
                    type:
                        fd.type === 'underground-belt' || fd.type === 'loader'
                            ? this.directionType
                            : undefined,
                    mirror: this.mirrored || undefined,
                },
                true
            )

            if (fd.type === 'underground-belt' || this.name === 'pipe-to-ground') {
                this.direction = (direction + 8) % 16
                this.redraw()
                this.destroyUndergroundLine()
            }
        }

        this.checkBuildable()
    }
}
