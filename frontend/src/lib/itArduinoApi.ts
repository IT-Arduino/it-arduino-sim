/**
 * Клиент к API основного сайта it-arduino.ru — хранение схем.
 *
 * Весь сетевой код форка живёт здесь и больше нигде. Серверная часть — в
 * репозитории сайта, arduino_api/app/api/endpoints/circuits.py.
 *
 * Адрес берётся из itArduinoAuth.getSiteApiBase(): симулятор стоит на
 * sim.it-arduino.ru, а API — на api.it-arduino.ru, это разные хосты, и
 * штатный lib/apiBase.ts сюда не годится — он резолвит бэкенд самого
 * симулятора, который компилирует скетчи.
 *
 * Авторизация — cookie сессии сайта, выданная на домен .it-arduino.ru.
 * Заголовков с токеном здесь нет: запрос от имени пользователя отличается от
 * запроса гостя одним полем `credentials`.
 *
 * Формат схемы не трогаем. В поле `data` уходит ровно то, что вернул
 * buildVlxPayload(), и оттуда же приходит обратно: сервер хранит его как
 * непрозрачный JSON. Любая попытка «улучшить» формат по дороге сломала бы
 * совместимость с файлами .vlx и с примерами апстрима.
 */

import { getSiteApiBase, handleUnauthorized, isAuthenticated } from './itArduinoAuth';
import type { VlxPayload } from '../utils/vlxFile';

/** Строка списка «Мои схемы». Без содержимого — см. CircuitListItem на сервере. */
export interface CircuitSummary {
  id: number;
  title: string;
  is_public: boolean;
  project_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CircuitFull extends CircuitSummary {
  data: VlxPayload;
}

export interface CircuitListResponse {
  items: CircuitSummary[];
  total: number;
  /** Потолок из настроек сервера — показываем «занято 12 из 100». */
  limit: number;
}

/** Ошибка запроса с кодом и разобранным сообщением сервера. */
export class ItArduinoApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ItArduinoApiError';
    this.status = status;
  }
}

/**
 * Отправка запроса и разбор ответа — общая часть для запросов от имени
 * пользователя и запросов гостя. Различаются они ровно одним полем, и держать
 * две копии разбора ошибок значило бы однажды починить её только в одной.
 *
 * `withSession` — прикладывать ли cookie сессии. Для публичной схемы она не
 * нужна: ответ от неё не меняется, а посланная без надобности cookie — лишний
 * повод её засветить.
 */
async function send<T>(path: string, init: RequestInit, withSession: boolean): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${getSiteApiBase()}${path}`, {
      ...init,
      credentials: withSession ? 'include' : 'omit',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    // Сеть, а не сервер: сайт может быть недоступен, а симулятор при этом
    // прекрасно работает дальше — про это и сообщаем.
    throw new ItArduinoApiError(
      0,
      `Не удалось связаться с it-arduino.ru: ${(err as Error).message}`,
    );
  }

  if (resp.status === 204) return undefined as T;

  if (!resp.ok) {
    // FastAPI кладёт причину в поле detail. Оно бывает строкой (наши
    // HTTPException) или списком (ошибки валидации Pydantic) — разбираем оба,
    // иначе пользователь увидит «[object Object]».
    let detail = `Ошибка ${resp.status}`;
    try {
      const body = (await resp.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') {
        detail = body.detail;
      } else if (Array.isArray(body.detail)) {
        detail = body.detail
          .map((d) =>
            d && typeof d === 'object' && 'msg' in d
              ? String((d as { msg: unknown }).msg)
              : String(d),
          )
          .join('; ');
      }
    } catch {
      // Тело не JSON — остаётся код ответа, и это лучше, чем исключение
      // разбора поверх исходной ошибки.
    }
    // Сессию сервер больше не признаёт — интерфейс не должен дальше считать
    // пользователя вошедшим (см. handleUnauthorized).
    if (resp.status === 401 && withSession) handleUnauthorized();
    throw new ItArduinoApiError(resp.status, detail);
  }

  return (await resp.json()) as T;
}

/** Запрос от имени пользователя. Гость до сети не доходит. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!isAuthenticated()) {
    // Не сетевой сбой, а состояние: гость сюда просто не должен попадать.
    // Интерфейс обязан прятать облачное сохранение, пока входа нет.
    throw new ItArduinoApiError(401, 'Вы не вошли в аккаунт it-arduino.ru');
  }
  return send<T>(path, init, true);
}

/**
 * Опубликованная схема для режима «только просмотр».
 *
 * Единственный вызов без токена. Отдельный маршрут на сервере
 * (`/public/circuits/{id}`), а не `/circuits/{id}` без заголовка: там
 * авторизация обязательна, и «без авторизации» видно прямо в адресе.
 *
 * Cookie не прикладывается даже когда сессия есть. Ответ от этого не
 * меняется, а посланная без нужды cookie — лишний повод её засветить.
 */
export function getPublicCircuit(id: number): Promise<CircuitFull> {
  return send<CircuitFull>(`/public/circuits/${id}`, {}, false);
}

/**
 * Пользователь сайта, каким его отдаёт `GET /users/me`.
 *
 * Объявлены только поля, которые симулятору действительно нужны. Ответ
 * содержит больше — почту, дату регистрации, аватар; не объявляем их, чтобы
 * не было соблазна показать в интерфейсе то, за чем сюда не ходили.
 */
export interface SiteUser {
  id: number;
  username: string;
  /** `'user'` либо `'admin'` — колонка role в модели пользователя сайта. */
  role: string;
}

/** Текущий пользователь. Симулятору нужен ради одного поля — role. */
export function getMe(): Promise<SiteUser> {
  return request<SiteUser>('/users/me');
}

export function listCircuits(): Promise<CircuitListResponse> {
  return request<CircuitListResponse>('/circuits');
}

export function getCircuit(id: number): Promise<CircuitFull> {
  return request<CircuitFull>(`/circuits/${id}`);
}

export function createCircuit(input: {
  title: string;
  data: VlxPayload;
  is_public?: boolean;
  project_id?: number | null;
}): Promise<CircuitFull> {
  return request<CircuitFull>('/circuits', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Частичное обновление: передаются только изменённые поля.
 *
 * Переименование не тащит содержимое обратно на сервер — при мегабайтной
 * схеме это заметная разница.
 */
export function updateCircuit(
  id: number,
  patch: {
    title?: string;
    data?: VlxPayload;
    is_public?: boolean;
    project_id?: number | null;
  },
): Promise<CircuitFull> {
  return request<CircuitFull>(`/circuits/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export function deleteCircuit(id: number): Promise<void> {
  return request<void>(`/circuits/${id}`, { method: 'DELETE' });
}
