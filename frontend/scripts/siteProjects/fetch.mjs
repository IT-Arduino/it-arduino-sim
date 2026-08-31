/**
 * Забрать проекты сайта и записать слепок.
 *
 * Слепок закрепляется намеренно: код скетчей копируется в схемы дословно,
 * и сборка должна опираться на зафиксированное состояние, а не на то, что
 * сайт отдаёт прямо сейчас.
 *
 * Запуск: SITE_PROJECTS_DIR=<путь> node scripts/siteProjects/fetch.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { mergePages } from './paginate.mjs';

const API = process.env.SITE_API_BASE ?? 'https://api.it-arduino.ru/api';
const OUT = process.env.SITE_PROJECTS_DIR;
if (!OUT) {
  console.error('Не задана SITE_PROJECTS_DIR — каталог site-projects репозитория сайта.');
  process.exit(1);
}

const pages = [];
for (let page = 1; page <= 20; page++) {
  const res = await fetch(`${API}/projects?page=${page}&per_page=10`);
  if (!res.ok) {
    console.error(`страница ${page}: HTTP ${res.status}`);
    process.exit(1);
  }
  pages.push(await res.json());
  if (mergePages(pages).complete) break;
}

const merged = mergePages(pages);
if (!merged.complete) {
  console.error(`собрано ${merged.projects.length} из ${merged.total} — слепок неполон`);
  process.exit(1);
}

mkdirSync(join(OUT, 'snapshot'), { recursive: true });
writeFileSync(
  join(OUT, 'snapshot', 'projects.json'),
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString().slice(0, 10),
      apiBase: API,
      projects: merged.projects,
    },
    null,
    1,
  ),
  'utf-8',
);
console.log(`слепок записан: ${merged.projects.length} проектов`);
