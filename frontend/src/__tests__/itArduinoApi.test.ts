/**
 * Тесты клиента к API сайта (src/lib/itArduinoApi).
 *
 * Проверяется не «ходит ли запрос» — это очевидно, — а четыре вещи, каждая из
 * которых однажды ломалась в подобном коде и ломалась молча:
 *
 *   - гость не должен доходить до сети вообще: запрос без токена вернул бы
 *     401 с сервера, но сначала засветил бы адрес и потратил время;
 *   - причина отказа должна доходить до пользователя дословно. FastAPI кладёт
 *     её в `detail`, и это поле бывает и строкой, и массивом ошибок Pydantic.
 *     Разбор только строки превращает вторую форму в «[object Object]»;
 *   - недоступный сайт и ошибка сервера — разные события. Первое не значит,
 *     что со схемой что-то не так, и путать их нельзя;
 *   - удаление отвечает 204 без тела, и попытка разобрать это тело как JSON
 *     превратила бы успешное удаление в ошибку.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Токен и адрес берутся из модуля авторизации — подменяем его целиком:
// настоящий работает через postMessage и window, которых в node-окружении нет.
const mockAuth = vi.hoisted(() => ({ token: null as string | null }));

vi.mock('../lib/itArduinoAuth', () => ({
  getToken: () => mockAuth.token,
  getSiteApiBase: () => 'https://api.example.test/api',
}));

import { ItArduinoApiError, createCircuit, deleteCircuit, listCircuits } from '../lib/itArduinoApi';
import type { VlxPayload } from '../utils/vlxFile';

const LIST_BODY = {
  items: [
    {
      id: 1,
      title: 'Мигающий светодиод',
      is_public: false,
      project_id: null,
      created_at: '2026-08-28T12:00:00',
      updated_at: '2026-08-28T12:00:00',
    },
  ],
  total: 1,
  limit: 100,
};

const EMPTY_PAYLOAD = {
  format: 'velxio-project',
  version: 1,
  exportedAt: '2026-08-28T12:00:00.000Z',
  boards: [],
  fileGroups: {},
  components: [],
  wires: [],
  activeBoardId: null,
} as unknown as VlxPayload;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockAuth.token = 'test-token';
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('itArduinoApi', () => {
  it('гостя не пускает в сеть', async () => {
    mockAuth.token = null;

    await expect(listCircuits()).rejects.toBeInstanceOf(ItArduinoApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('шлёт токен и собирает адрес от базы API сайта', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(LIST_BODY), { status: 200 }));

    const resp = await listCircuits();

    expect(resp.items[0].title).toBe('Мигающий светодиод');
    expect(resp.limit).toBe(100);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/api/circuits');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('показывает причину отказа, когда сервер прислал её строкой', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Достигнут лимит: 100 схем' }), { status: 409 }),
    );

    await expect(createCircuit({ title: 'Светофор', data: EMPTY_PAYLOAD })).rejects.toMatchObject({
      status: 409,
      message: 'Достигнут лимит: 100 схем',
    });
  });

  it('разбирает и массив ошибок валидации, а не только строку', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: [{ msg: 'field required' }] }), { status: 422 }),
    );

    await expect(createCircuit({ title: '', data: EMPTY_PAYLOAD })).rejects.toMatchObject({
      status: 422,
      message: 'field required',
    });
  });

  it('отличает недоступный сайт от ошибки сервера', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));

    await expect(listCircuits()).rejects.toMatchObject({ status: 0 });
  });

  it('принимает 204 без тела как успешное удаление', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(deleteCircuit(1)).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
  });
});
