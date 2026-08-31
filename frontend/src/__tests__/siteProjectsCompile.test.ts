import { describe, it, expect } from 'vitest';
import { compileSketch, backendAvailable } from './helpers/compileSketch';
import { AVRSimulator } from '../simulation/AVRSimulator';
import { PinManager } from '../simulation/PinManager';

const BLINK = `
void setup() { pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, HIGH); delay(1); digitalWrite(13, LOW); delay(1); }
`;

describe.runIf(backendAvailable())('компиляция через бэкенд', () => {
  it('возвращает прошивку в формате Intel HEX', async () => {
    const res = await compileSketch(BLINK, 'arduino:avr:uno');
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    if (!res.ok) return;
    // Intel HEX — текстовый формат, каждая запись начинается с двоеточия.
    expect(res.hex.startsWith(':')).toBe(true);
  }, 300_000);

  it('прошивка грузится в симулятор', async () => {
    const res = await compileSketch(BLINK, 'arduino:avr:uno');
    if (!res.ok) throw new Error(res.error);
    const pm = new PinManager();
    const sim = new AVRSimulator(pm, 'uno');
    expect(() => sim.loadHex(res.hex)).not.toThrow();
  }, 300_000);
});
