// @vitest-environment jsdom
/**
 * Тесты врезки форка в редактор (src/lib/itArduinoMount).
 *
 * Это единственное место, где наш код встречается с апстримовским, и здесь
 * держится главное правило задания: **облачное сохранение только у вошедших,
 * файл .vlx — всегда**.
 *
 * Выполняется оно тем, чего мы НЕ делаем: у гостя реализация сохранения не
 * ставится вовсе, и работает апстримовское поведение по умолчанию. Проверить
 * это важно именно потому, что «лишняя» установка реализации не сломала бы
 * ничего заметного — гость просто получил бы окно облачного сохранения,
 * которое отвечает 401 и выглядит поломкой.
 *
 * Второй шов — пункт меню «Мои схемы». Апстрим держит его с флагом
 * `optional: true`: строка прячется, пока обработчик не зарегистрирован.
 * Забыть снять регистрацию при выходе значило бы оставить в меню пункт,
 * который для вышедшего пользователя ведёт в 401.
 *
 * Реестр команд (`editorCommands`) взят настоящий: он ни от чего не зависит,
 * и проверять на нём честнее, чем на подделке. Диалоги, `proSaveAction` и
 * состояние открытой схемы подменены — они тянут React и сторы, а к предмету
 * теста отношения не имеют.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const saveSeam = vi.hoisted(() => ({ installSaveActionImpl: vi.fn() }));
const circuits = vi.hoisted(() => ({ forgetOpenCircuit: vi.fn() }));
const myCircuits = vi.hoisted(() => ({ openMyCircuitsDialog: vi.fn() }));
const saveDialog = vi.hoisted(() => ({ openSaveCircuitDialog: vi.fn() }));
const routes = vi.hoisted(() => ({ registerProRoutes: vi.fn() }));
// Страница просмотра тянет за собой EditorPage со всем деревом редактора —
// для проверки регистрации маршрута достаточно заглушки.
const publicPage = vi.hoisted(() => ({ PublicCircuitPage: () => null }));

vi.mock('../lib/proSaveAction', () => saveSeam);
vi.mock('../lib/itArduinoCircuits', () => circuits);
vi.mock('../lib/proRoutes', () => routes);
vi.mock('../components/layout/MyCircuitsDialog', () => myCircuits);
vi.mock('../components/layout/SaveCircuitDialog', () => saveDialog);
vi.mock('../pages/PublicCircuitPage', () => publicPage);

/** Ответ сайта на GET /users/me: 200 — вошли, 401 — гость. */
function stubSiteAuth(status: number): void {
  globalThis.fetch = vi.fn(
    async () => new Response(JSON.stringify({ detail: 'x' }), { status }),
  ) as unknown as typeof fetch;
}

/** Свежая копия модулей: у врезки есть флаг «уже смонтирована». */
async function freshMount() {
  vi.resetModules();
  vi.stubEnv('VITE_SITE_API_BASE', 'https://api.example.test/api');
  // Монтирование сразу спрашивает сайт о входе — по умолчанию отвечаем «гость».
  stubSiteAuth(401);

  const commands = await import('../lib/editorCommands');
  const auth = await import('../lib/itArduinoAuth');
  const mount = await import('../lib/itArduinoMount');
  mount.mountItArduino();
  await auth.refreshAuth();
  return { commands, mount, auth };
}

/**
 * Изобразить вход или выход на основном сайте: меняется ответ /users/me, а
 * дальше всё идёт тем же путём, что в бою.
 */
