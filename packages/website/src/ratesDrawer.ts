import EDITOR, { formatRate, inputMode } from '@fbe/editor'
import type { RatesData, RatesEntryData } from '@fbe/editor'
import { applyPackIcon } from './packIcons'
import { wrapIconWithQuality } from './qualityOverlay'

// Production-rates drawer (#89 Phase 2): the mobile presentation of the rates
// readout (#87). The editor's RatesPanel stays the state holder and computer —
// it recomputes live (entity add/remove, recipe/module edits) and mirrors
// every result over the `fbe:rates` CustomEvent (null = closed); this module
// renders that projection as a DOM drawer — bottom-right in portrait (the
// reachable band: it's an explicitly toggled overview the user scrolls and
// dismisses, unlike the passive tap-select sheet at the top), top-right in
// landscape. The canvas panel is desktop-only, so exactly one presentation is
// live per input mode; sheet + drawer anchor complementarily so both can be
// open at once, like their desktop counterparts stacked on the right edge.
export function initRatesDrawer(): void {
    const drawer = document.createElement('div')
    drawer.id = 'rates-drawer'
    document.body.appendChild(drawer)

    const iconSpan = (type: string, name: string, size = 20): HTMLElement => {
        const icon = document.createElement('span')
        icon.className = 'rd-icon'
        if (!applyPackIcon(icon, `${type}/${name}`, size)) icon.textContent = name
        return icon
    }

    // Machine counts as icon+×n pairs per machine type — same reasoning as the
    // canvas panel: a bare "×80" next to a rate reads as a rate multiplier.
    const machineSpans = (machines: RatesEntryData['producerMachines']): HTMLElement => {
        const wrap = document.createElement('span')
        wrap.className = 'rd-machines'
        for (const m of machines) {
            wrap.appendChild(iconSpan('item', m.name, 16))
            const n = document.createElement('span')
            n.textContent = `×${m.count}`
            wrap.appendChild(n)
        }
        return wrap
    }

    const row = (entry: RatesEntryData): HTMLElement => {
        const el = document.createElement('div')
        el.className = 'rd-row'
        el.appendChild(wrapIconWithQuality(iconSpan(entry.type, entry.name), entry.quality))

        const isIntermediate = entry.production > 0 && entry.consumption > 0
        const rate = document.createElement('span')
        if (isIntermediate) {
            const net = entry.production - entry.consumption
            rate.className = net >= 0 ? 'rd-net-pos' : 'rd-net-neg'
            rate.textContent = `${net >= 0 ? '+' : '−'}${formatRate(Math.abs(net))}`
            el.appendChild(rate)
            const detail = document.createElement('span')
            detail.className = 'rd-dim'
            detail.textContent = `= ${formatRate(entry.production)} − ${formatRate(entry.consumption)}`
            el.appendChild(detail)
            return el
        }

        rate.textContent = formatRate(entry.production > 0 ? entry.production : entry.consumption)
        el.appendChild(rate)
        el.appendChild(
            machineSpans(entry.production > 0 ? entry.producerMachines : entry.consumerMachines)
        )
        return el
    }

    const render = (data: RatesData | null): void => {
        if (!data || inputMode.mode !== 'mobile') {
            drawer.classList.remove('visible')
            return
        }
        drawer.replaceChildren()

        const header = document.createElement('div')
        header.className = 'rd-header'
        const title = document.createElement('span')
        title.textContent = 'Production rates'
        const close = document.createElement('button')
        close.type = 'button'
        close.className = 'rates-close'
        close.setAttribute('aria-label', 'Close')
        close.textContent = '✕'
        // Route through the same toggle as the keybind / rail button, so the
        // logical state (and its live-recompute subscriptions) stays in the
        // editor's RatesPanel where it lives.
        close.addEventListener('click', () => EDITOR.callAction('showRates'))
        header.append(title, close)
        drawer.appendChild(header)

        if (data.countedMachines === 0) {
            const none = document.createElement('div')
            none.className = 'rd-dim'
            none.textContent = 'No crafting machines with a recipe.'
            drawer.appendChild(none)
        } else {
            const section = (heading: string, rows: RatesEntryData[]): void => {
                if (rows.length === 0) return
                const h = document.createElement('div')
                h.className = 'rd-section'
                h.textContent = heading
                drawer.appendChild(h)
                for (const r of rows) drawer.appendChild(row(r))
            }
            section('Products', data.products)
            section('Intermediates', data.intermediates)
            section('Ingredients', data.ingredients)
        }

        const skipped =
            data.machinesWithoutRecipe > 0 ? ` · ${data.machinesWithoutRecipe} without recipe` : ''
        const footer = document.createElement('div')
        footer.className = 'rd-dim'
        footer.textContent = `${data.countedMachines} machine${
            data.countedMachines === 1 ? '' : 's'
        } counted${skipped}`
        drawer.appendChild(footer)

        drawer.classList.add('visible')
    }

    window.addEventListener('fbe:rates', e => render((e as CustomEvent<RatesData | null>).detail))
    // A live mobile→desktop switch hands presentation back to the Pixi panel.
    inputMode.on('change', () => {
        if (inputMode.mode !== 'mobile') drawer.classList.remove('visible')
    })
}
