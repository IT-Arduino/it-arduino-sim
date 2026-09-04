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
  MAX_STEPS: 30,
}));

import { useSimulatorStore } from '../store/useSimulatorStore';
import { AgentPanel } from '../components/itArduinoAgent/AgentPanel';

const led = (id: string) => ({ id, metadataId: 'led', x: 0, y: 0, properties: {} });

describe('панель', () => {
  // История вызовов vi.fn() не сбрасывается между it() сама по себе — иначе
  // второй тест видел бы вызов, оставшийся от первого, и всегда падал.
  beforeEach(() => {
    runAgent.mockClear();
  });

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

    render(<AgentPanel />);
    fireEvent.change(screen.getByPlaceholderText(/что собрать/i), {
      target: { value: 'собери светодиод' },
    });
    fireEvent.click(screen.getByRole('button', { name: /отправить/i }));
    // Мок runAgent пишет в стор синхронно, поэтому холст обновляется раньше,
    // чем React успевает снять running и разблокировать «Откатить прогон» —
    // ждём оба условия, иначе клик по ещё disabled-кнопке ничего не делает.
    const rollbackButton = () =>
      screen.getByRole('button', { name: /откатить/i }) as HTMLButtonElement;
    await vi.waitFor(() => {
      expect(useSimulatorStore.getState().components).toHaveLength(3);
      expect(rollbackButton().disabled).toBe(false);
    });

    fireEvent.click(rollbackButton());

    const ids = useSimulatorStore.getState().components.map((c) => c.id);
    expect(ids).toEqual(['было']);
  });

  it('пустой запрос не запускает прогон', () => {
    render(<AgentPanel />);

    fireEvent.click(screen.getByRole('button', { name: /отправить/i }));

    expect(runAgent).not.toHaveBeenCalled();
  });

  it('до первого прогона кнопка отката недоступна', () => {
    render(<AgentPanel />);

    const rollbackButton = screen.getByRole('button', { name: /откатить/i }) as HTMLButtonElement;
    expect(rollbackButton.disabled).toBe(true);
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

    render(<AgentPanel />);
    fireEvent.change(screen.getByPlaceholderText(/что собрать/i), {
      target: { value: 'собери светодиод' },
    });
    fireEvent.click(screen.getByRole('button', { name: /отправить/i }));

    const rollbackButton = () =>
      screen.getByRole('button', { name: /откатить/i }) as HTMLButtonElement;
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

    render(<AgentPanel />);
    fireEvent.change(screen.getByPlaceholderText(/что собрать/i), {
      target: { value: 'собери светодиод' },
    });
    fireEvent.click(screen.getByRole('button', { name: /отправить/i }));

    const sendButton = () =>
      screen.getByRole('button', { name: /отправить/i }) as HTMLButtonElement;
    const rollbackButton = () =>
      screen.getByRole('button', { name: /откатить/i }) as HTMLButtonElement;
    // Ждём конца прогона (кнопка «Отправить» снова доступна), а не длину
    // истории — стор в этом сценарии вообще не меняется.
    await vi.waitFor(() => {
      expect(sendButton().disabled).toBe(false);
    });

    expect(rollbackButton().disabled).toBe(true);
    expect(useSimulatorStore.getState().components.map((c) => c.id)).toEqual(['было']);
  });
});
