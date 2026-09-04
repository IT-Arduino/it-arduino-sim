// @vitest-environment jsdom
/**
 * Тесты роли пользователя (src/lib/itArduinoRole).
 *
 * От этого модуля зависит, увидит ли человек галерею «Избранные проекты».
 * Все проверяемые здесь правила ломаются молча — интерфейс не падает, просто
 * начинает пускать не тех или не пускать тех:
 *
 *   - гость не администратор. Убрав проверку входа, `refreshRole` ушёл бы в
 *     сеть без токена и упал в catch, а catch ставит роль `user` — то есть
 *     «вошедший обычный пользователь» вместо «гостя»;
 *   - сбой сети НЕ делает администратором. Обратная ошибка (считать админом
 *     при неизвестной роли) не проявилась бы ни в одном ручном сценарии,
 *     потому что у разработчика сеть работает;
 *   - выход забывает роль. Иначе вышедший админ видел бы пункт меню до
 *     перезагрузки страницы;
 *   - одновременные вызовы делят один запрос. Страж маршрута и две ссылки в
 *     шапке монтируются вместе; без этого при каждом открытии редактора
 *     уходило бы три одинаковых запроса к сайту.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getMe = vi.fn();

vi.mock('../lib/itArduinoApi', () => ({
  getMe: (...args: unknown[]) => getMe(...args),
}));

/** Ответ сайта на GET /users/me — им же изображается вход и выход. */
function stubSiteAuth(status: number): void {
  globalThis.fetch = vi.fn(
    async () => new Response(JSON.stringify({ detail: 'x' }), { status }),
  ) as unknown as typeof fetch;
}

/**
 * Свежие копии обоих модулей. `itArduinoRole` подписывается на авторизацию
 * при импорте, поэтому состояние между тестами сбрасывается целиком.
 */
async function load() {
  vi.resetModules();
  vi.stubEnv('VITE_SITE_API_BASE', 'https://api.example.test/api');
  // По умолчанию гость: тест, которому нужен вход, вызовет signIn().
  stubSiteAuth(401);
  const auth = await import('../lib/itArduinoAuth');
  const role = await import('../lib/itArduinoRole');
  return { auth, role };
}

/**
 * Вход изображается так же, как в бою: сайт отвечает 200 на /users/me.
 * Модуль роли подписан на авторизацию и спросит роль сам.
 */
async function signIn(auth: { refreshAuth: () => Promise<void> }): Promise<void> {
  stubSiteAuth(200);
  await auth.refreshAuth();
}

beforeEach(() => {
  getMe.mockReset();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('роль до входа', () => {
  it('гость, и в сеть не ходим', async () => {
    const { role } = await load();
    await role.refreshRole();
    expect(role.getRoleState()).toEqual({ role: 'guest', pending: false });
    expect(role.isAdmin()).toBe(false);
    // Главное: запроса не было. Иначе он упал бы в catch, роль стала бы
    // 'user', и гость превратился бы во «вошедшего».
    expect(getMe).not.toHaveBeenCalled();
  });
});

describe('роль после входа', () => {
  it('admin с сайта делает администратором', async () => {
    const { auth, role } = await load();
    getMe.mockResolvedValue({ id: 1, username: 'tester', role: 'admin' });
    await signIn(auth);
    expect(auth.isAuthenticated()).toBe(true);
    await role.refreshRole();
    expect(role.isAdmin()).toBe(true);
    expect(role.getRoleState().pending).toBe(false);
  });

  it('user с сайта администратором не делает', async () => {
    const { auth, role } = await load();
    getMe.mockResolvedValue({ id: 2, username: 'student', role: 'user' });
    await signIn(auth);
    await role.refreshRole();
    expect(role.getRoleState().role).toBe('user');
    expect(role.isAdmin()).toBe(false);
  });

  it('незнакомое значение роли администратором не делает', async () => {
    const { auth, role } = await load();
    // Если на сайте однажды появится третья роль, симулятор должен
    // промолчать, а не пустить её в закрытую часть.
    getMe.mockResolvedValue({ id: 3, username: 'teacher', role: 'moderator' });
    await signIn(auth);
    await role.refreshRole();
    expect(role.isAdmin()).toBe(false);
  });

  it('сбой сети не делает администратором', async () => {
    const { auth, role } = await load();
    getMe.mockRejectedValue(new Error('network'));
    await signIn(auth);
    await role.refreshRole();
    expect(role.isAdmin()).toBe(false);
    expect(role.getRoleState()).toEqual({ role: 'user', pending: false });
  });
});

describe('выход', () => {
  it('роль забывается', async () => {
    const { auth, role } = await load();
    getMe.mockResolvedValue({ id: 1, username: 'tester', role: 'admin' });
    await signIn(auth);
    await role.refreshRole();
    expect(role.isAdmin()).toBe(true);

    auth.markSignedOut();
    expect(role.isAdmin()).toBe(false);
    expect(role.getRoleState().role).toBe('guest');
  });
});

describe('одновременные вызовы', () => {
  it('делят один запрос', async () => {
    const { auth, role } = await load();
    getMe.mockResolvedValue({ id: 1, username: 'tester', role: 'admin' });
    await signIn(auth);
    // Вход сам запускает запрос роли (подписка внутри itArduinoRole).
    // Дожидаемся его, иначе следующие вызовы просто разделят этот же
    // незавершённый промис и счётчик покажет ноль.
    await role.refreshRole();
    getMe.mockClear();

    await Promise.all([role.refreshRole(), role.refreshRole(), role.refreshRole()]);
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it('следующий вызов после завершения идёт в сеть снова', async () => {
    const { auth, role } = await load();
    getMe.mockResolvedValue({ id: 1, username: 'tester', role: 'admin' });
    await signIn(auth);
    // Вход сам запускает запрос роли (подписка внутри itArduinoRole).
    // Дожидаемся его, иначе следующие вызовы просто разделят этот же
    // незавершённый промис и счётчик покажет ноль.
    await role.refreshRole();
    getMe.mockClear();

    await role.refreshRole();
    await role.refreshRole();
    // Не кэш навсегда: роль на сайте могли поменять.
    expect(getMe).toHaveBeenCalledTimes(2);
  });
});
