/**
 * PublicCircuitPage — маршрут `/circuit/:circuitId`, чужая опубликованная
 * схема в режиме «только просмотр».
 *
 * Своей вёрстки почти нет: страница загружает схему, включает режим и
 * показывает обычный редактор. Так ученик получает всё, ради чего пришёл, —
 * запуск, монитор порта, осциллограф, — и не получает возможности испортить
 * чужую работу.
 *
 * Порядок важен и обратному не поддаётся: сперва загрузка, потом режим.
 * Заглушка на `loadProjectState` намеренно снимает режим при загрузке целого
 * проекта, так что включённый заранее он снялся бы сам собой в ту же секунду.
 *
 * Маршрут регистрируется через `registerProRoutes` из `itArduinoMount`, а не
 * дописывается в таблицу `App.tsx`: реестр для этого и сделан апстримом, и
 * чужой файл остаётся нетронутым.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { EditorPage } from './EditorPage';
import { loadPublicCircuitIntoEditor } from '../lib/itArduinoCircuits';
import { enterReadOnly, exitReadOnly } from '../lib/itArduinoReadOnly';

type Status = 'loading' | 'ready' | 'error';

export const PublicCircuitPage: React.FC = () => {
  const { t } = useTranslation();
  const { circuitId } = useParams<{ circuitId: string }>();
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = Number(circuitId);
    if (!Number.isInteger(id) || id <= 0) {
      setError(t('circuits.readOnly.badLink'));
      setStatus('error');
      return;
    }

    // Ответ мог прийти после ухода со страницы — тогда включать режим уже
    // не нужно, иначе он останется висеть на чужой рабочей области.
    let alive = true;
    loadPublicCircuitIntoEditor(id)
      .then((circuit) => {
        if (!alive) return;
        enterReadOnly({ circuitId: circuit.id, title: circuit.title });
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError((err as Error).message);
        setStatus('error');
      });

    return () => {
      alive = false;
      // Уход со страницы возвращает стору её собственные действия. Без этого
      // редактор остался бы запертым после перехода на /editor.
      exitReadOnly();
    };
  }, [circuitId, t]);

  if (status === 'error') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          background: 'var(--color-bg-canvas)',
          color: 'var(--color-fg-default)',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0 }}>
          {t('circuits.readOnly.notFoundTitle')}
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-fg-muted)', maxWidth: 460 }}>
          {t('circuits.readOnly.notFoundBody')}
        </p>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-fg-muted)' }}>{error}</p>
        <a
          href="/editor"
          style={{ color: 'var(--brand-cyan)', textDecoration: 'none', fontSize: 13 }}
        >
          {t('circuits.readOnly.toEditor')}
        </a>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-canvas)',
          color: 'var(--color-fg-muted)',
          fontSize: 14,
        }}
      >
        {t('circuits.readOnly.loading')}
      </div>
    );
  }

  return <EditorPage />;
};
