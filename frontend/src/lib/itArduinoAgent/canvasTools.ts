/**
 * Инструменты изменения холста.
 *
 * Два правила, которые нельзя нарушать.
 *
 * Первое: всё пишется в штатную историю (`record*`-методы стора), иначе
 * действия агента не отменяются кнопкой отмены — а он работает поверх чужой
 * схемы. Часть `record*`-методов (recordMove, recordSetProperty) сама
 * значение не применяет — они лишь запоминают направление отмены, а
 * применяет сырой мутатор стора. Это не наша придумка: тем же путём идёт
 * панель свойств и перетаскивание мышью в SimulatorCanvas.tsx
 * (`updateComponent(...)`, потом `recordMove`/`recordSetProperty`) —
 * инструменты агента повторяют этот порядок, а не свой.
 *
 * Второе: выводы детали читаются из смонтированного DOM-элемента, поэтому
 * add_component ждёт готовности детали опросом. Без ожидания провод к только
 * что добавленной детали не находит её выводов.
 */
import { ComponentRegistry } from '../../services/ComponentRegistry';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { getAllPinPositions } from '../../utils/pinPositionCalculator';
import {
  collectComponentObstacles,
  collectWireSegments,
  routeAroundObstacles,
} from '../../utils/wireAutoRoute';
// crypto.randomUUID() бросает в небезопасном контексте (self-hosted по
// голому HTTP, не localhost) — see utils/uuid.ts. Это тот же генератор,
// которым уже пользуются useEditorStore и симуляторы плат; свой велосипед
// здесь был бы обходом уже решённого бага.
import { generateUUID } from '../../utils/uuid';
import { fail, ok, type ToolResult } from './toolTypes';

/** Дождаться отрисовки: до неё у детали нет DOM-элемента, а значит и выводов. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Сколько ждать выводов новой детали и как часто спрашивать.
 *
 * Числа не выдуманы: ровно так ждёт готовности детали сам апстрим
 * (`components/DynamicComponent.tsx` — опрос каждые 100 мс, потолок 10 с) и
 * там же объясняет, почему одного кадра отрисовки мало: деталь оживает не при
 * монтировании, а когда подгрузится определяющий её кусок кода, и на медленной
 * сети это занимает секунды. Мы читаем выводы тем же способом (pinInfo из DOM
 * через getAllPinPositions), значит и ждать обязаны столько же.
 */
const PIN_WAIT_MS = 10_000;
const PIN_POLL_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Выводы детали, когда они появятся. Пустой перечень по истечении срока —
 * не исключение: агент получит его в ответе и увидит, что цеплять нечего,
 * вместо того чтобы застрять на ожидании.
 */
async function waitForPins(componentId: string): Promise<string[]> {
  await nextFrame();
  let pins = pinsOf(componentId);
  const deadline = Date.now() + PIN_WAIT_MS;
  while (!pins.length && Date.now() < deadline) {
    await delay(PIN_POLL_MS);
    pins = pinsOf(componentId);
  }
  return pins;
}

function findComponent(id: string) {
  return useSimulatorStore.getState().components.find((component) => component.id === id);
}

function pinsOf(componentId: string): string[] {
  const component = findComponent(componentId);
  if (!component) return [];
  return getAllPinPositions(component.id, component.x, component.y).map((pin) => pin.name);
}

export async function addComponent(args: {
  type: string;
  x: number;
  y: number;
  properties?: Record<string, unknown>;
}): Promise<ToolResult> {
  const registry = ComponentRegistry.getInstance();
  const meta = registry.getById(args.type);
  if (!meta) {
    // Три ближайших по названию: обычно модель промахнулась в написании.
    const guesses = registry
      .search(args.type)
      .slice(0, 3)
      .map((candidate) => candidate.id);
    return fail(
      `Детали «${args.type}» нет в каталоге.` +
        (guesses.length ? ` Возможно, имелось в виду: ${guesses.join(', ')}.` : ''),
    );
  }

  const id = `${meta.id}-${generateUUID()}`;
  // recordAddComponent — канонический мутатор (в отличие от recordMove и
  // recordSetProperty он и применяет добавление, и пишет отмену за один
  // вызов), поэтому здесь никакого дополнительного updateComponent не нужно.
  useSimulatorStore.getState().recordAddComponent({
    id,
    metadataId: meta.id,
    x: args.x,
    y: args.y,
    properties: { ...meta.defaultValues, ...(args.properties ?? {}) },
  });

  return ok({ id, pins: await waitForPins(id) });
}

