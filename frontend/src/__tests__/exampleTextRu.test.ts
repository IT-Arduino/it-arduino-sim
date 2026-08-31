/**
 * exampleTextRu.test.ts — the Russian gallery strings actually reach the UI.
 *
 * The failure this guards against is silent: a key typo in `TITLE_RU` does
 * not throw, does not warn and does not show a placeholder — the example
 * simply keeps its English title, and nobody notices until a student does.
 * So the tests assert against the REAL `exampleProjects` array rather than
 * against the tables in isolation.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { exampleProjects } from '../data/examples';
import {
  TITLE_RU,
  DESCRIPTION_RU,
  translateExample,
  translateExamples,
} from '../lib/exampleTextRu';

const CYRILLIC = /[А-Яа-яЁё]/;

/**
 * Every example id upstream defines, INCLUDING the ones this fork's board
 * allowlist filters out of the gallery. Read from the source files rather
 * than imported: `ALL_EXAMPLES` is module-private, and adding an export to
 * an upstream file just to satisfy a test is a worse trade than a regex.
 *
 * The distinction matters. A key for a filtered-out example (`pico-blink`,
 * `esp32-oled`) is deliberate — the translation is ready if that board is
 * ever re-enabled. A key for an id that exists NOWHERE is a typo.
 */
const upstreamIds = (() => {
  // Всё, что форк реально показывает. Идентификаторы разделов `an-` и
  // `digital-` собираются фабриками во время выполнения — буквально в
  // исходниках их нет, поэтому одного разбора файлов мало.
  const ids = new Set<string>(exampleProjects.map((e) => e.id));
  const dir = path.resolve(__dirname, '../data');
  for (const file of fs.readdirSync(dir)) {
    if (!file.startsWith('examples') || !file.endsWith('.ts')) continue;
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/\bid:\s*'([^']+)'/g)) ids.add(m[1]);
  }
  return ids;
})();

/**
 * Titles that are correct with no Cyrillic in them: names of a product, a
 * board or a 1975 arcade game. Listed explicitly so a genuinely forgotten
 * translation still fails the test.
 */
const LATIN_BY_DESIGN = new Set([
  'stm32-blackpill-oled', // «STM32 Black Pill: OLED SSD1306 (I2C)» — сплошь названия
  'i8080-killbits', // «Kill the Bit» (1975) — название игры
]);

describe('таблицы переводов', () => {
  it('каждый ключ соответствует существующему примеру', () => {
    // Ловит опечатку в ключе: 'pico-blnik' не сломает сборку и не выдаст
    // предупреждения — пример просто останется английским.
    const orphanTitles = Object.keys(TITLE_RU).filter((id) => !upstreamIds.has(id));
    const orphanDescriptions = Object.keys(DESCRIPTION_RU).filter((id) => !upstreamIds.has(id));
    expect({ orphanTitles, orphanDescriptions }).toEqual({
      orphanTitles: [],
      orphanDescriptions: [],
    });
  });

  it('в списке разбора нашлись сами примеры', () => {
    // Страховка от того, что регулярное выражение выше однажды перестанет
    // что-либо находить и предыдущий тест начнёт проходить впустую.
    expect(upstreamIds.size).toBeGreaterThan(exampleProjects.length);
    expect(upstreamIds.has('blink-led')).toBe(true);
  });

  it('каждое значение действительно на русском', () => {
    const notRussian = [
      ...Object.entries(TITLE_RU).map(([k, v]) => [`title:${k}`, k, v] as const),
      ...Object.entries(DESCRIPTION_RU).map(([k, v]) => [`description:${k}`, k, v] as const),
    ]
      .filter(([, id, v]) => !CYRILLIC.test(v) && !LATIN_BY_DESIGN.has(id))
      .map(([label]) => label);
    expect(notRussian).toEqual([]);
  });
});

describe('перевод доходит до галереи', () => {
  it('у всех показываемых примеров русское название', () => {
    const english = exampleProjects
      .filter((e) => !CYRILLIC.test(e.title))
      .map((e) => `${e.id}: ${e.title}`);
    expect(english).toEqual(['i8080-killbits: «Kill the Bit» (1975)']);
  });

  it('описание либо русское, либо отсутствует', () => {
    const english = exampleProjects
      .filter((e) => e.description && !CYRILLIC.test(e.description))
      .map((e) => `${e.id}: ${e.description}`);
    expect(english).toEqual([]);
  });

  it('конкретные примеры переведены дословно', () => {
    const byId = (id: string) => exampleProjects.find((e) => e.id === id);
    expect(byId('blink-led')?.title).toBe('Мигание светодиодом');
    expect(byId('attiny85-blink')?.title).toBe('ATtiny85: мигание светодиодом');
    expect(byId('blink-led')?.description).toBe(
      'Классический пример для Arduino: светодиод зажигается и гаснет.',
    );
  });
});

describe('translateExample', () => {
  const base = {
    id: 'blink-led',
    title: 'Blink LED',
    description: 'Classic Arduino blink example',
    category: 'basics',
    difficulty: 'beginner',
    code: 'void setup() {}',
    components: [{ type: 'wokwi-led', id: 'led1', x: 0, y: 0, properties: {} }],
    wires: [],
    tags: ['led', 'basics'],
  } as unknown as Parameters<typeof translateExample>[0];

  it('меняет только название и описание', () => {
    const out = translateExample(base);
    expect(out.title).toBe('Мигание светодиодом');
    expect(out.description).toBe('Классический пример для Arduino: светодиод зажигается и гаснет.');
    // Всё остальное — байт в байт. Именно здесь сломался бы пример, если бы
    // перевод случайно затронул код или список деталей.
    const restIn = { ...(base as unknown as Record<string, unknown>) };
    const restOut = { ...(out as unknown as Record<string, unknown>) };
    delete restIn.title;
    delete restIn.description;
    delete restOut.title;
    delete restOut.description;
    expect(restOut).toEqual(restIn);
  });

  it('неизвестный идентификатор возвращается тем же объектом', () => {
    const unknown = { ...base, id: 'не-существует' } as typeof base;
    // Тот же объект, а не копия: общий путь не должен ничего выделять.
    expect(translateExample(unknown)).toBe(unknown);
  });

  it('translateExamples не меняет порядок и длину', () => {
    const list = [base, { ...base, id: 'не-существует' } as typeof base];
    const out = translateExamples(list);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.id)).toEqual(['blink-led', 'не-существует']);
  });
});
