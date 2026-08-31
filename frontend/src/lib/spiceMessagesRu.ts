/**
 * Сводка аналогового решателя — по-русски и без ложных тревог.
 *
 * Плашка в углу холста показывает состояние SPICE. Её текст собирался
 * по-английски прямо в ElectricalOverlay, а сообщения об ошибках приходят из
 * ngspice — это библиотека на C, её строки к i18next отношения не имеют и
 * сами по себе переведены быть не могут.
 *
 * Отдельная история — «Error: There are no vectors currently active.».
 * Это не поломка. Так ngspice сообщает, что решать нечего: ни одного узла в
 * цепи нет. Проверено на живом редакторе:
 *
 *   - пустой холст — сообщение есть;
 *   - одна деталь, ничего не соединено — сообщение есть;
 *   - плата без проводов — сообщения нет, решатель видит цепи питания.
 *
 * То есть ученик, который только открыл редактор или только вытащил первый
 * резистор, получал предупреждение о схеме, которой ещё не существует. Пока не
 * проведён ни один провод, такое сообщение скрывается: это нормальное начальное
 * состояние, а не ошибка.
 *
 * Если провода есть, а решатель всё равно говорит «нет узлов» — это уже
 * настоящая неисправность (не собрался netlist), и плашка показывается.
 *
 * Незнакомые сообщения ngspice выводятся как есть, по-английски. Придумывать
 * перевод строкам, которых мы не видели, значит переводить наугад; по
 * исходному тексту учитель хотя бы найдёт объяснение поиском.
 */

/**
 * Сообщение ngspice «решать нечего».
 *
 * Сверяется по подстроке: у ngspice бывает и «Error: » в начале, и голый текст.
 */
const NOTHING_TO_SOLVE = 'no vectors currently active';

/** Известные сообщения ngspice и их русские соответствия. */
const KNOWN_MESSAGES: Array<{ match: string; ru: string }> = [
  { match: NOTHING_TO_SOLVE, ru: 'схема не собрана — решать нечего' },
  { match: 'singular matrix', ru: 'вырожденная схема: где-то нет пути к земле' },
  { match: 'iteration limit reached', ru: 'решение не сошлось за отведённое число шагов' },
];

export interface SpiceSummary {
  /** Текст плашки. null — плашку не показывать вовсе. */
  text: string | null;
  /** Красить как ошибку. */
  isError: boolean;
}

export interface SpiceState {
  /** Сообщение решателя, как его вернул ngspice. */
  error: string | null;
  converged: boolean;
  /** Сколько узлов нашёл решатель. */
  netCount: number;
  solveMs: number;
  /** Сколько проводов на схеме. Ноль — ученик ещё ничего не соединил. */
  wireCount: number;
}

/** Перевести сообщение ngspice, если оно нам знакомо. */
export function translateSpiceMessage(message: string): string {
  const lower = message.toLowerCase();
  const known = KNOWN_MESSAGES.find((m) => lower.includes(m.match));
  return known ? known.ru : message;
}

/** Сообщение означает «решать нечего», а не неисправность схемы. */
export function isNothingToSolve(message: string): boolean {
  return message.toLowerCase().includes(NOTHING_TO_SOLVE);
}

/** Что показать в плашке SPICE — и показывать ли её вообще. */
export function describeSpiceState(state: SpiceState): SpiceSummary {
  if (state.error) {
    // Ничего не соединено — значит и решать нечего. Это не ошибка ученика и не
    // ошибка программы, показывать нечего.
    if (isNothingToSolve(state.error) && state.wireCount === 0) {
      return { text: null, isError: false };
    }
    return { text: `Предупреждение: ${translateSpiceMessage(state.error)}`, isError: true };
  }

  if (!state.converged) {
    return { text: 'Предупреждение: решение не сошлось', isError: true };
  }

  // Число вместо склонения: строка узкая, а склонять «узел / узла / узлов»
  // ради диагностической плашки незачем.
  return {
    text: `Узлов: ${state.netCount} · ${state.solveMs.toFixed(0)} мс`,
    isError: false,
  };
}
