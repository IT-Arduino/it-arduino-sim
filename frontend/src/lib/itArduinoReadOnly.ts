/**
 * Режим «только просмотр».
 *
 * Включается, когда открыта чужая опубликованная схема: ученик её запускает,
 * крутит потенциометр, жмёт кнопки, читает и правит код — но саму схему не
 * меняет. Владельцу его работа возвращается такой, какой он её оставил.
 *
 * Как это сделано. Апстримовский холст (`components/simulator/SimulatorCanvas.tsx`,
 * почти четыре тысячи строк) правится дорого, и всякая правка там — конфликт
 * при каждом слиянии. Поэтому запрет ставится не в интерфейсе, а в сторе:
 * действия, меняющие схему, подменяются заглушками, оригиналы сохраняются и
 * возвращаются на выходе. Zustand держит действия обычными полями состояния,
 * так что подмена делается штатным setState, без единой правки чужого файла.
 *
 * Побочный эффект честный, но его надо знать: перетащенная деталь просто не
 * сдвинется — интерфейс не выключен, он не даёт результата. Поэтому сверху
 * висит полоса ReadOnlyBanner, объясняющая, почему.
 *
 * Что НЕ запрещено и почему:
 *
 *   - запуск, остановка, сброс, компиляция, монитор порта, осциллограф —
 *     ради них режим и существует;
 *   - `updateComponentState` и `handleComponentEvent` — это нажатие кнопки и
 *     срабатывание датчика во время симуляции, а не правка схемы;
 *   - `updateComponent` с одним лишь полем `properties` — поворот ручки
 *     потенциометра идёт именно через него. Апстрим намеренно свёл в этот
 *     путь и диалог свойств, и живые органы управления
 *     (`SimulatorCanvas.tsx:564`), различить их здесь нечем. Выбор в пользу
 *     живых органов: без них смотреть на схему бессмысленно, а изменённое
 *     сопротивление всё равно никуда не сохранится;
 *   - правка кода (`useEditorStore`) — по условию задачи. Скетч можно менять
 *     и перезапускать у себя, записать поверх чужой схемы нельзя;
 *   - `updateBoard` — через него приходят результаты компиляции (hasWifi,
 *     libraries, compiledProgram). Запрет сломал бы компиляцию, а сдвинуть
 *     или удалить им ничего нельзя.
 *
 * `loadProjectState` не запрещается, а снимает режим: загрузка целого
 * проекта (файл .vlx, пример, новая рабочая область) означает, что чужую
 * схему больше не смотрят.
 */

import { useSimulatorStore } from '../store/useSimulatorStore';

export interface ReadOnlyState {
  readOnly: boolean;
  /** Номер просматриваемой схемы, если режим включён из-за неё. */
  circuitId: number | null;
  title: string | null;
  /** Счётчик отклонённых правок — полоса показывает подсказку при росте. */
  blocked: number;
}

const IDLE: ReadOnlyState = { readOnly: false, circuitId: null, title: null, blocked: 0 };

let _state: ReadOnlyState = IDLE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeReadOnly(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Снимок для useSyncExternalStore: ссылка меняется только при изменении. */
export function getReadOnlyState(): ReadOnlyState {
  return _state;
}

export function isReadOnly(): boolean {
  return _state.readOnly;
}

/**
 * Действия стора симулятора, меняющие саму схему.
 *
 * Список сверяется с содержимым стора: если апстрим переименует действие,
 * заглушка не встанет, а приложение продолжит работать — с записью в
 * консоль, чтобы расхождение было видно при отладке.
 */
const BLOCKED_ACTIONS = [
  // Платы
  'addBoard',
  'removeBoard',
  'setBoardPosition',
  'setBoardLanguageMode',
  'setBoardType',
  // Детали
  'addComponent',
  'removeComponent',
  'setComponents',
  'reseatComponentOnBreadboard',
  // Провода
  'addWire',
  'removeWire',
  'updateWire',
  'setWires',
  'startWireCreation',
  'finishWireCreation',
  'addWireWaypoint',
  // Порядок отрисовки и история правок холста
  'raiseItem',
  'pushCommand',
  'undo',
  'redo',
] as const;

/** Поля патча `updateComponent`, разрешённые в режиме просмотра. */
const ALLOWED_COMPONENT_PATCH_KEYS = new Set(['properties']);

type AnyFn = (...args: never[]) => unknown;

/** Оригиналы подменённых действий. null — заглушки не стоят. */
let _originals: Record<string, AnyFn> | null = null;

function noteBlocked(action: string): void {
  _state = { ..._state, blocked: _state.blocked + 1 };
  emit();
  console.info(`[it-arduino] режим просмотра: действие «${action}» отклонено`);
}

function installGuards(): void {
  if (_originals) return;

  const store = useSimulatorStore as unknown as {
    getState: () => Record<string, unknown>;
    setState: (patch: Record<string, unknown>) => void;
  };
  const state = store.getState();

  const originals: Record<string, AnyFn> = {};
  const patch: Record<string, unknown> = {};

  for (const key of BLOCKED_ACTIONS) {
    const fn = state[key];
    if (typeof fn !== 'function') {
      console.warn(`[it-arduino] режим просмотра: действия «${key}» в сторе нет`);
      continue;
    }
    originals[key] = fn as AnyFn;
    patch[key] = () => {
      noteBlocked(key);
    };
  }

  // updateComponent — единственное действие с разбором аргументов: правка
  // свойств проходит (живые органы управления), всё остальное задерживается
  // (перемещение, поворот, пересадка на макетную плату).
  const updateComponent = state.updateComponent;
  if (typeof updateComponent === 'function') {
    originals.updateComponent = updateComponent as AnyFn;
    patch.updateComponent = (id: string, updates: Record<string, unknown>) => {
      const keys = Object.keys(updates ?? {});
      const onlyProperties =
        keys.length > 0 && keys.every((k) => ALLOWED_COMPONENT_PATCH_KEYS.has(k));
      if (onlyProperties) {
        (originals.updateComponent as (a: string, b: unknown) => void)(id, updates);
        return;
      }
      noteBlocked('updateComponent');
    };
  }

  // loadProjectState не запрещаем: открыть свой файл .vlx или пример можно
  // всегда. Но это уже другая схема, поэтому режим снимаем.
  const loadProjectState = state.loadProjectState;
  if (typeof loadProjectState === 'function') {
    originals.loadProjectState = loadProjectState as AnyFn;
    patch.loadProjectState = (payload: unknown) => {
      const original = originals.loadProjectState as (a: unknown) => unknown;
      exitReadOnly();
      return original(payload);
    };
  }

  _originals = originals;
  store.setState(patch);
}

function removeGuards(): void {
  if (!_originals) return;
  const store = useSimulatorStore as unknown as {
    setState: (patch: Record<string, unknown>) => void;
  };
  store.setState({ ..._originals });
  _originals = null;
}

/** Включить просмотр чужой схемы. Вызывается ПОСЛЕ её загрузки. */
export function enterReadOnly(opts: { circuitId: number; title: string }): void {
  installGuards();
  _state = { readOnly: true, circuitId: opts.circuitId, title: opts.title, blocked: 0 };
  emit();
}

/** Снять режим и вернуть стору её собственные действия. */
export function exitReadOnly(): void {
  if (!_state.readOnly && !_originals) return;
  removeGuards();
  _state = IDLE;
  emit();
}
