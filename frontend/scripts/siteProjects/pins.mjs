/**
 * Разбор выводов из текста скетча.
 *
 * Сознательно грубый: берутся только те формы, где вывод записан числом
 * или именем ранее объявленной константы. Вычисляемый вывод (переменная
 * цикла, выражение) не разрешается — вернуть догадку хуже, чем не вернуть
 * ничего: несоединённая деталь видна сразу, неверно соединённая — нет.
 */

// Вырежи комментарии и строковые литералы перед разбором, заменяя на пробелы
// той же длины, чтобы не сбить номера строк.
//
// Экспортирована: blocklist.mjs использует её же для разбора конструктора
// LCD (закомментированный `LiquidCrystal lcd(...)` не должен маскировать
// настоящий `LiquidCrystal_I2C lcd(...)` ниже — см. #45 в манифесте).
export function stripCommentsAndStrings(source) {
  let result = '';
  let i = 0;
  while (i < source.length) {
    // Строковый литерал "…" с экранированием
    if (source[i] === '"') {
      const start = i;
      i++;
      while (i < source.length) {
        if (source[i] === '\\' && source[i + 1]) {
          i += 2;
        } else if (source[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
      result += ' '.repeat(i - start);
      continue;
    }
    // Символьный литерал '…' с экранированием
    if (source[i] === "'") {
      const start = i;
      i++;
      while (i < source.length) {
        if (source[i] === '\\' && source[i + 1]) {
          i += 2;
        } else if (source[i] === "'") {
          i++;
          break;
        } else {
          i++;
        }
      }
      result += ' '.repeat(i - start);
      continue;
    }
    // Однострочный комментарий //…
    if (source[i] === '/' && source[i + 1] === '/') {
      const start = i;
      while (i < source.length && source[i] !== '\n') i++;
      result += ' '.repeat(i - start);
      continue;
    }
    // Многострочный комментарий /*…*/
    if (source[i] === '/' && source[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < source.length) {
        if (source[i] === '*' && source[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      result += ' '.repeat(i - start);
      continue;
    }
    result += source[i];
    i++;
  }
  return result;
}

const DEFINE = /^\s*#define\s+(\w+)\s+(\d+)\s*$/gm;
const CONST_INT = /\bconst\s+(?:int|uint8_t|byte)\s+(\w+)\s*=\s*(\d+)\s*;/g;
const PIN_MODE = /\bpinMode\s*\(\s*([A-Za-z_]\w*|\d+)\s*,\s*(OUTPUT|INPUT_PULLUP|INPUT)\s*\)/g;
const LCD =
  /\bLiquidCrystal\s+\w+\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/;
const ATTACH = /\.attach\s*\(\s*([A-Za-z_]\w*|\d+)/g;
const TONE = /\btone\s*\(\s*([A-Za-z_]\w*|\d+)/g;
const ANALOG = /\banalogRead\s*\(\s*A(\d+)\s*\)/g;

function resolve(token, defines) {
  if (/^\d+$/.test(token)) return Number(token);
  return Object.prototype.hasOwnProperty.call(defines, token) ? defines[token] : null;
}

export function extractPins(source) {
  // Вырежи комментарии и строки, чтобы не выдумать выводы из текста
  const cleaned = stripCommentsAndStrings(source);

  const defines = {};
  for (const m of cleaned.matchAll(DEFINE)) defines[m[1]] = Number(m[2]);
  for (const m of cleaned.matchAll(CONST_INT)) defines[m[1]] = Number(m[2]);

  const modes = [];
  for (const m of cleaned.matchAll(PIN_MODE)) {
    const pin = resolve(m[1], defines);
    if (pin !== null) modes.push({ pin, mode: m[2] });
  }

  const lcdMatch = cleaned.match(LCD);
  const lcd = lcdMatch ? lcdMatch.slice(1, 7).map(Number) : null;

  const servo = [];
  for (const m of cleaned.matchAll(ATTACH)) {
    const pin = resolve(m[1], defines);
    if (pin !== null) servo.push(pin);
  }

  const tone = [];
  for (const m of cleaned.matchAll(TONE)) {
    const pin = resolve(m[1], defines);
    if (pin !== null) tone.push(pin);
  }

  const analog = [...cleaned.matchAll(ANALOG)].map((m) => Number(m[1]));

  return { defines, modes, lcd, servo, tone, analog };
}
