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

const JSDOM_ORIGIN = 'http://localhost:3000';

const getMe = vi.fn();

vi.mock('../lib/itArduinoApi', () => ({
  getMe: (...args: unknown[]) => getMe(...args),
}));

/**
 * Свежие копии обоих модулей. `itArduinoRole` подписывается на авторизацию
 * при импорте, поэтому состояние между тестами сбрасывается целиком.
 */
async function load() {
  vi.resetModules();
  vi.stubEnv('VITE_SITE_ORIGIN', JSDOM_ORIGIN);
  vi.stubEnv('VITE_SITE_API_BASE', 'https://api.example.test/api');
  const auth = await import('../lib/itArduinoAuth');
  const role = await import('../lib/itArduinoRole');
  // Слушатель сообщений ставится не при импорте, а здесь — без вызова
  // токен бы не принялся и все тесты «прошли» бы на состоянии гостя.
  auth.startItArduinoAuth();
  return { auth, role };
}

/**
 * Токен кладётся тем же путём, что в бою, — сообщением от родителя.
 * Событие создаётся вручную, а не через postMessage: в jsdom оно
 * доставляется асинхронно и с пустым origin, и проверка адреса отсекала бы
 * его (тот же приём, что в itArduinoAuth.test.ts).
 */
function signIn(token = 'jwt-test'): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'it-arduino-auth', token },
      origin: JSDOM_ORIGIN,
    }),
  );
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
    signIn();
    expect(auth.isAuthenticated()).toBe(true);
    await role.refreshRole();
    expect(role.isAdmin()).toBe(true);
    expect(role.getRoleState().pending).toBe(false);
  });

  it('user с сайта администратором не делает', async () => {
    const { role } = await load();
    getMe.mockResolvedValue({ id: 2, username: 'student', role: 'user' });
    signIn();
    await role.refreshRole();
    expect(role.getRoleState().role).toBe('user');
    expect(role.isAdmin()).toBe(false);
  });

  it('незнакомое значение роли администратором не делает', async () => {
    const { role } = await load();
    // Если на сайте однажды появится третья роль, симулятор должен
    // промолчать, а не пустить её в закрытую часть.
    getMe.mockResolvedValue({ id: 3, username: 'teacher', role: 'moderator' });
    signIn();
    await role.refreshRole();
    expect(role.isAdmin()).toBe(false);
  });

  it('сбой сети не делает администратором', async () => {
    const { role } = await load();
    getMe.mockRejectedValue(new Error('network'));
    signIn();
    await role.refreshRole();
    expect(role.isAdmin()).toBe(false);
    expect(role.getRoleState()).toEqual({ role: 'user', pending: false });
  });
});

describe('выход', () => {
  it('роль забывается', async () => {
    const { auth, role } = await load();
    getMe.mockResolvedValue({ id: 1, username: 'tester', role: 'admin' });
    signIn();
    await role.refreshRole();
    expect(role.isAdmin()).toBe(true);

    auth.clearToken();
    expect(role.isAdmin()).toBe(false);
    expect(role.getRoleState().role).toBe('guest');
  });
});

describe('одновременные вызовы', () => {
  it('делят один запрос', async () => {
    const { role } = await load();
    getMe.mockResolvedValue({ id: 1, username: 'tester', role: 'admin' });
    signIn();
    // Вход сам запускает запрос роли (подписка внутри itArduinoRole).
    // Дожидаемся его, иначе следующие вызовы просто разделят этот же
    // незавершённый промис и счётчик покажет ноль.
    await role.refreshRole();
    getMe.mockClear();

    await Promise.all([role.refreshRole(), role.refreshRole(), role.refreshRole()]);
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it('следующий вызов после завершения идёт в сеть снова', async () => {
    const { role } = await load();
    getMe.mockResolvedValue({ id: 1, username: 'tester', role: 'admin' });
    signIn();
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
