/**
 * Инструменты изменения холста (lib/itArduinoAgent/canvasTools).
 *
 * Здесь портятся чужие схемы, поэтому проверяется не только «получилось», но
 * и отмена: каждое действие агента обязано лечь в штатную историю и
 * отменяться как ручное.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSimulatorStore } from '../store/useSimulatorStore';
import {
  addComponent,
  addWire,
  moveComponent,
  removeComponent,
  setComponentProperty,
} from '../lib/itArduinoAgent/canvasTools';

vi.mock('../utils/pinPositionCalculator', () => ({
  calculatePinPosition: () => null,
  getAllPinPositions: (componentId: string, x: number, y: number) => [
    { name: 'A', x, y, signals: [] },
    { name: 'C', x: x + 4, y, signals: [] },
  ],
}));

// ComponentRegistry грузит каталог через fetch('/components-metadata.json')
// при импорте модуля — относительный URL, недостижимый в node-окружении
// vitest (та же особенность, что и в itArduinoAgentReadTools.test.ts и
// siteProjectsOpen.test.ts). Без подмены getById/search каталог всегда
// пуст, и add_component не находит даже «led» — это ограничение тестовой
// среды, а не поведение инструмента.
vi.mock('../services/ComponentRegistry', () => ({
  ComponentRegistry: {
    getInstance: () => ({
      getById: (id: string) =>
        id === 'led' ? { id: 'led', name: 'LED', category: 'output', defaultValues: {} } : undefined,
      search: () => [],
    }),
  },
}));

beforeEach(() => {
  const s = useSimulatorStore.getState();
  s.setComponents([]);
  s.setWires([]);
});

describe('add_component', () => {
  it('ставит деталь и возвращает её id', async () => {
    const result = await addComponent({ type: 'led', x: 10, y: 20 });

    expect(result.ok).toBe(true);
    const id = (result as { ok: true; data: any }).data.id;
    const stored = useSimulatorStore.getState().components;
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(id);
    expect(stored[0].metadataId).toBe('led');
  });

  it('отменяется штатной историей', async () => {
    await addComponent({ type: 'led', x: 10, y: 20 });

    useSimulatorStore.getState().undo();

    expect(useSimulatorStore.getState().components).toHaveLength(0);
  });

  it('неизвестный тип — ошибка с подсказкой, а не исключение', async () => {
    const result = await addComponent({ type: 'светодиодик', x: 0, y: 0 });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain('светодиодик');
  });
});

describe('add_wire', () => {
  it('соединяет два вывода и помечает провод как уложенный системой', async () => {
    const first = await addComponent({ type: 'led', x: 0, y: 0 });
    const second = await addComponent({ type: 'led', x: 60, y: 0 });
    const fromId = (first as { ok: true; data: any }).data.id;
    const toId = (second as { ok: true; data: any }).data.id;

    const result = addWire({
      from_component: fromId,
      from_pin: 'A',
      to_component: toId,
      to_pin: 'C',
    });

    expect(result.ok).toBe(true);
    const wires = useSimulatorStore.getState().wires;
    expect(wires).toHaveLength(1);
    expect(wires[0].start.pinName).toBe('A');
    expect(wires[0].autoRouted).toBe(true);
  });

  it('несуществующий вывод — ошибка со списком выводов детали', async () => {
    const added = await addComponent({ type: 'led', x: 0, y: 0 });
    const id = (added as { ok: true; data: any }).data.id;

    const result = addWire({
      from_component: id,
      from_pin: 'плюс',
      to_component: id,
      to_pin: 'C',
    });

    expect(result.ok).toBe(false);
    const error = (result as { ok: false; error: string }).error;
    expect(error).toContain('A');
    expect(error).toContain('C');
  });
});

describe('остальные изменения', () => {
  it('move_component двигает деталь и отменяется', async () => {
    const added = await addComponent({ type: 'led', x: 0, y: 0 });
    const id = (added as { ok: true; data: any }).data.id;

    moveComponent({ id, x: 100, y: 50 });
    expect(useSimulatorStore.getState().components[0].x).toBe(100);

    useSimulatorStore.getState().undo();
    expect(useSimulatorStore.getState().components[0].x).toBe(0);
  });

  it('set_component_property меняет свойство', async () => {
    const added = await addComponent({ type: 'led', x: 0, y: 0 });
    const id = (added as { ok: true; data: any }).data.id;

    const result = setComponentProperty({ id, name: 'color', value: 'green' });

    expect(result.ok).toBe(true);
    expect(useSimulatorStore.getState().components[0].properties.color).toBe('green');
  });

  it('remove_component убирает деталь', async () => {
    const added = await addComponent({ type: 'led', x: 0, y: 0 });
    const id = (added as { ok: true; data: any }).data.id;

    removeComponent({ id });

    expect(useSimulatorStore.getState().components).toHaveLength(0);
  });

  it('действие над несуществующей деталью — ошибка, а не падение', () => {
    const result = moveComponent({ id: 'нет-такой', x: 1, y: 1 });

    expect(result.ok).toBe(false);
  });
});
