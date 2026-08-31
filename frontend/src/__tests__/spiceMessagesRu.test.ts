/**
 * Тесты сводки решателя (src/lib/spiceMessagesRu).
 *
 * Проверяется граница между «решать нечего» и «схема неисправна». Ошибиться
 * здесь можно в обе стороны, и обе плохи: показывать ученику предупреждение о
 * схеме, которой он ещё не собрал, — пугать без причины; промолчать при
 * настоящей неисправности — спрятать поломку.
 *
 * Поведение снято с живого редактора: пустой холст и одиночная деталь без
 * проводов дают от ngspice «There are no vectors currently active», а плата
 * без проводов не даёт — цепи питания у неё есть.
 */
import { describe, it, expect } from 'vitest';

import {
  describeSpiceState,
  isNothingToSolve,
  translateSpiceMessage,
} from '../lib/spiceMessagesRu';

const NO_VECTORS = 'Error: There are no vectors currently active.';

/** Состояние «решатель отработал успешно». */
const OK = { error: null, converged: true, netCount: 4, solveMs: 3, wireCount: 6 };

describe('когда решать нечего', () => {
  it('на пустом холсте плашка не показывается', () => {
    const out = describeSpiceState({
      error: NO_VECTORS,
      converged: false,
      netCount: 0,
      solveMs: 0,
      wireCount: 0,
    });

    expect(out.text).toBeNull();
  });

  it('одиночная деталь без проводов — тоже не показывается', () => {
    // Ученик вытащил первый резистор. Схемы ещё нет, предупреждать не о чем.
    const out = describeSpiceState({
      error: NO_VECTORS,
      converged: false,
      netCount: 0,
      solveMs: 0,
      wireCount: 0,
    });

    expect(out.text).toBeNull();
    expect(out.isError).toBe(false);
  });

  it('но если провода есть — показывается, это уже неисправность', () => {
    // Провода проведены, а решатель не нашёл ни одного узла: не собрался
    // netlist. Промолчать здесь значило бы спрятать поломку.
    const out = describeSpiceState({
      error: NO_VECTORS,
      converged: false,
      netCount: 0,
      solveMs: 0,
      wireCount: 3,
    });

    // Сверяется вся строка, а не одно слово «Предупреждение»: иначе тест не
    // заметит, что перевод внутри describeSpiceState перестал применяться и
    // ученику снова показывают английский текст ngspice.
    expect(out.text).toBe('Предупреждение: схема не собрана — решать нечего');
    expect(out.isError).toBe(true);
  });

  it('в показанном предупреждении нет английского текста ngspice', () => {
    const out = describeSpiceState({
      error: NO_VECTORS,
      converged: false,
      netCount: 0,
      solveMs: 0,
      wireCount: 3,
    });

    expect(out.text).not.toContain('vectors');
  });
});

describe('перевод сообщений ngspice', () => {
  it('знакомые переводит', () => {
    expect(translateSpiceMessage(NO_VECTORS)).toBe('схема не собрана — решать нечего');
    expect(translateSpiceMessage('singular matrix')).toContain('вырожденная');
  });

  it('незнакомые оставляет как есть', () => {
    // Выдумывать перевод строкам, которых мы не видели, — переводить наугад.
    // По исходному тексту учитель хотя бы найдёт объяснение поиском.
    const unknown = 'Fatal error: some ngspice message we have never seen';
    expect(translateSpiceMessage(unknown)).toBe(unknown);
  });

  it('узнаёт сообщение без приставки Error и в другом регистре', () => {
    // ngspice выдаёт строку то с «Error: », то без неё.
    expect(isNothingToSolve('There are no vectors currently active.')).toBe(true);
    expect(isNothingToSolve(NO_VECTORS)).toBe(true);
    expect(isNothingToSolve('NO VECTORS CURRENTLY ACTIVE')).toBe(true);
    expect(isNothingToSolve('singular matrix')).toBe(false);
  });
});

describe('обычные состояния', () => {
  it('успешный расчёт показывает узлы и время по-русски', () => {
    const out = describeSpiceState(OK);

    expect(out.text).toBe('Узлов: 4 · 3 мс');
    expect(out.isError).toBe(false);
  });

  it('несошедшееся решение — предупреждение по-русски', () => {
    const out = describeSpiceState({ ...OK, converged: false });

    expect(out.text).toBe('Предупреждение: решение не сошлось');
    expect(out.isError).toBe(true);
  });

  it('в тексте не остаётся английских слов плашки', () => {
    for (const state of [OK, { ...OK, converged: false }]) {
      const text = describeSpiceState(state).text ?? '';
      expect(text).not.toMatch(/\bWarning\b|\bnets\b|\bms\b|did not converge/);
    }
  });
});
