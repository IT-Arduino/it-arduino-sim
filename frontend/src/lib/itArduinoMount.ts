/**
 * Врезка форка в редактор — единственное место, где наш код встречается с
 * апстримовским.
 *
 * Всё подключение идёт через швы, которые апстрим сделал сам:
 *
 *   - installSaveActionImpl (proSaveAction.ts) — подменяет действие кнопки
 *     «Сохранить». Ставим реализацию ТОЛЬКО у вошедших. У гостя реализации
 *     нет, и апстримовское поведение по умолчанию работает как работало:
 *     скачивание .vlx. Так требование «облачное сохранение только у
 *     авторизованных, файл — всегда» выполняется тем, что мы НЕ делаем.
 *
 *   - registerEditorCommand('account.myProjects') (editorCommands.ts) — пункт
 *     «Мои схемы». Апстрим держит его в меню File и Account с флагом
 *     `optional: true`: без зарегистрированного обработчика строка не
 *     показывается вовсе. Регистрируем при входе, снимаем при выходе — меню
 *     перестраивается само, править EditorMenuBar не нужно.
 *
 * Отсюда же стартует слежение за входом (itArduinoAuth): один запрос к сайту
 * при загрузке и повтор при возврате в вкладку.
 *
 * Сам файл ничего не рендерит. Окна монтирует ItArduinoDialogs в EditorPage.
 */

import { createElement } from 'react';

import { installSaveActionImpl } from './proSaveAction';
import { registerEditorCommand } from './editorCommands';
import { registerProRoutes } from './proRoutes';
import { isAuthenticated, startItArduinoAuth, subscribeAuth } from './itArduinoAuth';
import { forgetOpenCircuit } from './itArduinoCircuits';
import { openMyCircuitsDialog } from '../components/layout/MyCircuitsDialog';
import { openSaveCircuitDialog } from '../components/layout/SaveCircuitDialog';
import { PublicCircuitPage } from '../pages/PublicCircuitPage';

/** Функция снятия регистрации «Мои схемы», пока пункт зарегистрирован. */
let unregisterMyCircuits: (() => void) | null = null;

/** Привести редактор в соответствие с текущим состоянием входа. */
function syncAuth(): void {
  if (isAuthenticated()) {
    installSaveActionImpl(openSaveCircuitDialog);
    if (!unregisterMyCircuits) {
      unregisterMyCircuits = registerEditorCommand('account.myProjects', openMyCircuitsDialog);
    }
    return;
  }

  // Выход. Возвращаем апстримовское сохранение в файл, убираем пункт меню и
  // забываем открытую схему: держать идентификатор записи, к которой больше
  // нет доступа, значит получить 404 в ответ на следующее «Сохранить».
  installSaveActionImpl(null);
  unregisterMyCircuits?.();
  unregisterMyCircuits = null;
  forgetOpenCircuit();
}

let _mounted = false;

/** Подключить форк к редактору. Идемпотентно. */
export function mountItArduino(): void {
  if (_mounted) return;
  _mounted = true;

  // Маршрут просмотра чужой опубликованной схемы. Реестр маршрутов —
  // третий шов апстрима (`lib/proRoutes.ts`): App.tsx подмешивает
  // зарегистрированные маршруты к своей таблице, так что таблицу править не
  // нужно. Реестр заменяет набор целиком, но в форке кроме нас в него никто
  // не пишет: платного оверлея нет, `@pro/index` — заглушка.
  //
  // Регистрация ДО подписки на вход и намеренно вне syncAuth: ссылку на
  // опубликованную схему открывают без входа на сайт.
  //
  // createElement вместо JSX, чтобы файл остался .ts: переименование в .tsx
  // поменяло бы путь импорта в main.tsx и в тестах.
  registerProRoutes([{ path: 'circuit/:circuitId', element: createElement(PublicCircuitPage) }]);

  // Подписка ДО старта: проверка входа уходит в сеть сразу, и подписаться
  // после неё значило бы прозевать ответ, а вместе с ним и вход.
  subscribeAuth(syncAuth);
  startItArduinoAuth();
  syncAuth();
}
