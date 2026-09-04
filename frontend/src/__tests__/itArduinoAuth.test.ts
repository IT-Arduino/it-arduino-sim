// @vitest-environment jsdom
/**
 * Тесты состояния входа (src/lib/itArduinoAuth).
 *
 * Вход держится на cookie сессии сайта, выданной на домен .it-arduino.ru:
 * симулятор её не читает и не хранит, а только спрашивает у API «кто я».
 * Проверяется то, что ломается молча:
 *
 *   - запрос обязан уходить с `credentials: 'include'`. Без этого флага
 *     браузер не приложит cookie к запросу на соседний поддомен, и вошедший
 *     пользователь навсегда останется гостем. В коде это одна строка, при
 *     удалении которой ни один тип не сломается;
 *   - 401 — гость, а не ошибка. Ответ сервера «сессии нет» штатный: симулятор
 *     работает и без входа, сохраняя схемы в файл;
 *   - недоступный сайт тоже гость. Считать вошедшим того, о ком ничего не
 *     известно, значит показать облачное сохранение, которое ответит 401;
 *   - одновременные вызовы делят один запрос: врезка в редактор и возврат
 *     фокуса во вкладку случаются в один момент.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function loadAuth() {
  vi.resetModules();
  vi.stubEnv('VITE_SITE_API_BASE', 'https://api.example.test/api');
  return import('../lib/itArduinoAuth');
}

/** Ответ сайта на GET /users/me. */
function stubFetch(status: number) {
  const mock = vi.fn(async () =>
    status === 200
      ? new Response(JSON.stringify({ id: 1, username: 'ученик', role: 'user' }), { status })
      : new Response(JSON.stringify({ detail: 'Could not validate credentials' }), { status }),
  );
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('проверка входа', () => {
  it('ответ 200 делает пользователя вошедшим', async () => {
    stubFetch(200);
    const auth = await loadAuth();

    await auth.refreshAuth();

    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.getAuthState()).toEqual({ authenticated: true, pending: false });
  });

  it('спрашивает /users/me у API сайта и прикладывает cookie', async () => {
    const fetchMock = stubFetch(200);
    const auth = await loadAuth();

    await auth.refreshAuth();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/api/users/me');
    // Без этого cookie сессии не уйдёт на соседний поддомен.
    expect(init.credentials).toBe('include');
  });

  it('ответ 401 оставляет гостем', async () => {
    stubFetch(401);
    const auth = await loadAuth();

    await auth.refreshAuth();

    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.getAuthState().pending).toBe(false);
  });

  it('недоступный сайт оставляет гостем, а не роняет', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as unknown as typeof fetch;
    const auth = await loadAuth();

    await expect(auth.refreshAuth()).resolves.toBeUndefined();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('одновременные вызовы делят один запрос', async () => {
    const fetchMock = stubFetch(200);
    const auth = await loadAuth();

    await Promise.all([auth.refreshAuth(), auth.refreshAuth(), auth.refreshAuth()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('следующий вызов после завершения идёт в сеть снова', async () => {
    const fetchMock = stubFetch(200);
    const auth = await loadAuth();

    await auth.refreshAuth();
    await auth.refreshAuth();

    // Не кэш навсегда: на сайте могли выйти из аккаунта.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('потеря сессии', () => {
  it('401 на рабочем запросе снимает признак входа', async () => {
    stubFetch(200);
    const auth = await loadAuth();
    await auth.refreshAuth();
    expect(auth.isAuthenticated()).toBe(true);

    auth.handleUnauthorized();

    expect(auth.isAuthenticated()).toBe(false);
  });

  it('подписчику сообщают об изменении', async () => {
    stubFetch(200);
    const auth = await loadAuth();
    const seen: boolean[] = [];
    auth.subscribeAuth(() => seen.push(auth.getAuthState().authenticated));

    await auth.refreshAuth();
    auth.markSignedOut();

    expect(seen).toContain(true);
    expect(seen[seen.length - 1]).toBe(false);
  });
});

describe('запуск слежения', () => {
  it('спрашивает сайт при старте и переспрашивает при возврате в вкладку', async () => {
    stubFetch(200);
    const auth = await loadAuth();

    auth.startItArduinoAuth();
    await vi.waitFor(() => expect(auth.isAuthenticated()).toBe(true));

    // Вход и выход происходят на сайте, в другой вкладке; сигнала оттуда нет,
    // и возврат фокуса — единственный дешёвый повод переспросить.
    const afterFocus = stubFetch(401);
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(auth.isAuthenticated()).toBe(false));

    expect(afterFocus).toHaveBeenCalledTimes(1);
  });

  it('повторный запуск ничего не делает заново', async () => {
    const fetchMock = stubFetch(200);
    const auth = await loadAuth();

    auth.startItArduinoAuth();
    await vi.waitFor(() => expect(auth.getAuthState().pending).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Врезка в редактор вызывается из нескольких мест; второй запуск не должен
    // ни спрашивать сайт заново, ни ставить второго слушателя фокуса.
    auth.startItArduinoAuth();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