export function moveComponent(args: { id: string; x: number; y: number }): ToolResult {
  const component = findComponent(args.id);
  if (!component) return fail(`Детали с id «${args.id}» на холсте нет.`);

  const from = { x: component.x, y: component.y };
  const to = { x: args.x, y: args.y };
  const store = useSimulatorStore.getState();
  // recordMove не двигает деталь: он рассчитан на то, что перемещение уже
  // произошло (в редакторе — за время перетаскивания), а сам только
  // запоминает from/to для отмены/повтора. Двигаем сырым updateComponent
  // первым — тем же способом, которым завершение drag в SimulatorCanvas.tsx
  // готовит recordMove.
  store.updateComponent(args.id, { x: to.x, y: to.y });
  store.recordMove(args.id, from, to);
  return ok({ id: args.id, x: args.x, y: args.y });
}

export function setComponentProperty(args: {
  id: string;
  name: string;
  value: unknown;
}): ToolResult {
  const component = findComponent(args.id);
  if (!component) return fail(`Детали с id «${args.id}» на холсте нет.`);

  const prevValue = component.properties[args.name];
  const store = useSimulatorStore.getState();
  // Тот же порядок, что у панели свойств (SimulatorCanvas.tsx,
  // onPropertyChange): сырая мутация updateComponent, затем recordSetProperty
  // — готовый в сторе инструмент записи отмены для одного свойства, вместо
  // самодельной пары execute/undo.
  store.updateComponent(args.id, {
    properties: { ...component.properties, [args.name]: args.value },
  });
  store.recordSetProperty(args.id, args.name, prevValue, args.value);
  return ok({ id: args.id, name: args.name, value: args.value });
}

export function removeComponent(args: { id: string }): ToolResult {
  if (!findComponent(args.id)) return fail(`Детали с id «${args.id}» на холсте нет.`);
  useSimulatorStore.getState().recordRemoveComponent(args.id);
  return ok({ id: args.id });
}

export function addWire(args: {
  from_component: string;
  from_pin: string;
  to_component: string;
  to_pin: string;
}): ToolResult {
  const from = findComponent(args.from_component);
  const to = findComponent(args.to_component);
  if (!from) return fail(`Детали с id «${args.from_component}» на холсте нет.`);
  if (!to) return fail(`Детали с id «${args.to_component}» на холсте нет.`);

  const fromPins = getAllPinPositions(from.id, from.x, from.y);
  const toPins = getAllPinPositions(to.id, to.x, to.y);
  const start = fromPins.find((pin) => pin.name === args.from_pin);
  const end = toPins.find((pin) => pin.name === args.to_pin);
  if (!start) {
    return fail(
      `У детали «${from.id}» нет вывода «${args.from_pin}». ` +
        `Есть: ${fromPins.map((pin) => pin.name).join(', ')}.`,
    );
  }
  if (!end) {
    return fail(
      `У детали «${to.id}» нет вывода «${args.to_pin}». ` +
        `Есть: ${toPins.map((pin) => pin.name).join(', ')}.`,
    );
  }

  const state = useSimulatorStore.getState();
  // Сигнатура сверена по фактическим вызовам в useSimulatorStore.ts
  // (finishWireCreation, updateWireInProgress): collectComponentObstacles
  // принимает ВЕСЬ список деталей холста и id-шники концов провода к
  // исключению, а не заранее отфильтрованный список без второго аргумента —
  // черновик задания звал её иначе. collectWireSegments добавлен по тому же
  // образцу: без него автопрокладка не видит уже существующие провода как
  // препятствие и может лечь поверх них.
  const waypoints =
    routeAroundObstacles(
      { x: start.x, y: start.y },
      { x: end.x, y: end.y },
      collectComponentObstacles(state.components, [from.id, to.id]),
      collectWireSegments(state.wires),
    ) ?? [];

  const id = `wire-${generateUUID()}`;
  useSimulatorStore.getState().recordAddWire({
    id,
    start: { componentId: from.id, pinName: start.name, x: start.x, y: start.y },
    end: { componentId: to.id, pinName: end.name, x: end.x, y: end.y },
    waypoints,
    color: '#22c55e',
    // Провод уложен системой: при перемещении деталей его можно
    // переукладывать, в отличие от нарисованного руками.
    autoRouted: true,
  });
  return ok({ id });
}

export function removeWire(args: { id: string }): ToolResult {
  const wire = useSimulatorStore.getState().wires.find((candidate) => candidate.id === args.id);
  if (!wire) return fail(`Провода с id «${args.id}» на холсте нет.`);
  // recordRemoveWire (не сырой removeWire) — единственный из пары, что
  // пишет отмену: сырой мутатор существует для превью-кадров перетаскивания
  // и историю намеренно не трогает (см. комментарий у SimulatorState в
  // useSimulatorStore.ts).
  useSimulatorStore.getState().recordRemoveWire(args.id);
  return ok({ id: args.id });
}
