/**
 * Панель живёт в слоте, который апстрим оставил под агента
 * (EditorPage.tsx: <div data-velxio-slot="agent-chat" />). Портал — чтобы
 * не править чужой файл: React рисует наше поддерево внутри их разметки.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AgentPanel } from './AgentPanel';

let setVisible: ((visible: boolean) => void) | null = null;

/** Открыть панель. Зовётся из пункта меню project.connectAgent. */
export function openAgentPanel(): void {
  setVisible?.(true);
}

export function AgentPanelHost() {
  const [visible, setVisibleState] = useState(false);
  const [slot, setSlot] = useState<Element | null>(null);

  useEffect(() => {
    setVisible = setVisibleState;
    // Слот появляется вместе со страницей редактора, поэтому ищем его после
    // монтирования, а не на импорте модуля.
    setSlot(document.querySelector('[data-velxio-slot="agent-chat"]'));
    return () => {
      setVisible = null;
    };
  }, []);

  if (!visible || !slot) return null;
  return createPortal(<AgentPanel />, slot);
}
