/**
 * Инструменты кода: запись скетча и сборка.
 *
 * Вывод компилятора обрезается до сорока строк. Неудачная сборка выдаёт
 * сотни строк, и целиком они съедают контекст модели за один шаг — а нужны
 * ей первые ошибки: остальные обычно следствие.
 *
 * Плата берётся у холста, а не зашита строкой. FQBN считает тот же
 * `fqbnForLanguage`, а настройки сборки собирает тот же
 * `compileOptionsForBoard`, что у панели инструментов и диалога прошивки
 * (`utils/boardCompile.ts`): иначе read_canvas называет модели одну плату, а
 * компилятор собирает под другую, и модель правит исправный код по чужим
 * ошибкам.
 */
import { compileCode } from '../../services/compilation';
import { useEditorStore } from '../../store/useEditorStore';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { fqbnForLanguage } from '../../types/board';
import { compileOptionsForBoard } from '../../utils/boardCompile';
import { fail, ok, type ToolResult } from './toolTypes';

/** Сколько строк вывода компилятора уходит модели. */
const ERROR_LINES = 40;

export function writeSketch(args: { name: string; content: string }): ToolResult {
  const store = useEditorStore.getState();
  const existing = store.files.find((file) => file.name === args.name);
  const id = existing ? existing.id : store.createFile(args.name);
  useEditorStore.getState().setFileContent(id, args.content);
  return ok({ name: args.name, created: !existing });
}

export async function compileSketch(): Promise<ToolResult> {
  const files = useEditorStore
    .getState()
    .files.map((file) => ({ name: file.name, content: file.content }));

  const simulator = useSimulatorStore.getState();
  const board =
    simulator.boards.find((candidate) => candidate.id === simulator.activeBoardId) ??
    simulator.boards[0];
  if (!board) {
    return fail('На холсте нет платы — собирать не для чего. Сначала добавьте плату.');
  }
  const fqbn = fqbnForLanguage(board.boardKind, board.languageMode);
  if (!fqbn) {
    // Отказ, а не молчаливая подмена на Uno: собрать под другую плату хуже,
    // чем честно сказать, что эта не собирается.
    return fail(`Плата «${board.boardKind}» не собирается компилятором Arduino.`);
  }

  const result = await compileCode(
    files,
    fqbn,
    null,
    undefined,
    compileOptionsForBoard(board, { initiatedBy: 'agent' }),
  );

  // CompileResult (services/compilation.ts) не отдаёт единый `output` —
  // текст ошибки собирается из `stderr` и `error` тем же способом, каким его
  // уже читает EditorToolbar.tsx для панели ошибок редактора.
  const errorText = [result.stderr, result.error].filter(Boolean).join('\n');
  return ok({
    success: result.success,
    errors: result.success ? '' : errorText.split('\n').slice(0, ERROR_LINES).join('\n'),
  });
}
