/**
 * Сборка каркаса .vlx из слепка.
 *
 * Запуск: SITE_PROJECTS_DIR=<путь> node scripts/siteProjects/scaffold.mjs <siteId>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadManifest, saveManifest, advance } from './manifest.mjs';
import { extractPins } from './pins.mjs';
import { planWiring } from './wiring.mjs';

const DIR = process.env.SITE_PROJECTS_DIR;
const siteId = Number(process.argv[2]);
if (!DIR || !siteId) {
  console.error('Использование: SITE_PROJECTS_DIR=<путь> node scaffold.mjs <siteId>');
  process.exit(1);
}

const manifest = loadManifest(DIR);
const entry = manifest.projects.find((p) => p.siteId === siteId);
if (!entry) {
  console.error(`проект ${siteId} не найден в манифесте`);
  process.exit(1);
}

const snap = JSON.parse(readFileSync(join(DIR, 'snapshot', 'projects.json'), 'utf-8'));
const project = snap.projects.find((p) => p.id === siteId);

const boardId = 'board1';
const fileGroupId = `group-${boardId}`;
let n = 0;
// Плата тоже проходит через mapping.json со своим `fork` (например
// `arduino-uno`) и попадает в entry.components наравне с деталями — без
// исключения она задвоилась бы в components[] схемы, хотя место платы
// только в boards[].
const components = entry.components
  .filter((c) => c.fork && c.fork !== entry.board)
  .flatMap((c) =>
    Array.from({ length: c.qty }, () => ({ id: `c${++n}`, fork: c.fork, props: c.props ?? {} })),
  );

const pins = extractPins(project.code ?? '');
const { wires, unwired } = planWiring(pins, components, boardId);
const libraries = [...(project.code ?? '').matchAll(/#include\s*<([^>]+)>/g)].map((m) => m[1]);

const vlx = {
  format: 'velxio-project',
  version: 1,
  exportedAt: new Date().toISOString(),
  name: project.title,
  boards: [
    {
      id: boardId,
      boardKind: entry.board,
      x: 200,
      y: 200,
      activeFileGroupId: fileGroupId,
      libraries,
    },
  ],
  // Идентификатор группы файлов ОБЯЗАН быть `group-<id платы>`: loadProjectState
  // пересоздаёт плату через addBoard, а тот жёстко ставит activeFileGroupId =
  // `group-${id}` и значение из файла не читает. С любым другим именем схема
  // открывается, детали и провода на месте, а редактор кода пуст — активная
  // группа указывает на несуществующую.
  fileGroups: { [fileGroupId]: [{ name: 'sketch.ino', content: project.code ?? '' }] },
  components: components.map((c, i) => ({
    id: c.id,
    // Поле называется metadataId, а не type. Форма `type` живёт в примерах
    // (src/data/examples.ts) и переводится в metadataId загрузчиком
    // utils/loadExample.ts. Импорт .vlx ничего не переводит — кладёт объект
    // в хранилище как есть, а SimulatorCanvas читает component.metadataId.
    // С полем `type` схема грузится «успешно», но холст падает на
    // ComponentRegistry.getById(undefined) и приложение остаётся белым.
    metadataId: c.fork,
    x: 500 + (i % 5) * 120,
    y: 120 + Math.floor(i / 5) * 120,
    properties: c.props,
  })),
  wires,
  activeBoardId: boardId,
};

mkdirSync(join(DIR, 'circuits'), { recursive: true });
writeFileSync(join(DIR, 'circuits', `${siteId}.vlx`), JSON.stringify(vlx, null, 1), 'utf-8');

const idx = manifest.projects.indexOf(entry);
manifest.projects[idx] = {
  ...advance(entry, 'scaffolded'),
  vlx: `circuits/${siteId}.vlx`,
  unwired,
};
saveManifest(DIR, manifest);
console.log(
  `каркас ${siteId}: деталей ${components.length}, соединений ${wires.length}, без соединений ${unwired.length}`,
);
