/**
 * Панель агента: запрос, ход работы, остановка и откат.
 *
 * Откат считает длину истории до прогона и отменяет ровно столько шагов,
 * сколько агент добавил. Это надёжнее, чем помечать команды: история — стек,
 * и лишние отмены задели бы работу человека.
 */
import { useRef, useState } from 'react';

import { runAgent, type AgentEvent } from '../../lib/itArduinoAgent/agentLoop';
import { useSimulatorStore } from '../../store/useSimulatorStore';

export function AgentPanel() {
  const [text, setText] = useState('');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const historyBeforeRun = useRef<number>(0);

  const send = async () => {
    const request = text.trim();
    if (!request || running) return;

    historyBeforeRun.current = useSimulatorStore.getState().history.length;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setEvents([]);
    setText('');

    await runAgent(request, (event) => setEvents((prev) => [...prev, event]), controller.signal);
    setRunning(false);
  };

  const rollback = () => {
    const steps = useSimulatorStore.getState().history.length - historyBeforeRun.current;
    for (let i = 0; i < steps; i += 1) {
      useSimulatorStore.getState().undo();
    }
  };

  return (
    <div className="it-agent-panel">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Что собрать? Например: мигающий светодиод на пине 9"
      />
      <div className="it-agent-actions">
        <button type="button" onClick={send} disabled={running}>
          Отправить
        </button>
        <button type="button" onClick={() => abortRef.current?.abort()} disabled={!running}>
          Стоп
        </button>
        <button type="button" onClick={rollback} disabled={running}>
          Откатить прогон
        </button>
      </div>
      <ul className="it-agent-log">
        {events.map((event, index) => (
          <li key={index}>
            {event.kind === 'text' && event.text}
            {event.kind === 'tool' && `${event.name}: ${event.ok ? 'готово' : 'не вышло'}`}
            {event.kind === 'done' && 'Агент закончил'}
            {event.kind === 'error' && event.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
