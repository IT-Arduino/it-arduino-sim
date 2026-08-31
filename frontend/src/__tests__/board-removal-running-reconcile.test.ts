// @vitest-environment jsdom
/**
 * Regression tests for three reported circuit bugs:
 *
 *  1. "Deleting a board STARTS the simulation, leaving the circuit
 *     unresponsive until stopped."
 *  2. "Selecting New Project sometimes STARTS the simulation."
 *  3. "Load a multi-board example, then a single-board example — the old
 *     boards stay behind as residue."
 *
 * Root cause for (1) and (2): the flat `running` flag mirrors the ACTIVE
 * board's run state. `removeBoard` reassigned `activeBoardId` but never
 * re-derived `running`, so deleting the running/active board left it stale
 * at `true`. The UI then looked "running" and SimulatorCanvas's auto-start
 * effect (which treats `running` as a master switch for remote boards) span
 * a sibling board up. New Project hits the same path — it removes every
 * board in a loop. The fix re-derives `running` from the new active board
 * inside removeBoard.
 *
 * Root cause for (3): loadExample's single-board path called setBoardType
 * when boards already existed but never dropped the EXTRA boards a previous
 * multi-board example had added. The fix removes every board past the first
 * before retyping.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useElectricalStore } from '../store/useElectricalStore';
import { loadExample } from '../utils/loadExample';
import { exampleProjects } from '../data/examples';

function resetStores() {
  const sim = useSimulatorStore.getState();
  for (const id of sim.boards.map((b) => b.id)) sim.removeBoard(id);
  useElectricalStore.getState().setPaused(false);
}

function findExample(id: string) {
  const e = exampleProjects.find((x) => x.id === id);
  if (!e) throw new Error(`Example not found: ${id}`);
  return e;
}

/** Mark a board (and, if active, the flat mirror) as running — without
 *  spinning up a real simulator/bridge. */
function markRunning(boardId: string) {
  useSimulatorStore.setState((s) => ({
    running: s.activeBoardId === boardId ? true : s.running,
    boards: s.boards.map((b) => (b.id === boardId ? { ...b, running: true } : b)),
  }));
}

describe('removeBoard — running-flag reconciliation (bugs 1 & 2)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('deleting the running ACTIVE board clears the global running flag', () => {
    const { addBoard, setActiveBoardId, removeBoard } = useSimulatorStore.getState();
    const a = addBoard('arduino-uno', 0, 0);
    const b = addBoard('arduino-nano', 300, 0);
    setActiveBoardId(a);
    markRunning(a);
    expect(useSimulatorStore.getState().running).toBe(true);

    removeBoard(a);

    const s = useSimulatorStore.getState();
    expect(s.activeBoardId).toBe(b);
    // The new active board (b) is NOT running, so the flat flag must follow.
    expect(s.running).toBe(false);
  });

  it('deleting the only (running) board leaves running=false with no boards', () => {
    const { addBoard, setActiveBoardId, removeBoard } = useSimulatorStore.getState();
    const a = addBoard('arduino-uno', 0, 0);
    setActiveBoardId(a);
    markRunning(a);

    removeBoard(a);

    const s = useSimulatorStore.getState();
    expect(s.boards).toHaveLength(0);
    expect(s.activeBoardId).toBeNull();
    expect(s.running).toBe(false);
  });

  it('deleting a NON-active board does not disturb the active board mirror', () => {
    const { addBoard, setActiveBoardId, removeBoard } = useSimulatorStore.getState();
    const a = addBoard('arduino-uno', 0, 0);
    const b = addBoard('arduino-nano', 300, 0);
    setActiveBoardId(a);
    markRunning(a);

    removeBoard(b); // remove the inactive one

    const s = useSimulatorStore.getState();
    expect(s.activeBoardId).toBe(a);
    expect(s.running).toBe(true); // active board still running
  });

  it('New Project teardown (remove every board in a loop) ends with running=false', () => {
    const { addBoard, setActiveBoardId, removeBoard } = useSimulatorStore.getState();
    const a = addBoard('arduino-uno', 0, 0);
    addBoard('arduino-nano', 300, 0);
    setActiveBoardId(a);
    markRunning(a);

    // Mirror desktop menu.ts::newProject(): drop every board.
    for (const board of [...useSimulatorStore.getState().boards]) {
      removeBoard(board.id);
    }

    const s = useSimulatorStore.getState();
    expect(s.boards).toHaveLength(0);
    expect(s.running).toBe(false);
  });
});

describe('loadExample — multi-board to single-board leaves no residue (bug 3)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('a single-board example after a multi-board example ends with exactly one clean board', async () => {
    // Upstream loaded the gallery's `stm32-uno-gpio-mirror` here — a Blue Pill
    // wired to an Uno. This fork has no STM32, and every remaining multi-board
    // example in the gallery pairs an allowed board with a removed one, so
    // there is no gallery fixture left for this case.
    //
    // The bug being guarded has nothing to do with STM32 anyway: it is about a
    // stale board id surviving a multi-board → single-board transition. A
    // synthetic two-board example exercises exactly that path and, as a bonus,
    // stops the test depending on what the gallery happens to contain.
    await loadExample({
      id: 'test-two-avr-boards',
      title: 'Две платы AVR',
      description: 'Синтетический пример для проверки перехода с двух плат на одну.',
      category: 'basics',
      difficulty: 'beginner',
      code: '',
      components: [],
      wires: [],
      boards: [
        { boardKind: 'arduino-nano', x: 0, y: 0, code: 'void setup(){}\nvoid loop(){}\n' },
        { boardKind: 'arduino-mega', x: 400, y: 0, code: 'void setup(){}\nvoid loop(){}\n' },
      ],
    });
    expect(useSimulatorStore.getState().boards.length).toBe(2);

    // Single-board example must reduce the canvas back to one board, freshly
    // built — its id must match its kind (no stale "arduino-nano" id left on
    // what is now an Arduino Uno).
    await loadExample(findExample('blink-led'));
    const after = useSimulatorStore.getState();
    expect(after.boards.length).toBe(1);
    expect(after.boards[0].boardKind).toBe('arduino-uno');
    expect(after.boards[0].id).toBe('arduino-uno');
    expect(after.activeBoardId).toBe('arduino-uno');
  });

  it('residue cleanup also applies when extra boards were added manually', async () => {
    const { addBoard } = useSimulatorStore.getState();
    addBoard('arduino-nano', 300, 0);
    addBoard('arduino-mega', 600, 0);
    expect(useSimulatorStore.getState().boards.length).toBeGreaterThan(1);

    await loadExample(findExample('blink-led'));
    expect(useSimulatorStore.getState().boards.length).toBe(1);
  });
});
