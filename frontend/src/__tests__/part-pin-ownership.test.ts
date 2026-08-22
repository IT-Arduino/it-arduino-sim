// @vitest-environment jsdom
/**
 * A part that models its own line must keep it — on every board.
 *
 * connectDigitalInputsToMcu thresholds the solved node into each input pin, and
 * its `sourcedNets` gate is not a real guard: it only holds while NOTHING
 * electrical sits on the net. Wire the sensor the way the hardware needs it — a
 * pull-up on a DHT22, the 1k/2k2 divider a 5 V HC-SR04 needs to reach a 3.3 V
 * pad — and the net becomes component-backed, solves at what the passives say,
 * and the connector starts pinning the very line the sensor is pulsing.
 *
 * partPinOwnership is the rule that fixes it for every board at once, and this
 * test pins both halves of it: the unmodelled part keeps its pin, and the part
 * SPICE does model (a button) still reads the real circuit.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  claimPartPin,
  releasePartPins,
  isPartOwnedPin,
  clearPartPinOwnership,
  withPartPinOwnership,
} from '../simulation/partPinOwnership';

describe('part pin ownership', () => {
  beforeEach(() => clearPartPinOwnership());

  it('claims and releases per component', () => {
    claimPartPin('uno', 10, 'sr04-1');
    expect(isPartOwnedPin('uno', 10)).toBe(true);
    expect(isPartOwnedPin('uno', 11)).toBe(false);
    expect(isPartOwnedPin('esp32', 10)).toBe(false); // per board, not global
    releasePartPins('sr04-1');
    expect(isPartOwnedPin('uno', 10)).toBe(false);
  });

  it('keeps a pin owned while a second component still claims it', () => {
    claimPartPin('uno', 4, 'a');
    claimPartPin('uno', 4, 'b');
    releasePartPins('a');
    expect(isPartOwnedPin('uno', 4)).toBe(true);
    releasePartPins('b');
    expect(isPartOwnedPin('uno', 4)).toBe(false);
  });

  it('claims what an unmodelled part drives, through the wrapper', () => {
    const calls: Array<[string, unknown[]]> = [];
    const sim = {
      setPinState: (...a: unknown[]) => calls.push(['setPinState', a]),
      schedulePinChange: (...a: unknown[]) => calls.push(['schedulePinChange', a]),
      registerSensor: (...a: unknown[]) => {
        calls.push(['registerSensor', a]);
        return true;
      },
    };
    // hc-sr04 has no SPICE mapper: nothing but the part describes ECHO.
    const wrapped = withPartPinOwnership(sim, 'esp32-s3', 'sr04-1', 'hc-sr04') as typeof sim;

    wrapped.setPinState(41, false);
    expect(isPartOwnedPin('esp32-s3', 41)).toBe(true);

    wrapped.schedulePinChange(7, true, 1000);
    expect(isPartOwnedPin('esp32-s3', 7)).toBe(true);

    // A backend sensor owns its data pin AND every extra pin its props name.
    wrapped.registerSensor('hc-sr04', 21, { distance: 30, echo_pin: 41 });
    expect(isPartOwnedPin('esp32-s3', 21)).toBe(true);

    // Everything still reached the real simulator.
    expect(calls.map((c) => c[0])).toEqual([
      'setPinState',
      'schedulePinChange',
      'registerSensor',
    ]);
  });

  it('never claims for a part the netlist already describes', () => {
    const sim = { setPinState: vi.fn() };
    // A pushbutton IS in SPICE. The solved circuit stays the truth for it —
    // that is what makes a mis-wired button read stuck instead of "working".
    const wrapped = withPartPinOwnership(sim, 'uno', 'btn-1', 'pushbutton') as typeof sim;
    wrapped.setPinState(2, false);
    expect(sim.setPinState).toHaveBeenCalledWith(2, false);
    expect(isPartOwnedPin('uno', 2)).toBe(false);
  });

  it('leaves lazy getters and method binding intact', () => {
    let built = 0;
    const sim = {
      pinManager: { id: 'pm' },
      _spi: null as null | { tag: string },
      get spi() {
        if (!this._spi) {
          built += 1;
          this._spi = { tag: 'adapter' };
        }
        return this._spi;
      },
      value: 7,
      readValue(this: { value: number }) {
        return this.value;
      },
    };
    const wrapped = withPartPinOwnership(sim, 'uno', 'x-1', 'hc-sr04') as typeof sim;
    expect(wrapped.pinManager).toEqual({ id: 'pm' });
    expect(wrapped.spi).toBe(wrapped.spi); // memoised on the real object, once
    expect(built).toBe(1);
    expect(wrapped.readValue()).toBe(7); // `this` is the target, not the proxy
  });
});
