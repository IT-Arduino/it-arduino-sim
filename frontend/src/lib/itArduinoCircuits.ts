/**
 * Схемы в облаке it-arduino.ru — какая открыта и что с ней можно делать.
 *
 * Слой между диалогами («Сохранить в проект», «Мои схемы») и HTTP-клиентом
 * itArduinoApi. Здесь же живёт единственное состояние, которое переживает
 * закрытие диалога: какая облачная схема сейчас открыта. Оно нужно, чтобы
 * повторное «Сохранить» обновляло ту же запись, а не плодило копии.
 *
 * Состояние модульное, а не в zustand-сторе, намеренно: сторы принадлежат
 * апстриму, а новое поле в чужом сторе — это правка чужого файла и вечный
 * конфликт при слиянии. Модульный подписчик — тот же приём, что у самого
 * апстрима в proSaveAction и newsSource.
 *
 * Формат .vlx не трогаем ни на запись, ни на чтение: сохраняем ровно то, что
 * вернул buildVlxPayload(), а загружаем через штатный importVlxFile(). Второе
 * важнее, чем кажется, — importVlxFile перед загрузкой рвёт связь с текущим
 * проектом (clearCurrentProject), иначе автосохранение приняло бы чужую схему
 * за правки открытого проекта и переписало бы его.
 */

import { buildVlxPayload, importVlxFile } from '../utils/vlxFile';
import {
  createCircuit,
  deleteCircuit as apiDeleteCircuit,
  getCircuit,
  getPublicCircuit,
  updateCircuit,
  type CircuitFull,
} from './itArduinoApi';

/** Облачная схема, открытая в редакторе сейчас. */
export interface OpenCircuit {
  id: number;
  title: string;
}

let _open: OpenCircuit | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeOpenCircuit(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Снимок для useSyncExternalStore. Ссылка меняется только при реальном
 * изменении — иначе React уходит в бесконечную перерисовку.
 */
export function getOpenCircuit(): OpenCircuit | null {
  return _open;
}

function setOpen(next: OpenCircuit | null): void {
  _open = next;
  emit();
}

/**
 * Забыть, что открыта облачная схема.
 *
 * Вызывается при выходе из аккаунта и после удаления открытой схемы: держать
 * идентификатор записи, к которой больше нет доступа, значит однажды получить
 * 404 в ответ на обычное «Сохранить».
 */
export function forgetOpenCircuit(): void {
  setOpen(null);
}

/**
 * Сохранить текущее содержимое редактора.
 *
 * id задан — обновляем эту схему, иначе создаём новую. Возвращённая запись
 * становится открытой: следующее «Сохранить» пойдёт в неё же.
 */
export async function saveCircuit(opts: {
  id?: number | null;
  title: string;
}): Promise<OpenCircuit> {
  const title = opts.title.trim();
  const data = buildVlxPayload({ name: title });

  const saved =
    opts.id != null
      ? await updateCircuit(opts.id, { title, data })
      : await createCircuit({ title, data });

  const open: OpenCircuit = { id: saved.id, title: saved.title };
  setOpen(open);
  return open;
}

/**
 * Положить содержимое схемы в редактор.
 *
 * importVlxFile принимает File — заворачиваем JSON обратно в файл вместо
 * того, чтобы дублировать разбор и загрузку в сторы. Один путь кода для
 * файла с диска, своей схемы из облака и чужой публичной: то, что работает
 * для файла схемы, работает и здесь, и чинится в одном месте.
 *
 * Имя файла синтетическое, человеку оно не показывается, — но расширение
 * держим то же, что у сохраняемых схем: иначе следующий читатель решит, что
 * облачные схемы живут в каком-то другом формате.
 */
async function loadIntoEditor(circuit: CircuitFull): Promise<void> {
  const file = new File([JSON.stringify(circuit.data)], `${circuit.id}.itarduino`, {
    type: 'application/json',
  });
  await importVlxFile(file);
}

/** Загрузить свою схему из облака в редактор, заменив рабочую область. */
export async function loadCircuitIntoEditor(id: number): Promise<OpenCircuit> {
  const circuit = await getCircuit(id);
  await loadIntoEditor(circuit);

  const open: OpenCircuit = { id: circuit.id, title: circuit.title };
  setOpen(open);
  return open;
}

/**
 * Загрузить чужую опубликованную схему — режим «только просмотр».
 *
 * Открытой схемой она НЕ становится: `setOpen` здесь не вызывается
 * намеренно. Открытая схема — это то, во что пойдёт следующее «Сохранить», а
 * писать в чужую запись нельзя. Сохранение из режима просмотра всегда создаёт
 * новую схему в своём аккаунте.
 *
 * Режим просмотра включает вызывающая сторона (PublicCircuitPage), уже после
 * загрузки: включи мы его раньше, заглушка на `loadProjectState` сняла бы
 * режим ровно в момент загрузки.
 */
export async function loadPublicCircuitIntoEditor(id: number): Promise<CircuitFull> {
  const circuit = await getPublicCircuit(id);
  await loadIntoEditor(circuit);
  forgetOpenCircuit();
  return circuit;
}

/**
 * Опубликовать схему или снять публикацию.
 *
 * Опубликованную видит любой по ссылке `/circuit/<id>`, в том числе без входа
 * на сайт, и только в режиме просмотра. Снятие публикации закрывает доступ
 * сразу: условие `is_public` стоит в самом запросе к базе на сервере.
 *
 * Содержимое не пересылается — уходит одно поле.
 */
export async function setCircuitPublic(id: number, isPublic: boolean): Promise<void> {
  await updateCircuit(id, { is_public: isPublic });
}

/** Ссылка на просмотр опубликованной схемы. */
export function publicCircuitUrl(id: number): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/circuit/${id}`;
}

/** Переименовать. Содержимое не пересылается — только заголовок. */
export async function renameCircuit(id: number, title: string): Promise<void> {
  const saved = await updateCircuit(id, { title: title.trim() });
  if (_open?.id === id) setOpen({ id, title: saved.title });
}

/** Удалить схему. Если она была открыта — редактор просто теряет с ней связь. */
export async function removeCircuit(id: number): Promise<void> {
  await apiDeleteCircuit(id);
  if (_open?.id === id) setOpen(null);
}
