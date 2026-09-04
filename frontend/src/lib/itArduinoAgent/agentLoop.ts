/**
 * Цикл агента: диалог с моделью через прокси сайта.
 *
 * Шаг цикла: отправить историю → получить ответ → исполнить запрошенные
 * инструменты → положить их результаты в историю. И так пока модель не
 * скажет «готово» либо пока не кончатся шаги.
 *
 * Ключ провайдера в браузер не попадает: его держит сервер
 * (arduino_api/app/api/endpoints/agent.py).
 */
import { getSiteApiBase } from '../itArduinoAuth';
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

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export async function runAgent(
  userText: string,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const messages: ChatMessage[] = [{ role: 'user', content: userText }];
  let added = 0;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (signal?.aborted) return;

    let reply: any;
    try {
      const response = await fetch(`${getSiteApiBase()}/agent/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      if (!response.ok) {
        onEvent({ kind: 'error', message: `Сервер ответил ${response.status}` });
        return;
      }
      reply = await response.json();
    } catch (error) {
      onEvent({
        kind: 'error',
        message: `Не удалось связаться с сайтом: ${(error as Error).message}`,
      });
      return;
    }

    if (reply.text) {
      onEvent({ kind: 'text', text: reply.text });
      messages.push({ role: 'assistant', content: reply.text });
    }

    const calls = Array.isArray(reply.tool_calls) ? reply.tool_calls : [];
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
