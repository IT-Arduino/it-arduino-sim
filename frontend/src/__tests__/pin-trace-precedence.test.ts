// @vitest-environment jsdom
/**
 * What the wire walk answers when a net offers more than one answer.
 *
 * These are the cases that decide whether walking the WHOLE node (rather than
 * a single chain) is safe. Each topology below is one a user really draws, and
 * each one broke a plausible implementation of the divider fix:
 *
 *  - a ground tie point almost always has something else on it (a button's
 *    pull-down, a decoupling cap). If reaching a rail did not END the walk,
 *    a grounded pin would resolve to whatever GPIO the pull-down hangs off;
 *  - a resistor lead used as a tie point can put a custom chip one hop away
 *    from a pin that also reaches a real GPIO. The board pin has to win, even
 *    when the chip is found first;
 *  - the depth budget is spent by CROSSING parts, so a long chain explored
 *    first must not make a shorter route to the same pin unreachable.
 *
 * Every case here fails on the first cut of the fix (57325aa), which returned
 * the first non-null answer any branch produced.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { traceDetailed, traceBoardGpio } from '../simulation/PinTrace';

const BOARD = 'arduino-uno';

const wire = (id: string, a: [string, string], b: [string, string]) => ({
  id,
  waypoints: [],
  color: '#000',
  start: { componentId: a[0], pinName: a[1], x: 0, y: 0 },
  end: { componentId: b[0], pinName: b[1], x: 0, y: 0 },
});

function load(components: unknown[], wires: unknown[]) {
  useSimulatorStore.setState({ boards: [], components: [], wires: [] } as never);
  useSimulatorStore.getState().addBoard('arduino-uno' as never, 0, 0, BOARD);
  const s = useSimulatorStore.getState();
  s.setComponents(components as never);
  s.setWires(wires as never);
  return useSimulatorStore.getState();
}

const R = (id: string, metadataId = 'resistor-1k') => ({
  id,
  metadataId,
  x: 0,
  y: 0,
  properties: { value: '1000' },
});

describe('what wins on a net', () => {
  beforeEach(() => useSimulatorStore.setState({ boards: [], components: [], wires: [] } as never));

  it('a node that touches a rail IS the rail, whatever hangs off it', () => {
    // The LED's cathode is soldered to the same lead as a button's pull-down,
    // and that lead goes to GND. The cathode is grounded — it is not "wired to
    // D2" just because the pull-down's other leg is.
    const state = load(
      [{ id: 'led1', metadataId: 'led', x: 0, y: 0, properties: {} }, R('r-pulldown')],
      [
        wire('g1', ['led1', 'C'], ['r-pulldown', '2']),
        wire('g2', ['r-pulldown', '2'], [BOARD, 'GND']),
        wire('g3', ['r-pulldown', '1'], [BOARD, '2']),
      ],
    );
    expect(traceDetailed(state as never, 'led1', 'C', 0).arduinoPin).toBe(-1);
  });

  it('but a rail BEHIND a component never hides a GPIO on the near side', () => {
    // The divider shape: the walk crosses the top resistor, and the tap it
    // lands on carries both the lower resistor (to GND) and the wire to D7.
    const state = load(
      [R('r-top'), R('r-bot', 'resistor-2k2')],
      [
        wire('d1', ['sensor', 'ECHO'], ['r-top', '1']),
        wire('d2', ['r-top', '2'], ['r-bot', '1']),
        wire('d3', ['r-bot', '2'], [BOARD, 'GND']),
        wire('d4', ['r-bot', '1'], [BOARD, '7']),
      ],
    );
    expect(traceDetailed(state as never, 'sensor', 'ECHO', 0).arduinoPin).toBe(7);
  });

  it('a real board pin beats a custom chip found first', () => {
    // Wire order is the trap: the chip branch is drawn first, so a walk that
    // returns the first non-null answer hands back a synthetic chip pin and
    // never looks at the wire to D5 on the very same node.
    const state = load(
      [R('r-tie'), { id: 'chip1', metadataId: 'custom-chip', x: 0, y: 0, properties: {} }],
      [
        wire('c1', ['part1', 'OUT'], ['r-tie', '1']),
        wire('c2', ['r-tie', '1'], ['chip1', 'PIN1']),
        wire('c3', ['part1', 'OUT'], [BOARD, '5']),
      ],
    );
    expect(traceDetailed(state as never, 'part1', 'OUT', 0).arduinoPin).toBe(5);
  });

  it('still falls back to the chip pin when no board pin is reachable', () => {
    const state = load(
      [R('r-tie'), { id: 'chip1', metadataId: 'custom-chip', x: 0, y: 0, properties: {} }],
      [
        wire('c1', ['part1', 'OUT'], ['r-tie', '1']),
        wire('c2', ['r-tie', '1'], ['chip1', 'PIN1']),
      ],
    );
    const hit = traceDetailed(state as never, 'part1', 'OUT', 0).arduinoPin;
    expect(hit).not.toBeNull();
    expect(hit).toBeGreaterThanOrEqual(100000); // synthetic chip-pin space
  });

  it('a long dead end explored first does not hide a shorter route', () => {
    // Six resistors in series reach the tie point at the very edge of the
    // depth budget, so its own continuation is cut. The same tie point is one
    // resistor away from the start — that shorter route must still be walked,
    // and it reaches D4.
    const chain = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
    const comps = [...chain.map((id) => R(id)), R('r-short'), R('r-far')];
    const wires = [wire('s0', ['part1', 'OUT'], ['r1', '1'])];
    for (let i = 0; i < chain.length - 1; i++) {
      wires.push(wire(`s${i + 1}`, [chain[i], '2'], [chain[i + 1], '1']));
    }
    // The long chain lands on the tie point (r-far's near lead) at max depth.
    wires.push(wire('s-tie', ['r6', '2'], ['r-far', '1']));
    // The short route to the SAME tie point, drawn last on purpose.
    wires.push(wire('t1', ['part1', 'OUT'], ['r-short', '1']));
    wires.push(wire('t2', ['r-short', '2'], ['r-far', '1']));
    // And the tie point reaches D4 by crossing one more resistor.
    wires.push(wire('t3', ['r-far', '2'], [BOARD, '4']));
    const state = load(comps, wires);
    expect(traceDetailed(state as never, 'part1', 'OUT', 0).arduinoPin).toBe(4);
  });
});

describe('nets whose answer is not a board pin', () => {
  beforeEach(() => useSimulatorStore.setState({ boards: [], components: [], wires: [] } as never));

  it('two chips on one wire share ONE net key', async () => {
    // The chip bus exists so a write on one chip is visible to the other
    // through the same PinManager key. A walk that answers with the chip it
    // happened to reach first hands each endpoint its own key, and the two
    // chips stop hearing each other — with every symptom pointing at the
    // chips rather than at the walk.
    const { setChipBusEnabledForTest, resolveChipNetKey } = await import(
      '../simulation/customChips/chipNets'
    );
    setChipBusEnabledForTest(true);
    try {
      useSimulatorStore.setState({ boards: [], components: [], wires: [] } as never);
      const s = useSimulatorStore.getState();
      s.setComponents([
        { id: 'driver', metadataId: 'custom-chip', x: 0, y: 0, properties: {} },
        { id: 'reader', metadataId: 'custom-chip', x: 0, y: 0, properties: {} },
      ] as never);
      s.setWires([wire('bus', ['driver', 'D0'], ['reader', 'D0'])] as never);
      const state = useSimulatorStore.getState();
      const a = traceDetailed(state as never, 'driver', 'D0', 0).arduinoPin;
      const b = traceDetailed(state as never, 'reader', 'D0', 0).arduinoPin;
      expect(a).toBe(b);
      expect(a).toBe(resolveChipNetKey(state as never, 'driver', 'D0'));
    } finally {
      setChipBusEnabledForTest(null);
    }
  });

  it('a ground plane on a breadboard rail is still ground', () => {
    // Same rule as the tie point, through the shape people actually build: the
    // strip joins the cathode, the board's GND and a pull-down whose far leg
    // is a GPIO. Which hole the walk happens to reach first must not decide it.
    const state = load(
      [
        { id: 'seg7', metadataId: '7segment', x: 0, y: 0, properties: {} },
        { id: 'bb', metadataId: 'breadboard', x: 0, y: 0, properties: {} },
        R('r-pd', 'resistor-10k'),
      ],
      [
        wire('b1', ['seg7', 'COM'], ['bb', 'bn.1']),
        wire('b2', ['r-pd', '2'], ['bb', 'bn.20']),
        wire('b3', ['r-pd', '1'], [BOARD, '2']),
        wire('b4', [BOARD, 'GND'], ['bb', 'bn.10']),
      ],
    );
    expect(traceDetailed(state as never, 'seg7', 'COM', 0).arduinoPin).toBe(-1);
  });
});

describe('cost of walking the net', () => {
  // Walking the whole node is not free, and the shape that hurts is the one
  // every real canvas has: a ground rail with dozens of legs on it. This is a
  // guard rail, not a benchmark — it exists so a future change that turns the
  // walk quadratic again shows up here instead of as "the canvas feels slow".
  it('stays well under a millisecond per pin on a 300-wire canvas', () => {
    useSimulatorStore.setState({ boards: [], components: [], wires: [] } as never);
    useSimulatorStore.getState().addBoard('arduino-uno' as never, 0, 0, BOARD);
    const comps: unknown[] = [{ id: 'bb', metadataId: 'breadboard', x: 0, y: 0, properties: {} }];
    const wires: unknown[] = [wire('gnd', [BOARD, 'GND'], ['bb', 'bn.1'])];
    const N = 100;
    for (let i = 0; i < N; i++) {
      comps.push({ id: `led${i}`, metadataId: 'led', x: 0, y: 0, properties: {} });
      comps.push({ id: `r${i}`, metadataId: 'resistor-1k', x: 0, y: 0, properties: { value: '1000' } });
      wires.push(wire(`w${i}a`, [`led${i}`, 'C'], [`r${i}`, '1']));
      wires.push(wire(`w${i}b`, [`r${i}`, '2'], ['bb', `bn.${(i % 28) + 2}`]));
      wires.push(wire(`w${i}c`, [`led${i}`, 'A'], [BOARD, String((i % 12) + 2)]));
    }
    const s = useSimulatorStore.getState();
    s.setComponents(comps as never);
    s.setWires(wires as never);
    const state = useSimulatorStore.getState();

    // The anodes go straight to a GPIO — the common case, and the one the
    // early exit is for.
    let t0 = performance.now();
    for (let i = 0; i < N; i++) {
      expect(traceDetailed(state as never, `led${i}`, 'A', 0).arduinoPin).toBe((i % 12) + 2);
    }
    const perDriven = (performance.now() - t0) / N;

    // The cathodes all land on the same rail — the worst case, where the whole
    // node has to be collected before "ground" is certain.
    t0 = performance.now();
    for (let i = 0; i < N; i++) {
      expect(traceDetailed(state as never, `led${i}`, 'C', 0).arduinoPin).toBe(-1);
    }
    const perRail = (performance.now() - t0) / N;

    console.log(
      `[pin-trace] 301 wires: ${perDriven.toFixed(3)} ms/pin driven, ` +
        `${perRail.toFixed(3)} ms/pin on the shared rail`,
    );
    expect(perDriven).toBeLessThan(3);
    expect(perRail).toBeLessThan(8);
  });
});

describe('a net shared by two boards', () => {
  it('answers each board its own pad', () => {
    // One sensor line wired to a GPIO on BOTH boards. Whoever pre-registers
    // the sensor for board B must learn B's pad, whatever order the wires
    // were drawn in — the walk must not stop at A's pad and report "not on B".
    useSimulatorStore.setState({ boards: [], components: [], wires: [] } as never);
    useSimulatorStore.getState().addBoard('arduino-uno' as never, 0, 0, 'uno-a');
    useSimulatorStore.getState().addBoard('esp32' as never, 0, 0, 'esp-b');
    const s = useSimulatorStore.getState();
    s.setComponents([]);
    s.setWires([
      wire('x1', ['sensor', 'ECHO'], ['uno-a', '7']),
      wire('x2', ['sensor', 'ECHO'], ['esp-b', '19']),
    ] as never);
    const state = useSimulatorStore.getState();
    expect(traceBoardGpio(state as never, 'sensor', 'ECHO', 'uno-a')).toBe(7);
    expect(traceBoardGpio(state as never, 'sensor', 'ECHO', 'esp-b')).toBe(19);
    // And a board the net never reaches is still "not here".
    expect(traceBoardGpio(state as never, 'sensor', 'ECHO', 'nope')).toBeNull();
  });
});
