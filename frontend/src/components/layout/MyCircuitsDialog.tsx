/**
 * MyCircuitsDialog — «Мои схемы»: список, открыть, переименовать, удалить.
 *
 * Попадает в меню без единой правки меню. Апстрим уже держит пункт
 * `account.myProjects` в File и в Account с флагом `optional: true` — строка
 * прячется, пока никто не зарегистрировал обработчик, потому что в открытой
 * версии аккаунтов нет вовсе. Форк регистрирует обработчик при входе и снимает
 * при выходе (itArduinoMount), и пункт появляется и исчезает сам.
 *
 * Список приходит без содержимого схем: сто схем по мегабайту — это сто
 * мегабайт на открытие окна. Содержимое подтягивается по одной схеме, когда
 * её открывают.
 *
 * Сам список — отдельный компонент, живущий только пока окно открыто. Отсюда
 * два следствия: состояние не нужно сбрасывать при открытии, и запрос
 * уходит один раз при монтировании. Список перечитывается на каждое открытие
 * намеренно — схему могли сохранить, переименовать или удалить с другого
 * устройства.
 */
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ForkDialog,
  forkBodyStyle,
  forkDangerButtonStyle,
  forkGhostButtonStyle,
  forkInputStyle,
  forkPrimaryButtonStyle,
} from './ForkDialog';
import { listCircuits, type CircuitSummary } from '../../lib/itArduinoApi';
import { formatUpdatedAt } from '../../lib/itArduinoFormat';
import {
  getOpenCircuit,
  loadCircuitIntoEditor,
  publicCircuitUrl,
  removeCircuit,
  renameCircuit,
  setCircuitPublic,
  subscribeOpenCircuit,
  type OpenCircuit,
} from '../../lib/itArduinoCircuits';

let _open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function openMyCircuitsDialog(): void {
  _open = true;
  emit();
}

