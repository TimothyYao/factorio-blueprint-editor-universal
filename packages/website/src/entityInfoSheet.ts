import { inputMode } from '@fbe/editor'
import type { EntityInfoData, EntityInfoStack } from '@fbe/editor'
import { applyPackIcon } from './packIcons'

// Entity-info sheet (#89 Phase 2): the mobile presentation of the entity info
// panel. The editor dispatches a render-free `EntityInfoData` on every
// hover/tap-select via the `fbe:entityinfo` window event (see
// `UIContainer.updateEntityInfoPanel`); this module renders it as DOM — a
// full-width top sheet in portrait, a bottom-right drawer in landscape (CSS
// decides, see index.styl) — with real game icons through the packIcons seam.
// The Pixi panel stays the desktop presentation; on mobile it's hidden, so
// exactly one renderer is live per input mode.
//
// Placement: the sheet floats over the world (full-bleed canvas) at the *top*
// in portrait — it appears on every tap-select, and the active, reachable area
// of a portrait phone is the bottom of the screen, so the passive readout
// stays out of it (and clear of the bottom-center EDIT Select/Edit bar, which
// always co-occurs with it). z-index below the clusters keeps their buttons
// tappable if they ever overlap on a very short viewport.
export function initEntityInfoSheet(): void {
    const sheet = document.createElement('div')
    sheet.id = 'entity-info-sheet'
    document.body.appendChild(sheet)

    const stackSpan = (stack: EntityInfoStack): HTMLElement => {
        const wrap = document.createElement('span')
        wrap.className = 'eis-stack'
        const icon = document.createElement('span')
        icon.className = 'eis-icon'
        // Text fallback when the pack has no sheet (or the id is unknown).
        if (!applyPackIcon(icon, `${stack.type}/${stack.name}`, 20)) {
            icon.textContent = stack.name
        }
        const amount = document.createElement('span')
        amount.textContent = String(stack.amount)
        wrap.append(icon, amount)
        if (stack.quality) {
            const qBadge = document.createElement('span')
            qBadge.className = 'eis-quality'
            qBadge.textContent = stack.quality.charAt(0).toUpperCase()
            qBadge.title = stack.quality
            wrap.appendChild(qBadge)
        }
        return wrap
    }

    const recipeRow = (
        label: string,
        ingredients: EntityInfoStack[],
        results: EntityInfoStack[],
        arrow: string
    ): HTMLElement => {
        const row = document.createElement('div')
        row.className = 'eis-row'
        const lbl = document.createElement('span')
        lbl.className = 'eis-dim'
        lbl.textContent = label
        row.appendChild(lbl)
        for (const i of ingredients) row.appendChild(stackSpan(i))
        const arr = document.createElement('span')
        arr.className = 'eis-dim'
        arr.textContent = arrow
        row.appendChild(arr)
        for (const r of results) row.appendChild(stackSpan(r))
        return row
    }

    const render = (data: EntityInfoData | null): void => {
        if (!data || inputMode.mode !== 'mobile') {
            sheet.classList.remove('visible')
            return
        }
        sheet.replaceChildren()

        const name = document.createElement('div')
        name.className = 'eis-name'
        name.textContent = data.name
        sheet.appendChild(name)

        for (const line of data.lines) {
            const el = document.createElement('div')
            el.className = 'eis-line'
            el.textContent = line
            sheet.appendChild(el)
        }

        if (data.recipe) {
            sheet.appendChild(
                recipeRow(
                    'Recipe:',
                    data.recipe.ingredients,
                    data.recipe.results,
                    `=${data.recipe.time}s>`
                )
            )
        }
        if (data.effectiveRecipe) {
            sheet.appendChild(
                recipeRow(
                    'Per second:',
                    data.effectiveRecipe.ingredients,
                    data.effectiveRecipe.results,
                    '>'
                )
            )
        }

        for (const line of data.circuit) {
            const el = document.createElement('div')
            el.className = 'eis-line eis-dim'
            el.textContent = line
            sheet.appendChild(el)
        }

        sheet.classList.add('visible')
    }

    window.addEventListener('fbe:entityinfo', e =>
        render((e as CustomEvent<EntityInfoData | null>).detail)
    )
    // A live mobile→desktop switch hands presentation back to the Pixi panel;
    // don't leave a stale sheet floating over it.
    inputMode.on('change', () => {
        if (inputMode.mode !== 'mobile') sheet.classList.remove('visible')
    })
}
