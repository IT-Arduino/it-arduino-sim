// @vitest-environment jsdom
/**
 * Тесты приёма авторизации (src/lib/itArduinoAuth).
 *
 * Здесь два правила, каждое из которых защищает чужой токен доступа, и оба
 * ломаются молча — без падения, без ошибки в консоли, просто перестают
 * работать:
 *
 *   - сообщение с токеном принимается ТОЛЬКО от адреса основного сайта.
 *     Ослабление проверки до `*` не сломало бы ни одного сценария и при этом
 *     позволило бы любой странице, встроившей симулятор, и подсунуть свой
 *     токен, и получить чужой;
 *   - одноразовый билет вычищается из адресной строки ДО сетевого запроса, а
 *     не после. Обмен занимает сотни миллисекунд; всё это время билет лежит в
 *     истории браузера и уедет в заголовке Referer при первом переходе по
 *     внешней ссылке. Перестановка двух строк местами ничего не сломает в
 *     работе — и именно поэтому проверяется тестом.
 *
 * VITE_SITE_ORIGIN подменяется на адрес самого jsdom: иначе «правильный»
 * источник невозможно изобразить, и проверить можно было бы только отказ.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Адрес, который jsdom выдаёт странице по умолчанию. */
const JSDOM_ORIGIN = 'http://localhost:3000';

async function loadAuth() {
  vi.resetModules();
  vi.stubEnv('VITE_SITE_ORIGIN', JSDOM_ORIGIN);
  vi.stubEnv('VITE_SITE_API_BASE', 'https://api.example.test/api');
  return import('../lib/itArduinoAuth');
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('itArduinoAuth: приём токена от родительской страницы', () => {
  it('не принимает токен от чужого адреса', async () => {
    const auth = await loadAuth();
    auth.startItArduinoAuth();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'it-arduino-auth', token: 'тестовый-токен' },
        origin: 'https://evil.example',
      }),
    );

    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.getToken()).toBeNull();
  });

  it('принимает токен от адреса основного сайта', async () => {
    const auth = await loadAuth();
    auth.startItArduinoAuth();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'it-arduino-auth', token: 'тестовый-токен' },
        origin: JSDOM_ORIGIN,
      }),
    );

    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.getToken()).toBe('тестовый-токен');
  });

  it('трактует token: null как выход из аккаунта', async () => {
    const auth = await loadAuth();
    auth.startItArduinoAuth();

    const send = (token: string | null): void => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'it-arduino-auth', token },
          origin: JSDOM_ORIGIN,
        }),
      );
    };

    send('тестовый-токен');
    expect(auth.isAuthenticated()).toBe(true);

    send(null);
    expect(auth.isAuthenticated()).toBe(false);
  });
});

describe('itArduinoAuth: обмен билета из адресной строки', () => {
  it('вычищает билет из адреса ДО запроса и меняет его на токен', async () => {
    window.history.replaceState({}, '', '/editor?ticket=одноразовый-билет');

    // Что было в адресной строке в момент запроса. Именно момент важен:
    // проверка после обмена прошла бы и при обратном порядке строк.
    let searchAtRequest: string | null = null;

    const fetchMock = vi.fn(async () => {
      searchAtRequest = window.location.search;
      return new Response(
        JSON.stringify({
          access_token: 'тестовый-токен',
          token_type: 'bearer',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const auth = await loadAuth();
    auth.startItArduinoAuth();

    await vi.waitFor(() => expect(auth.isAuthenticated()).toBe(true));

    expect(searchAtRequest).not.toContain('ticket');
    expect(window.location.search).not.toContain('ticket');
    expect(auth.getToken()).toBe('тестовый-токен');

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.example.test/api/sim/session/exchange');
  });

  it('оставляет гостем, если билет уже использован', async () => {
    window.history.replaceState({}, '', '/editor?ticket=просроченный');

    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: 'Недействительный билет' }), { status: 401 }),
    ) as unknown as typeof fetch;

    const auth = await loadAuth();
    auth.startItArduinoAuth();

    await vi.waitFor(() => expect(auth.getAuthState().pending).toBe(false));

    expect(auth.isAuthenticated()).toBe(false);
    expect(window.location.search).not.toContain('ticket');
  });
});
