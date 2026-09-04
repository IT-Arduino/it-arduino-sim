/**
 * Инструменты чтения: чем агент видит холст, каталог и код.
 *
 * Формат — JSON, а не проза: его проверяет тест, и модель не тратит ход на
 * разбор свободного текста.
 */
import { useEditorStore } from '../../store/useEditorStore';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { ComponentRegistry } from '../../services/ComponentRegistry';
import { getAllPinPositions } from '../../utils/pinPositionCalculator';
import { ok, type ToolResult } from './toolTypes';

export function readCanvas(): ToolResult {
  const state = useSimulatorStore.getState();

  const components = state.components.map((component) => ({
    id: component.id,
    type: component.metadataId,
    x: component.x,
    y: component.y,
    properties: component.properties,
    // Имена выводов — самое важное поле ответа: по ним агент соединяет.
    pins: getAllPinPositions(component.id, component.x, component.y).map((pin) => pin.name),
  }));

  const wires = state.wires.map((wire) => ({
    id: wire.id,
    from: { component: wire.start.componentId, pin: wire.start.pinName },
    to: { component: wire.end.componentId, pin: wire.end.pinName },
  }));

  return ok({
    activeBoardId: state.activeBoardId,
    boards: state.boards.map((board) => ({ id: board.id, kind: board.boardKind })),
    components,
    wires,
  });
}

export function listAvailableComponents(): ToolResult {
  const components = ComponentRegistry.getInstance()
    .getAllComponents()
    .map((meta) => ({ type: meta.id, name: meta.name, category: meta.category }));
  return ok({ components });
}

export function readSketch(): ToolResult {
  const files = useEditorStore.getState().files.map((file) => ({
    name: file.name,
    content: file.content,
  }));
  return ok({ files });
}
