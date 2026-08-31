/**
 * Тесты русских названий каталога (src/lib/componentNamesRu).
 *
 * Главная проверка — что ключи таблицы существуют в каталоге. Опечатка в
 * идентификаторе не роняет ничего: перевод просто молча не применяется, и
 * деталь остаётся английской среди русских. Такое замечают через месяц и
 * случайно.
 *
 * Обратной проверки — что переведены ВСЕ детали — здесь намеренно нет.
 * Апстрим добавляет детали, и такой тест краснел бы после каждого слияния,
 * сообщая не об ошибке, а о появлении новой детали. Непереведённая деталь
 * показывается с английским названием и работает.
 */
import { describe, it, expect, vi } from 'vitest';

import metadata from '../../public/components-metadata.json';
import {
  CATEGORY_RU,
  COMPONENT_RU,
  boardDescriptionRu,
  categoryLabelRu,
  translateComponent,
  translateComponents,
} from '../lib/componentNamesRu';

interface RawComponent {
  id: string;
  name: string;
  category: string;
  description?: string;
}

const CATALOG = ((metadata as { components?: RawComponent[] }).components ??
  (metadata as unknown as RawComponent[])) as RawComponent[];

describe('таблица перевода', () => {
  it('не содержит ключей, которых нет в каталоге', () => {
    const ids = new Set(CATALOG.map((c) => c.id));
    const stale = Object.keys(COMPONENT_RU).filter((id) => !ids.has(id));

    // Опечатка в ключе не ломает сборку и не даёт ошибки — перевод просто не
    // применяется. Поймать её можно только так.
    expect(stale).toEqual([]);
  });

  it('покрывает все категории, встречающиеся в каталоге', () => {
    const categories = [...new Set(CATALOG.map((c) => c.category))];
    const untranslated = categories.filter((c) => !(c in CATEGORY_RU));

    expect(untranslated).toEqual([]);
  });

  it('сохраняет маркировку прибора латиницей', () => {
    // Переводится пояснение, а не обозначение: по «1N4007» ученик найдёт
    // деталь в магазине и в справочнике, по «диод выпрямительный» — нет.
    expect(COMPONENT_RU['diode-1n4007'].name).toContain('1N4007');
    expect(COMPONENT_RU['bjt-bc547'].name).toContain('BC547');
    expect(COMPONENT_RU['ic-74hc00'].name).toContain('74HC00');
    expect(COMPONENT_RU['opamp-lm358'].name).toContain('LM358');
  });

  it('не оставляет английских единиц в названиях резисторов и конденсаторов', () => {
    const passives = Object.entries(COMPONENT_RU).filter(
      ([id]) => id.startsWith('resistor-') || id.startsWith('cap-'),
    );
    expect(passives.length).toBeGreaterThan(15);

    for (const [id, ru] of passives) {
      expect(ru.name, `${id}: осталась латинская единица`).not.toMatch(/\d\s*(kΩ|Ω|[nµu]F|pF)\b/);
    }
  });
});

