/**
 * pinInspectorLayout — the Part Inspector's spatial pin geometry.
 *
 * The coordinate tables here are copied VERBATIM from the real elements (the
 * file/line each block cites), not invented: the point of the suite is that
 * the classifier reads actual shipped parts sensibly. If a part's pinInfo
 * changes upstream, refresh the copy.
 */
import { describe, expect, it } from 'vitest';
import {
  layoutInspectorPins,
  signalKindOf,
  type InspectorPinInput,
} from '../utils/pinInspectorLayout';

// components/velxio-components/Esp32Element.ts:31-68 (PINS_ESP32), board
// natural size 141x265 (BOARD_CONFIGS.esp32). Two vertical columns: left
// x=6, right x=134. Silk aliases (16/RX2, 17/TX2) share coordinates.
const ESP32_PINS: InspectorPinInput[] = [
  { name: 'EN', x: 6, y: 29 },
  { name: 'VN', x: 6, y: 42 },
  { name: 'VP', x: 6, y: 54 },
  { name: '34', x: 6, y: 67 },
  { name: '35', x: 6, y: 80 },
  { name: '32', x: 6, y: 93 },
  { name: '33', x: 6, y: 105 },
  { name: '25', x: 6, y: 118 },
  { name: '26', x: 6, y: 131 },
  { name: '27', x: 6, y: 143 },
  { name: '14', x: 6, y: 156 },
  { name: '12', x: 6, y: 169 },
  { name: '13', x: 6, y: 181 },
  { name: 'GND', x: 6, y: 194 },
  { name: 'VIN', x: 6, y: 207 },
  { name: '3V3', x: 134, y: 207 },
  { name: 'GND2', x: 134, y: 194 },
  { name: '15', x: 134, y: 181 },
  { name: '2', x: 134, y: 169 },
  { name: '4', x: 134, y: 156 },
  { name: 'RX2', x: 134, y: 143 },
  { name: 'TX2', x: 134, y: 131 },
  { name: '5', x: 134, y: 118 },
  { name: '18', x: 134, y: 105 },
  { name: '19', x: 134, y: 93 },
  { name: '21', x: 134, y: 80 },
  { name: 'RX0', x: 134, y: 67 },
  { name: 'TX0', x: 134, y: 54 },
  { name: '22', x: 134, y: 42 },
  { name: '23', x: 134, y: 29 },
];
const ESP32_SIZE = { width: 141, height: 265 };

// @wokwi/elements led-element.js:28-34 (unflipped), element box 40x50.
const LED_PINS: InspectorPinInput[] = [
  { name: 'A', x: 25, y: 42 },
  { name: 'C', x: 15, y: 42 },
];
const LED_SIZE = { width: 40, height: 50 };

describe('layoutInspectorPins — the ESP32 board (the 30-pin scroll case)', () => {
  const r = layoutInspectorPins(ESP32_PINS, ESP32_SIZE);

  it('classifies every pin left or right, none interior', () => {
    for (const p of r.pins) {
      expect(['left', 'right']).toContain(p.edge);
    }
    expect(r.pins.filter((p) => p.edge === 'left')).toHaveLength(15);
    expect(r.pins.filter((p) => p.edge === 'right')).toHaveLength(15);
  });

  it('keeps a minimum spacing between labels on the same side', () => {
    for (const edge of ['left', 'right'] as const) {
      const ys = r.pins
        .filter((p) => p.edge === edge)
        .map((p) => p.labelY)
        .sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) {
        expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(16 - 1e-6);
      }
    }
  });

  it('preserves the dot y-order in the label order per side', () => {
    for (const edge of ['left', 'right'] as const) {
      const group = r.pins.filter((p) => p.edge === edge).sort((a, b) => a.dotY - b.dotY);
      for (let i = 1; i < group.length; i++) {
        expect(group[i].labelY).toBeGreaterThan(group[i - 1].labelY);
      }
    }
  });

  it('reserves side gutters and no top/bottom gutters', () => {
    expect(r.padLeft).toBeGreaterThan(0);
    expect(r.padRight).toBeGreaterThan(0);
    expect(r.padTop).toBe(0);
    expect(r.padBottom).toBe(0);
  });

  it('scales the art into the default box', () => {
    expect(r.artHeight).toBeLessThanOrEqual(260);
    expect(r.scale).toBeCloseTo(260 / 265, 5);
  });
});

describe('layoutInspectorPins — small parts', () => {
  it('puts the LED legs on the bottom edge', () => {
    const r = layoutInspectorPins(LED_PINS, LED_SIZE);
    for (const p of r.pins) expect(p.edge).toBe('bottom');
    expect(r.padBottom).toBeGreaterThan(0);
    expect(r.padLeft).toBe(0);
  });

  it('caps upscaling at 2x so a tiny part is not a blur', () => {
    const r = layoutInspectorPins(LED_PINS, { width: 20, height: 10 });
    expect(r.scale).toBe(2);
    expect(r.artWidth).toBe(40);
  });

  it('handles zero pins and one pin', () => {
    const none = layoutInspectorPins([], LED_SIZE);
    expect(none.pins).toHaveLength(0);
    expect(none.padLeft + none.padRight + none.padTop + none.padBottom).toBe(0);

    const one = layoutInspectorPins([{ name: 'OUT', x: 2, y: 25 }], { width: 50, height: 50 });
    expect(one.pins[0].edge).toBe('left');
    expect(one.pins[0].needsLeader).toBe(false);
  });
});

describe('layoutInspectorPins — interior pins', () => {
  it('detects a pin far from every edge and anchors its label on the dot', () => {
    const r = layoutInspectorPins(
      [
        { name: 'MID', x: 50, y: 50 },
        { name: 'L', x: 2, y: 50 },
      ],
      { width: 100, height: 100 },
    );
    const mid = r.pins.find((p) => p.name === 'MID')!;
    expect(mid.edge).toBe('interior');
    expect(mid.labelX).toBe(mid.dotX);
    expect(mid.labelY).toBe(mid.dotY);
    expect(r.pins.find((p) => p.name === 'L')!.edge).toBe('left');
  });
});

describe('signalKindOf', () => {
  it('maps the wokwi signal shapes', () => {
    expect(signalKindOf({ name: 'SDA', x: 0, y: 0, signals: [{ type: 'i2c', signal: 'SDA' }] })).toBe('i2c');
    expect(signalKindOf({ name: 'GND', x: 0, y: 0, signals: [{ type: 'power', signal: 'GND' }] })).toBe('power-gnd');
    expect(signalKindOf({ name: 'VCC', x: 0, y: 0, signals: [{ type: 'power', signal: 'VCC' }] })).toBe('power-vcc');
    expect(signalKindOf({ name: 'D1', x: 0, y: 0 })).toBe('other');
    expect(signalKindOf({ name: 'D1', x: 0, y: 0, signals: [] })).toBe('other');
  });
});
