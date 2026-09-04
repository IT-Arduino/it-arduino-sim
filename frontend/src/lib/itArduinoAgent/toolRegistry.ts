/**
 * Что умеет агент — в одном месте.
 *
 * Перечень должен совпадать с серверной схемой
 * (arduino_api/app/services/agent/tools_schema.py): сервер объявляет
 * инструменты модели, браузер их исполняет. На совпадение есть тесты с обеих
 * сторон.
 *
 * run/stop сверены с фактическими именами в useSimulatorStore.ts:
 * startSimulation()/stopSimulation() — оба без аргументов, сами берут
 * activeBoardId из состояния (см. store, ~строка 3020 и 3035).
 */
import { useSimulatorStore } from '../../store/useSimulatorStore';
import {
  addComponent,
  addWire,
  moveComponent,
  removeComponent,
  removeWire,
  setComponentProperty,
} from './canvasTools';
import { compileSketch, writeSketch } from './codeTools';
import { listAvailableComponents, readCanvas, readSketch } from './readTools';
import { fail, ok, type ToolResult } from './toolTypes';

type ToolFn = (args: any) => ToolResult | Promise<ToolResult>;

export const TOOLS: Record<string, ToolFn> = {
  read_canvas: () => readCanvas(),
  list_available_components: () => listAvailableComponents(),
  read_sketch: () => readSketch(),
  add_component: (args) => addComponent(args),
  move_component: (args) => moveComponent(args),
  set_component_property: (args) => setComponentProperty(args),
  remove_component: (args) => removeComponent(args),
  add_wire: (args) => addWire(args),
  remove_wire: (args) => removeWire(args),
  write_sketch: (args) => writeSketch(args),
  compile: () => compileSketch(),
  run: () => {
    useSimulatorStore.getState().startSimulation();
    return ok({ running: true });
  },
  stop: () => {
    useSimulatorStore.getState().stopSimulation();
    return ok({ running: false });
  },
};

/**
 * Вызвать инструмент по имени с разбором аргументов.
 *
 * Единая точка входа для цикла агента (задача 10): и синхронные
 * инструменты (moveComponent и другие), и асинхронные (addComponent,
 * compileSketch) дожидаются здесь одинаково через await — вызывающему коду
 * не нужно знать, какие из них асинхронные.
 */
export async function runTool(name: string, args: unknown): Promise<ToolResult> {
  const tool = TOOLS[name];
  if (!tool) {
    return fail(`Инструмента «${name}» нет. Доступны: ${Object.keys(TOOLS).join(', ')}.`);
  }
  try {
    return await tool(args ?? {});
  } catch (error) {
    // Исключение внутри инструмента не должно обрывать прогон: модель
    // получает текст ошибки и пробует иначе.
    return fail(`Инструмент «${name}» не выполнился: ${(error as Error).message}`);
  }
}
