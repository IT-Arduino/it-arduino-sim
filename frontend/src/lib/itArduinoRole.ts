/**
 * itArduinoRole.ts — роль текущего пользователя сайта.
 *
 * Нужна ровно для одного: галерея «Избранные проекты» открыта только
 * администратору. Больше роли в симуляторе никто не спрашивает.
 *
 * Почему отдельный модуль, а не поле в `itArduinoAuth`: там один вопрос —
 * есть ли сессия, — а роль требует отдельного запроса и появляется позже.
 * Смешав их, пришлось бы каждому потребителю объяснять, почему
 * `authenticated === true`, но роль ещё неизвестна. Здесь это выражено
 * отдельным флагом `pending`.
 *
 * Роль НЕ кладётся в localStorage. Соблазн есть — избавляет от запроса при
 * каждой загрузке, — но тогда значение, решающее вопрос доступа, лежало бы
 * там, где пользователь его правит. Проверка на клиенте и так не защита:
 * это удобство навигации, а не запрет. Данные примеров лежат в бандле у
 * всех, и настоящий запрет, если он понадобится, ставится на сервере.
 */

import { getMe } from './itArduinoApi';
import { subscribeAuth, isAuthenticated } from './itArduinoAuth';

export type Role = 'admin' | 'user' | 'guest';

export interface RoleState {
  role: Role;
  /** Запрос в пути. Интерфейсу стоит подождать, а не рисовать «не админ». */
  pending: boolean;
}

const listeners = new Set<() => void>();

// Снимок пересоздаётся только при реальном изменении полей: useSyncExternalStore
// сравнивает по ссылке и уходит в бесконечную перерисовку, если возвращать
// новый объект на каждый вызов (тот же приём, что в itArduinoAuth).
let _snapshot: RoleState = { role: 'guest', pending: false };
let _inFlight: Promise<void> | null = null;

function set(role: Role, pending: boolean): void {
  if (role === _snapshot.role && pending === _snapshot.pending) return;
  _snapshot = { role, pending };
  for (const l of listeners) l();
}

export function subscribeRole(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getRoleState(): RoleState {
  return _snapshot;
}

export function isAdmin(): boolean {
  return _snapshot.role === 'admin';
}

/** Забыть роль. Вызывается при выходе и в тестах. */
export function resetRole(): void {
  _inFlight = null;
  set('guest', false);
}

/**
 * Спросить роль у сайта.
 *
 * Повторные вызовы во время запроса разделяют один промис: страж маршрута
 * и две ссылки в шапке монтируются одновременно, и без этого ушло бы три
 * одинаковых запроса.
 */
export function refreshRole(): Promise<void> {
  if (!isAuthenticated()) {
    resetRole();
    return Promise.resolve();
  }
  if (_inFlight) return _inFlight;

  set(_snapshot.role, true);
  _inFlight = getMe()
    .then((me) => {
      set(me.role === 'admin' ? 'admin' : 'user', false);
    })
    .catch(() => {
      // Сеть недоступна или сессия закрылась. Молча считаем обычным
      // пользователем: спрятанный пункт меню — не та беда, ради которой
      // стоит показывать человеку ошибку.
      set('user', false);
    })
    .finally(() => {
      _inFlight = null;
    });
  return _inFlight;
}

// Вход и выход меняют ответ на вопрос о роли: при входе спрашиваем заново,
// при выходе забываем. Подписка ставится один раз на модуль.
subscribeAuth(() => {
  if (isAuthenticated()) void refreshRole();
  else resetRole();
});
