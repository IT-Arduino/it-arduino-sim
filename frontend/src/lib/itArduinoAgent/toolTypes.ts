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
