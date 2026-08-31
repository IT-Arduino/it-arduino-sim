import { describe, it, expect } from 'vitest';
import { pickNext } from '../../scripts/siteProjects/next.mjs';

const m = (projects: any[]) => ({ projects });

describe('выбор следующего проекта', () => {
  it('берёт первый pending и просит собрать каркас', () => {
    const out = pickNext(m([{ siteId: 1, title: 'a', state: 'pending', difficulty: 'Легко' }]));
    expect(out).toMatchObject({ siteId: 1, action: 'scaffold' });
  });

  it('незавершённое важнее нового', () => {
    // Иначе накопится десяток наполовину собранных схем.
    const out = pickNext(
      m([
        { siteId: 1, title: 'a', state: 'pending', difficulty: 'Легко' },
        { siteId: 2, title: 'b', state: 'scaffolded', difficulty: 'Сложно' },
      ]),
    );
    expect(out?.siteId).toBe(2);
  });

  it('пропускает blocked и needs-attention', () => {
    const out = pickNext(
      m([
        { siteId: 1, title: 'a', state: 'blocked', difficulty: 'Легко' },
        { siteId: 2, title: 'b', state: 'needs-attention', difficulty: 'Легко' },
      ]),
    );
    expect(out).toBeNull();
  });

  it('всё сделано — возвращает null', () => {
    expect(pickNext(m([{ siteId: 1, title: 'a', state: 'verified' }]))).toBeNull();
  });

  // Итоговое ревью, IMPORTANT I8: ORDER ставит 'wired' выше всего, и #77
  // (verify.kind: 'analog' — вида проверки, которого раннер ещё не умеет)
  // навсегда занимал голову очереди: pickNext выдаёт #77 бесконечно,
  // очередь не двигается. #77 — не отказ (правило «дважды не вышло →
  // needs-attention» тут не подходит): он ждёт инструмента, которого нет.
  describe('«wired», ждущий отсутствующего вида проверки, не держит очередь', () => {
    it('пропускает такой проект и отдаёт следующего по ORDER (pending)', () => {
      const out = pickNext(
        m([
          {
            siteId: 77,
            title: 'стоит',
            state: 'wired',
            difficulty: 'Легко',
            verify: { kind: 'analog' },
          },
          { siteId: 5, title: 'ждёт', state: 'pending', difficulty: 'Легко' },
        ]),
      );
      expect(out).toMatchObject({ siteId: 5, action: 'scaffold' });
    });

    it('пропускает и когда это единственная запись — очередь не встаёт, а завершается', () => {
      const out = pickNext(
        m([
          {
            siteId: 77,
            title: 'стоит',
            state: 'wired',
            difficulty: 'Легко',
            verify: { kind: 'analog' },
          },
        ]),
      );
      expect(out).toBeNull();
    });

    it('уступает место другому "wired" в том же бакете, если у того известный вид проверки', () => {
      const out = pickNext(
        m([
          {
            siteId: 77,
            title: 'стоит',
            state: 'wired',
            difficulty: 'Легко',
            verify: { kind: 'analog' },
          },
          {
            siteId: 6,
            title: 'можно',
            state: 'wired',
            difficulty: 'Сложно',
            verify: { kind: 'lcd-text' },
          },
        ]),
      );
      expect(out).toMatchObject({ siteId: 6, action: 'verify' });
    });

    it('"wired" с verify: null (ещё не пробовали) остаётся в очереди как обычно', () => {
      const out = pickNext(
        m([{ siteId: 1, title: 'a', state: 'wired', difficulty: 'Легко', verify: null }]),
      );
      expect(out).toMatchObject({ siteId: 1, action: 'verify' });
    });

    it('"wired" с известным видом проверки (pin-toggle) остаётся в очереди как обычно', () => {
      const out = pickNext(
        m([
          {
            siteId: 1,
            title: 'a',
            state: 'wired',
            difficulty: 'Легко',
            verify: { kind: 'pin-toggle' },
          },
        ]),
      );
      expect(out).toMatchObject({ siteId: 1, action: 'verify' });
    });
  });
});
