/**
 * Наблюдение за дисплеем HD44780 в четырёхбитном режиме.
 *
 * Библиотека LiquidCrystal (прямая 6-проводная разводка RS/E/D4-D7, НЕ
 * I2C-переходник) гонит байт двумя полубайтами по четырём линиям данных,
 * защёлкивая их спадом на выводе E. Здесь это и воспроизводится — так же,
 * как делает настоящий дисплей.
 *
 * ВАЖНО (правка относительно черновика в брифе задачи): у настоящего
 * `frontend/src/simulation/HD44780Decoder.ts` (трогать который запрещено)
 * нет методов `writeByte`/`getLines` — сверено чтением файла. Реальный
 * публичный интерфейс:
 *   - `new HD44780Decoder({ cols, rows })` — геометрия обязательна в
 *     конструкторе, а не задаётся отдельным вызовом;
 *   - `feedPCF8574Byte(byte: number): void` — единственная точка входа
 *     для записи. Она рассчитана на провод PCF8574/LiquidCrystal_I2C
 *     (бит-карта `D7..D4 | BL EN RW RS`, защёлка по спаду EN), поэтому
 *     ниже наблюдаемые уровни RS/D4-D7/E на КАЖДОМ изменении E пересобираются
 *     в байт той же битовой раскладки и подаются в неё — так прямая
 *     4-битная разводка декодируется тем же (единственным) декодером,
 *     что уже использует остальной код для I2C-подключений
 *     (frontend/src/simulation/parts/ProtocolParts.ts:1492,1501, и тесты
 *     frontend/src/__tests__/i2c-lcd-coupling-gap.test.ts). Внутри
 *     `feedPCF8574Byte` смотрит только на биты EN(0x04)/RS(0x01)/старший
 *     полубайт(0xF0) — какой физический провод фактически принёс байт,
 *     ей не важно;
 *   - `snapshot().characters` — плоский массив кодов символов
 *     длиной cols*rows (не `getLines(): string[]`). Разбивку на строки и
 *     перевод кодов в текст делает этот помощник, не декодер.
 *
 * Почему байт собирается на КАЖДОЕ изменение E, а не только на спад:
 * `feedPCF8574Byte` защёлкивает полубайт по условию
 * `lastEN(true) && !en(false)` — «было включено, стало выключено». Поле
 * `lastEN` — внутреннее состояние самого декодера, обновляемое им при
 * каждом вызове; если ни разу не подать байт с EN=1, декодер никогда не
 * увидит переход true→false и не защёлкнёт ни одного полубайта. Значит
 * вызывать `feedPCF8574Byte` нужно на обоих фронтах E, каждый раз с
 * текущими уровнями D4-D7/RS на тот момент — ровно так, как реальная
 * микросхема мигрирует состояние линий данных в шину.
 */
import { AVRSimulator } from '../../simulation/AVRSimulator';
import { PinManager } from '../../simulation/PinManager';
import { HD44780Decoder } from '../../simulation/HD44780Decoder';

export interface LcdPins {
  rs: number;
  e: number;
  d4: number;
  d5: number;
  d6: number;
  d7: number;
}

// WH1602 / LCD1602 — 16 столбцов, 2 строки. Единственный типоразмер, на
// который сейчас рассчитан этот помощник (см. `runLcdText` в интерфейсах
// задачи 6); для LCD2004 потребовалась бы своя геометрия параметром.
const COLS = 16;
const ROWS = 2;

// Дефолт 32_000_000, не 8_000_000 из черновика в брифе (тот скопирован из
// примера #28 и сюда не подходит — измерено, не угадано). #63 печатает
// морзянку для первых четырёх символов message[]="beautiful" (b,e,a,u),
// а перед КАЖДЫМ символом стоит `delay(500)` — уже 4×500мс=2 000 мс занятых
// одними задержками, это 32 000 000 тактов на 16 МГц. Одноразовый
// диагностический прогон (тот же приём, что в PinManager-помощнике
// runSketch.ts/Task 5, до 40 000 000 шагов, лог каждого onCharsChange) дал:
// первый непустой символ на дисплее — шаг 6 412 043 («-», начало морзянки
// «b»), а вся строка «-... . .- ..-» (b e a u полностью) собирается к шагу
// 24 943 047 (17-й и последний вызов onCharsChange). 8 000 000 из брифа
// проходят слабую проверку «непусто» с запасом всего ~25% и НЕ дотягивают
// даже до половины полного сообщения. 32 000 000 — запас ~28% сверх
// измеренного момента полной сборки строки, тем же порядком величины, что
// и решение Task 5 для #28 (~32% сверх измеренного минимума).
export function runLcdText(
  hex: string,
  board: 'uno' | 'mega',
  pins: LcdPins,
  cycles = 32_000_000,
): string[] {
  const pm = new PinManager();
  const sim = new AVRSimulator(pm, board);
  const decoder = new HD44780Decoder({ cols: COLS, rows: ROWS });

  const level: Record<number, boolean> = {};
  for (const pin of [pins.rs, pins.d4, pins.d5, pins.d6, pins.d7]) {
    level[pin] = false;
    pm.onPinChange(pin, (_p, state) => {
      level[pin] = state;
    });
  }

  pm.onPinChange(pins.e, (_p, enState) => {
    const nibble =
      (level[pins.d7] ? 0x8 : 0) |
      (level[pins.d6] ? 0x4 : 0) |
      (level[pins.d5] ? 0x2 : 0) |
      (level[pins.d4] ? 0x1 : 0);
    // PCF8574 wire byte: D7..D4 | BL EN RW RS. BL(0x08) выставлен
    // постоянно (подсветка «включена») — decoder её не использует ни для
    // чего, кроме собственного onBacklightChange; RW(0x02) всегда 0 —
    // LiquidCrystal в этой схеме не читает с дисплея.
    const byte = (nibble << 4) | 0x08 | (enState ? 0x04 : 0) | (level[pins.rs] ? 0x01 : 0);
    decoder.feedPCF8574Byte(byte);
  });

  sim.loadHex(hex);
  for (let i = 0; i < cycles; i++) sim.step();
  sim.stop();

  const { characters } = decoder.snapshot();
  const lines: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    const rowChars = characters.slice(row * COLS, row * COLS + COLS);
    lines.push(rowChars.map((code) => String.fromCharCode(code)).join(''));
  }
  return lines;
}
