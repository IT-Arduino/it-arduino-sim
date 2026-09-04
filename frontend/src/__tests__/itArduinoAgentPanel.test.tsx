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

    runAgent.mockImplementation(async () => {
      useSimulatorStore.getState().recordAddComponent(led('от-агента-1'));
      useSimulatorStore.getState().recordAddComponent(led('от-агента-2'));
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
});