function closeMyCircuitsDialog(): void {
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

interface ListProps {
  /** Облачная схема, открытая сейчас, — помечается в списке. */
  current: OpenCircuit | null;
}

const MyCircuitsList: React.FC<ListProps> = ({ current }) => {
  const { t } = useTranslation();

  /** null — список ещё не пришёл. */
  const [items, setItems] = useState<CircuitSummary[] | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Схема, которую сейчас переименовывают, и черновик её названия. */
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  /** Идёт операция над этой схемой — блокируем её кнопки, но не всё окно. */
  const [busyId, setBusyId] = useState<number | null>(null);
  /** Ссылка на эту схему только что скопирована — показываем подтверждение. */
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    // Флаг живости: окно могли закрыть, пока ответ шёл. Запись состояния в
    // размонтированный компонент React проглотит, но проверка честнее и
    // избавляет от предупреждения в консоли.
    let alive = true;
    listCircuits()
      .then((resp) => {
        if (!alive) return;
        setItems(resp.items);
        setLimit(resp.limit);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setItems([]);
        setError((err as Error).message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleOpen = useCallback(
    async (item: CircuitSummary) => {
      // Загрузка заменяет рабочую область целиком. Несохранённые правки
      // пропадут, и спросить об этом дешевле, чем потом объяснять.
      if (!window.confirm(t('circuits.list.openConfirm', { title: item.title }))) return;
      setBusyId(item.id);
      setError(null);
      try {
        await loadCircuitIntoEditor(item.id);
        closeMyCircuitsDialog();
      } catch (err) {
        setError((err as Error).message);
        setBusyId(null);
      }
    },
    [t],
  );

  const handleRename = useCallback(
    async (item: CircuitSummary) => {
      const title = draft.trim();
      if (!title) return;
      if (title === item.title) {
        setRenamingId(null);
        return;
      }
      setBusyId(item.id);
      setError(null);
      try {
        await renameCircuit(item.id, title);
        setItems((prev) => (prev ?? []).map((c) => (c.id === item.id ? { ...c, title } : c)));
        setRenamingId(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [draft],
  );

  const handleTogglePublic = useCallback(
    async (item: CircuitSummary) => {
      const next = !item.is_public;
      // Снятие публикации закрывает доступ немедленно, поэтому спрашиваем
      // только при включении: там пользователь открывает работу наружу.
      if (next && !window.confirm(t('circuits.list.publishConfirm', { title: item.title }))) {
        return;
      }
      setBusyId(item.id);
      setError(null);
      try {
        await setCircuitPublic(item.id, next);
        setItems((prev) =>
          (prev ?? []).map((c) => (c.id === item.id ? { ...c, is_public: next } : c)),
        );
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [t],
  );

  const handleCopyLink = useCallback(async (item: CircuitSummary) => {
    const url = publicCircuitUrl(item.id);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Доступ к буферу обмена браузер даёт не всегда (нет разрешения, не
      // https). Показываем саму ссылку — скопировать вручную можно всегда.
      setError(url);
    }
  }, []);

  const handleDelete = useCallback(
    async (item: CircuitSummary) => {
      if (!window.confirm(t('circuits.list.confirmDelete', { title: item.title }))) return;
      setBusyId(item.id);
      setError(null);
      try {
        await removeCircuit(item.id);
        setItems((prev) => (prev ?? []).filter((c) => c.id !== item.id));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [t],
  );

  return (
    <ForkDialog
      open
      onClose={closeMyCircuitsDialog}
      title={t('circuits.list.title')}
      width={640}
      footer={
        <button type="button" onClick={closeMyCircuitsDialog} style={forkPrimaryButtonStyle}>
          {t('circuits.list.close')}
        </button>
      }
    >
      {items !== null && limit !== null ? (
        <p style={{ ...forkBodyStyle, marginBottom: 12 }}>
          {t('circuits.list.counter', { used: items.length, limit })}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          style={{
            ...forkBodyStyle,
            marginBottom: 12,
            color: 'var(--color-feedback-danger, #ff5252)',
          }}
        >
          {error}
        </p>
      ) : null}

      {items === null ? <p style={forkBodyStyle}>{t('circuits.list.loading')}</p> : null}

      {items !== null && items.length === 0 && !error ? (
        <p style={forkBodyStyle}>{t('circuits.list.empty')}</p>
      ) : null}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {(items ?? []).map((item) => {
          const isCurrent = current?.id === item.id;
          const busy = busyId === item.id;
          return (
            <li
              key={item.id}
              style={{
                borderTop: '1px solid var(--color-border-default)',
                padding: '12px 0',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                opacity: busy ? 0.6 : 1,
              }}
            >
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                {renamingId === item.id ? (
                  <input
                    type="text"
                    value={draft}
                    autoFocus
                    maxLength={255}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRename(item);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    style={forkInputStyle}
                  />
                ) : (
                  <>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--color-fg-default)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.title}
                      {isCurrent ? (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            fontWeight: 500,
                            color: 'var(--brand-cyan)',
                          }}
                        >
                          {t('circuits.list.current')}
                        </span>
                      ) : null}
                      {item.is_public ? (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            fontWeight: 500,
                            color: 'var(--color-feedback-success, var(--brand-green))',
                          }}
                        >
                          {t('circuits.list.published')}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ ...forkBodyStyle, fontSize: 12 }}>
                      {t('circuits.list.updatedAt', { date: formatUpdatedAt(item.updated_at) })}
                    </div>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {renamingId === item.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleRename(item)}
                      style={forkPrimaryButtonStyle}
                      disabled={busy}
                    >
                      {t('circuits.list.renameSave')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      style={forkGhostButtonStyle}
                      disabled={busy}
                    >
                      {t('circuits.list.renameCancel')}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleOpen(item)}
                      style={forkPrimaryButtonStyle}
                      disabled={busy}
                    >
                      {t('circuits.list.open')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(item.id);
                        setDraft(item.title);
                      }}
                      style={forkGhostButtonStyle}
                      disabled={busy}
                    >
                      {t('circuits.list.rename')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleTogglePublic(item)}
                      style={forkGhostButtonStyle}
                      disabled={busy}
                    >
                      {item.is_public ? t('circuits.list.unpublish') : t('circuits.list.publish')}
                    </button>
                    {item.is_public ? (
                      <button
                        type="button"
                        onClick={() => void handleCopyLink(item)}
                        style={forkGhostButtonStyle}
                        disabled={busy}
                      >
                        {copiedId === item.id
                          ? t('circuits.list.linkCopied')
                          : t('circuits.list.copyLink')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleDelete(item)}
                      style={forkDangerButtonStyle}
                      disabled={busy}
                    >
                      {t('circuits.list.delete')}
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </ForkDialog>
  );
};

export const MyCircuitsDialog: React.FC = () => {
  const open = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const current = useSyncExternalStore(subscribeOpenCircuit, getOpenCircuit, getOpenCircuit);

  if (!open) return null;
  return <MyCircuitsList current={current} />;
};
