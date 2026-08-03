/**
 * pinInspectorLayout — pure geometry for the Part Inspector's spatial pin view.
 *
 * Input: a part's pinInfo (element-local CSS px at scale 1 — the same numbers
 * the canvas snaps wires to) and its measured natural size. Output: where to
 * draw each pin dot and its label around a scaled preview of the part, so the
 * dialog can show "pins where they really are" for ANY part or board without
 * per-component data. That genericity is the point: pinInfo + size is the
 * whole input, so future parts work unmodified.
 *
 * No DOM, no React, deterministic — unit-tested in
 * __tests__/pin-inspector-layout.test.ts with real pin tables.
 */

export type PinEdge = 'left' | 'right' | 'top' | 'bottom' | 'interior';

export interface InspectorPinInput {
  name: string;
  x: number;
  y: number;
  signals?: Array<{ type?: string; signal?: string }>;
}

export type PinSignalKind =
  | 'i2c'
  | 'spi'
  | 'usart'
  | 'power-gnd'
  | 'power-vcc'
  | 'pwm'
  | 'analog'
  | 'other';

export interface LaidOutPin {
  name: string;
  edge: PinEdge;
  /** Scaled px, relative to the ART box top-left. */
  dotX: number;
  dotY: number;
  /** Scaled px, label anchor point, same origin. */
  labelX: number;
  labelY: number;
  /** True when the label was nudged away from its dot row/column. */
  needsLeader: boolean;
  signalKind: PinSignalKind;
}

