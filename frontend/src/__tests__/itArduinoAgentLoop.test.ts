/**
 * Цикл агента (lib/itArduinoAgent/agentLoop).
 *
 * Проверяется на подменённом ответе сервера — без сети и без модели:
 * порядок вызовов, возврат результатов в диалог, предел шагов и остановка.
 *
 * Сетевой вызов подменяется на уровне lib/itArduinoApi (см. доработку 1), а
 * не на уровне globalThis.fetch: agentLoop.ts больше не делает fetch сам,
 * весь сетевой код форка живёт в itArduinoApi.ts — там же и cookie сессии, и
 * разбор detail, и сброс входа на 401.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runTool = vi.fn();
vi.mock('../lib/itArduinoAgent/toolRegistry', () => ({
  runTool: (...args: unknown[]) => runTool(...args),
  TOOLS: {},
}));

/**
 * agentChat и ItArduinoApiError нужны внутри фабрики vi.mock ниже, а вызовы
 * vi.mock поднимаются над остальным кодом файла целиком — обычная константа
 * в этой точке ещё не инициализирована (временная мёртвая зона). vi.hoisted
 * поднимает вместе с mock и саму инициализацию.
 */
const { agentChat, ItArduinoApiError } = vi.hoisted(() => {
  /** Та же ошибка, что бросает request() в itArduinoApi.ts, — с кодом и текстом сервера. */
  class ItArduinoApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ItArduinoApiError';
      this.status = status;
    }
  }
  return { agentChat: vi.fn(), ItArduinoApiError };
});

vi.mock('../lib/itArduinoApi', () => ({
  agentChat,
  ItArduinoApiError,
}));

import { runAgent, MAX_COMPONENTS, MAX_STEPS } from '../lib/itArduinoAgent/agentLoop';

/** Ответы сервера по очереди; последний повторяется. */
function stubAgentChat(replies: unknown[]) {
  let step = 0;
  agentChat.mockImplementation(async () => {
    const body = replies[Math.min(step, replies.length - 1)];
    step += 1;
    return body;
  });
}

beforeEach(() => {
  runTool.mockReset();
  runTool.mockResolvedValue({ ok: true, data: {} });
  agentChat.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('цикл', () => {
  it('исполняет запрошенный инструмент и возвращает результат в диалог', async () => {
    stubAgentChat([
      {
        text: 'ставлю светодиод',
        tool_calls: [{ id: '1', name: 'add_component', arguments: { type: 'led', x: 0, y: 0 } }],
        done: false,
        usage: {},
      },
      { text: 'готово', tool_calls: [], done: true, usage: {} },
    ]);
    const events: string[] = [];

    await runAgent('собери светодиод', (event) => events.push(event.kind));

    expect(runTool).toHaveBeenCalledWith('add_component', { type: 'led', x: 0, y: 0 });
    expect(events).toContain('done');

    // Во втором запросе к серверу должен уйти результат инструмента.
    const secondCallMessages = agentChat.mock.calls[1][0] as Array<{ role: string }>;
    expect(secondCallMessages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('останавливается на пределе шагов', async () => {
    stubAgentChat([
      {
        text: '',
        tool_calls: [{ id: '1', name: 'read_canvas', arguments: {} }],
        done: false,
        usage: {},
      },
    ]);
    const events: any[] = [];

    await runAgent('крутись', (event) => events.push(event));

    expect(runTool).toHaveBeenCalledTimes(MAX_STEPS);
    expect(events.at(-1).kind).toBe('error');
  });

  it('прерывается по сигналу остановки', async () => {
    stubAgentChat([
      {
        text: '',
        tool_calls: [{ id: '1', name: 'read_canvas', arguments: {} }],
        done: false,
        usage: {},
      },
    ]);
    const controller = new AbortController();
    runTool.mockImplementation(async () => {
      controller.abort();
      return { ok: true, data: {} };
    });

    await runAgent('собери', () => {}, controller.signal);

    expect(runTool).toHaveBeenCalledTimes(1);
  });

  it('останавливается, когда агент просит больше сорока деталей', async () => {
    // По одной детали за шаг предел шагов (30) сработал бы раньше предела
    // деталей (40) — тест не отличал бы «предел есть» от «предела нет».
    // Здесь модель запрашивает разом больше сорока деталей одним ответом,
    // чтобы предел деталей гарантированно сработал внутри первого же шага.
    const tooManyComponents = Array.from({ length: MAX_COMPONENTS + 5 }, (_, i) => ({
      id: String(i),
      name: 'add_component',
      arguments: { type: 'led', x: i, y: 0 },
    }));
    stubAgentChat([{ text: '', tool_calls: tooManyComponents, done: false, usage: {} }]);
    const events: any[] = [];

    await runAgent('насыпь деталей', (event) => events.push(event));

    // Один запрос к серверу, а не тридцать: до предела шагов дело не дошло.
    expect(agentChat).toHaveBeenCalledTimes(1);
    // Сорок первая деталь инструмент не вызывает — цикл останавливается
    // раньше. Останови проверку предела деталей в коде — это число вырастет.
    expect(runTool).toHaveBeenCalledTimes(MAX_COMPONENTS);
    const lastEvent = events.at(-1);
    expect(lastEvent.kind).toBe('error');
    // Текст должен называть причину — деталей, а не шагов, иначе это тот же
    // самый предел шагов, который тест уже проверяет отдельно.
    expect(lastEvent.message).toContain('деталей');
  });

  it('ошибка сервера завершает прогон понятным событием', async () => {
    // Сеть жива, сервер ответил ошибкой — это ровно то, во что itArduinoApi
    // заворачивает и отказ, и сетевой сбой: цикл не должен упасть сам.
    agentChat.mockRejectedValue(new ItArduinoApiError(502, 'Bad Gateway'));
    const events: any[] = [];

    await runAgent('собери', (event) => events.push(event));

    expect(events.at(-1)).toMatchObject({ kind: 'error' });
    // Дальше первого шага цикл не пошёл — инструмент не вызывался.
    expect(runTool).not.toHaveBeenCalled();
  });

  it('передаёт пользователю текст ошибки от сервера, а не голый код', async () => {
    // detail из FastAPI (413, «вход слишком большой») — именно то, что теряется,
    // если разбирать ответ вручную вместо request() из itArduinoApi.ts.
    agentChat.mockRejectedValue(
      new ItArduinoApiError(413, 'Диалог стал слишком большим. Начните новый прогон.'),
    );
    const events: any[] = [];

    await runAgent('собери', (event) => events.push(event));

    expect(events.at(-1)).toMatchObject({
      kind: 'error',
      message: 'Диалог стал слишком большим. Начните новый прогон.',
    });
  });
});
