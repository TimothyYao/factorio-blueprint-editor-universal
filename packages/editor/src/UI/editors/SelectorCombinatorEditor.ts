import { Entity } from '../../core/Entity'
import { ComparatorString, SelectorCombinatorOperation } from '../../types'
import { Switch } from '../controls/Switch'
import { Enable } from '../controls/Enable'
import { CycleButton } from '../controls/CycleButton'
import { Checkbox } from '../controls/Checkbox'
import { QualityRow } from '../controls/QualityRow'
import { SignalSlot } from './components/SignalSlot'
import { qualityUi } from '../../common/qualityUi'
import { Editor } from './Editor'

const OPERATIONS: SelectorCombinatorOperation[] = [
    'select',
    'count',
    'random',
    'stack-size',
    'rocket-capacity',
    'quality-filter',
    'quality-transfer',
]

/**
 * Selector combinator editor. Operation picker plus the quality-filter /
 * quality-transfer knobs (issue #5 slice 4).
 */
export class SelectorCombinatorEditor extends Editor {
    public constructor(entity: Entity) {
        super(420, qualityUi.enabled ? 230 : 150, entity)

        const x = 140
        this.addLabel(x, 50, 'Operation:')
        const extras = new (class {
            filter?: QualityRow
            fromSignal?: Checkbox
            source?: QualityRow
            dest?: SignalSlot
        })()

        const refreshExtras = (): void => {
            const op = (entity.operator as SelectorCombinatorOperation) ?? 'select'
            if (extras.filter) extras.filter.visible = op === 'quality-filter'
            if (extras.fromSignal) extras.fromSignal.visible = op === 'quality-transfer'
            if (extras.source) extras.source.visible = op === 'quality-transfer'
            if (extras.dest) extras.dest.visible = op === 'quality-transfer'
        }

        const op = new CycleButton<SelectorCombinatorOperation>(
            OPERATIONS,
            (entity.operator as SelectorCombinatorOperation) ?? 'select',
            v => {
                entity.selectorOperation = v
                refreshExtras()
            },
            150
        )
        op.position.set(x, 70)
        this.addChild(op)

        // Min/max toggle (only meaningful for the `select` operation).
        const isMax = entity.selectorCombinatorSelectMax
        const minLabel = new Enable(!isMax, 'Min')
        minLabel.position.set(x, 116)
        this.addChild(minLabel)

        const maxSwitch = new Switch(['min', 'max'], isMax ? 'max' : 'min')
        maxSwitch.position.set(x + 50, 116)
        maxSwitch.on('changed', () => {
            entity.selectorSelectMax = maxSwitch.value === 'max'
            minLabel.active = maxSwitch.value === 'min'
            maxLabel.active = maxSwitch.value === 'max'
        })
        this.addChild(maxSwitch)

        const maxLabel = new Enable(isMax, 'Max')
        maxLabel.position.set(x + 100, 116)
        this.addChild(maxLabel)

        if (qualityUi.enabled) {
            extras.filter = new QualityRow({
                value: entity.selectorQualityFilter.quality,
                includeAny: true,
                showComparator: true,
                comparator: entity.selectorQualityFilter.comparator ?? '=',
                onChange: q => {
                    entity.selectorQualityFilter = {
                        ...entity.selectorQualityFilter,
                        quality: q,
                    }
                },
                onComparator: (c: ComparatorString) => {
                    entity.selectorQualityFilter = {
                        ...entity.selectorQualityFilter,
                        comparator: c,
                    }
                },
            })
            extras.filter.position.set(12, 150)
            this.addChild(extras.filter)

            extras.fromSignal = new Checkbox(
                entity.selectorQualityFromSignal,
                'Quality from signal'
            )
            extras.fromSignal.position.set(12, 182)
            extras.fromSignal.on('changed', () => {
                entity.selectorQualityFromSignal = extras.fromSignal!.checked
            })
            this.addChild(extras.fromSignal)

            extras.source = new QualityRow({
                value: entity.selectorQualitySourceStatic,
                includeAny: true,
                anyLabel: 'Nrm',
                onChange: q => {
                    entity.selectorQualitySourceStatic = q
                },
            })
            extras.source.position.set(12, 204)
            this.addChild(extras.source)

            extras.dest = new SignalSlot(
                entity.selectorQualityDestSignal,
                s => {
                    entity.selectorQualityDestSignal = s
                },
                false,
                'Quality destination'
            )
            extras.dest.position.set(370, 182)
            this.addChild(extras.dest)

            refreshExtras()
        }
    }
}
