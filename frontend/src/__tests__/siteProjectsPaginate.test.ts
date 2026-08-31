import { describe, it, expect } from 'vitest';
import { mergePages } from '../../scripts/siteProjects/paginate.mjs';

describe('склейка страниц ответа API', () => {
  it('убирает повторы по id', () => {
    const out = mergePages([
      { projects: [{ id: 1 }, { id: 2 }], total: 3 },
      { projects: [{ id: 2 }, { id: 3 }], total: 3 },
    ]);
    expect(out.projects.map((p: any) => p.id)).toEqual([1, 2, 3]);
    expect(out.complete).toBe(true);
  });

  it('сообщает о неполноте, если собрано меньше заявленного', () => {
    // Молчаливая потеря страницы — худшее, что может случиться:
    // манифест выйдет короче, и никто не заметит.
    const out = mergePages([{ projects: [{ id: 1 }], total: 44 }]);
    expect(out.complete).toBe(false);
  });

  it('пустой список — не ошибка, но и не полнота', () => {
    const out = mergePages([]);
    expect(out.projects).toEqual([]);
    expect(out.complete).toBe(false);
  });
});
