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

const JSDOM_ORIGIN = 'http://localhost:3000';

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

/** Свежая копия модулей: у врезки есть флаг «уже смонтирована». */
async function freshMount() {
  vi.resetModules();
  vi.stubEnv('VITE_SITE_ORIGIN', JSDOM_ORIGIN);
  vi.stubEnv('VITE_SITE_API_BASE', 'https://api.example.test/api');

  const commands = await import('../lib/editorCommands');
  const mount = await import('../lib/itArduinoMount');
  mount.mountItArduino();
  return { commands, mount };
}

/** Изобразить вход или выход на основном сайте. */
function sendAuth(token: string | null): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'it-arduino-auth', token },
      origin: JSDOM_ORIGIN,
    }),
  );
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
    await freshMount();

    sendAuth('тестовый-токен');

    expect(saveSeam.installSaveActionImpl).toHaveBeenLastCalledWith(
      saveDialog.openSaveCircuitDialog,
    );
  });

  it('добавляет пункт «Мои схемы» без правки меню', async () => {
    const { commands } = await freshMount();

    sendAuth('тестовый-токен');

    expect(commands.hasEditorCommand('account.myProjects')).toBe(true);
  });

  it('повторный приход токена не перерегистрирует пункт заново', async () => {
    const { commands } = await freshMount();

    sendAuth('первый-токен');
    sendAuth('второй-токен');

    expect(commands.hasEditorCommand('account.myProjects')).toBe(true);
  });
});

describe('выход', () => {
  it('возвращает скачивание .vlx и убирает пункт меню', async () => {
    const { commands } = await freshMount();
    sendAuth('тестовый-токен');
    expect(commands.hasEditorCommand('account.myProjects')).toBe(true);

    sendAuth(null);

    expect(saveSeam.installSaveActionImpl).toHaveBeenLastCalledWith(null);
    expect(commands.hasEditorCommand('account.myProjects')).toBe(false);
  });

  it('забывает открытую схему', async () => {
    await freshMount();
    sendAuth('тестовый-токен');
    circuits.forgetOpenCircuit.mockClear();

    sendAuth(null);

    // Иначе следующее «Сохранить» ушло бы в запись, к которой доступа уже нет.
    expect(circuits.forgetOpenCircuit).toHaveBeenCalled();
  });
});

describe('повторный вход после выхода', () => {
  it('снова включает и сохранение, и пункт меню', async () => {
    const { commands } = await freshMount();

    sendAuth('тестовый-токен');
    sendAuth(null);
    sendAuth('новый-токен');

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

describe('чужой источник сообщения', () => {
  it('не включает облачное сохранение', async () => {
    const { commands } = await freshMount();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'it-arduino-auth', token: 'подсунутый-токен' },
        origin: 'https://evil.example',
      }),
    );

    expect(commands.hasEditorCommand('account.myProjects')).toBe(false);
    expect(saveSeam.installSaveActionImpl).not.toHaveBeenCalledWith(
      saveDialog.openSaveCircuitDialog,
    );
  });
});
