/**
 * Тесты режима «только просмотр» (src/lib/itArduinoReadOnly).
 *
 * На этом модуле держится вся гарантия: чужая схема не изменится. Запрет
 * стоит не в интерфейсе, а в сторе — кнопки и холст выглядят рабочими и
 * просто не дают результата. Значит, проверять надо именно то, доходит ли
 * вызов до настоящего действия.
 *
 * Граница проходит не по «действие меняет стор», а по «действие меняет
 * СХЕМУ». Нажатие кнопки, поворот ручки потенциометра, результат компиляции
 * и запуск симуляции тоже пишут в стор, и ради них режим и существует —
 * запретить их значило бы отдать ученику неподвижную картинку.
 *
 * Самый тонкий случай — `updateComponent`. Апстрим свёл в него и диалог
 * свойств, и живые органы управления (`SimulatorCanvas.tsx:564`), поэтому
 * различать приходится по составу патча: одни `properties` проходят,
 * координаты — нет.
 *
 * Стор подменён: настоящий тянет за собой эмуляторы и WASM, а проверяется
 * здесь подмена функций, а не их содержимое.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sim = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  return {
    state,
    useSimulatorStore: {
      getState: () => state,
      setState: (patch: Record<string, unknown>) => Object.assign(state, patch),
    },
  };
});

vi.mock('../store/useSimulatorStore', () => ({ useSimulatorStore: sim.useSimulatorStore }));

import {
  enterReadOnly,
  exitReadOnly,
  getReadOnlyState,
  isReadOnly,
  subscribeReadOnly,
} from '../lib/itArduinoReadOnly';

/** Действия, которые режим обязан задержать. */
const MUST_BLOCK = [
  'addBoard',
  'removeBoard',
  'setBoardPosition',
  'setBoardLanguageMode',
  'setBoardType',
  'addComponent',
  'removeComponent',
  'setComponents',
  'reseatComponentOnBreadboard',
  'addWire',
  'removeWire',
  'updateWire',
  'setWires',
  'startWireCreation',
  'finishWireCreation',
  'addWireWaypoint',
  'raiseItem',
  'pushCommand',
  'undo',
  'redo',
];

/** Действия, которые режим обязан оставить в покое. */
const MUST_PASS = [
  'startSimulation',
  'stopSimulation',
  'resetSimulation',
  'startBoard',
  'stopBoard',
  'resetBoard',
  'restartParts',
  'compileBoardProgram',
  'setCompiledHex',
  'setRunning',
  'updateComponentState',
  'handleComponentEvent',
  'markComponentBurnt',
  'updateBoard',
  'setActiveBoardId',
  'setSelectedWire',
  'updateWirePositions',
];

/** Оригиналы, положенные в стор перед тестом. */
let originals: Record<string, ReturnType<typeof vi.fn>>;

function seedStore(): void {
  for (const key of Object.keys(sim.state)) delete sim.state[key];
  originals = {};
  for (const key of [...MUST_BLOCK, ...MUST_PASS, 'updateComponent', 'loadProjectState']) {
    originals[key] = vi.fn();
    sim.state[key] = originals[key];
  }
}

beforeEach(() => {
  exitReadOnly();
  seedStore();
});

afterEach(() => {
  exitReadOnly();
  vi.restoreAllMocks();
});

describe('до включения', () => {
  it('режим выключен и стор не тронут', () => {
    expect(isReadOnly()).toBe(false);
    for (const key of MUST_BLOCK) {
      expect(sim.state[key]).toBe(originals[key]);
    }
  });
});

describe('изменения схемы', () => {
  it('все структурные действия перестают доходить до стора', () => {
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });

    for (const key of MUST_BLOCK) {
      (sim.state[key] as () => void)();
      expect(originals[key], `действие ${key} должно быть задержано`).not.toHaveBeenCalled();
    }
  });

  it('каждая отклонённая попытка увеличивает счётчик', () => {
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });
    expect(getReadOnlyState().blocked).toBe(0);

    (sim.state.addComponent as () => void)();
    (sim.state.removeWire as () => void)();

    // Полоса внизу экрана показывает подсказку именно по росту счётчика.
    expect(getReadOnlyState().blocked).toBe(2);
  });
});

describe('симуляция и работа с платой', () => {
  it('не задеты вовсе — функции остались теми же', () => {
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });

    for (const key of MUST_PASS) {
      expect(sim.state[key], `действие ${key} трогать нельзя`).toBe(originals[key]);
    }
  });

  it('нажатие кнопки на схеме доходит до стора', () => {
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });

    (sim.state.handleComponentEvent as (a: string, b: string) => void)('btn-1', 'press');

    expect(originals.handleComponentEvent).toHaveBeenCalledWith('btn-1', 'press');
  });
});

