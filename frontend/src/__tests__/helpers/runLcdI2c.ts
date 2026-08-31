/**
 * Наблюдение за LCD-дисплеем HD44780 за переходником PCF8574 на шине I2C.
 *
 * Отличие от runLcd.ts (`runLcdText`): та версия снимает уровни с шести
 * отдельных GPIO-выводов (RS/E/D4-D7) — так работает библиотека
 * LiquidCrystal с прямой 6-проводной разводкой. Библиотека
 * LiquidCrystal_I2C общается с тем же контроллером HD44780 через
 * аппаратный модуль TWI платы и переходник PCF8574 на шине I2C — там нет
 * отдельных GPIO-выводов под RS/E/D4-D7 вообще, только SDA/SCL (у Uno —
 * фиксированные аппаратные A4/A5, не выбираемые скетчем).
 *
 * Путь наблюдения — публичный, уже покрытый тестами API, а не новый канал:
 * `AVRSimulator.addI2CDevice()` регистрирует виртуальное устройство на шине
 * (`i2c-real-firmware.test.ts` уже проверяет ровно этот путь end-to-end на
 * реальной прошивке LiquidCrystal_I2C). Здесь регистрируется
 * `VirtualPCF8574` на нужном адресе; её `onWrite` отдаёт записанный байт
 * тому же декодеру `HD44780Decoder.feedPCF8574Byte()`, которым уже
 * пользуется `runLcdText` — самому декодеру всё равно, приехал байт с
 * шести физических проводов или с шины I2C, битовая раскладка одна и та же
 * (D7..D4 | BL EN RW RS).
 *
 * Как и setAdcVoltage/setPinState в соседних помощниках, устройство на шину
 * добавляется ПОСЛЕ sim.loadHex() — loadHex() заново привязывает TWI-мастер
 * к шине (см. AVRSimulator.ts), и порядок из существующего теста повторён
 * здесь для надёжности.
 */
import { AVRSimulator } from '../../simulation/AVRSimulator';
import { PinManager } from '../../simulation/PinManager';
import { HD44780Decoder } from '../../simulation/HD44780Decoder';
import { VirtualPCF8574 } from '../../simulation/I2CBusManager';

// WH1602/LCD1602 — 16 столбцов, 2 строки. Тот же типоразмер, на который
// сейчас рассчитан runLcdText (см. её докстринг) — для LCD2004 потребовалась
// бы своя геометрия параметром, здесь пока не нужно.
const COLS = 16;
const ROWS = 2;

export function runLcdTextI2c(
  hex: string,
  board: 'uno' | 'mega',
  address: number,
  cycles: number,
): string[] {
  const pm = new PinManager();
  const sim = new AVRSimulator(pm, board);
  const decoder = new HD44780Decoder({ cols: COLS, rows: ROWS });
  const pcf = new VirtualPCF8574(address);
  pcf.onWrite = (v: number) => decoder.feedPCF8574Byte(v);

  sim.loadHex(hex);
  sim.addI2CDevice(pcf);

  for (let i = 0; i < cycles; i++) sim.step();
  sim.stop();

  const { characters } = decoder.snapshot();
  const lines: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    const rowChars = characters.slice(row * COLS, row * COLS + COLS);
    lines.push(Array.from(rowChars, (code: number) => String.fromCharCode(code)).join(''));
  }
  return lines;
}
