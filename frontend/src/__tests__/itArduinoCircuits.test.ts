/**
 * Тесты работы с облачными схемами (src/lib/itArduinoCircuits).
 *
 * Модуль стоит между окнами и HTTP-клиентом и отвечает за то, что при ошибке
 * стоит дороже всего — за чужую работу:
 *
 *   - повторное «Сохранить» должно обновлять ту же запись. Если бы оно
 *     создавало новую, десять нажатий дали бы десять схем и упёрлись бы в
 *     предел на ровном месте;
 *   - переименование не пересылает содержимое. Отправлять мегабайт ради
 *     смены заголовка — заметная разница, а перепутанный вызов вдобавок мог
 *     бы записать поверх схемы то, что сейчас в редакторе;
 *   - загрузка идёт через штатный importVlxFile апстрима. Он перед записью в
 *     сторы рвёт связь с текущим проектом; в обход него автосохранение
 *     приняло бы чужую схему за правки открытого проекта и переписало бы его;
 *   - после удаления открытой схемы её номер надо забыть, иначе следующее
 *     «Сохранить» уйдёт в несуществующую запись.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  createCircuit: vi.fn(),
  updateCircuit: vi.fn(),
  getCircuit: vi.fn(),
  deleteCircuit: vi.fn(),
}));

const vlx = vi.hoisted(() => ({
  buildVlxPayload: vi.fn(),
  importVlxFile: vi.fn(),
}));

vi.mock('../lib/itArduinoApi', () => api);
vi.mock('../utils/vlxFile', () => vlx);

import {
  forgetOpenCircuit,
  getOpenCircuit,
  loadCircuitIntoEditor,
  removeCircuit,
  renameCircuit,
  saveCircuit,
  subscribeOpenCircuit,
} from '../lib/itArduinoCircuits';

const PAYLOAD = {
  format: 'velxio-project',
  version: 1,
  exportedAt: '2026-08-28T12:00:00.000Z',
  boards: [],
  fileGroups: {},
  components: [],
  wires: [],
  activeBoardId: null,
};

/** Запись, какой её возвращает сервер. */
function record(id: number, title: string) {
  return {
    id,
    title,
    is_public: false,
    project_id: null,
    created_at: '2026-08-28T12:00:00',
    updated_at: '2026-08-28T12:00:00',
    data: PAYLOAD,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetOpenCircuit();
  vlx.buildVlxPayload.mockReturnValue(PAYLOAD);
});

describe('saveCircuit', () => {
  it('без номера создаёт новую схему и запоминает её', async () => {
    api.createCircuit.mockResolvedValue(record(7, 'Мигающий светодиод'));

    const open = await saveCircuit({ title: 'Мигающий светодиод' });

    expect(api.createCircuit).toHaveBeenCalledWith({
      title: 'Мигающий светодиод',
      data: PAYLOAD,
    });
    expect(api.updateCircuit).not.toHaveBeenCalled();
    expect(open).toEqual({ id: 7, title: 'Мигающий светодиод' });
    expect(getOpenCircuit()).toEqual({ id: 7, title: 'Мигающий светодиод' });
  });

  it('с номером обновляет ту же запись, а не плодит копии', async () => {
    api.updateCircuit.mockResolvedValue(record(7, 'Светофор'));

    await saveCircuit({ id: 7, title: 'Светофор' });

    expect(api.updateCircuit).toHaveBeenCalledWith(7, { title: 'Светофор', data: PAYLOAD });
    expect(api.createCircuit).not.toHaveBeenCalled();
  });

  it('отдаёт серверу ровно то, что вернул buildVlxPayload', async () => {
    api.createCircuit.mockResolvedValue(record(1, 'Схема'));

    await saveCircuit({ title: 'Схема' });

    // Не копия и не «улучшенная» версия: формат .vlx принадлежит апстриму,
    // и любая правка по дороге ломает совместимость с файлами и примерами.
    expect(api.createCircuit.mock.calls[0][0].data).toBe(PAYLOAD);
  });

  it('обрезает пробелы в названии', async () => {
    api.createCircuit.mockResolvedValue(record(1, 'Схема'));

    await saveCircuit({ title: '   Схема   ' });

    expect(api.createCircuit.mock.calls[0][0].title).toBe('Схема');
    expect(vlx.buildVlxPayload).toHaveBeenCalledWith({ name: 'Схема' });
  });

  it('берёт название из ответа сервера, а не из запроса', async () => {
    // Сервер вправе подрезать длинный заголовок; в списке и в редакторе
    // должно стоять то, что там на самом деле сохранено.
    api.createCircuit.mockResolvedValue(record(3, 'Как записал сервер'));

    const open = await saveCircuit({ title: 'Как ввёл пользователь' });

    expect(open.title).toBe('Как записал сервер');
  });

  it('при ошибке сервера не запоминает схему как открытую', async () => {
    api.createCircuit.mockRejectedValue(new Error('Достигнут предел в 100 схем'));

    await expect(saveCircuit({ title: 'Сто первая' })).rejects.toThrow();
    expect(getOpenCircuit()).toBeNull();
  });
});

