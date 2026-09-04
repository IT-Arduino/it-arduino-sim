/**
 * ItArduinoAdminOnly.tsx — страж маршрута для страниц, открытых только
 * администратору сайта.
 *
 * Сейчас такая страница одна: галерея «Избранные проекты». Симулятор нужен
 * как инструмент, витрина чужих примеров — нет; но заглянуть в неё изнутри
 * бывает полезно, поэтому она не удалена, а закрыта.
 *
 * Что важно понимать: это НЕ защита. Данные примеров лежат в бандле, их
 * видит любой, кто откроет вкладку разработчика. Страж убирает страницу из
 * навигации и из выдачи поисковиков — не более. Если однажды понадобится
 * настоящий запрет, его место на сервере.
 *
 * Отдельные страницы примеров (`/examples/:exampleId`) намеренно остаются
 * открытыми: на них ведут ссылки «Примеры проектов» из окна детали в
 * редакторе, и, закрыв их, мы сломали бы эти ссылки обычному пользователю.
 */

import React from 'react';
import { useSyncExternalStore } from 'react';
import { Navigate } from 'react-router-dom';
import { subscribeRole, getRoleState, refreshRole } from '../lib/itArduinoRole';
import { subscribeAuth, getAuthState } from '../lib/itArduinoAuth';

/** Роль текущего пользователя, с флагом «ещё выясняем». */
export function useRole(): { isAdmin: boolean; pending: boolean } {
  const role = useSyncExternalStore(subscribeRole, getRoleState, getRoleState);
  const auth = useSyncExternalStore(subscribeAuth, getAuthState, getAuthState);

  // Первый заход: токен уже мог быть положен при загрузке страницы, а
  // подписка внутри itArduinoRole сработает только на СЛЕДУЮЩЕЕ изменение
  // входа — значит про роль надо спросить самим.
  React.useEffect(() => {
    if (auth.authenticated && role.role === 'guest' && !role.pending) void refreshRole();
  }, [auth.authenticated, role.role, role.pending]);

  return {
    isAdmin: role.role === 'admin',
    // Пока идёт проверка входа или запрос роли, ответа ещё нет. Отрисовать в
    // этот момент «не админ» значит мигнуть отказом человеку, у которого
    // доступ есть.
    pending: auth.pending || role.pending || (auth.authenticated && role.role === 'guest'),
  };
}

/** Короткая форма для мест, где ожидание неважно (ссылка в меню). */
export function useIsAdmin(): boolean {
  return useRole().isAdmin;
}

export const ItArduinoAdminOnly: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAdmin, pending } = useRole();

  // Ничего, а не «загрузка»: ожидание тут доли секунды, и заглушка успела
  // бы мигнуть на пустом месте.
  if (pending) return null;
  if (!isAdmin) return <Navigate to="/editor" replace />;
  return children;
};
