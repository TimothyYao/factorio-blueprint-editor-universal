import { DeciderCombinatorCondition, DeciderCombinatorOutput, IDeciderCondition } from '../types'

/**
 * The decider editor's working model: the *complete* post-2.0 clause lists.
 *
 * Kept framework-free (no PixiJS) so the invariant that matters most — an edit
 * writes back every clause, not a 1-element array — is unit-testable. The old
 * editor read `conditions[0]`/`outputs[0]` and committed `[thatOne]`, which
 * silently deleted the other clauses of any multi-clause 2.0 combinator the
 * moment you touched a control.
 */
export interface DeciderClauses {
    conditions: DeciderCombinatorCondition[]
    outputs: DeciderCombinatorOutput[]
}

/**
 * Deep-copy the clause lists out of a `decider_conditions` object, normalizing
 * the shapes an editor has to handle:
 *
 * - **post 2.0**: `conditions[]` / `outputs[]` pass through (copied).
 * - **pre 2.0 import**: the flat single-condition fields (`first_signal`,
 *   `comparator`, `output_signal`, …) are lifted into one row each, so a 1.1
 *   blueprint string opens editable instead of blank.
 * - **empty**: seeds one blank condition and one blank output so the editor
 *   always has a row to show.
 */
export function readDeciderClauses(dc: IDeciderCondition): DeciderClauses {
    const conditions: DeciderCombinatorCondition[] = (dc.conditions ?? []).map(c => ({ ...c }))
    const outputs: DeciderCombinatorOutput[] = (dc.outputs ?? []).map(o => ({ ...o }))

    if (
        conditions.length === 0 &&
        (dc.first_signal || dc.comparator || dc.constant !== undefined)
    ) {
        conditions.push({
            first_signal: dc.first_signal,
            first_signal_networks: dc.first_signal_networks,
            second_signal: dc.second_signal,
            second_signal_networks: dc.second_signal_networks,
            constant: dc.constant,
            comparator: dc.comparator,
        })
    }
    if (outputs.length === 0 && dc.output_signal) {
        outputs.push({
            signal: dc.output_signal,
            copy_count_from_input: dc.copy_count_from_input,
        })
    }

    if (conditions.length === 0) conditions.push({})
    if (outputs.length === 0) outputs.push({ signal: undefined })
    return { conditions, outputs }
}

/**
 * Serialize the working model back to the post-2.0 `decider_conditions` shape.
 * Always writes the full lists — clause preservation is structural, not a
 * per-control responsibility — and drops the legacy flat fields so a lifted
 * pre-2.0 blueprint re-serializes in one (2.0) format rather than both.
 */
export function writeDeciderClauses(clauses: DeciderClauses): IDeciderCondition {
    return {
        conditions: clauses.conditions.map(c => ({ ...c })),
        outputs: clauses.outputs.map(o => ({ ...o })),
    }
}

/**
 * Factorio's per-operand network filter defaults to both wires; the export
 * omits the field entirely at the default. Normalize for display…
 */
export function networkSelection(v?: { red?: boolean; green?: boolean }): {
    red: boolean
    green: boolean
} {
    return { red: v?.red !== false, green: v?.green !== false }
}

/** …and back: `undefined` at the default so we serialize like the game. */
export function toNetworkField(
    red: boolean,
    green: boolean
): { red: boolean; green: boolean } | undefined {
    return red && green ? undefined : { red, green }
}
