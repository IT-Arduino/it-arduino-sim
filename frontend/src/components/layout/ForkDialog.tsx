/**
 * ForkDialog — общая оболочка модальных окон, добавленных форком.
 *
 * Появилась после второго такого окна. AboutDialog нёс свою вёрстку внутри
 * себя, и повторять те же тридцать строк (портал, затемнение, Escape,
 * остановка всплытия клика) в каждом новом диалоге значило бы чинить
 * доступность в трёх местах вместо одного.
 *
 * AboutDialog намеренно не переписан на эту оболочку: он работает, а лишняя
 * правка существующего файла — лишний конфликт при слиянии с апстримом.
 * Новые окна форка строятся уже отсюда.
 *
 * Стили — инлайновые объекты на переменных темы, как в остальном форке.
 * Отдельного CSS-файла нет намеренно: свой .css пришлось бы подключать в
 * чужой точке входа, а переменные темы уже дают и тёмную, и светлую тему без
 * единой строки каскада.
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Ссылка внутри диалога. */
export const forkLinkStyle: React.CSSProperties = {
  color: 'var(--brand-cyan)',
  textDecoration: 'none',
  wordBreak: 'break-all',
};

/** Обычный текст диалога. */
export const forkBodyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.55,
  color: 'var(--color-fg-muted)',
};

/**
 * Главная кнопка.
 *
 * Цвет текста — --color-action-primary-fg, а не белый: на фирменном голубом
 * белый даёт контраст 2,4:1 и не проходит WCAG AA. Подробнее в tokens/brand.css.
 */
export const forkPrimaryButtonStyle: React.CSSProperties = {
  background: 'var(--color-action-primary)',
  color: 'var(--color-action-primary-fg)',
  border: 'none',
  borderRadius: 8,
  padding: '8px 18px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

/** Второстепенная кнопка — отмена, закрыть. */
export const forkGhostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--color-fg-muted)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

/** Опасное действие — удаление. */
export const forkDangerButtonStyle: React.CSSProperties = {
  ...forkGhostButtonStyle,
  color: 'var(--color-feedback-danger, #ff5252)',
  borderColor: 'var(--color-feedback-danger, #ff5252)',
};

export const forkInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--color-bg-surface-2, var(--color-bg-canvas))',
  color: 'var(--color-fg-default)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 8,
  padding: '9px 11px',
  fontSize: 13,
  fontFamily: 'inherit',
};

export interface ForkDialogProps {
  open: boolean;
  onClose: () => void;
  /** Заголовок окна. Он же — доступное имя для программ чтения с экрана. */
  title: string;
  /** Ширина панели в пикселях. По умолчанию 560. */
  width?: number;
  children: React.ReactNode;
  /** Правый нижний угол — кнопки. */
  footer?: React.ReactNode;
}

export const ForkDialog: React.FC<ForkDialogProps> = ({
  open,
  onClose,
  title,
  width = 560,
  children,
  footer,
}) => {
  const [mounted, setMounted] = useState(false);

  // Порталу нужен настоящий DOM, которого нет на этапе пререндера.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
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
          maxWidth: width,
          width: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 26px',
          boxSizing: 'border-box',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 20,
            fontWeight: 600,
            margin: '0 0 14px',
            color: 'var(--color-fg-default)',
          }}
        >
          {title}
        </h2>

        {/* Прокручивается содержимое, а не всё окно: кнопки внизу должны
            оставаться на виду при длинном списке схем. */}
        <div style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>{children}</div>

        {footer ? (
          <div
            style={{
              marginTop: 20,
              display: 'flex',
              gap: 10,
              justifyContent: 'flex-end',
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
};
