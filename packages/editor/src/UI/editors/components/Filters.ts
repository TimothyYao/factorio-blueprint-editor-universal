import { Text, Container } from 'pixi.js'
import EventEmitter from 'eventemitter3'
import FD from '../../../core/factorioData'
import G from '../../../common/globals'
import F from '../../controls/functions'
import { Slot } from '../../controls/Slot'
import { bindSlotGestures } from '../../controls/gestures'
import { Entity, EntityEvents, IFilter } from '../../../core/Entity'
import { ComparatorString } from '../../../types'

/** Module Slots for Entity */
export class Filters extends Container<Slot<number>> {
    /* Blueprint Splitters
    ########################
    entity_number: 1
    filter: "assembling-machine-2"
    input_priority: "right"
    name: "express-splitter"
    output_priority: "left"
    position: { x: -0.5, y: 0 }
    // Filter Slots: 1
    // Filter Count: N/A
    */

    /* Blueprint Filter Inserters
    ########################
    entity_number: 1
    filters: Array(2)
        0: {index: 1, name: "long-handed-inserter"}
        1: {index: 2, name: "inserter"}
    name: "filter-inserter"
    override_stack_size: 3
    position: {x: -1, y: 0}
    // Filter Slots: 5
    // Filter Count: N/A >> Does not need to be written
    ########################
    entity_number: 2
    filters: Array(1)
        0: {index: 1, name: "express-transport-belt"}
    length: 1
    name: "stack-filter-inserter"
    override_stack_size: 10
    position: {x: 0, y: 0}
    // Filter Slots: 1
    // Filter Count: N/A >> Does not need to be written
    */

    /* Blueprint Logist Chests
    ########################
    entity_number: 2
    name: "storage-chest"
    position: {x: 0, y: 0}
    request_filters: Array(1)
        0: {index: 1, name: "assembling-machine-2", count: 0}
    // Filter Slots: 1
    // Filter Count: N/A >> Needs to be written as 0
    ########################
    entity_number: 4
    name: "requester-chest"
    position: {x: 0, y: 2}
    request_filters: Array(1)
        0: {index: 1, name: "storage-chest", count: 50}
    request_from_buffers: true
    // Filter Slots: 12
    // Filter Count: Stack Size
    ########################
    entity_number: 5
    name: "buffer-chest"
    position: {x: 0, y: 1}
    request_filters: Array(2)
        0: {index: 1, name: "assembling-machine-2", count: 50}
        1: {index: 2, name: "assembling-machine-3", count: 10}
    // Filter Slots: 12
    // Filter Count: Stack Size
    */

    /** Blueprint Editor Entity reference */
    private readonly m_Entity: Entity

    /** Field to indicate whether counts shall be shown (Used for 2 chests) */
    private readonly m_Amount: boolean

    /** Field to hold data for module visualization */
    private m_Filters: IFilter[]

    public constructor(entity: Entity, amount = false) {
        super()

        // Store entity data reference for later usage
        this.m_Entity = entity
        this.m_Amount = amount

        // Get filters from entity
        this.m_UpdateFilters()

        // Create slots for entity
        for (let slotIndex = 0; slotIndex < this.m_Filters.length; slotIndex++) {
            const slot = new Slot<number>()
            slot.position.set(Math.floor((slotIndex % 6) * 38), Math.floor(slotIndex / 6) * 38)
            slot.data = slotIndex
            bindSlotGestures(
                slot,
                () => this.activate(slotIndex),
                () => this.clear(slotIndex)
            )
            this.addChild(slot)
        }
        this.m_UpdateSlots()

        // Listen to filter changes on entity
        this.onEntityChange('filters', () => {
            this.m_UpdateFilters()
            this.m_UpdateSlots()
        })
    }

    private onEntityChange<T extends EventEmitter.EventNames<EntityEvents>>(
        event: T,
        fn: EventEmitter.EventListener<EntityEvents, T>
    ): void {
        this.m_Entity.on(event, fn)
        this.once('destroyed', () => this.m_Entity.off(event, fn))
    }

    /**
     * Update filter count
     * @param index - Index of filter
     * @param count - New count
     */
    public updateFilter(index: number, count: number): void {
        if (this.m_Filters[index].count === count) return
        this.m_Filters[index].count = count
        this.m_Entity.filters = this.m_Filters
        this.m_UpdateSlots()
    }

    /**
     * Return filter count of specific filter
     * @param index Index of filter
     */
    public getFilterCount(index: number): number {
        return this.m_Filters[index].count
    }

