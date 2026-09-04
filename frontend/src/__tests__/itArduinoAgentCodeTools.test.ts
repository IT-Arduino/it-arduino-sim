/**
 * Инструменты кода (lib/itArduinoAgent/codeTools).
 *
 * Главное здесь — обрезка вывода компилятора: неудачная сборка выдаёт сотни
 * строк, и целиком они съедают контекст модели за один шаг.
 *
 * Поля мока compileCode взяты из настоящего `CompileResult`
 * (services/compilation.ts) — там нет единого `output`, есть раздельные
 * `stdout`/`stderr`/`error`, и текст ошибки собирается из `stderr` и `error`
 * тем же способом, что уже делает `EditorToolbar.tsx` для панели ошибок.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../store/useEditorStore';

const compileCode = vi.fn();
vi.mock('../services/compilation', () => ({
  compileCode: (...args: unknown[]) => compileCode(...args),
}));

import { compileSketch, writeSketch } from '../lib/itArduinoAgent/codeTools';

beforeEach(() => {
  compileCode.mockReset();
});

describe('write_sketch', () => {
  it('переписывает существующий файл', () => {
    const file = useEditorStore.getState().files[0];

    const result = writeSketch({ name: file.name, content: '// от агента' });

    expect(result.ok).toBe(true);
    const after = useEditorStore.getState().files.find((f) => f.name === file.name);
    expect(after?.content).toBe('// от агента');
  });

  it('создаёт файл, которого не было', () => {
    const result = writeSketch({ name: 'helper.h', content: '#pragma once' });

    expect(result.ok).toBe(true);
    const created = useEditorStore.getState().files.find((f) => f.name === 'helper.h');
    expect(created?.content).toBe('#pragma once');
  });
});

describe('compile', () => {
  it('успешная сборка возвращает признак успеха', async () => {
    compileCode.mockResolvedValue({ success: true, stdout: 'Sketch uses 924 bytes', stderr: '' });

    const result = await compileSketch();

    expect(result.ok).toBe(true);
    expect((result as { ok: true; data: any }).data.success).toBe(true);
  });

  it('неудачная сборка отдаёт не больше сорока строк ошибок', async () => {
    compileCode.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: Array.from({ length: 200 }, (_, i) => `error line ${i}`).join('\n'),
    });

    const result = await compileSketch();

    const data = (result as { ok: true; data: any }).data;
    expect(data.success).toBe(false);
    expect(data.errors.split('\n')).toHaveLength(40);
  });

  it('помечает сборку как начатую агентом', async () => {
    compileCode.mockResolvedValue({ success: true, stdout: '', stderr: '' });

    await compileSketch();

    const extras = compileCode.mock.calls[0][4];
    expect(extras).toMatchObject({ initiatedBy: 'agent' });
  });
});
