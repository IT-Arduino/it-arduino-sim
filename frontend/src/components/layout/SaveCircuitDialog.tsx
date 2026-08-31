/**
 * SaveCircuitDialog — «Сохранить в проект».
 *
 * Открывается по кнопке «Сохранить» в редакторе, но только у вошедших:
 * гостю форк вообще не подменяет действие сохранения, и у него по той же
 * кнопке работает штатное скачивание .vlx (см. itArduinoMount).
 *
 * Скачивание .vlx остаётся и здесь, отдельной кнопкой. Это не дубль ради
 * симметрии: сайт может быть недоступен, лимит в сто схем может кончиться, а
 * работу надо забрать с собой — файл всегда работает и ни от чего не зависит.
 *
 * Когда облачная схема уже открыта, «Сохранить» обновляет её, а не создаёт
 * копию. Отдельная кнопка «Сохранить как новую» оставляет прежнюю нетронутой.
 * Без этого разделения десять нажатий «Сохранить» дали бы десять схем и
 * упёрлись бы в лимит на ровном месте.
 *
 * Форма вынесена в отдельный компонент и монтируется только при открытом
 * окне. Так начальное имя схемы задаётся при создании состояния, а не
 * эффектом «окно открылось — сбрось поля»: эффект давал лишнюю перерисовку на
 * каждое открытие и был бы источником ошибок при каждой новой добавленной
 * сюда переменной состояния.
 */
import React, { useCallback, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ForkDialog,
  forkBodyStyle,
  forkGhostButtonStyle,
  forkInputStyle,
  forkPrimaryButtonStyle,
} from './ForkDialog';
import {
  getOpenCircuit,
  saveCircuit,
  subscribeOpenCircuit,
  type OpenCircuit,
} from '../../lib/itArduinoCircuits';
import { getReadOnlyState } from '../../lib/itArduinoReadOnly';
import { triggerDownloadVlx } from '../../utils/vlxFile';
import { useProjectStore } from '../../store/useProjectStore';

let _open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function openSaveCircuitDialog(): void {
  _open = true;
  emit();
}

function closeSaveCircuitDialog(): void {
  _open = false;
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const getSnapshot = (): boolean => _open;

interface FormProps {
  /** Облачная схема, открытая сейчас, или null для новой. */
  current: OpenCircuit | null;
}

const SaveCircuitForm: React.FC<FormProps> = ({ current }) => {
  const { t } = useTranslation();

  // Имя по умолчанию, по убыванию точности: своя облачная схема — её
  // собственное; чужая просматриваемая — «Копия: …», потому что сохранение
  // из режима просмотра всегда создаёт новую запись в своём аккаунте;
  // иначе имя загруженного проекта. Считается один раз, при монтировании.
  const viewed = getReadOnlyState();
  const copyTitle =
    viewed.readOnly && viewed.title ? t('circuits.save.copyOf', { title: viewed.title }) : null;
  const [title, setTitle] = useState(
    current?.title ?? copyTitle ?? useProjectStore.getState().currentProject?.slug ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (asNew: boolean) => {
      const trimmed = title.trim();
      if (!trimmed) {
        setError(t('circuits.save.emptyName'));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await saveCircuit({ id: asNew ? null : (current?.id ?? null), title: trimmed });
        closeSaveCircuitDialog();
      } catch (err) {
        // Сообщение сервера показываем как есть: «превышен лимит», «схема
        // слишком большая» — это то, что пользователю и нужно знать, и
        // переписывать его в общее «что-то пошло не так» значит скрыть причину.
        setError((err as Error).message);
        setBusy(false);
      }
    },
    [title, current, t],
  );

  const download = useCallback(() => {
    triggerDownloadVlx({ name: title.trim() || undefined });
    closeSaveCircuitDialog();
  }, [title]);

  return (
    <ForkDialog
      open
      onClose={closeSaveCircuitDialog}
      title={t('circuits.save.title')}
      width={480}
      footer={
        <>
          <button type="button" onClick={download} style={forkGhostButtonStyle} disabled={busy}>
            {t('circuits.save.downloadInstead')}
          </button>
          {current ? (
            <button
              type="button"
              onClick={() => void submit(true)}
              style={forkGhostButtonStyle}
              disabled={busy}
            >
              {t('circuits.save.submitAsNew')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void submit(false)}
            style={{ ...forkPrimaryButtonStyle, opacity: busy ? 0.6 : 1 }}
            disabled={busy}
          >
            {busy
              ? t('circuits.save.saving')
              : current
                ? t('circuits.save.submitUpdate')
                : t('circuits.save.submit')}
          </button>
        </>
      }
    >
      <label
        htmlFor="it-arduino-circuit-title"
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 6,
          color: 'var(--color-fg-default)',
        }}
      >
        {t('circuits.save.nameLabel')}
      </label>
      <input
        id="it-arduino-circuit-title"
        type="text"
        value={title}
        autoFocus
        maxLength={255}
        placeholder={t('circuits.save.namePlaceholder')}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !busy) void submit(false);
        }}
        style={forkInputStyle}
      />

      {current ? (
        <p style={{ ...forkBodyStyle, marginTop: 10 }}>
          {t('circuits.save.updatingHint', { title: current.title })}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          style={{
            ...forkBodyStyle,
            marginTop: 12,
            color: 'var(--color-feedback-danger, #ff5252)',
          }}
        >
          {error}
        </p>
      ) : null}
    </ForkDialog>
  );
};

export const SaveCircuitDialog: React.FC = () => {
  const open = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const current = useSyncExternalStore(subscribeOpenCircuit, getOpenCircuit, getOpenCircuit);

  if (!open) return null;
  return <SaveCircuitForm current={current} />;
};
