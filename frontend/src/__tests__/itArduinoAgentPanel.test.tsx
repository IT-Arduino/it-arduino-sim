// @vitest-environment jsdom
/**
 * Панель агента.
 *
 * Проверяется то, что защищает чужую работу: кнопка отката возвращает холст
 * к состоянию до прогона, и пустой запрос не запускает цикл.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const runAgent = vi.fn();
vi.mock('../lib/itArduinoAgent/agentLoop', () => ({
  runAgent: (...args: unknown[]) => runAgent(...args),
}));

import { useSimulatorStore } from '../store/useSimulatorStore';
import { AgentPanel } from '../components/itArduinoAgent/AgentPanel';

const led = (id: string) => ({ id, metadataId: 'led', x: 0, y: 0, properties: {} });

describe('панель', () => {
  // История вызовов vi.fn() не сбрасывается между it() сама по себе — иначе
  // второй тест видел бы вызов, оставшийся от первого, и всегда падал.
  beforeEach(() => {
    runAgent.mockClear();
    // История холста — модульный стор, между it() она не сбрасывается сама.
    // Тесты про рубеж истории считают позицию указателя, поэтому начинают с
    // пустой истории, а не с хвоста предыдущего теста.
    const store = useSimulatorStore.getState();
    store.setComponents([]);
    store.setWires([]);
    store.clearHistory();
  });

  /** Запустить прогон и дождаться, пока кнопка отката станет доступной. */
  const rollbackButton = () =>
    screen.getByRole('button', { name: /откатить/i }) as HTMLButtonElement;

  it('откат возвращает холст к состоянию до прогона', async () => {
    const store = useSimulatorStore.getState();
    store.setComponents([]);
    store.setWires([]);
    store.recordAddComponent(led('было'));

    // Мок теперь ещё и шлёт события успешных инструментов — счётчик отката
    // считает их, а не длину истории (см. AgentPanel.tsx).
    runAgent.mockImplementation(async (_userText: string, onEvent: (e: unknown) => void) => {
      useSimulatorStore.getState().recordAddComponent(led('от-агента-1'));
      onEvent({ kind: 'tool', name: 'add_component', ok: true });
      useSimulatorStore.getState().recordAddComponent(led('от-агента-2'));
      onEvent({ kind: 'tool', name: 'add_component', ok: true });
    });

    render(<AgentPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/что собрать/i), {
      target: { value: 'собери светодиод' },
    });
    fireEvent.click(screen.getByRole('button', { name: /отправить/i }));
    // Мок runAgent пишет в стор синхронно, поэтому холст обновляется раньше,
    // чем React успевает снять running и разблокировать «Откатить прогон» —
    // ждём оба условия, иначе клик по ещё disabled-кнопке ничего не делает.
    await vi.waitFor(() => {
      expect(useSimulatorStore.getState().components).toHaveLength(3);
      expect(rollbackButton().disabled).toBe(false);
    });

    fireEvent.click(rollbackButton());

    const ids = useSimulatorStore.getState().components.map((c) => c.id);
    expect(ids).toEqual(['было']);
  });

  it('штатная отмена между прогоном и откатом не съедает правку человека', async () => {
    // Самый дорогой случай: откат по счётчику «сколько сделал агент» снимает
    // ПОСЛЕДНЮЮ запись общей истории, чья бы она ни была. Человек нажал
    // штатную отмену — счётчик агента от этого не уменьшился, а указатель
    // истории уехал назад, и следующий «Откатить прогон» дотягивался до
    // детали человека.
    const store = useSimulatorStore.getState();
    store.recordAddComponent(led('человек'));

    runAgent.mockImplementation(async (_userText: string, onEvent: (e: unknown) => void) => {
      useSimulatorStore.getState().recordAddComponent(led('от-агента'));
      onEvent({ kind: 'tool', name: 'add_component', ok: true });
    });

    render(<AgentPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/что собрать/i), {
      target: { value: 'собери светодиод' },
    });
    fireEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await vi.waitFor(() => {
      expect(useSimulatorStore.getState().components).toHaveLength(2);
      expect(rollbackButton().disabled).toBe(false);
    });

    // Человек сам отменил работу агента штатной кнопкой отмены.
    useSimulatorStore.getState().undo();
    expect(useSimulatorStore.getState().components.map((c) => c.id)).toEqual(['человек']);

    fireEvent.click(rollbackButton());

    expect(useSimulatorStore.getState().components.map((c) => c.id)).toEqual(['человек']);
  });

  it('правка человека во время прогона откатом не снимается', async () => {
    // Пока агент ходил к модели, человек поставил свою деталь. Она попала в
    // ту же историю, но в счёт агента не идёт — и откат до неё не доходит.
    runAgent.mockImplementation(async (_userText: string, onEvent: (e: unknown) => void) => {
      useSimulatorStore.getState().recordAddComponent(led('человек-во-время-прогона'));
      useSimulatorStore.getState().recordAddComponent(led('от-агента'));
      onEvent({ kind: 'tool', name: 'add_component', ok: true });
    });

    render(<AgentPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/что собрать/i), {
      target: { value: 'собери светодиод' },
    });
    fireEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await vi.waitFor(() => {
      expect(useSimulatorStore.getState().components).toHaveLength(2);
      expect(rollbackButton().disabled).toBe(false);
    });

    fireEvent.click(rollbackButton());

    expect(useSimulatorStore.getState().components.map((c) => c.id)).toEqual([
      'человек-во-время-прогона',
    ]);
  });

  it('панель закрывается своей кнопкой', () => {
    // Открывается панель командой меню, а закрыть её было нечем.
    const onClose = vi.fn();
    render(<AgentPanel onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /закрыть/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('пустой запрос не запускает прогон', () => {
    render(<AgentPanel onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /отправить/i }));

    expect(runAgent).not.toHaveBeenCalled();
  });

  it('до первого прогона кнопка отката недоступна', () => {
    render(<AgentPanel onClose={() => {}} />);

    expect(rollbackButton().disabled).toBe(true);
  });

  it('после отката повторный клик ничего больше не отменяет', async () => {
    const store = useSimulatorStore.getState();
    store.setComponents([]);
    store.setWires([]);
    store.recordAddComponent(led('было'));

    runAgent.mockImplementation(async (_userText: string, onEvent: (e: unknown) => void) => {
      useSimulatorStore.getState().recordAddComponent(led('от-агента-1'));
      onEvent({ kind: 'tool', name: 'add_component', ok: true });
      useSimulatorStore.getState().recordAddComponent(led('от-агента-2'));
      onEvent({ kind: 'tool', name: 'add_component', ok: true });
    });

    render(<AgentPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/что собрать/i), {
      target: { value: 'собери светодиод' },
    });
    fireEvent.click(screen.getByRole('button', { name: /отправить/i }));

    await vi.waitFor(() => {
      expect(useSimulatorStore.getState().components).toHaveLength(3);
      expect(rollbackButton().disabled).toBe(false);
    });

    fireEvent.click(rollbackButton());
    expect(useSimulatorStore.getState().components.map((c) => c.id)).toEqual(['было']);

    // Счётчик агентских шагов после отката обнулён, кнопка снова недоступна:
    // повторный клик (случайный или по клавише) не должен ничего отменять.
    expect(rollbackButton().disabled).toBe(true);
    fireEvent.click(rollbackButton());
    expect(useSimulatorStore.getState().components.map((c) => c.id)).toEqual(['было']);
  });

  it('неудачный инструмент не идёт в счётчик отката', async () => {
    const store = useSimulatorStore.getState();
    store.setComponents([]);
    store.setWires([]);
    store.recordAddComponent(led('было'));

    // Единственное событие прогона — провалившийся инструмент. Стор он не
    // трогает (как настоящий runTool при ошибке), поэтому если бы неудача
    // всё равно шла в счётчик, кнопка отката ошибочно стала бы доступна.
    runAgent.mockImplementation(async (_userText: string, onEvent: (e: unknown) => void) => {
      onEvent({ kind: 'tool', name: 'add_component', ok: false });
    });

    render(<AgentPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/что собрать/i), {
      target: { value: 'собери светодиод' },
    });
    fireEvent.click(screen.getByRole('button', { name: /отправить/i }));

    const sendButton = () =>
      screen.getByRole('button', { name: /отправить/i }) as HTMLButtonElement;
    // Ждём конца прогона (кнопка «Отправить» снова доступна), а не длину
    // истории — стор в этом сценарии вообще не меняется.
    await vi.waitFor(() => {
      expect(sendButton().disabled).toBe(false);
    });

    expect(rollbackButton().disabled).toBe(true);
    expect(useSimulatorStore.getState().components.map((c) => c.id)).toEqual(['было']);
  });
});