describe('loadCircuitIntoEditor', () => {
  it('грузит содержимое штатным importVlxFile апстрима', async () => {
    api.getCircuit.mockResolvedValue(record(7, 'Мигающий светодиод'));
    vlx.importVlxFile.mockResolvedValue(PAYLOAD);

    const open = await loadCircuitIntoEditor(7);

    expect(api.getCircuit).toHaveBeenCalledWith(7);
    expect(vlx.importVlxFile).toHaveBeenCalledTimes(1);

    // Содержимое доезжает без изменений: файл собирается из того же JSON.
    const file = vlx.importVlxFile.mock.calls[0][0] as File;
    expect(JSON.parse(await file.text())).toEqual(PAYLOAD);

    expect(open).toEqual({ id: 7, title: 'Мигающий светодиод' });
    expect(getOpenCircuit()).toEqual({ id: 7, title: 'Мигающий светодиод' });
  });

  it('не запоминает схему открытой, если содержимое не разобралось', async () => {
    api.getCircuit.mockResolvedValue(record(7, 'Битая'));
    vlx.importVlxFile.mockRejectedValue(new Error('Invalid JSON'));

    await expect(loadCircuitIntoEditor(7)).rejects.toThrow();
    expect(getOpenCircuit()).toBeNull();
  });
});

describe('renameCircuit', () => {
  it('пересылает только заголовок, без содержимого', async () => {
    api.updateCircuit.mockResolvedValue(record(7, 'Новое имя'));

    await renameCircuit(7, '  Новое имя  ');

    expect(api.updateCircuit).toHaveBeenCalledWith(7, { title: 'Новое имя' });
    expect(api.updateCircuit.mock.calls[0][1]).not.toHaveProperty('data');
  });

  it('обновляет название открытой схемы', async () => {
    api.createCircuit.mockResolvedValue(record(7, 'Было'));
    await saveCircuit({ title: 'Было' });

    api.updateCircuit.mockResolvedValue(record(7, 'Стало'));
    await renameCircuit(7, 'Стало');

    expect(getOpenCircuit()).toEqual({ id: 7, title: 'Стало' });
  });

  it('не трогает открытую схему при переименовании другой', async () => {
    api.createCircuit.mockResolvedValue(record(7, 'Открытая'));
    await saveCircuit({ title: 'Открытая' });

    api.updateCircuit.mockResolvedValue(record(9, 'Другая'));
    await renameCircuit(9, 'Другая');

    expect(getOpenCircuit()).toEqual({ id: 7, title: 'Открытая' });
  });
});

describe('removeCircuit', () => {
  it('забывает открытую схему после её удаления', async () => {
    api.createCircuit.mockResolvedValue(record(7, 'Ненужная'));
    await saveCircuit({ title: 'Ненужная' });
    api.deleteCircuit.mockResolvedValue(undefined);

    await removeCircuit(7);

    // Иначе следующее «Сохранить» ушло бы в несуществующую запись и вернуло 404.
    expect(getOpenCircuit()).toBeNull();
  });

  it('оставляет открытую схему при удалении другой', async () => {
    api.createCircuit.mockResolvedValue(record(7, 'Открытая'));
    await saveCircuit({ title: 'Открытая' });
    api.deleteCircuit.mockResolvedValue(undefined);

    await removeCircuit(9);

    expect(getOpenCircuit()).toEqual({ id: 7, title: 'Открытая' });
  });

  it('не забывает схему, если удаление не удалось', async () => {
    api.createCircuit.mockResolvedValue(record(7, 'Открытая'));
    await saveCircuit({ title: 'Открытая' });
    api.deleteCircuit.mockRejectedValue(new Error('Схема не найдена'));

    await expect(removeCircuit(7)).rejects.toThrow();
    expect(getOpenCircuit()).toEqual({ id: 7, title: 'Открытая' });
  });
});

describe('подписка', () => {
  it('сообщает подписчикам об изменении и отписывается', async () => {
    const seen: Array<{ id: number; title: string } | null> = [];
    const unsubscribe = subscribeOpenCircuit(() => seen.push(getOpenCircuit()));

    api.createCircuit.mockResolvedValue(record(7, 'Схема'));
    await saveCircuit({ title: 'Схема' });
    forgetOpenCircuit();

    expect(seen).toEqual([{ id: 7, title: 'Схема' }, null]);

    unsubscribe();
    forgetOpenCircuit();
    expect(seen).toHaveLength(2);
  });

  it('снимок не меняет ссылку без причины', async () => {
    // useSyncExternalStore сравнивает снимок по ссылке: новый объект на
    // каждый вызов увёл бы React в бесконечную перерисовку.
    api.createCircuit.mockResolvedValue(record(7, 'Схема'));
    await saveCircuit({ title: 'Схема' });

    expect(getOpenCircuit()).toBe(getOpenCircuit());
  });
});
