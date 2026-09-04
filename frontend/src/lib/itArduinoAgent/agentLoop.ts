/**
 * Цикл агента: диалог с моделью через прокси сайта.
 *
 * Шаг цикла: отправить историю → получить ответ → исполнить запрошенные
 * инструменты → положить их результаты в историю. И так пока модель не
 * скажет «готово» либо пока не кончатся шаги.
 *
 * Ключ провайдера в браузер не попадает: его держит сервер
 * (arduino_api/app/api/endpoints/agent.py).
 *
 * Сам HTTP-вызов не делаем: он живёт в itArduinoApi.ts (agentChat) — там же
 * cookie сессии, разбор detail из ответа FastAPI и сброс входа на 401.
 * Держать здесь свой fetch значило бы завести второй способ ходить на сайт
 * рядом с уже существующим, а он в форке один.
 */
import {
  agentChat,
  ItArduinoApiError,
  type AgentChatMessage,
  type AgentChatReply,
} from '../itArduinoApi';
import { runTool } from './toolRegistry';

/** Предел шагов. Тот же, что на сервере: зациклившийся агент иначе молчит. */
export const MAX_STEPS = 30;

/**
 * Сколько деталей агент вправе добавить за один прогон.
 *
 * Предел шагов от этого не спасает: за тридцать шагов модель успевает
 * высыпать на холст сотню деталей одним ответом, и разбирать это придётся
 * человеку.
 */
export const MAX_COMPONENTS = 40;

export type AgentEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; ok: boolean }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export async function runAgent(
  userText: string,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const messages: AgentChatMessage[] = [{ role: 'user', content: userText }];
  let added = 0;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (signal?.aborted) return;

    let reply: AgentChatReply;
    try {
      reply = await agentChat(messages);
    } catch (error) {
      // agentChat() заворачивает и отказ сервера (с текстом из detail — лимит
      // входа, частота запросов, рубильник), и сетевой сбой, и «не вошли» в
      // один ItArduinoApiError. Голый код ответа человеку ничего не скажет —
      // отдаём его собственный текст.
      const message =
        error instanceof ItArduinoApiError
          ? error.message
          : `Не удалось связаться с сайтом: ${(error as Error).message}`;
      onEvent({ kind: 'error', message });
      return;
    }

    if (reply.text) onEvent({ kind: 'text', text: reply.text });

    const calls = Array.isArray(reply.tool_calls) ? reply.tool_calls : [];

    // Ход модели кладётся в историю ВСЕГДА и целиком — вместе с вызовами
    // инструментов. Ответ одними вызовами, без текста, — обычное дело: раньше
    // такой ход не попадал в историю вовсе, и следующий запрос выглядел как
    // «пользователь → результат инструмента → результат инструмента».
    // Связать результат с запросом было нечем: `tool_call_id` у результата
    // ссылается на вызов, которого в переписке нет, а модель видит ответы на
    // вопросы, которых не задавала, — и переспрашивает то же самое.
    messages.push({
      role: 'assistant',
      content: reply.text ?? '',
      // Поле уходит только когда есть что положить: пустой список ничего не
      // сообщает, а история и так растёт с каждым шагом.
      ...(calls.length ? { tool_calls: calls } : {}),
    });
    if (!calls.length) {
      onEvent({ kind: 'done' });
      return;
    }

    for (const call of calls) {
      if (signal?.aborted) return;

      if (call.name === 'add_component') {
        added += 1;
        if (added > MAX_COMPONENTS) {
          onEvent({
            kind: 'error',
            message: `Агент попытался поставить больше ${MAX_COMPONENTS} деталей и остановлен.`,
          });
          return;
        }
      }

      const result = await runTool(call.name, call.arguments);
      onEvent({ kind: 'tool', name: call.name, ok: result.ok });
      messages.push({
        role: 'tool',
        name: call.name,
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    if (reply.done) {
      onEvent({ kind: 'done' });
      return;
    }
  }

  onEvent({
    kind: 'error',
    message: `Агент не уложился в ${MAX_STEPS} шагов и остановлен. Сделанное осталось на холсте.`,
  });
}