export interface PinLayoutResult {
  /** Scale applied to the natural size. */
  scale: number;
  artWidth: number;
  artHeight: number;
  pins: LaidOutPin[];
  /** Gutter reserved on each side for labels; 0 when that side has no pins. */
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export interface PinLayoutOptions {
  maxArtWidth?: number;
  maxArtHeight?: number;
  /** Minimum label spacing along an edge, px (left/right stacks). */
  minSpacing?: number;
  /** A pin farther than this fraction of the dimension from EVERY edge is interior. */
  interiorFrac?: number;
}

/** Horizontal gutter for left/right label columns (room for "GND2" etc.). */
const SIDE_GUTTER = 72;
/**
 * Vertical gutter for top/bottom labels. Those are drawn as VERTICAL text —
 * the way printed pinout diagrams do it — because horizontal ones do not fit:
 * an SSD1306 has 8 pins along a 240px edge, and at the ~36px a horizontal
 * "DATA" needs they demand 288px and spill out of the dialog. Vertical text
 * needs only the same spacing as a side column, and the gutter grows instead.
 */
const CAP_GUTTER = 52;
/** Small parts (a resistor is 107x11) are upscaled, but only this far. */
const MAX_UPSCALE = 2;

export function signalKindOf(pin: InspectorPinInput): PinSignalKind {
  const s = pin.signals?.[0];
  if (!s || typeof s !== 'object') return 'other';
  switch (s.type) {
    case 'i2c':
      return 'i2c';
    case 'spi':
      return 'spi';
    case 'usart':
      return 'usart';
    case 'pwm':
      return 'pwm';
    case 'analog':
      return 'analog';
    case 'power':
      return s.signal === 'GND' ? 'power-gnd' : 'power-vcc';
    default:
      return 'other';
  }
}

/**
 * Stack labels along one edge: process in position order and push each label
 * forward so no two sit closer than `spacing`. If the stack overruns the art,
 * shift it back as one block (clamped at 0) — this keeps a 15-pin column
 * centred on its side instead of trailing off the bottom.
 */
function stackLabels(
  positions: number[],
  spacing: number,
  extent: number,
): { out: number[]; nudged: boolean[] } {
  const order = positions.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const placed: number[] = [];
  for (let k = 0; k < order.length; k++) {
    const want = order[k][0];
    placed.push(k === 0 ? want : Math.max(want, placed[k - 1] + spacing));
  }
  // Shift the whole stack up if it overran the art extent and there is room.
  const overrun = placed.length ? placed[placed.length - 1] - extent : 0;
  if (overrun > 0) {
    const room = placed[0]; // how far the first label can move toward 0
    const shift = Math.min(overrun, Math.max(0, room));
    for (let k = 0; k < placed.length; k++) placed[k] -= shift;
  }
  const out = new Array<number>(positions.length);
  const nudged = new Array<boolean>(positions.length);
  for (let k = 0; k < order.length; k++) {
    const i = order[k][1];
    out[i] = placed[k];
    nudged[i] = Math.abs(placed[k] - positions[i]) > 1;
  }
  return { out, nudged };
}

export function layoutInspectorPins(
  pins: InspectorPinInput[],
  natural: { width: number; height: number },
  opts: PinLayoutOptions = {},
): PinLayoutResult {
  const maxW = opts.maxArtWidth ?? 260;
  const maxH = opts.maxArtHeight ?? 260;
  const minSpacing = opts.minSpacing ?? 16;
  const interiorFrac = opts.interiorFrac ?? 0.18;

  const w = Math.max(1, natural.width);
  const h = Math.max(1, natural.height);
  const scale = Math.min(maxW / w, maxH / h, MAX_UPSCALE);
  const W = w * scale;
  const H = h * scale;

  // Classify each pin by its nearest edge on the scaled art.
  const fW = interiorFrac * W;
  const fH = interiorFrac * H;
  const classified = pins.map((pin) => {
    const x = pin.x * scale;
    const y = pin.y * scale;
    const dLeft = x;
    const dRight = W - x;
    const dTop = y;
    const dBottom = H - y;
    let edge: PinEdge;
    if (dLeft > fW && dRight > fW && dTop > fH && dBottom > fH) {
      edge = 'interior';
    } else {
      const min = Math.min(dLeft, dRight, dTop, dBottom);
      edge = min === dLeft ? 'left' : min === dRight ? 'right' : min === dTop ? 'top' : 'bottom';
    }
    return { pin, x, y, edge };
  });

  // Lay labels per edge. Left/right stack along y; top/bottom along x
  // (with wider spacing — their labels are horizontal text).
  const laid: LaidOutPin[] = new Array(pins.length);
  const byEdge = (e: PinEdge) =>
    classified.map((c, i) => [c, i] as const).filter(([c]) => c.edge === e);

  for (const edge of ['left', 'right'] as const) {
    const group = byEdge(edge);
    const { out, nudged } = stackLabels(
      group.map(([c]) => c.y),
      minSpacing,
      H,
    );
    group.forEach(([c, i], k) => {
      laid[i] = {
        name: c.pin.name,
        edge,
        dotX: c.x,
        dotY: c.y,
        labelX: edge === 'left' ? -8 : W + 8,
        labelY: out[k],
        needsLeader: nudged[k],
        signalKind: signalKindOf(c.pin),
      };
    });
  }
  for (const edge of ['top', 'bottom'] as const) {
    const group = byEdge(edge);
    const { out, nudged } = stackLabels(
      group.map(([c]) => c.x),
      minSpacing,
      W,
    );
    group.forEach(([c, i], k) => {
      laid[i] = {
        name: c.pin.name,
        edge,
        dotX: c.x,
        dotY: c.y,
        labelX: out[k],
        labelY: edge === 'top' ? -8 : H + 8,
        needsLeader: nudged[k],
        signalKind: signalKindOf(c.pin),
      };
    });
  }
  for (const [c, i] of byEdge('interior')) {
    // Interior pins keep their label ON the dot: the dialog renders a
    // tooltip instead of printed text (a label in the middle of the art
    // would sit on top of the silkscreen).
    laid[i] = {
      name: c.pin.name,
      edge: 'interior',
      dotX: c.x,
      dotY: c.y,
      labelX: c.x,
      labelY: c.y,
      needsLeader: false,
      signalKind: signalKindOf(c.pin),
    };
  }

  const has = (e: PinEdge) => classified.some((c) => c.edge === e);
  return {
    scale,
    artWidth: W,
    artHeight: H,
    pins: laid,
    padLeft: has('left') ? SIDE_GUTTER : 0,
    padRight: has('right') ? SIDE_GUTTER : 0,
    padTop: has('top') ? CAP_GUTTER : 0,
    padBottom: has('bottom') ? CAP_GUTTER : 0,
  };
}
