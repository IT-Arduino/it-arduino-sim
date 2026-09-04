/**
 * Инструменты чтения (lib/itArduinoAgent/readTools).
 *
 * Модель видит холст только через них. Если read_canvas не отдаёт имена
 * выводов, агент выдумывает названия ножек и провод не ставится — ошибка
 * тихая, всплывает уже во время прогона.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useEditorStore } from '../store/useEditorStore';
import { readCanvas, listAvailableComponents, readSketch } from '../lib/itArduinoAgent/readTools';

// Выводы читаются из смонтированного DOM-элемента; в тестах его нет.
vi.mock('../utils/pinPositionCalculator', () => ({
  calculatePinPosition: () => null,
  getAllPinPositions: (componentId: string) =>
    componentId === 'led-1'
      ? [
          { name: 'A', x: 0, y: 0, signals: [] },
          { name: 'C', x: 4, y: 0, signals: [] },
        ]
      : [],
}));

// ComponentRegistry грузит каталог через fetch('/components-metadata.json')
// при импорте модуля (services/ComponentRegistry.ts) — относительный URL,
// который в node-окружении vitest не резолвится (та же особенность описана
// в __tests__/siteProjectsOpen.test.ts). Без подмены getAllComponents()
// в тесте всегда пуст, и это никак не связано с работой listAvailableComponents.
vi.mock('../services/ComponentRegistry', () => ({
  ComponentRegistry: {
    getInstance: () => ({
      getAllComponents: () => [{ id: 'led', name: 'LED', category: 'output' }],
    }),
  },
}));

const led = (id: string) => ({ id, metadataId: 'led', x: 10, y: 20, properties: { color: 'red' } });

beforeEach(() => {
  const s = useSimulatorStore.getState();
  s.setComponents([]);
  s.setWires([]);
});

describe('read_canvas', () => {
  it('отдаёт детали с координатами и свойствами', () => {
    useSimulatorStore.getState().setComponents([led('led-1')]);

    const result = readCanvas();

    expect(result.ok).toBe(true);
    const data = (result as { ok: true; data: any }).data;
    expect(data.components).toEqual([
      expect.objectContaining({ id: 'led-1', type: 'led', x: 10, y: 20 }),
    ]);
  });

  it('отдаёт имена выводов каждой детали', () => {
    useSimulatorStore.getState().setComponents([led('led-1')]);

    const data = (readCanvas() as { ok: true; data: any }).data;

    // Без этого модель выдумывает названия ножек.
    expect(data.components[0].pins).toEqual(['A', 'C']);
  });

  it('пустой холст — это не ошибка', () => {
    const result = readCanvas();

    expect(result.ok).toBe(true);
    expect((result as { ok: true; data: any }).data.components).toEqual([]);
  });
});

describe('list_available_components', () => {
  it('перечисляет типы каталога', () => {
    const result = listAvailableComponents();

    expect(result.ok).toBe(true);
    const types = (result as { ok: true; data: any }).data.components.map((c: any) => c.type);
    expect(types).toContain('led');
  });
});

describe('read_sketch', () => {
  it('отдаёт файлы рабочей области', () => {
    const files = useEditorStore.getState().files;

    const result = readSketch();

    expect(result.ok).toBe(true);
    const names = (result as { ok: true; data: any }).data.files.map((f: any) => f.name);
    expect(names).toEqual(files.map((f) => f.name));
  });
});
