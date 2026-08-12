import { Container, FederatedPointerEvent, Graphics, Rectangle } from 'pixi.js'
import { CircuitNetworkSelection } from '../../../types'
import { networkSelection, toNetworkField } from '../../../core/deciderClauses'

/** Wire colours matching the rendered wires (see testHook's pixel counts). */
const RED = 0xc83718
const GREEN = 0x588c38
const OFF = 0x3a3a3a

/**
 * Per-operand red/green network filter — two stacked squares, tap to toggle.
 * A filled square means that wire's network feeds the operand; the game
 * requires at least one, so switching the last one off is refused. `onChange`
 * gets `undefined` at the both-on default, mirroring how the export omits the
 * field entirely (see `toNetworkField`).
 */
export class NetworkToggle extends Container {
    private red: boolean
    private green: boolean
    private readonly boxes: { red: Graphics; green: Graphics }

    public constructor(
        value: CircuitNetworkSelection | undefined,
        private readonly onChange: (value: CircuitNetworkSelection | undefined) => void
    ) {
        super()
        const v = networkSelection(value)
        this.red = v.red
        this.green = v.green

        this.boxes = { red: new Graphics(), green: new Graphics() }
        this.boxes.red.position.set(0, 0)
        this.boxes.green.position.set(0, 18)
        this.addChild(this.boxes.red, this.boxes.green)
        this.redraw()

        this.eventMode = 'static'
        // One solid hit rect spanning both squares — without it the 3px gap
        // between them isn't hit-testable, and a tap at the control's centre
        // (exactly where e2e and a fat finger land) would fall through.
        this.hitArea = new Rectangle(-2, -2, 19, 37)
        this.on('pointerdown', (e: FederatedPointerEvent) => {
            e.stopPropagation()
            const local = this.toLocal(e.global)
            this.toggle(local.y < 18 ? 'red' : 'green')
        })
    }

    private toggle(which: 'red' | 'green'): void {
        const next = { red: this.red, green: this.green, [which]: !this[which] }
        if (!next.red && !next.green) return // the game requires at least one wire
        this.red = next.red
        this.green = next.green
        this.redraw()
        this.onChange(toNetworkField(this.red, this.green))
    }

    private redraw(): void {
        const draw = (g: Graphics, on: boolean, color: number): void => {
            g.clear()
            g.roundRect(0, 0, 15, 15, 3)
                .fill(on ? color : OFF)
                .stroke({ width: 1, color: on ? 0xffffff : 0x646464, alpha: on ? 0.6 : 1 })
        }
        draw(this.boxes.red, this.red, RED)
        draw(this.boxes.green, this.green, GREEN)
    }
}
