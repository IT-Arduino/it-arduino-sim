/**
 * @vitest-environment jsdom
 *
 * Расширение файлов схем.
 *
 * Схемы сохраняются как `.itarduino`, а открываются и `.itarduino`, и `.vlx`:
 * файлы, сохранённые до переименования, и примеры апстрима никуда не делись,
 * а формат внутри не менялся — поменялось только имя.
 *
 * Тест нужен именно здесь, потому что расширение задаётся литералами в
 * АПСТРИМНЫХ файлах (`utils/vlxFile.ts`, `utils/importProject.ts`). Обновление
 * с апстрима вернёт их обратно молча, без единой ошибки сборки, и заметить
 * это можно будет только по жалобе человека, у которого схема сохранилась
 * не тем именем.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_FILE_ACCEPT } from '../utils/importProject';
import { triggerDownloadVlx } from '../utils/vlxFile';

vi.mock('../store/useSimulatorStore', () => ({
  useSimulatorStore: {
    getState: () => ({
      components: [],
      wires: [],
      boards: [],
      activeBoardId: null,
    }),
  },
}));

vi.mock('../store/useEditorStore', () => ({
  useEditorStore: {
    getState: () => ({ files: [], folders: [] }),
  },
}));

describe('расширение файла схемы', () => {
  beforeEach(() => {
    // Скачивание идёт через созданную на лету ссылку. Настоящего скачивания
    // в узле нет, поэтому подменяются ровно те две вещи, которых там не
    // существует, — адрес объекта и клик по ссылке.
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('сохраняет схему с расширением .itarduino', () => {
    const filename = triggerDownloadVlx({ name: 'project' });

    expect(filename).toBe('project.itarduino');
  });

  it('безымянной схеме даёт нейтральное имя, а не чужое', () => {
    const filename = triggerDownloadVlx({});

    // Не «velxio-project»: имя чужого проекта с нашим расширением выглядело
    // бы недоразумением.
    expect(filename).toBe('shema.itarduino');
  });

  it('принимает при открытии и новое расширение, и прежнее', () => {
    // Прежние файлы у людей на руках, а примеры апстрима лежат в .vlx:
    // перестать их открывать значило бы сломать работу без причины.
    expect(PROJECT_FILE_ACCEPT).toContain('.itarduino');
    expect(PROJECT_FILE_ACCEPT).toContain('.vlx');
  });
});
