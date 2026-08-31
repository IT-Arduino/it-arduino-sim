// @vitest-environment jsdom
/**
 * Открываются ли собранные схемы САМИМ приложением.
 *
 * Остальные тесты набора siteProjects читают `.vlx` как JSON своими руками:
 * достают выводы, сверяют концы проводов, гоняют прошивку. Приложение в них
 * не участвует вовсе — и ровно поэтому они держали зелёным набор файлов,
 * которые в редакторе не открывались ни один.
 *
 * Два дефекта, найденные вручную (оба давали 100% зелёных тестов):
 *
 *  1. деталь записана как `{ type: 'led' }`. Такая форма живёт в примерах
 *     (src/data/examples.ts) и переводится загрузчиком utils/loadExample.ts
 *     в `metadataId`. Импорт `.vlx` не переводит НИЧЕГО — `loadProjectState`
 *     кладёт объект в хранилище как есть. Дальше SimulatorCanvas читает
 *     `component.metadataId`, получает undefined, зовёт с ним
 *     ComponentRegistry.getById, тот делает `id.replace(...)` — и React
 *     снимает всё дерево. Страница белая, в консоли одна строка
 *     «Cannot read properties of undefined (reading 'replace')».
 *     Валидатор .vlx этого не ловит: он проверяет, что `components` —
 *     массив, а форму элементов не смотрит.
 *
 *  2. группа файлов названа `g1`. `loadProjectState` пересоздаёт плату через
 *     `addBoard`, а тот жёстко ставит `activeFileGroupId = group-<id платы>`
 *     и значение из файла не читает. Схема открывается, детали и провода на
 *     месте — а редактор кода пуст, потому что активная группа указывает на
 *     несуществующую.
 *
 * Поэтому здесь не проверяется «файл выглядит правильно». Здесь вызывается
 * тот же `loadProjectState`, что и при импорте, и спрашивается у хранилищ,
 * что в них оказалось. Имя группы берётся из состояния платы, а не из
 * ожиданий теста: поменяется соглашение в addBoard — тест пойдёт за ним.
 *
 * Среда — jsdom, а не node по умолчанию: loadProjectState заканчивает работу
 * вызовом requestAnimationFrame (пересчёт координат концов проводов после
 * монтирования элементов), которого в node нет вовсе.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadManifest } from '../../scripts/siteProjects/manifest.mjs';
import { useEditorStore } from '../store/useEditorStore';
import { useSimulatorStore } from '../store/useSimulatorStore';

const DIR = process.env.SITE_PROJECTS_DIR;
const dirProvided = Boolean(DIR);
const dirExists = dirProvided && existsSync(DIR!);
const manifestFile = dirProvided ? join(DIR!, 'manifest.json') : '';
const manifestExists = dirExists && existsSync(manifestFile);

/** Состояния, при которых схема обязана открываться. */
const BUILT = new Set(['verified', 'needs-attention']);

/**
 * Идентификаторы деталей берутся из того же файла, который читает
 * ComponentRegistry в браузере. Сам реестр здесь не поднимается: он грузит
 * метаданные через fetch, которого в узле нет, а нужен от него ровно
 * список известных id.
 */
function knownMetadataIds(): Set<string> {
  const raw = readFileSync(join(process.cwd(), 'public', 'components-metadata.json'), 'utf-8');
  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (typeof o.id === 'string') ids.add(o.id);
      Object.values(o).forEach(walk);
    }
  };
  walk(JSON.parse(raw));
  return ids;
}

