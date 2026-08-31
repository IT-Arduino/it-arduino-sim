/**
 * Прогон прошивки с наблюдением выводов.
 *
 * Тот же приём, что в attiny85-simulation.test.ts: шагаем процессором
 * вручную вместо sim.start(). Реальное время в тесте не нужно и вредно —
 * прогон должен быть повторяемым, а не зависеть от загрузки машины.
 */
import { AVRSimulator } from '../../simulation/AVRSimulator';
import { PinManager } from '../../simulation/PinManager';

export function runPinToggle(
  hex: string,
  board: 'uno' | 'mega' | 'tiny85',
  pins: number[],
  cycles: number,
): Map<number, boolean[]> {
  const pm = new PinManager();
  const sim = new AVRSimulator(pm, board);
  const changes = new Map<number, boolean[]>();
  for (const pin of pins) {
    const log: boolean[] = [];
    changes.set(pin, log);
    pm.onPinChange(pin, (_pin, state) => log.push(state));
  }
  sim.loadHex(hex);
  for (let i = 0; i < cycles; i++) sim.step();
  sim.stop();
  return changes;
}
