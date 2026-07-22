/**
 * proBoardRegistry — runtime registration seam for boards a private overlay
 * (velxio.com) ships outside the OSS tree.
 *
 * The OSS BoardKind union and its compiler-enforced Record maps stay exactly
 * as they are for the open boards. An overlay calls registerProBoards() at
 * mount with data-only definitions; registration patches the exported maps in
 * types/board.ts (labels / FQBN / MicroPython set) so every existing read site
 * keeps working untouched, and the handful of sites a map can't cover (canvas
 * render, pin-name mapping, simulator construction, firmware load) consult
 * getProBoard() as a fallback.
 *
 * The OSS build never registers anything here — like the proRoutes /
 * __velxio_pro_gate__ / registerComponentDoc seams, this module is dead code
 * until an overlay imports it. Board ad cards (ONLINE_ONLY_BOARD_ADS) hide
 * automatically for registered kinds: the picker filter checks
 * `ad.id in BOARD_KIND_LABELS`, and registration inserts the label.
 */
import type React from 'react';
import {
  BOARD_KIND_LABELS,
  BOARD_KIND_FQBN,
  BOARD_SUPPORTS_MICROPYTHON,
  type BoardKind,
} from '../types/board';

/** Structural contract for an overlay-provided in-browser board simulator.
 *  Mirrors the surface the store already uses on RP2040Simulator — the store
 *  only ever duck-types these members for pro simulators. */
export interface ProBoardSimulator {
  /** Brand flag so the store can recognize overlay simulators without a class. */
  readonly isProBoardSimulator: true;
  onSerialData: ((ch: string) => void) | null;
  onPinChangeWithTime: ((pin: number, state: boolean, time: number) => void) | null;
  stop(): void;
  detachPioPeripheral?(): void;
}

export interface ProBoardDef {
  /** The board id — behaves like a BoardKind everywhere at runtime. */
  kind: string;
  label: string;
  /** arduino-cli FQBN, or null when the board has no backend compile. */
  fqbn: string | null;
  /** One-line picker description. */
  description: string;
  /** The board's custom-element tag. The overlay's import must have run
   *  customElements.define for it before the board is placed. */
  tag: string;
  /** True pixel size of the element (selection ring + pin overlays). */
  size: { w: number; h: number };
  supportsMicroPython?: boolean;
  /** ESP32 run-path routing: the base chip the board carries. Routes the run
   *  through the ESP32 bridge path and picks the machine/engine type. Omit for
   *  boards that provide createSimulator (RP2350 class) or AVR/RP2040. */
  esp32Family?: 'esp32' | 'esp32-s3' | 'esp32-c3' | 'esp32-c6';
  /** Canvas renderer. Receives the placed board's props; return a React node.
   *  When omitted, the canvas renders `<tag id=... style=absolute@x,y>`. */
  render?: (props: { id: string; x: number; y: number; running: boolean }) => React.ReactNode;
  /** pinInfo name -> GPIO number (power/ground pins -> -1). Falls back to the
   *  generic numeric parse when omitted. Return null for "not mine". */
  pinToNumber?: (pinName: string) => number | null;
  /** In-browser simulator factory (e.g. the RP2350/Hazard3 emulator). The pm
   *  argument is the store's PinManager instance. */
  createSimulator?: (pm: unknown) => ProBoardSimulator;
  /** Load compiled firmware into a createSimulator() instance at run time —
   *  the overlay owns the whole sequence (PIO attach, binary load, demo I2C
   *  devices, ...). `program` is the compiled artifact exactly as the store
   *  holds it (base64/hex string, same value RP2040Simulator.loadBinary gets). */
  loadFirmware?: (
    sim: ProBoardSimulator,
    program: string,
    ctx: { boardKind: string; boardId: string },
  ) => void;
  /** Built-in bridge sensors registered without wiring (e.g. an on-board I2C
   *  keyboard): pushed into the ESP32 bridge's sensor config on every run. */
  builtInSensors?: Array<{ sensor_type: string; pin: number; addr?: number }>;
  /** Built-in microSD on a shared SPI bus: the CS pin the bridge must gate.
   *  (A standalone SD card component still overrides this to un-gated.) */
  builtInSdCsPin?: number;
  /** Sidebar / toolbar accents (fall back to a neutral chip icon). */
  icon?: string;
  color?: string;
}

const registry = new Map<string, ProBoardDef>();

export function registerProBoards(defs: ProBoardDef[]): void {
  for (const def of defs) {
    registry.set(def.kind, def);
    const kind = def.kind as BoardKind;
    // Patch the exported maps so every existing read site sees the board —
    // labels also make the picker's ONLINE ad for this kind disappear.
    (BOARD_KIND_LABELS as Record<string, string>)[kind] = def.label;
    (BOARD_KIND_FQBN as Record<string, string | null>)[kind] = def.fqbn;
    if (def.supportsMicroPython) BOARD_SUPPORTS_MICROPYTHON.add(kind);
  }
}

export function getProBoard(kind: string): ProBoardDef | undefined {
  return registry.get(kind);
}

export function listProBoards(): ProBoardDef[] {
  return Array.from(registry.values());
}

export function isProBoardSimulator(sim: unknown): sim is ProBoardSimulator {
  return !!sim && (sim as { isProBoardSimulator?: boolean }).isProBoardSimulator === true;
}
