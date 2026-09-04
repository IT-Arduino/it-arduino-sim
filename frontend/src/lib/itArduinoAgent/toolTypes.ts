/**
 * Общий вид результата инструмента.
 *
 * Инструменты не бросают исключений: для агента ошибка — обычный ход
 * разговора, и модель должна получить текст, по которому можно попробовать
 * иначе. Брошенное исключение оборвало бы прогон целиком.
 */
export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

export const ok = (data: unknown): ToolResult => ({ ok: true, data });
export const fail = (error: string): ToolResult => ({ ok: false, error });

/**
 * Инструменты, которые пишут в историю отмены холста (`record*`-методы стора):
 * add_component, move_component, set_component_property, remove_component,
 * add_wire, remove_wire. Чтение холста и каталога, запись скетча, сборка,
 * запуск и остановка историю не трогают.
 *
 * Список живёт в этом модуле, а не в цикле агента и не в панели, потому что
 * нужен обоим и означать должен одно и то же: цикл считает по нему предел
 * изменений за прогон, панель — сколько отменять при откате. Разъехавшись,
 * они дали бы прогон, который откатывается не целиком. Зависимостей у модуля
 * нет, поэтому его импорт безопасен и в панели, и в тестах.
 */
export const CANVAS_MUTATING_TOOLS: ReadonlySet<string> = new Set([
  'add_component',
  'move_component',
  'set_component_property',
  'remove_component',
  'add_wire',
  'remove_wire',
]);
