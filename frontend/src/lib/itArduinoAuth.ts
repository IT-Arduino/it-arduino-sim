/**
 * Авторизация симулятора против основного сайта it-arduino.ru.
 *
 * Задача. Сайт живёт на it-arduino.ru и держит свой токен в localStorage под
 * ключом `auth_data`. Симулятор живёт на sim.it-arduino.ru — это другой
 * origin, и прочитать чужой localStorage браузер ему не даст. Нужен явный
 * механизм передачи, и здесь их два, потому что симулятор открывают двумя
 * способами.
 *
 *   1. В iframe на странице сайта. Родительская страница шлёт токен через
 *      postMessage при загрузке и при каждом обновлении токена.
 *   2. Прямым заходом на sim.it-arduino.ru. Сайт по кнопке «Открыть
 *      симулятор» получает у API одноразовый билет и передаёт его в адресе;
 *      симулятор меняет билет на рабочий токен и вычищает параметр из
 *      адресной строки.
 *
 * Токен живёт ТОЛЬКО в памяти вкладки. В localStorage он не пишется
 * намеренно: симулятор — сторонний origin для сайта, и оставлять там чужой
 * ключ доступа, переживающий закрытие вкладки, незачем. Цена — при
 * перезагрузке прямого захода вход теряется; в iframe родитель пришлёт
 * токен заново сам.
 *
 * Проверка origin строгая с обеих сторон и без исключений. `*` здесь означал
 * бы, что токен готова прислать любая страница, встроившая симулятор, и что
 * любая такая страница может подсунуть свой.
 */

/** Origin основного сайта. Только от него принимаются сообщения. */
const SITE_ORIGIN: string =
  (import.meta.env.VITE_SITE_ORIGIN as string | undefined) || 'https://it-arduino.ru';

/** База API основного сайта. Симулятор ходит на неё, а не на свой бэкенд. */
export function getSiteApiBase(): string {
  const w =
    typeof window !== 'undefined'
      ? (window as Window & { __IT_ARDUINO_API__?: string })
      : undefined;
  if (w && typeof w.__IT_ARDUINO_API__ === 'string' && w.__IT_ARDUINO_API__) {
    return w.__IT_ARDUINO_API__.replace(/\/+$/, '');
  }
  const fromEnv = import.meta.env.VITE_SITE_API_BASE as string | undefined;
  if (typeof fromEnv === 'string' && fromEnv) return fromEnv.replace(/\/+$/, '');
  return 'https://api.it-arduino.ru/api';
}

export interface AuthState {
  /** Токен есть и им можно пользоваться. */
  authenticated: boolean;
  /** Идёт обмен билета — интерфейсу стоит подождать, а не рисовать «гость». */
  pending: boolean;
}

let _token: string | null = null;
let _pending = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeAuth(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Снимок состояния.
 *
 * Объект пересоздаётся только при реальном изменении полей: useSyncExternalStore
 * сравнивает снимок по ссылке и уходит в бесконечный цикл перерисовки, если
 * возвращать новый объект на каждый вызов.
 */
let _snapshot: AuthState = { authenticated: false, pending: false };

function refreshSnapshot(): void {
  const authenticated = _token !== null;
  if (authenticated !== _snapshot.authenticated || _pending !== _snapshot.pending) {
    _snapshot = { authenticated, pending: _pending };
  }
}

export function getAuthState(): AuthState {
  return _snapshot;
}

export function getToken(): string | null {
  return _token;
}

export function isAuthenticated(): boolean {
  return _token !== null;
}

function setToken(token: string | null): void {
  _token = token;
  refreshSnapshot();
  emit();
}

/** Выйти. Токен забывается; сохранение снова уходит в файл .vlx. */
export function clearToken(): void {
  setToken(null);
}

/**
 * Приём токена от родительской страницы (сценарий с iframe).
 *
 * Ожидаемое сообщение: { type: 'it-arduino-auth', token: '<jwt>' }.
 * token === null трактуется как выход из аккаунта на сайте.
 */
function startParentListener(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('message', (event: MessageEvent) => {
    // Первая и главная проверка. Без неё токен принимался бы от любой
    // страницы, встроившей симулятор.
    if (event.origin !== SITE_ORIGIN) return;

    const data = event.data as { type?: string; token?: unknown } | null;
    if (!data || data.type !== 'it-arduino-auth') return;

    if (data.token === null) {
      setToken(null);
      return;
    }
    if (typeof data.token === 'string' && data.token) {
      setToken(data.token);
    }
  });

  // Сообщить родителю, что мы готовы принимать токен. Нужно на случай, если
  // родитель отправил его до того, как наш обработчик встал: сообщение,
  // отправленное до подписки, теряется безвозвратно, и без этого сигнала
  // пользователь в iframe выглядел бы гостем до следующего обновления токена.
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'it-arduino-ready' }, SITE_ORIGIN);
  }
}

/**
 * Обмен билета из адресной строки на рабочий токен (прямой заход).
 *
 * Билет вычищается из адреса СРАЗУ, до сетевого запроса. Иначе он остаётся в
 * истории браузера и уедет в заголовке Referer при первом же переходе по
 * внешней ссылке — а обмен занимает сотни миллисекунд, которых для этого
 * вполне достаточно.
 */
async function redeemTicketFromUrl(): Promise<void> {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  const ticket = url.searchParams.get('ticket');
  if (!ticket) return;

  url.searchParams.delete('ticket');
  window.history.replaceState({}, '', url.toString());

  _pending = true;
  refreshSnapshot();
  emit();

  try {
    const resp = await fetch(`${getSiteApiBase()}/sim/session/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
    });
    if (!resp.ok) {
      // Просроченный или уже использованный билет — не ошибка приложения.
      // Пользователь просто остаётся гостем и сохраняет в файл.
      console.info('[it-arduino] билет не принят, работаем как гость');
      return;
    }
    const body = (await resp.json()) as { access_token?: unknown };
    if (typeof body.access_token === 'string' && body.access_token) {
      _token = body.access_token;
    }
  } catch (err) {
    console.warn('[it-arduino] не удалось обменять билет:', err);
  } finally {
    _pending = false;
    refreshSnapshot();
    emit();
  }
}

let _started = false;

/** Запустить приём авторизации. Идемпотентно. */
export function startItArduinoAuth(): void {
  if (_started) return;
  _started = true;
  startParentListener();
  void redeemTicketFromUrl();
}
