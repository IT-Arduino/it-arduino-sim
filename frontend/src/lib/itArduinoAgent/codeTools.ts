/**
 * Инструменты кода: запись скетча и сборка.
 *
 * Вывод компилятора обрезается до сорока строк. Неудачная сборка выдаёт
 * сотни строк, и целиком они съедают контекст модели за один шаг — а нужны
 * ей первые ошибки: остальные обычно следствие.
 */
import { compileCode } from '../../services/compilation';
import { useEditorStore } from '../../store/useEditorStore';
import { ok, type ToolResult } from './toolTypes';

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

  const result = await compileCode(files, 'arduino:avr:uno', null, undefined, {
    initiatedBy: 'agent',
  });

  // CompileResult (services/compilation.ts) не отдаёт единый `output` —
  // текст ошибки собирается из `stderr` и `error` тем же способом, каким его
  // уже читает EditorToolbar.tsx для панели ошибок редактора.
  const errorText = [result.stderr, result.error].filter(Boolean).join('\n');
  return ok({
    success: result.success,
    errors: result.success ? '' : errorText.split('\n').slice(0, ERROR_LINES).join('\n'),
  });
}
