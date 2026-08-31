/**
 * Прогон прошивки с наблюдением того, что ушло в последовательный порт.
 *
 * Тот же приём, что в runSketch.ts/runAnalog.ts/runDigitalInput.ts: шагаем
 * процессором вручную (sim.step()) вместо sim.start() — повторяемо, не
 * зависит от загрузки машины.
 *
 * Зачем это нужно отдельно от pin-toggle/analog/digital-input: часть
 * проектов не делает НИ ОДНОГО digitalWrite()/analogWrite()/tone() —
 * единственный наблюдаемый эффект прошивки уходит в Serial.print/println.
 * Ни один из четырёх прежних видов не имеет вывода, управляемого MCU,
 * за которым можно наблюдать (#66 «Датчик пульса»: только analogRead() и
 * Serial.println()) — pin-toggle/analog/digital-input в такой прошивке
 * молча проверяют ноль выводов, потому что verify.pins/output.pin
 * попросту нечем заполнить.
 *
 * Источник байт — не новый канал. AVRSimulator.onSerialData — существующее
 * публичное поле (`((char: string) => void) | null`), уже используемое как
 * прод-кодом (useSimulatorStore.ts, PiTerminal.tsx — вкладка «Монитор
 * порта»), так и настоящими (не мокнутыми) тестами на реальных прошивках:
 * i2c-real-firmware.test.ts (`sim.onSerialData = (ch) => serialOut.push(...)`,
 * прогон через AVRUSART.onByteTransmit) и microsd-real-firmware.test.ts (тот
 * же приём). Внутри AVRSimulator (AVRSimulator.ts:520-522) оно вызывается из
 * `this.usart.onByteTransmit`, который avr8js дёргает при каждом байте,
 * реально прошедшем через аппаратный UART0 — тот же путь, которым идёт
 * Serial.print()/println() у настоящей прошивки. Тесты выше уже проверяют,
 * что этот путь работает и при пошаговом step() (не только при
 * sim.start()) — тот же режим прогона, что и здесь.
 *
 * Стимул на аналоговом входе — та же setAdcVoltage() из partUtils.ts, что
 * уже использует runAnalog.ts (см. её докстринг про PinManager.
 * setAnalogVoltage(), которая ни к чему не подключена). Здесь voltage
 * меняется РОВНО ОДИН РАЗ, на середине прогона (low → high) — тот же
 * приём, которым #66 проверялся диагностически до появления этого
 * помощника («смена стимула на середине прогона, на случай если код
 * реагирует только на фронт», см. batch-7-report.md). Он же и доказывает
 * содержательность проверки: прошивка, печатающая значение датчика один раз
 * и дальше повторяющая его же (или вовсе не читающая вход), даст
 * одинаковые строки до и после смены — ровно то, что verify.kind: "serial"
 * обязан ловить как «не одно и то же».
 */
import { AVRSimulator } from '../../simulation/AVRSimulator';
import { PinManager } from '../../simulation/PinManager';
import { setAdcVoltage } from '../../simulation/parts/partUtils';

export interface SerialInput {
  /** Аналоговый вывод Arduino: 14-19 = A0-A5 на Uno/Mega. */
  pin: number;
  /** Напряжение первой половины прогона, В (0-5). */
  low: number;
  /** Напряжение второй половины прогона (со смены на середине), В (0-5). */
  high: number;
}

export interface SerialRunResult {
  /** Всё, что прошивка передала в Serial, как есть (посимвольно). */
  raw: string;
  /** Непустые строки (CRLF/LF обрезаны), в порядке печати. */
  lines: string[];
}

export function runSerial(
  hex: string,
  board: 'uno' | 'mega' | 'tiny85',
  input: SerialInput,
  cycles: number,
): SerialRunResult {
  const pm = new PinManager();
  const sim = new AVRSimulator(pm, board);

  let raw = '';
  sim.onSerialData = (ch) => {
    raw += ch;
  };

  sim.loadHex(hex);

  // setAdcVoltage нужно звать ПОСЛЕ loadHex() — ADC создаётся внутри неё
  // (тот же порядок, что уже задокументирован в runAnalog.ts).
  const setLow = setAdcVoltage(sim, input.pin, input.low);
  if (!setLow) {
    throw new Error(
      `runSerial: setAdcVoltage отказала для вывода ${input.pin} (плата ${board}) — ` +
        `не аналоговый канал этой платы (AVR: только 14-19 = A0-A5)`,
    );
  }

  const half = Math.floor(cycles / 2);
  for (let i = 0; i < half; i++) sim.step();

  const setHigh = setAdcVoltage(sim, input.pin, input.high);
  if (!setHigh) {
    throw new Error(
      `runSerial: setAdcVoltage (смена на середине) отказала для вывода ${input.pin} (плата ${board})`,
    );
  }
  for (let i = half; i < cycles; i++) sim.step();

  sim.stop();

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return { raw, lines };
}