describe('схемы проектов сайта открываются приложением', () => {
  if (!dirProvided) {
    it.skip('пропущено: SITE_PROJECTS_DIR не задана', () => {});
    return;
  }
  if (!dirExists) {
    it('SITE_PROJECTS_DIR указывает на существующий каталог', () => {
      expect.fail(
        `SITE_PROJECTS_DIR="${DIR}" — каталога нет. Опечатка в пути иначе дала бы тихий зелёный прогон.`,
      );
    });
    return;
  }
  if (!manifestExists) {
    it('манифест на месте', () => {
      expect.fail(`нет ${manifestFile}`);
    });
    return;
  }

  const manifest = loadManifest(DIR!);
  const built = manifest.projects.filter((p: { state: string }) => BUILT.has(p.state));
  const ids = knownMetadataIds();

  beforeEach(() => {
    // Каждая схема грузится в чистое состояние: loadProjectState сносит
    // прежние платы сам, но редакторские группы прошлого проекта иначе
    // остались бы и подменили бы собой отсутствующую группу текущего.
    useEditorStore.getState().replaceFileGroups({}, {});
  });

  it('есть что открывать', () => {
    // Без этого весь блок ниже прошёл бы «зелено» на пустом списке.
    expect(built.length, 'ни одного проекта в состоянии verified/needs-attention').toBeGreaterThan(
      0,
    );
  });

  for (const p of built) {
    const file = join(DIR!, p.vlx ?? '');

    it(`#${p.siteId} «${p.title}»: открывается, детали известны реестру, скетч попадает в редактор`, () => {
      expect(p.vlx, `#${p.siteId}: в манифесте нет пути к .vlx`).toBeTruthy();
      expect(existsSync(file), `#${p.siteId}: нет файла ${file}`).toBe(true);

      const payload = JSON.parse(readFileSync(file, 'utf-8'));

      // Форма детали. Проверяется до загрузки: с полем `type` вместо
      // `metadataId` хранилище примет объект молча, а упадёт потом холст.
      for (const c of payload.components ?? []) {
        expect(
          'type' in c,
          `#${p.siteId}: деталь ${c.id} записана как {type}. Импорт .vlx не переводит type→metadataId (это делает только loadExample), холст упадёт на getById(undefined)`,
        ).toBe(false);
        expect(
          typeof c.metadataId === 'string' && c.metadataId.length > 0,
          `#${p.siteId}: у детали ${c.id} нет metadataId`,
        ).toBe(true);
        expect(
          ids.has(c.metadataId),
          `#${p.siteId}: реестр не знает деталь "${c.metadataId}"`,
        ).toBe(true);
      }

      // Тот же вызов, что делает importVlxFile после разбора файла.
      useSimulatorStore.getState().loadProjectState({
        boards: payload.boards,
        fileGroups: payload.fileGroups,
        folderGroups: payload.folderGroups,
        components: payload.components,
        wires: payload.wires,
        activeBoardId: payload.activeBoardId,
      });

      const sim = useSimulatorStore.getState();
      expect(sim.boards.length, `#${p.siteId}: плата не создалась`).toBe(payload.boards.length);
      expect(sim.components.length, `#${p.siteId}: детали не загрузились`).toBe(
        payload.components.length,
      );
      expect(sim.wires.length, `#${p.siteId}: провода не загрузились`).toBe(payload.wires.length);

      // Ключевое: имя группы спрашивается у платы ПОСЛЕ загрузки, то есть у
      // самого приложения. Файл может называть группу как угодно — важно,
      // что содержимое найдётся по тому имени, которое приложение выберет.
      const board = sim.boards[0];
      const group = useEditorStore.getState().fileGroups[board.activeFileGroupId];
      expect(
        group,
        `#${p.siteId}: активная группа платы "${board.activeFileGroupId}" отсутствует в редакторе (в файле: ${Object.keys(
          payload.fileGroups ?? {},
        ).join(', ')}). Схема откроется, но поле кода будет пустым`,
      ).toBeTruthy();

      const sketch = (group ?? []).find((f: { name: string }) => f.name === 'sketch.ino');
      expect(sketch, `#${p.siteId}: в активной группе нет sketch.ino`).toBeTruthy();
      expect(
        (sketch?.content ?? '').length,
        `#${p.siteId}: sketch.ino пуст — компилировать в редакторе будет нечего`,
      ).toBeGreaterThan(20);

      // Концы проводов должны указывать на то, что действительно есть в
      // схеме. Провод в никуда рисуется, но никуда и не соединяет.
      const known = new Set<string>([
        ...sim.boards.map((b) => b.id),
        ...sim.components.map((c) => c.id),
      ]);
      for (const w of payload.wires ?? []) {
        for (const side of ['start', 'end'] as const) {
          expect(
            known.has(w[side].componentId),
            `#${p.siteId}: провод ${w.id} (${side}) висит на "${w[side].componentId}" — такой детали в схеме нет`,
          ).toBe(true);
        }
      }
    });
  }
});