    /** Update local filters array */
    private m_UpdateFilters(): void {
        const slots = this.m_Entity.filterSlots
        if (slots > 0) {
            this.m_Filters = new Array(slots)
            const filters = this.m_Entity.filters
            if (filters !== undefined) {
                for (const item of filters) {
                    this.m_Filters[item.index - 1] = {
                        index: item.index,
                        name: item.name,
                        count: item.count,
                        ...(item.quality ? { quality: item.quality } : {}),
                        ...(item.comparator ? { comparator: item.comparator } : {}),
                    }
                }
            }
            for (let slotIndex = 0; slotIndex < slots; slotIndex++) {
                this.m_Filters[slotIndex] =
                    this.m_Filters[slotIndex] === undefined
                        ? { index: slotIndex + 1, name: undefined }
                        : this.m_Filters[slotIndex]
            }
        }
    }

    /** Update slot icons */
    private m_UpdateSlots(): void {
        for (const slot of this.children) {
            const slotIndex = slot.data
            const slotFilter = this.m_Filters[slotIndex]

            if (slotFilter.name === undefined) {
                if (slot.content !== undefined) {
                    slot.content = undefined
                }
                slot.label = ''
            } else {
                // `label` caches quality so a same-name / different-tier edit
                // still rebuilds the badge (Pixi Container.label, unused elsewhere).
                const qualityKey = slotFilter.quality || ''
                if (
                    slot.content === undefined ||
                    slot.name !== slotFilter.name ||
                    slot.label !== qualityKey ||
                    this.m_Amount
                ) {
                    if (this.m_Amount) {
                        if (slot.content !== undefined) {
                            const text = slot.children[1] as Text
                            if (text.text !== slotFilter.count.toString()) {
                                slot.content = undefined
                            }
                        }
                        const container = new Container()
                        F.CreateIconWithAmount(
                            container,
                            -16,
                            -16,
                            slotFilter.name,
                            slotFilter.count,
                            undefined,
                            undefined,
                            slotFilter.quality
                        )
                        slot.content = container
                    } else {
                        slot.content = F.CreateIcon(
                            slotFilter.name,
                            32,
                            true,
                            false,
                            slotFilter.quality
                        )
                    }
                    slot.name = slotFilter.name
                    slot.label = slotFilter.quality || ''
                }
            }
        }

        this.emit('changed')
    }

    /**
     * Tap/left-click. An *empty* slot (or any slot on a countless entity) opens
     * the filter picker; on a counted entity a *filled* slot instead hands the
     * index to the editor's count field, which is what you nearly always want
     * once the filter itself is set.
     */
    private activate(index: number): void {
        if (this.m_Amount && this.m_Filters[index].name !== undefined) {
            this.emit('selected', index, this.m_Filters[index].count)
            return
        }

        this.emit('selection-started')
        const inv = G.UI.createInventory(
            'Select Filter',
            this.m_Entity.acceptedFilters,
            (name, quality, comparator) => {
                this.m_Filters[index].name = name
                if (quality) {
                    this.m_Filters[index].quality = quality
                    this.m_Filters[index].comparator = (comparator as ComparatorString) || '='
                } else {
                    delete this.m_Filters[index].quality
                    delete this.m_Filters[index].comparator
                }
                if (this.m_Amount) {
                    this.m_Filters[index].count = FD.items[name].stack_size
                }
                this.m_Entity.filters = this.m_Filters

                if (this.m_Amount) {
                    this.emit('selected', index, this.m_Filters[index].count)
                }
            },
            undefined,
            // "✕ Clear" on a filled slot, "✕ Cancel" on an empty one — either way
            // it leaves the slot empty and closes.
            { onClear: () => this.clear(index), filled: this.m_Filters[index].name !== undefined },
            {
                quality: true,
                comparator: true,
                initialQuality: this.m_Filters[index].quality,
                initialComparator: this.m_Filters[index].comparator,
            }
        )
        inv.on('close', () => this.emit('selection-ended'))
    }

    /** Long-press / right-click (or the picker's ✕ Clear): empty the slot. */
    private clear(index: number): void {
        this.m_Filters[index].name = undefined
        delete this.m_Filters[index].quality
        delete this.m_Filters[index].comparator
        this.m_Entity.filters = this.m_Filters
        if (this.m_Amount) {
            this.emit('selected', -1, 0)
        }
    }
}
