/**
 * Тесты клиента к API сайта (src/lib/itArduinoApi).
 *
 * Проверяется не «ходит ли запрос» — это очевидно, — а то, что однажды
 * ломалось в подобном коде и ломалось молча:
 *
 *   - запрос от имени пользователя обязан уходить с `credentials: 'include'`,
 *     а публичный — без: первое решает, дойдёт ли cookie сессии до соседнего
 *     поддомена, второе не светит её там, где она не нужна;
 *   - гость не должен доходить до сети вообще: запрос без сессии вернул бы
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

// Признак входа и адрес берутся из модуля авторизации — подменяем его
// целиком: настоящий ходит в сеть за /users/me, а здесь проверяется клиент.
const mockAuth = vi.hoisted(() => ({
  authenticated: false,
  handleUnauthorized: vi.fn(),
}));

vi.mock('../lib/itArduinoAuth', () => ({
  isAuthenticated: () => mockAuth.authenticated,
  handleUnauthorized: () => mockAuth.handleUnauthorized(),
  getSiteApiBase: () => 'https://api.example.test/api',
}));

import {
  ItArduinoApiError,
  createCircuit,
  deleteCircuit,
  getPublicCircuit,
  listCircuits,
} from '../lib/itArduinoApi';
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
  mockAuth.authenticated = true;
  mockAuth.handleUnauthorized.mockClear();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('itArduinoApi', () => {
  it('гостя не пускает в сеть', async () => {
    mockAuth.authenticated = false;

    await expect(listCircuits()).rejects.toBeInstanceOf(ItArduinoApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('прикладывает cookie сессии и собирает адрес от базы API сайта', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(LIST_BODY), { status: 200 }));

    const resp = await listCircuits();

    expect(resp.items[0].title).toBe('Мигающий светодиод');
    expect(resp.limit).toBe(100);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/api/circuits');
    // Без этого браузер не пошлёт cookie на соседний поддомен, и запрос
    // вошедшего пользователя вернул бы 401.
    expect(init.credentials).toBe('include');
  });

  it('публичную схему запрашивает без cookie', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ...LIST_BODY.items[0], data: EMPTY_PAYLOAD }), { status: 200 }),
    );

    await getPublicCircuit(7);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/api/public/circuits/7');
    // Ответ от cookie не меняется, а посланная без нужды — лишний повод её
    // засветить.
    expect(init.credentials).toBe('omit');
  });

  it('401 на рабочем запросе закрывает вход в интерфейсе', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Could not validate credentials' }), { status: 401 }),
    );

    await expect(listCircuits()).rejects.toMatchObject({ status: 401 });
    expect(mockAuth.handleUnauthorized).toHaveBeenCalled();
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
