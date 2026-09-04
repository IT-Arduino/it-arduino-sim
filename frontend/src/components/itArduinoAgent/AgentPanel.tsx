/**
 * Панель агента: запрос, ход работы, остановка и откат.
 *
 * Откат считает не длину истории редактора, а число реально совершённых
 * агентом отменяемых действий за прогон. Длина для этого не годится по двум
 * причинам: (1) до первого прогона и сразу после отката она никак не связана
 * с тем, что сделал агент — «текущая длина минус запомненная» дала бы
 * случайное число вместо нуля, и кнопка отката была бы то доступна не к
 * месту, то съедала бы лишнее; (2) история — кольцевой буфер на HISTORY_MAX
 * записей (useSimulatorStore.ts): при переполнении старые записи
 * вытесняются, длина перестаёт расти, и разница «после минус до» молча
 * уходит в ноль даже когда агент реально что-то поставил на холст.
 */
import { useRef, useState } from 'react';

import { runAgent, type AgentEvent } from '../../lib/itArduinoAgent/agentLoop';
import { useSimulatorStore } from '../../store/useSimulatorStore';

/**
 * Инструменты, которые пишут в историю отмены холста (toolRegistry.ts —
 * add_component, move_component, set_component_property, remove_component,
 * add_wire, remove_wire, все через record*-обёртки стора). Чтение холста и
 * каталога, скетч, сборка, запуск и остановка историю не трогают и в счётчик
 * отката не идут.
 */
const CANVAS_MUTATING_TOOLS = new Set([
  'add_component',
  'move_component',
  'set_component_property',
  'remove_component',
  'add_wire',
  'remove_wire',
]);

export function AgentPanel() {
  const [text, setText] = useState('');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  // Сколько отменяемых действий агент реально совершил в текущем прогоне.
  // Состояние, а не ref: от него зависит disabled кнопки отката, а правка
  // ref сама по себе перерисовку не вызывает.
  const [agentSteps, setAgentSteps] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const handleEvent = (event: AgentEvent) => {
    setEvents((prev) => [...prev, event]);
    // Считаем только успешные вызовы: неудачный инструмент холст не менял,
    // undo() ему соответствовать не будет.
    if (event.kind === 'tool' && event.ok && CANVAS_MUTATING_TOOLS.has(event.name)) {
      setAgentSteps((prev) => prev + 1);
    }
  };

  const send = async () => {
    const request = text.trim();
    if (!request || running) return;

    // Каждый новый прогон считает заново: то, что не откатили после
    // прошлого раза, уже осталось на холсте безвозвратно.
    setAgentSteps(0);
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setEvents([]);
    setText('');

    await runAgent(request, handleEvent, controller.signal);
    setRunning(false);
  };

  const rollback = () => {
    // Не больше, чем реально лежит в истории: кольцевой буфер мог вытеснить
    // часть (или все) записи агента, и откат не должен дотягиваться до
    // правок, сделанных человеком раньше.
    const steps = Math.min(agentSteps, useSimulatorStore.getState().history.length);
    for (let i = 0; i < steps; i += 1) {
      useSimulatorStore.getState().undo();
    }
    setAgentSteps(0);
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
        <button type="button" onClick={rollback} disabled={running || agentSteps === 0}>
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
