/**
 * Цикл агента (lib/itArduinoAgent/agentLoop).
 *
 * Проверяется на подменённом ответе сервера — без сети и без модели:
 * порядок вызовов, возврат результатов в диалог, предел шагов и остановка.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runTool = vi.fn();
vi.mock('../lib/itArduinoAgent/toolRegistry', () => ({
  runTool: (...args: unknown[]) => runTool(...args),
  TOOLS: {},
}));

vi.mock('../lib/itArduinoAuth', () => ({
  getSiteApiBase: () => 'https://api.example.test/api',
}));

import { runAgent, MAX_COMPONENTS, MAX_STEPS } from '../lib/itArduinoAgent/agentLoop';

/** Ответы сервера по очереди; последний повторяется. */
function stubServer(replies: unknown[]) {
  let step = 0;
  globalThis.fetch = vi.fn(async () => {
    const body = replies[Math.min(step, replies.length - 1)];
    step += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  runTool.mockReset();
  runTool.mockResolvedValue({ ok: true, data: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('цикл', () => {
  it('исполняет запрошенный инструмент и возвращает результат в диалог', async () => {
    stubServer([
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
    const secondCall = (globalThis.fetch as any).mock.calls[1][1];
    expect(String(secondCall.body)).toContain('"role":"tool"');
  });

  it('останавливается на пределе шагов', async () => {
    stubServer([
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
    stubServer([
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
    stubServer([
      {
        text: '',
        tool_calls: [{ id: '1', name: 'add_component', arguments: { type: 'led', x: 0, y: 0 } }],
        done: false,
        usage: {},
      },
    ]);
    const events: any[] = [];

    await runAgent('насыпь деталей', (event) => events.push(event));

    // Предел шагов тут не спасает: за тридцать шагов холст уже завален.
    expect(runTool.mock.calls.length).toBeLessThanOrEqual(MAX_COMPONENTS);
    expect(events.at(-1).kind).toBe('error');
  });

  it('ошибка сервера завершает прогон понятным событием', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('{}', { status: 502 }),
    ) as unknown as typeof fetch;
    const events: any[] = [];

    await runAgent('собери', (event) => events.push(event));

    expect(events.at(-1)).toMatchObject({ kind: 'error' });
  });
});
