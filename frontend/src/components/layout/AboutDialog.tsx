/**
 * AboutDialog — "О программе".
 *
 * Exists to satisfy two obligations at once, both licence terms rather than
 * decoration:
 *
 *   - AGPLv3 section 13. A user interacting with this simulator over a
 *     network must be offered the corresponding source of the running
 *     version. The header carries a permanent "Исходный код" link; this
 *     dialog is the second, fuller statement of the same thing, next to the
 *     licence itself.
 *   - Attribution. The fork is derived from Velxio by David Montero Crespo.
 *     "Velxio" is his trademark, so it is gone from our interface — but the
 *     work behind it is credited here, with a link to the upstream project.
 *
 * Upstream had no such component: its About page lived in the private
 * marketing overlay on velxio.dev, outside the open-source tree.
 *
 * Wiring is deliberately thin — one mount in EditorPage, one menu item in
 * EditorMenuBar calling openAboutDialog(). The open/closed state lives in a
 * module-level subscriber rather than in a store, mirroring the seam pattern
 * upstream already uses (proSaveAction, newsSource): nothing else has to know
 * this dialog exists.
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/** Public repository of this fork — the source AGPLv3 section 13 requires. */
const SOURCE_CODE_URL = 'https://github.com/IT-Arduino/it-arduino-sim';
/** The project this one is derived from. */
const UPSTREAM_URL = 'https://github.com/davidmonterocrespo24/velxio';
/** The licence text itself, on gnu.org. */
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
/** The site this simulator belongs to. */
const MAIN_SITE_URL = 'https://it-arduino.ru';

let _open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function openAboutDialog(): void {
  _open = true;
  emit();
}

function closeAboutDialog(): void {
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

const linkStyle: React.CSSProperties = {
  color: 'var(--brand-cyan)',
  textDecoration: 'none',
  wordBreak: 'break-all',
};

const headingStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 14,
  fontWeight: 600,
  margin: '18px 0 6px',
  color: 'var(--color-fg-default)',
};

const bodyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.55,
  color: 'var(--color-fg-muted)',
};

export const AboutDialog: React.FC = () => {
  const { t } = useTranslation();
  const open = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [mounted, setMounted] = useState(false);

  // Portals need a DOM target, which does not exist during the SSR prerender.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeAboutDialog();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('about.title')}
      onClick={closeAboutDialog}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'var(--color-bg-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-bg-surface-1)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 12,
          maxWidth: 560,
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '24px 26px',
          boxSizing: 'border-box',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 20,
            fontWeight: 600,
            margin: 0,
            color: 'var(--color-fg-default)',
          }}
        >
          IT-Arduino Симулятор
        </h2>
        <p style={{ ...bodyStyle, marginTop: 10 }}>{t('about.tagline')}</p>

        <h3 style={headingStyle}>{t('about.sourceHeading')}</h3>
        <p style={bodyStyle}>
          {t('about.sourceBody')}{' '}
          <a href={SOURCE_CODE_URL} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            {SOURCE_CODE_URL}
          </a>
        </p>

        <h3 style={headingStyle}>{t('about.licenseHeading')}</h3>
        <p style={bodyStyle}>
          {t('about.licenseBody')}{' '}
          <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            {t('about.licenseLink')}
          </a>
        </p>

        <h3 style={headingStyle}>{t('about.basedOnHeading')}</h3>
        <p style={bodyStyle}>
          {t('about.basedOnBody')}{' '}
          <a href={UPSTREAM_URL} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            {t('about.upstreamLink')}
          </a>
        </p>

        <p style={{ ...bodyStyle, marginTop: 18 }}>
          <a href={MAIN_SITE_URL} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            it-arduino.ru
          </a>
        </p>

        <div style={{ marginTop: 22, textAlign: 'right' }}>
          <button
            type="button"
            onClick={closeAboutDialog}
            style={{
              background: 'var(--color-action-primary)',
              color: 'var(--color-action-primary-fg)',
              border: 'none',
              borderRadius: 8,
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('about.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
