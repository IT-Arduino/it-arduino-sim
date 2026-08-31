/**
 * ReadOnlyBanner — полоса «только просмотр».
 *
 * Нужна из-за того, как устроен сам режим. Запрет стоит в сторе, а не в
 * интерфейсе (см. `lib/itArduinoReadOnly.ts`): кнопки и холст выглядят
 * рабочими, но перетащенная деталь не сдвигается. Без объяснения это читается
 * как поломка, поэтому объяснение висит на экране всё время, пока режим
 * включён, и подсвечивается на отклонённой правке.
 *
 * Полоса внизу, а не вверху: сверху меню и панель инструментов, и закрывать
 * их ради подписи неправильно. Портал — чтобы не зависеть от вёрстки
 * страницы, в которую нас вставили.
 *
 * Здесь же оба выхода из тупика «хочу поменять, но нельзя»: «Сохранить как
 * свою» для вошедших и скачивание .vlx для всех.
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { getReadOnlyState, subscribeReadOnly } from '../../lib/itArduinoReadOnly';
import { getAuthState, subscribeAuth } from '../../lib/itArduinoAuth';
import { openSaveCircuitDialog } from './SaveCircuitDialog';
import { triggerDownloadVlx } from '../../utils/vlxFile';
import { forkGhostButtonStyle, forkPrimaryButtonStyle } from './ForkDialog';

/** Сколько миллисекунд держать подсветку после отклонённой правки. */
const HINT_MS = 2600;

export const ReadOnlyBanner: React.FC = () => {
  const { t } = useTranslation();
  const state = useSyncExternalStore(subscribeReadOnly, getReadOnlyState, getReadOnlyState);
  const auth = useSyncExternalStore(subscribeAuth, getAuthState, getAuthState);
  const [mounted, setMounted] = useState(false);
  const [hint, setHint] = useState(false);

  useEffect(() => setMounted(true), []);

  // Подсветка гаснет сама. Зависимость — счётчик отклонённых правок: каждая
  // следующая попытка перезапускает таймер, а не копит их.
  useEffect(() => {
    if (state.blocked === 0) return;
    setHint(true);
    const id = window.setTimeout(() => setHint(false), HINT_MS);
    return () => window.clearTimeout(id);
  }, [state.blocked]);

  if (!state.readOnly || !mounted) return null;

  return createPortal(
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 18,
        transform: 'translateX(-50%)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        maxWidth: 'calc(100vw - 32px)',
        flexWrap: 'wrap',
        justifyContent: 'center',
        padding: '10px 16px',
        borderRadius: 10,
        background: 'var(--color-bg-surface-1)',
        border: `1px solid ${hint ? 'var(--brand-cyan)' : 'var(--color-border-default)'}`,
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.35)',
        transition: 'border-color 160ms ease-out',
      }}
    >
      <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--color-fg-default)' }}>
        <strong style={{ fontFamily: 'var(--font-display)' }}>
          {t('circuits.readOnly.title')}
        </strong>
        {state.title ? (
          <span style={{ color: 'var(--color-fg-muted)' }}> — «{state.title}»</span>
        ) : null}
        <span style={{ display: 'block', color: 'var(--color-fg-muted)', fontSize: 12 }}>
          {hint ? t('circuits.readOnly.blocked') : t('circuits.readOnly.hint')}
        </span>
      </span>

      <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {auth.authenticated ? (
          <button type="button" onClick={openSaveCircuitDialog} style={forkPrimaryButtonStyle}>
            {t('circuits.readOnly.saveAsMine')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => triggerDownloadVlx({ name: state.title ?? undefined })}
          style={forkGhostButtonStyle}
        >
          {t('circuits.readOnly.download')}
        </button>
      </span>
    </div>,
    document.body,
  );
};