describe('translateComponent', () => {
  it('подставляет русское название', () => {
    const out = translateComponent({
      id: 'resistor-220',
      name: 'Resistor 220 Ω',
      category: 'passive',
    });

    expect(out.name).toBe('Резистор 220 Ом');
  });

  it('оставляет английское описание, если своего нет', () => {
    // У большинства пассивных деталей описания в таблице нет. Английское
    // описание апстрима полезнее пустого места: по нему хотя бы понятно, что
    // это за деталь.
    const out = translateComponent({
      id: 'resistor-220',
      name: 'Resistor 220 Ω',
      description: 'Through-hole resistor',
    });

    expect(out.name).toBe('Резистор 220 Ом');
    expect(out.description).toBe('Through-hole resistor');
  });

  it('заменяет описание, когда своё есть', () => {
    const out = translateComponent({
      id: 'diode-1n4007',
      name: '1N4007 (1 kV Rectifier)',
      description: '1 A / 1000 V silicon rectifier diode.',
    });

    expect(out.description).toContain('выпрямительный');
  });

  it('не трогает деталь, которой нет в таблице', () => {
    const original = { id: 'совершенно-новая-деталь', name: 'Brand New Part' };

    // Возвращается та же ссылка: копия ничего не даёт, а ссылочное равенство
    // иногда экономит перерисовку.
    expect(translateComponent(original)).toBe(original);
  });

  it('не меняет id и категорию — по ним работает фильтр каталога', () => {
    const out = translateComponent({ id: 'led', name: 'LED', category: 'output' });

    expect(out.id).toBe('led');
    expect(out.category).toBe('output');
  });

  it('переводит список целиком', () => {
    const out = translateComponents([
      { id: 'led', name: 'LED' },
      { id: 'pushbutton', name: 'Pushbutton' },
    ]);

    expect(out.map((c) => c.name)).toEqual(['Светодиод', 'Кнопка']);
  });
});

describe('врезка в каталог', () => {
  it('applyCatalogConfig и фильтрует, и переводит', async () => {
    // Проверяется именно связка. Таблица может быть полной, функция перевода
    // рабочей, а вызова в applyCatalogConfig не быть — и каталог останется
    // английским, не уронив ни одного другого теста.
    vi.resetModules();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ disabled: [], enabledOnly: null }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { applyCatalogConfig } = await import('../lib/componentCatalog');
    const out = await applyCatalogConfig([
      { id: 'led', name: 'LED', category: 'output' },
      // Деталь снятой платы: должна исчезнуть, а не перевестись.
      { id: 'esp32-devkit-v1', name: 'ESP32 Devkit V1', category: 'boards' },
    ] as never);

    expect(out.map((c) => c.name)).toEqual(['Светодиод']);
  });
});

describe('категории', () => {
  it('sensor и sensors переводятся одинаково', () => {
    // Обе существуют в метаданных апстрима — это его несогласованность. Два
    // разных перевода дали бы в списке две строки «Датчики».
    expect(categoryLabelRu('sensor')).toBe(categoryLabelRu('sensors'));
  });

  it('приводит sensor к sensors', () => {
    // Одного перевода мало: список категорий в окне строится по уникальным
    // идентификаторам, и без приведения «Датчики» появлялись дважды, каждая
    // со своей частью деталей.
    const out = translateComponent({
      id: 'bmp280',
      name: 'BMP280 (Pressure + Temp)',
      category: 'sensor',
    });

    expect(out.category).toBe('sensors');
  });

  it('после обработки в каталоге не остаётся двух подписей «Датчики»', () => {
    const processed = translateComponents(CATALOG);
    const labels = [...new Set(processed.map((c) => categoryLabelRu(c.category)))];

    expect(labels.length).toBe(new Set(labels).size);
    expect(labels.filter((l) => l === 'Датчики')).toHaveLength(1);
  });

  it('порядок карточек знает приведённую категорию', () => {
    // CATEGORY_ORDER в ComponentPickerModal содержит `sensors` и не содержит
    // `sensor`, поэтому до приведения BMP280 сортировался как «прочее».
    const out = translateComponent({ id: 'bmp280', name: 'BMP280', category: 'sensor' });

    expect(out.category).not.toBe('sensor');
  });

  it('незнакомую категорию возвращает как есть', () => {
    expect(categoryLabelRu('quantum')).toBe('quantum');
  });
});

describe('описания плат', () => {
  it('переведены для всех плат форка', () => {
    for (const kind of ['arduino-uno', 'arduino-nano', 'arduino-mega', 'attiny85']) {
      expect(boardDescriptionRu(kind), `нет описания для ${kind}`).toBeTruthy();
    }
  });

  it('для чужой платы возвращает undefined — сработает запасной вариант', () => {
    expect(boardDescriptionRu('esp32-devkit-v1')).toBeUndefined();
  });
});
