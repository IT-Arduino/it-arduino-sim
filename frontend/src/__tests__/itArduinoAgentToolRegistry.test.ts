/**
 * Реестр инструментов.
 *
 * Перечень обязан совпадать с тем, что сервер объявляет модели
 * (arduino_api/app/services/agent/tools_schema.py). Расхождение проявляется
 * тихо: модель зовёт инструмент, браузер отвечает «нет такого», прогон
 * топчется на месте до предела шагов.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/pinPositionCalculator', () => ({
  calculatePinPosition: () => null,
  getAllPinPositions: () => [],
}));

import { TOOLS, runTool } from '../lib/itArduinoAgent/toolRegistry';

const DECLARED_ON_SERVER = [
  'read_canvas',
  'list_available_components',
  'read_sketch',
  'add_component',
  'move_component',
  'set_component_property',
  'remove_component',
  'add_wire',
  'remove_wire',
  'write_sketch',
  'compile',
  'run',
  'stop',
];

describe('реестр', () => {
  it('содержит ровно те инструменты, что объявлены серверу', () => {
    expect(Object.keys(TOOLS).sort()).toEqual([...DECLARED_ON_SERVER].sort());
  });

  it('неизвестное имя — ошибка со списком доступных, а не исключение', async () => {
    const result = await runTool('поставь_всё_сам', {});

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain('read_canvas');
  });

  it('read_canvas исполняется через реестр', async () => {
    const result = await runTool('read_canvas', {});

    expect(result.ok).toBe(true);
  });
});
