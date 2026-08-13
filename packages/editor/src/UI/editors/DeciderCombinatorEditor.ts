import { FederatedPointerEvent, Text } from 'pixi.js'
import G from '../../common/globals'
import { Entity } from '../../core/Entity'
import { readDeciderClauses, writeDeciderClauses, DeciderClauses } from '../../core/deciderClauses'
import { ComparatorString, CompareType } from '../../types'
import { CycleButton } from '../controls/CycleButton'
import { Checkbox } from '../controls/Checkbox'
import { NumericField } from '../controls/NumericField'
import { Slot } from '../controls/Slot'
import { styles } from '../style'
import { Editor } from './Editor'
import { Operand } from './components/Operand'
import { SignalSlot } from './components/SignalSlot'
import { NetworkToggle } from './components/NetworkToggle'

const COMPARATORS: ComparatorString[] = ['<', '>', '≤', '≥', '=', '≠']

const ROW_H = 42
const X = 140

/**
 * Decider combinator editor — the full post-2.0 form: any number of conditions
 * (chained with per-row AND/OR) and any number of outputs, with the per-operand
 * red/green network filters. The working model is the *complete* clause lists
 * (`core/deciderClauses.ts`, unit-tested) and every commit writes them back
 * whole — the previous editor committed `[firstClause]` only, silently deleting
 * the rest of a multi-clause combinator on any edit.
 *
 * Row add/remove changes the dialog's height, which `Dialog` fixes at
 * construction — so those rebuild the editor (commit → close → reopen), the
 * same cheap path `ChestEditor` uses to size itself per entity.
 */
export class DeciderCombinatorEditor extends Editor {
    private readonly clauses: DeciderClauses

    public constructor(entity: Entity) {
        const clauses = readDeciderClauses(entity.deciderConditions)
        const nCond = clauses.conditions.length
        const nOut = clauses.outputs.length
        // 45 top pad, a label band + rows + an add-button band per section.
        const condsTop = 45
        const outsTop = condsTop + 19 + nCond * ROW_H + 26 + 10
        super(446, Math.max(190, outsTop + 19 + nOut * ROW_H + 26 + 6), entity)
        this.clauses = clauses

        this.addLabel(X, condsTop, 'Conditions')
        clauses.conditions.forEach((cond, i) => {
            const y = condsTop + 19 + i * ROW_H

            if (i > 0) {
                // Row chaining: Factorio groups consecutive ANDs, ORs between
                // groups; the export omits the default ("or").
                const chain = new CycleButton<CompareType>(
                    ['or', 'and'],
                    cond.compare_type ?? 'or',
                    v => {
                        cond.compare_type = v === 'or' ? undefined : v
                        this.commit()
                    },
                    40
                )
                chain.position.set(X, y)
                this.addChild(this.registerControl(`cond-${i}-chain`, chain))
            }

            const firstNet = new NetworkToggle(cond.first_signal_networks, v => {
                cond.first_signal_networks = v
                this.commit()
            })
            firstNet.position.set(X + 46, y + 2)
            this.addChild(this.registerControl(`cond-${i}-firstNet`, firstNet))

            const first = new SignalSlot(cond.first_signal, signal => {
                cond.first_signal = signal
                this.commit()
            })
            first.position.set(X + 66, y)
            this.addChild(this.registerControl(`cond-${i}-first`, first))

            const cmp = new CycleButton<ComparatorString>(
                COMPARATORS,
                cond.comparator ?? '<',
                v => {
                    cond.comparator = v
                    this.commit()
                }
            )
            cmp.position.set(X + 106, y)
            this.addChild(this.registerControl(`cond-${i}-cmp`, cmp))

            const second = new Operand(
                { signal: cond.second_signal, constant: cond.constant },
                v => {
                    cond.second_signal = v.signal
                    cond.constant = v.signal ? undefined : v.constant
                    this.commit()
                }
            )
            second.position.set(X + 160, y)
            this.addChild(this.registerControl(`cond-${i}-second`, second))

            const secondNet = new NetworkToggle(cond.second_signal_networks, v => {
                cond.second_signal_networks = v
                this.commit()
            })
            secondNet.position.set(X + 200, y + 2)
            this.addChild(this.registerControl(`cond-${i}-secondNet`, secondNet))

            if (nCond > 1) {
                const remove = this.textButton('✕', 20, () => {
                    this.clauses.conditions.splice(i, 1)
                    this.commitAndRebuild()
                })
                remove.position.set(X + 226, y + 7)
                this.addChild(this.registerControl(`cond-${i}-remove`, remove))
            }
        })

        const addCond = this.textButton('+ Add condition', 110, () => {
            this.clauses.conditions.push({})
            this.commitAndRebuild()
        })
        addCond.position.set(X, condsTop + 19 + nCond * ROW_H + 2)
        this.addChild(this.registerControl('addCondition', addCond))

        this.addLabel(X, outsTop, 'Outputs')
        clauses.outputs.forEach((out, i) => {
            const y = outsTop + 19 + i * ROW_H

            const signal = new SignalSlot(out.signal, s => {
                out.signal = s
                this.commit()
            })
            signal.position.set(X, y)
            this.addChild(this.registerControl(`out-${i}-signal`, signal))

            const net = new NetworkToggle(out.networks, v => {
                out.networks = v
                this.commit()
            })
            net.position.set(X + 42, y + 2)
            this.addChild(this.registerControl(`out-${i}-net`, net))

            // Unchecked → a fixed value (default 1, editable); the count field
            // only shows then, mirroring the game's greyed-out input.
            const constant = new NumericField(
                out.constant ?? 1,
                v => {
                    out.constant = v === 1 ? undefined : v
                    this.commit()
                },
                'Output value',
                56
            )
            constant.position.set(X + 234, y + 2)
            constant.visible = out.copy_count_from_input === false
            this.addChild(this.registerControl(`out-${i}-constant`, constant))

            const copy = new Checkbox(out.copy_count_from_input !== false, 'Copy count')
            copy.position.set(X + 66, y + 9)
            copy.on('changed', () => {
                out.copy_count_from_input = copy.checked ? undefined : false
                constant.visible = !copy.checked
                this.commit()
            })
            this.addChild(this.registerControl(`out-${i}-copy`, copy))

            if (nOut > 1) {
                const remove = this.textButton('✕', 20, () => {
                    this.clauses.outputs.splice(i, 1)
                    this.commitAndRebuild()
                })
                remove.position.set(X + 296, y + 7)
                this.addChild(this.registerControl(`out-${i}-remove`, remove))
            }
        })

        const addOut = this.textButton('+ Add output', 110, () => {
            this.clauses.outputs.push({ signal: undefined })
            this.commitAndRebuild()
        })
        addOut.position.set(X, outsTop + 19 + nOut * ROW_H + 2)
        this.addChild(this.registerControl('addOutput', addOut))

        this.declareClearableSlots()
    }

    private textButton(label: string, width: number, onTap: () => void): Slot<undefined> {
        const button = new Slot<undefined>(width, 22)
        const text = new Text({ text: label, style: styles.dialog.label })
        text.anchor.set(0.5)
        button.content = text
        button.on('pointerdown', (e: FederatedPointerEvent) => {
            e.stopPropagation()
            if (e.button !== 0) return
            onTap()
        })
        return button
    }

    private commit(): void {
        this.m_Entity.deciderConditions = writeDeciderClauses(this.clauses)
    }

    /** Row count changed → the fixed-height dialog no longer fits; reopen. */
    private commitAndRebuild(): void {
        this.commit()
        const entity = this.m_Entity
        this.close()
        G.UI.createEditor(entity)
    }
}
