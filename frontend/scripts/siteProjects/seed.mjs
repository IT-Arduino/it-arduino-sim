/**
 * Заполнение манифеста из слепка — слияние, не перезапись.
 *
 * Порядок — по возрастанию сложности с сайта: простые дают правилам
 * трассировки покрытие, и каждая следующая итерация дешевеет.
 *
 * Итоговое ревью, IMPORTANT I3: старая версия перезаписывала манифест
 * целиком при каждом запуске — состояние (state/vlx/hex/verify/unwired)
 * уже собранных схем стиралось. Это штатное действие после того, как
 * fetch.mjs обновил слепок, а не разовый сценарий — значит, обязано быть
 * безопасным при повторных запусках. mergeManifest() ниже: siteId, которых
 * не было в манифесте, заводятся с нуля тем же способом, что и раньше;
 * существующие сохраняются как есть — единственное исключение узкое и
 * явное: свежий codeSha256 сверяется со старым через checkStale() из
 * manifest.mjs (итоговое ревью, IMPORTANT I2), и расхождение у уже
 * verified записи переводит её в stale. siteId из старого манифеста,
 * которого нет в свежем слепке, не удаляется — пропажа из выгрузки может
 * быть временной, молча терять историю дороже, чем оставить лишнюю запись.
 *
 * mergeManifest() — чистая функция без файлового I/O (тот же приём, что
 * next.mjs с pickNext()): CLI-обвязка ниже читает диск и печатает
 * результат, сама логика слияния проверяется юнит-тестами без диска.
 *
 * Запуск: SITE_PROJECTS_DIR=<путь> node scripts/siteProjects/seed.mjs
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadManifest, saveManifest, manifestPath, checkStale } from './manifest.mjs';
import { blockersFor, mapComponent } from './blocklist.mjs';

const RANK = { Легко: 0, Средне: 1, Сложно: 2 };
const BOARD = { 'Arduino Nano': 'arduino-nano' };

function freshEntry(p) {
  const blockers = blockersFor(p.components, p.code);
  const boardName = (p.components ?? []).map((c) => c.name).find((n) => BOARD[n]);
  return {
    siteId: p.id,
    title: p.title,
    author: p.author ?? null,
    difficulty: p.difficulty,
    codeSha256: createHash('sha256')
      .update(p.code ?? '')
      .digest('hex'),
    board: boardName ? BOARD[boardName] : 'arduino-uno',
    state: blockers.length ? 'blocked' : 'pending',
    blockedBy: blockers.length ? blockers : undefined,
    vlx: null,
    hex: null,
    components: (p.components ?? []).map((c) => ({
      site: c.name,
      qty: c.quantity ?? 1,
      ...mapComponent(c.name),
    })),
    verify: null,
  };
}

export function mergeManifest(existing, snapshot) {
  const byId = new Map((existing?.projects ?? []).map((p) => [p.siteId, p]));
  let added = 0;
  let staled = 0;
  for (const p of snapshot.projects) {
    const prior = byId.get(p.id);
    if (prior) {
      const freshHash = createHash('sha256')
        .update(p.code ?? '')
        .digest('hex');
      const reconciled = checkStale(prior, freshHash);
      if (reconciled.state === 'stale' && prior.state !== 'stale') staled++;
      byId.set(p.id, reconciled);
      continue;
    }
    byId.set(p.id, freshEntry(p));
    added++;
  }
  const projects = [...byId.values()].sort(
    (a, b) => (RANK[a.difficulty] ?? 9) - (RANK[b.difficulty] ?? 9),
  );
  return {
    manifest: {
      snapshot: {
        fetchedAt: snapshot.fetchedAt,
        apiBase: snapshot.apiBase,
        total: projects.length,
      },
      projects,
    },
    added,
    staled,
  };
}

if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '')) {
  const DIR = process.env.SITE_PROJECTS_DIR;
  if (!DIR) {
    console.error('Не задана SITE_PROJECTS_DIR.');
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(join(DIR, 'snapshot', 'projects.json'), 'utf-8'));
  const existing = existsSync(manifestPath(DIR)) ? loadManifest(DIR) : null;
  const { manifest, added, staled } = mergeManifest(existing, snap);
  saveManifest(DIR, manifest);
  const blocked = manifest.projects.filter((p) => p.state === 'blocked').length;
  console.log(
    `манифест: ${manifest.projects.length} проектов, из них заблокировано ${blocked}` +
      (existing ? `; слияние: новых ${added}, устарело ${staled}` : ''),
  );
}
