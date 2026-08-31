/**
 * Склейка страниц ответа GET /api/projects.
 *
 * Поле `complete` существует ради одной ошибки: если страница потерялась,
 * манифест выйдет короче ожидаемого, и без явной проверки этого никто не
 * заметит — просто «проектов оказалось меньше».
 */
export function mergePages(pages) {
  const seen = new Map();
  let total = 0;
  for (const page of pages) {
    total = Math.max(total, page.total ?? 0);
    for (const p of page.projects ?? []) if (!seen.has(p.id)) seen.set(p.id, p);
  }
  const projects = [...seen.values()];
  return { projects, total, complete: total > 0 && projects.length === total };
}
