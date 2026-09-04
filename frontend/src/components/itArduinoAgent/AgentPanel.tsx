/**
 * Панель агента: запрос, ход работы, остановка и откат.
 *
 * Откат держится на двух ограничениях сразу, и каждое закрывает свой случай.
 *
 * СКОЛЬКО отменять — счётчик успешных изменяющих действий агента. Длина
 * истории для этого не годится: (1) до первого прогона и сразу после отката
 * она никак не связана с тем, что сделал агент; (2) история — кольцевой
 * буфер на HISTORY_MAX записей (useSimulatorStore.ts), при переполнении
 * старые записи вытесняются, и разница «после минус до» молча уходит в ноль.
 * Правка, сделанная человеком, пока агент работал, в счёт не идёт — и откат
 * до неё не доходит.
 *
 * КУДА отменять — рубеж истории, запомненный на старте прогона. Отмена
 * снимает ПОСЛЕДНЮЮ запись общей истории, чья бы она ни была, поэтому одного
 * счётчика мало: человек мог сам нажать штатную отмену между прогоном и
 * откатом. Счётчик агента при этом не уменьшается, а указатель истории
 * (`historyIndex`) уезжает назад — и откат по счётчику дотягивается до
 * правок человека. Сторожем должен быть именно указатель: при отмене длина
 * истории не меняется вовсе, меняется только положение в ней.
 *
 * Рубеж запоминается не числом, а самой командой, на которой стоял указатель
 * (`history[historyIndex]`). Числу верить нельзя: при переполнении буфера
 * записи вытесняются с начала, и все индексы съезжают вниз. Команду же
 * достаточно найти в истории — а если её саму уже вытеснило, то всё, что в
 * буфере осталось, новее рубежа, и глубже него откат физически не уйдёт.
 */
import { useRef, useState } from 'react';

import { runAgent, type AgentEvent } from '../../lib/itArduinoAgent/agentLoop';
// Список инструментов, пишущих в историю отмены, — общий с циклом агента
// (см. комментарий у CANVAS_MUTATING_TOOLS): цикл считает по нему предел
// изменений за прогон, панель — сколько отменять при откате.
import { CANVAS_MUTATING_TOOLS } from '../../lib/itArduinoAgent/toolTypes';
import { useSimulatorStore, type CanvasCommand } from '../../store/useSimulatorStore';

export function AgentPanel() {
  const [text, setText] = useState('');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  // Сколько отменяемых действий агент реально совершил в текущем прогоне.
  // Состояние, а не ref: от него зависит disabled кнопки отката, а правка
  // ref сама по себе перерисовку не вызывает.
  const [agentSteps, setAgentSteps] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  // Команда, на которой стоял указатель истории в начале прогона. null —
  // история была пуста или полностью отменена, ниже опускаться просто некуда.
  const baselineRef = useRef<CanvasCommand | null>(null);

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
    const { history, historyIndex } = useSimulatorStore.getState();
    baselineRef.current = historyIndex >= 0 ? (history[historyIndex] ?? null) : null;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setEvents([]);
    setText('');

    await runAgent(request, handleEvent, controller.signal);
    setRunning(false);
  };

  /**
   * Положение рубежа в истории ПРЯМО СЕЙЧАС.
   *
   * −1 значит «дна нет»: либо прогон начался с пустой историей, либо запись
   * рубежа уже вытеснена кольцевым буфером — а вытесняются они с начала,
   * значит всё оставшееся новее рубежа.
   */
  const baselineIndex = (): number => {
    const marker = baselineRef.current;
    if (!marker) return -1;
    return useSimulatorStore.getState().history.indexOf(marker);
  };

  const rollback = () => {
    const bottom = baselineIndex();
    let left = agentSteps;
    while (left > 0 && useSimulatorStore.getState().historyIndex > bottom) {
      const before = useSimulatorStore.getState().historyIndex;
      useSimulatorStore.getState().undo();
      // Отмена умеет отказать (undo команды бросил — стор ловит и оставляет
      // указатель на месте). Без этой проверки цикл крутился бы вечно.
      if (useSimulatorStore.getState().historyIndex === before) break;
      left -= 1;
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
