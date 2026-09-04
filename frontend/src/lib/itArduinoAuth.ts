/**
 * Авторизация симулятора против основного сайта it-arduino.ru.
 *
 * Симулятор живёт на sim.it-arduino.ru, сайт — на it-arduino.ru, API — на
 * api.it-arduino.ru. Всё это поддомены одного домена, и вход держится на
 * cookie сессии, выданной сайтом на `.it-arduino.ru`: браузер сам приложит её
 * к запросу к API, если запрос сделан с `credentials: 'include'`.
 *
 * Поэтому передавать сюда нечего и хранить здесь тоже нечего. Вопрос «вошёл
 * ли пользователь» решается одним запросом `GET /users/me`: ответ 200 —
 * вошёл, 401 — гость. Токена в памяти вкладки нет вовсе.
 *
 * Раньше здесь было два механизма передачи чужого токена — postMessage от
 * родительской страницы и обмен одноразового билета из адресной строки, — и
 * оба существовали ровно потому, что токен лежал в localStorage сайта, а
 * прочитать чужой localStorage браузер не даёт. С cookie на общем домене
 * задача исчезла целиком, вместе с билетами, проверкой origin у сообщений и
 * разбором срока из JWT.
 *
 * Гость никуда не упирается: редактор работает, схемы сохраняются в файл .vlx.
 */

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
  /** Сессия сайта есть — облачное сохранение доступно. */
  authenticated: boolean;
  /** Идёт проверка — интерфейсу стоит подождать, а не рисовать «гость». */
  pending: boolean;
}

let _authenticated = false;
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
  if (_authenticated !== _snapshot.authenticated || _pending !== _snapshot.pending) {
    _snapshot = { authenticated: _authenticated, pending: _pending };
    emit();
  }
}

export function getAuthState(): AuthState {
  return _snapshot;
}

export function isAuthenticated(): boolean {
  return _authenticated;
}

/**
 * Спросить у сайта, есть ли сессия.
 *
 * Одновременные вызовы делят один запрос: врезка в редактор и возврат фокуса
 * во вкладку могут случиться в один момент, и два одинаковых запроса здесь
 * бессмысленны.
 *
 * Сетевой сбой трактуем как «гость». Другого разумного варианта нет: считать
 * вошедшим того, о ком ничего не известно, значит показать облачное
 * сохранение, которое ответит 401 и будет выглядеть поломкой.
 */
let _inFlight: Promise<void> | null = null;

export function refreshAuth(): Promise<void> {
  if (_inFlight) return _inFlight;

  _pending = true;
  refreshSnapshot();

  _inFlight = (async () => {
    try {
      const resp = await fetch(`${getSiteApiBase()}/users/me`, {
        // Главная строка файла: без неё браузер не приложит cookie сессии к
        // запросу на соседний поддомен, и вошедший пользователь выглядел бы
        // гостем.
        credentials: 'include',
      });
      _authenticated = resp.ok;
    } catch {
      // Сайт недоступен — работаем как гость. Сообщение в консоль не пишем:
      // это штатный сценарий, симулятор открывают и без сети.
      _authenticated = false;
    } finally {
      _pending = false;
      _inFlight = null;
      refreshSnapshot();
    }
  })();

  return _inFlight;
}

/**
 * Сервер ответил 401 на запрос от имени пользователя: сессии больше нет
 * (вышли на сайте, сменили пароль, истёк срок). Интерфейс не должен дальше
 * считать пользователя вошедшим.
 */
export function handleUnauthorized(): void {
  _authenticated = false;
  refreshSnapshot();
}

/** Забыть вход. То же действие, что при 401, — отдельное имя ради читаемости. */
export function markSignedOut(): void {
  handleUnauthorized();
}

let _started = false;

/**
 * Запустить слежение за входом. Идемпотентно.
 *
 * Кроме первой проверки — повтор при возврате в вкладку. Вход и выход
 * происходят на сайте, в другой вкладке, и никакого сигнала оттуда сюда не
 * приходит; возвращение фокуса — самый дешёвый момент, чтобы заметить
 * изменение, не опрашивая сервер по таймеру.
 */
export function startItArduinoAuth(): void {
  if (_started) return;
  _started = true;

  void refreshAuth();

  if (typeof window !== 'undefined') {
    window.addEventListener('focus', () => {
      void refreshAuth();
    });
  }
}
