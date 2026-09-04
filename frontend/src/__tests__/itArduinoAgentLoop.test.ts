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

import {
  runAgent,
  MAX_CANVAS_ACTIONS,
  MAX_COMPONENTS,
  MAX_STEPS,
} from '../lib/itArduinoAgent/agentLoop';

/**
 * Снимки истории, ушедшей на сервер, — по одному на запрос.
 *
 * Смотреть в `agentChat.mock.calls[n][0]` нельзя: цикл всё время дописывает
 * ОДИН И ТОТ ЖЕ массив, и vi.fn() запоминает его по ссылке. К концу прогона
 * все записи вызовов показывают одно и то же — конечное состояние истории, а
 * не то, что было отправлено на шаге n. Тест на «в запросе номер два уже есть
 * ход помощника» на такой ссылке проходил бы, даже если ход дописан позже.
 */
const sent: Array<Array<Record<string, unknown>>> = [];

/** Ответы сервера по очереди; последний повторяется. */
function stubAgentChat(replies: unknown[]) {
  let step = 0;
  agentChat.mockImplementation(async (messages: Array<Record<string, unknown>>) => {
    sent.push(JSON.parse(JSON.stringify(messages)));
    const body = replies[Math.min(step, replies.length - 1)];
    step += 1;
    return body;
  });
}

beforeEach(() => {
  sent.length = 0;
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
    expect(sent[1].some((m) => m.role === 'tool')).toBe(true);
  });

  it('ход модели с вызовом инструмента уходит в историю целиком', async () => {
    // Модель, ответившая одними вызовами без текста, — обычное дело. Если
    // такой ход не положить в историю, следующий запрос выглядит как
    // «пользователь → результат инструмента»: связать результат с запросом
    // модели нечем, и она видит ответ на вопрос, которого не задавала.
    stubAgentChat([
      {
        text: '',
        tool_calls: [{ id: 'call-1', name: 'read_canvas', arguments: {} }],
        done: false,
        usage: {},
      },
      { text: 'готово', tool_calls: [], done: true, usage: {} },
    ]);

    await runAgent('посмотри холст', () => {});

    const secondCallMessages = sent[1] as Array<{
      role: string;
      tool_calls?: Array<{ id: string; name: string }>;
    }>;
    const assistant = secondCallMessages.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(assistant?.tool_calls?.[0]).toMatchObject({ id: 'call-1', name: 'read_canvas' });
    // Результат инструмента ссылается на id вызова — тот самый, что ушёл в
    // ходе помощника выше. Пара «вызов ↔ результат» и есть смысл правки.
    expect(secondCallMessages.find((m) => m.role === 'tool')).toMatchObject({
      tool_call_id: 'call-1',
    });
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

  it('останавливается на общем пределе изменений холста', async () => {
    // Предел деталей не спасает: кроме деталей агент ставит провода и меняет
    // свойства, и записей в истории отмены выходит заметно больше, чем
    // деталей. Здесь модель просит одни провода — деталей ноль, а предел
    // должен сработать.
    const tooManyWires = Array.from({ length: MAX_CANVAS_ACTIONS + 5 }, (_, i) => ({
      id: String(i),
      name: 'add_wire',
      arguments: {},
    }));
    stubAgentChat([{ text: '', tool_calls: tooManyWires, done: false, usage: {} }]);
    const events: any[] = [];

    await runAgent('насыпь проводов', (event) => events.push(event));

    expect(runTool).toHaveBeenCalledTimes(MAX_CANVAS_ACTIONS);
    const lastEvent = events.at(-1);
    expect(lastEvent.kind).toBe('error');
    // Причина должна быть названа настоящая — изменения холста, а не шаги и
    // не детали: деталей в этом прогоне не было вовсе.
    expect(lastEvent.message).toContain('изменени');
  });

  it('общий предел изменений заведомо помещается в историю отмены', () => {
    // История отмены — кольцевой буфер на HISTORY_MAX = 50 записей
    // (useSimulatorStore.ts, файл апстрима: константа не экспортируется,
    // поэтому число сверено глазами и продублировано здесь). Предел больше
    // буфера означал бы, что часть правок агента вытеснена и «Откатить
    // прогон» вернёт только хвост.
    expect(MAX_CANVAS_ACTIONS).toBeLessThan(50);
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
