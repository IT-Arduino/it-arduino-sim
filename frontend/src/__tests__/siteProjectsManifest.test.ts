import { describe, it, expect } from 'vitest';
import { canTransition, advance, checkStale } from '../../scripts/siteProjects/manifest.mjs';

describe('переходы состояний', () => {
  it('разрешает движение вперёд по цепочке', () => {
    expect(canTransition('pending', 'scaffolded')).toBe(true);
    expect(canTransition('scaffolded', 'wired')).toBe(true);
    expect(canTransition('wired', 'verified')).toBe(true);
  });

  it('запрещает перепрыгивать состояния', () => {
    // Прыжок через scaffolded означал бы схему, которой никто не собирал.
    expect(canTransition('pending', 'verified')).toBe(false);
  });

  it('из blocked никуда не ведёт', () => {
    expect(canTransition('blocked', 'scaffolded')).toBe(false);
  });

  it('из wired можно уйти в needs-attention', () => {
    expect(canTransition('wired', 'needs-attention')).toBe(true);
  });

  it('advance проставляет состояние и не трогает остальное', () => {
    const entry = { siteId: 28, state: 'pending', title: 'Бегущий огонек' };
    const out = advance(entry, 'scaffolded');
    expect(out.state).toBe('scaffolded');
    expect(out.title).toBe('Бегущий огонек');
    expect(entry.state).toBe('pending'); // исходный объект не меняется
  });

  it('advance отказывается от запрещённого перехода', () => {
    expect(() => advance({ siteId: 1, state: 'pending' }, 'verified')).toThrow(/переход/);
  });
});

describe('checkStale — codeSha256 писался и никогда не читался (найдено итоговым ревью, I2)', () => {
  // Спека: «codeSha256 — слепок кода сайта на момент сборки... Несовпадение
  // хеша при следующей выгрузке переводит проект в stale. Без этого поля
  // связка разъезжается молча». До этой правки ничто в кодовой базе не
  // сравнивало codeSha256 со свежим слепком — состояние stale было
  // недостижимо ни одним путём, хотя входит в STATES и в ALLOWED (stale:
  // ['wired']).
  it('хеш совпадает — запись не меняется', () => {
    const entry = { siteId: 1, state: 'verified', codeSha256: 'abc' };
    expect(checkStale(entry, 'abc')).toEqual(entry);
  });

  it('хеш разошёлся у verified — переходит в stale, codeSha256 не трогается', () => {
    // codeSha256 остаётся старым (тем, что реально было собрано и
    // проверено) — не тем, что сейчас на сайте: значение поля обязано
    // отвечать на вопрос «что подтверждено», а не «что сейчас на сайте»
    // (для этого у самого слепка есть свой fetchedAt).
    const entry = { siteId: 1, state: 'verified', codeSha256: 'abc', vlx: 'circuits/1.vlx' };
    const out = checkStale(entry, 'def');
    expect(out.state).toBe('stale');
    expect(out.codeSha256).toBe('abc');
    expect(out.vlx).toBe('circuits/1.vlx');
  });

  it('хеш разошёлся у wired — переход в stale не определён (ALLOWED), запись не меняется', () => {
    const entry = { siteId: 1, state: 'wired', codeSha256: 'abc' };
    expect(checkStale(entry, 'def')).toEqual(entry);
  });

  it('хеш разошёлся у pending — запись не меняется (ещё ничего не собрано)', () => {
    const entry = { siteId: 1, state: 'pending', codeSha256: 'abc' };
    expect(checkStale(entry, 'def')).toEqual(entry);
  });

  it('хеш разошёлся у blocked — запись не меняется (блокировка не про исходный код)', () => {
    const entry = { siteId: 1, state: 'blocked', codeSha256: 'abc', blockedBy: ['x'] };
    expect(checkStale(entry, 'def')).toEqual(entry);
  });
});
