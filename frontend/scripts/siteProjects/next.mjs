/**
 * Что делать в следующей итерации.
 *
 * Незавершённое важнее нового: иначе накопится десяток наполовину
 * собранных схем, каждая из которых требует повторного погружения.
 */
const ACTION = { stale: 'recompile', wired: 'verify', scaffolded: 'wire', pending: 'scaffold' };
const ORDER = ['stale', 'wired', 'scaffolded', 'pending'];
const RANK = { Легко: 0, Средне: 1, Сложно: 2 };

// Виды verify.kind, которые умеет запускать siteProjects.test.ts прямо
// сейчас (pin-toggle/lcd-text/manual — см. циклы там). Список специально
// узкий и держится в согласии с тем файлом руками, не общим модулем: два
// потребителя (тестовый раннер и выбор следующей задачи) должны отдельно
// решить, что для них значит «умею проверять», и раздельное объявление
// дешевле, чем разбираться с общей абстракцией ради одной строки констант.
const RUNNABLE_VERIFY_KINDS = ['pin-toggle', 'lcd-text', 'manual'];

// Итоговое ревью, IMPORTANT I8: 'wired' стоит в ORDER выше scaffolded и
// pending, и если у 'wired'-проекта уже назначен verify.kind, для которого
// раннера ещё нет (#77: 'analog' — ШИМ без внешнего сигнала не даёт
// pin-toggle переключений, нужен вид analog, которого сегодня нет), он
// навсегда занимает голову очереди: pickNext вернёт его снова и снова,
// а остальные 43 проекта не сдвинутся. Это не отказ верификации (правило
// «дважды не вышло → needs-attention» здесь неприменимо) — проект ждёт
// инструмента, которого ещё не существует, и не должен блокировать всё
// остальное. verify: null (ещё не пробовали) actionable как обычно —
// только назначенный, но нереализуемый kind пропускается.
function isActionable(p) {
  if (p.state !== 'wired') return true;
  if (!p.verify?.kind) return true;
  return RUNNABLE_VERIFY_KINDS.includes(p.verify.kind);
}

export function pickNext(manifest) {
  for (const state of ORDER) {
    const batch = (manifest.projects ?? [])
      .filter((p) => p.state === state)
      .sort((a, b) => (RANK[a.difficulty] ?? 9) - (RANK[b.difficulty] ?? 9));
    const p = batch.find(isActionable);
    if (p) {
      return { siteId: p.siteId, title: p.title, state: p.state, action: ACTION[p.state] };
    }
  }
  return null;
}

if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '')) {
  const { loadManifest } = await import('./manifest.mjs');
  const dir = process.env.SITE_PROJECTS_DIR;
  if (!dir) {
    console.error('Не задана SITE_PROJECTS_DIR.');
    process.exit(1);
  }
  const next = pickNext(loadManifest(dir));
  console.log(next ? `#${next.siteId} «${next.title}» — ${next.action}` : 'всё в терминальном состоянии');
}