describe('updateComponent', () => {
  it('пропускает поворот ручки — патч только со свойствами', () => {
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });

    (sim.state.updateComponent as (a: string, b: unknown) => void)('pot-1', {
      properties: { value: '512' },
    });

    expect(originals.updateComponent).toHaveBeenCalledWith('pot-1', {
      properties: { value: '512' },
    });
  });

  it('задерживает перетаскивание — патч с координатами', () => {
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });

    (sim.state.updateComponent as (a: string, b: unknown) => void)('led-1', { x: 10, y: 20 });

    expect(originals.updateComponent).not.toHaveBeenCalled();
    expect(getReadOnlyState().blocked).toBe(1);
  });

  it('задерживает смешанный патч целиком', () => {
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });

    // Пропустить такой патч значило бы вместе со свойствами применить и
    // координаты — то есть разрешить перетаскивание в обход запрета.
    (sim.state.updateComponent as (a: string, b: unknown) => void)('led-1', {
      properties: { value: '1' },
      x: 10,
    });

    expect(originals.updateComponent).not.toHaveBeenCalled();
  });

  it('задерживает пустой патч', () => {
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });

    (sim.state.updateComponent as (a: string, b: unknown) => void)('led-1', {});

    expect(originals.updateComponent).not.toHaveBeenCalled();
  });
});

describe('загрузка другого проекта', () => {
  it('снимает режим и передаёт вызов дальше', () => {
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });

    const payload = { boards: [], components: [], wires: [] };
    (sim.state.loadProjectState as (a: unknown) => void)(payload);

    // Открыли свой файл .vlx — чужую схему больше не смотрят.
    expect(isReadOnly()).toBe(false);
    expect(originals.loadProjectState).toHaveBeenCalledWith(payload);
    // И стор снова свой.
    expect(sim.state.addComponent).toBe(originals.addComponent);
  });
});

describe('выход из режима', () => {
  it('возвращает стору все её действия', () => {
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });
    expect(sim.state.addComponent).not.toBe(originals.addComponent);

    exitReadOnly();

    for (const key of [...MUST_BLOCK, 'updateComponent', 'loadProjectState']) {
      expect(sim.state[key], `действие ${key} не возвращено`).toBe(originals[key]);
    }
    expect(isReadOnly()).toBe(false);
  });

  it('повторный выход безопасен', () => {
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });
    exitReadOnly();
    expect(() => exitReadOnly()).not.toThrow();
  });

  it('повторный вход не сохраняет заглушки как оригиналы', () => {
    // Ошибка была бы необратимой: второй вход запомнил бы уже подменённые
    // функции, и выход вернул бы в стор заглушки навсегда.
    enterReadOnly({ circuitId: 7, title: 'Первая' });
    enterReadOnly({ circuitId: 8, title: 'Вторая' });

    exitReadOnly();

    expect(sim.state.addComponent).toBe(originals.addComponent);
  });
});

describe('состояние', () => {
  it('хранит номер и название просматриваемой схемы', () => {
    enterReadOnly({ circuitId: 42, title: 'Светофор' });

    expect(getReadOnlyState()).toMatchObject({
      readOnly: true,
      circuitId: 42,
      title: 'Светофор',
    });
  });

  it('сообщает подписчикам о входе, отклонении и выходе', () => {
    const seen: boolean[] = [];
    const off = subscribeReadOnly(() => seen.push(isReadOnly()));

    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });
    (sim.state.addComponent as () => void)();
    exitReadOnly();

    expect(seen).toEqual([true, true, false]);

    off();
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });
    expect(seen).toHaveLength(3);
  });

  it('снимок не меняет ссылку без причины', () => {
    // useSyncExternalStore сравнивает снимок по ссылке.
    enterReadOnly({ circuitId: 7, title: 'Чужая схема' });
    expect(getReadOnlyState()).toBe(getReadOnlyState());
  });
});

describe('устойчивость к переименованиям в апстриме', () => {
  it('пропускает отсутствующее действие, не падая', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete sim.state.raiseItem;

    expect(() => enterReadOnly({ circuitId: 7, title: 'Чужая схема' })).not.toThrow();

    // Остальные заглушки при этом встали.
    (sim.state.addComponent as () => void)();
    expect(originals.addComponent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