async function setSignedIn(
  auth: { refreshAuth: () => Promise<void> },
  signedIn: boolean,
): Promise<void> {
  stubSiteAuth(signedIn ? 200 : 401);
  await auth.refreshAuth();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('гость', () => {
  it('не получает облачного сохранения — работает скачивание .vlx апстрима', async () => {
    await freshMount();

    // null снимает нашу реализацию, и triggerSaveAction уходит в
    // апстримовскую defaultSaveAction, то есть в скачивание файла.
    expect(saveSeam.installSaveActionImpl).toHaveBeenCalledWith(null);
    expect(saveSeam.installSaveActionImpl).not.toHaveBeenCalledWith(
      saveDialog.openSaveCircuitDialog,
    );
  });

  it('не видит пункта «Мои схемы»', async () => {
    const { commands } = await freshMount();

    expect(commands.hasEditorCommand('account.myProjects')).toBe(false);
  });
});

describe('вход', () => {
  it('включает облачное сохранение', async () => {
    const { auth } = await freshMount();

    await setSignedIn(auth, true);

    expect(saveSeam.installSaveActionImpl).toHaveBeenLastCalledWith(
      saveDialog.openSaveCircuitDialog,
    );
  });

  it('добавляет пункт «Мои схемы» без правки меню', async () => {
    const { commands, auth } = await freshMount();

    await setSignedIn(auth, true);

    expect(commands.hasEditorCommand('account.myProjects')).toBe(true);
  });

  it('повторная проверка входа не перерегистрирует пункт заново', async () => {
    const { commands, auth } = await freshMount();

    await setSignedIn(auth, true);
    await setSignedIn(auth, true);

    expect(commands.hasEditorCommand('account.myProjects')).toBe(true);
  });
});

describe('выход', () => {
  it('возвращает скачивание .vlx и убирает пункт меню', async () => {
    const { commands, auth } = await freshMount();
    await setSignedIn(auth, true);
    expect(commands.hasEditorCommand('account.myProjects')).toBe(true);

    await setSignedIn(auth, false);

    expect(saveSeam.installSaveActionImpl).toHaveBeenLastCalledWith(null);
    expect(commands.hasEditorCommand('account.myProjects')).toBe(false);
  });

  it('забывает открытую схему', async () => {
    const { auth } = await freshMount();
    await setSignedIn(auth, true);
    circuits.forgetOpenCircuit.mockClear();

    await setSignedIn(auth, false);

    // Иначе следующее «Сохранить» ушло бы в запись, к которой доступа уже нет.
    expect(circuits.forgetOpenCircuit).toHaveBeenCalled();
  });
});

describe('повторный вход после выхода', () => {
  it('снова включает и сохранение, и пункт меню', async () => {
    const { commands, auth } = await freshMount();

    await setSignedIn(auth, true);
    await setSignedIn(auth, false);
    await setSignedIn(auth, true);

    expect(saveSeam.installSaveActionImpl).toHaveBeenLastCalledWith(
      saveDialog.openSaveCircuitDialog,
    );
    expect(commands.hasEditorCommand('account.myProjects')).toBe(true);
  });
});

describe('маршрут просмотра чужой схемы', () => {
  it('регистрируется через реестр апстрима, а не правкой App.tsx', async () => {
    await freshMount();

    expect(routes.registerProRoutes).toHaveBeenCalledTimes(1);
    const registered = routes.registerProRoutes.mock.calls[0][0] as Array<{ path: string }>;
    expect(registered.map((r) => r.path)).toContain('circuit/:circuitId');
  });

  it('доступен и гостю — регистрация не ждёт входа', async () => {
    // Ссылку на опубликованную схему открывают без входа на сайт; если бы
    // маршрут появлялся вместе с токеном, гость получал бы «страница не
    // найдена».
    await freshMount();

    expect(routes.registerProRoutes).toHaveBeenCalled();
  });
});

describe('идемпотентность', () => {
  it('второй вызов mountItArduino ничего не делает повторно', async () => {
    const { mount } = await freshMount();
    const callsAfterFirst = saveSeam.installSaveActionImpl.mock.calls.length;

    mount.mountItArduino();

    expect(saveSeam.installSaveActionImpl.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('недоступный сайт', () => {
  it('не включает облачное сохранение', async () => {
    // Единственный источник входа — ответ сайта. Нет ответа — нет и облачного
    // сохранения: показать его значило бы предложить действие, которое
    // немедленно упадёт.
    const { commands, auth } = await freshMount();

    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as unknown as typeof fetch;
    await auth.refreshAuth();

    expect(commands.hasEditorCommand('account.myProjects')).toBe(false);
    expect(saveSeam.installSaveActionImpl).not.toHaveBeenCalledWith(
      saveDialog.openSaveCircuitDialog,
    );
  });
});
