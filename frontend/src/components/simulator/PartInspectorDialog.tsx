/**
 * Part Inspector — the right-click dialog for canvas components.
 *
 * Merges the two surfaces that used to exist separately: the old
 * ComponentPropertyDialog (a 250px column of pin names, editors and
 * Rotate/Delete) and the component-picker info card (datasheet, brand, Buy).
 * Layout: actions and a live preview of the part on the left; Properties /
 * Datasheet tabs on the right.
 *
 * The preview is the REAL web component, mounted and scaled — not a drawing.
 * Pin markers are laid over it at their true positions and their labels flank
 * the art on the side each pin lives on (pinInspectorLayout); hovering a name
 * lights its leader line and its pad so the two can be traced to each other.
 * Everything is driven by the element's own pinInfo and measured size, so any
 * part present or future works with zero per-part data.
 *
 * Clicking a pin keeps the exact contract of the old dialog: onPinSelect ->
 * the canvas starts (or finishes) a wire through handlePinClick, with its
 * undo, colors and running-state gating.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ComponentMetadata } from '../../types/component-metadata';
import { SdCardPanel } from './SdCardPanel';
import type { UploadedSdFile } from '../../utils/sdCardFiles';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import {
  isKeyBindable,
  isModifierKey,
  normalizeKey,
  formatKeyLabel,
} from '../../utils/keyButtonBindings';
import {
  ComponentInfoBody,
  useComponentDoc,
  HIDDEN_PROPS,
  formatValue,
  type PanelData,
} from '../ComponentInfoPanel';
import {
  layoutInspectorPins,
  type InspectorPinInput,
  type PinLayoutResult,
} from '../../utils/pinInspectorLayout';
// The keybind chips and the SD Card panel keep their existing class names and
// styles — both live in ComponentPropertyDialog.css, imported here so the old
// dialog file can eventually retire without orphaning them.
import './ComponentPropertyDialog.css';
import './PartInspectorDialog.css';

function isEditable(prop: any): boolean {
  if (prop.control === 'select' && prop.options) return true;
  if (prop.control === 'text' || prop.control === 'number') return true;
  return false;
}

/** "input" -> "Input" — the picker formats categories for display; match it. */
function displayCategory(cat: string): string {
  return cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : cat;
}

/**
 * An action shown in the left column instead of Rotate. Boards do not rotate;
 * they carry Board Options / Flash instead, and the canvas owns what those do.
 */
export interface InspectorAction {
  id: string;
  label: string;
  title?: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface PartInspectorDialogProps {
  componentId: string;
  componentMetadata: ComponentMetadata;
  componentProperties: Record<string, any>;
  /** Anchor point in VIEWPORT coordinates (both open gestures now agree). */
  position: { x: number; y: number };
  pinInfo: Array<{ name: string; x: number; y: number; signals?: any[]; description?: string }>;
  onClose: () => void;
  /** Omitted for boards, which do not rotate. */
  onRotate?: (componentId: string) => void;
  onDelete: (componentId: string) => void;
  onPropertyChange?: (componentId: string, propertyName: string, value: unknown) => void;
  /** Same contract as the old dialog: the canvas starts/finishes a wire here. */
  onPinSelect?: (componentId: string, pinName: string) => void;
  wireInProgress?: boolean;
  /** Board-only extras, rendered above Delete in the actions column. */
  extraActions?: InspectorAction[];
  /** Overrides the Delete button's label (boards say "Remove board"). */
  deleteLabel?: string;
  /** Extra line under the delete confirmation (e.g. "3 wires will be removed"). */
  deleteHint?: string;
  /** Tag rendered live in the preview when the element is not the metadata's. */
  previewTagName?: string;
  /** Attributes to set on the preview element (boards need board-kind). */
  previewAttributes?: Record<string, string>;
}

/**
 * The art box the part is scaled into. The pin gutters are added around it, so
 * the dialog's left column ends up a little wider than this.
 */
const PINS_ART = 190;

export const PartInspectorDialog: React.FC<PartInspectorDialogProps> = ({
  componentId,
  componentMetadata,
  componentProperties,
  position,
  pinInfo,
  onClose,
  onRotate,
  onDelete,
  onPropertyChange,
  onPinSelect,
  wireInProgress,
  extraActions,
  deleteLabel,
  deleteHint,
  previewTagName,
  previewAttributes,
}) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const [dialogPos, setDialogPos] = useState<{ x: number; y: number } | null>(null);
  const [tab, setTab] = useState<'properties' | 'datasheet'>('properties');
  // The pin the pointer is on — its leader line and dot light up together, so
  // a name in the gutter can be traced to the pad it belongs to.
  const [hoverPin, setHoverPin] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [layout, setLayout] = useState<PinLayoutResult | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const doc = useComponentDoc(componentMetadata.id);

  // ── Keyboard binding capture (unchanged from the old dialog) ─────────────
  const [capturingKey, setCapturingKey] = useState(false);
  const allComponents = useSimulatorStore((s) => s.components);
  const boundKey =
    typeof componentProperties.key === 'string' && componentProperties.key
      ? componentProperties.key
      : '';
  const keyInUseElsewhere =
    !!boundKey &&
    allComponents.some(
      (c) =>
        c.id !== componentId &&
        isKeyBindable(c.metadataId) &&
        typeof c.properties.key === 'string' &&
        !!c.properties.key &&
        normalizeKey(c.properties.key) === normalizeKey(boundKey),
    );

  useEffect(() => setCapturingKey(false), [componentId]);

  useEffect(() => {
    if (!capturingKey) return;
    const onCaptureKey = (e: KeyboardEvent) => {
      // Capture-phase + stopPropagation: the pressed key must not reach the
      // dialog's Escape-close handler, the canvas delete handler, or the
      // runtime key->button bridge while we're recording it.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturingKey(false);
        return;
      }
      if (isModifierKey(e.key)) return; // keep waiting for a real key
      onPropertyChange?.(componentId, 'key', normalizeKey(e.key));
      setCapturingKey(false);
    };
    window.addEventListener('keydown', onCaptureKey, true);
    return () => window.removeEventListener('keydown', onCaptureKey, true);
  }, [capturingKey, componentId, onPropertyChange]);

  // The preview effect must NOT re-run on every parent render, or the element
  // is torn down and remounted and the dialog visibly flickers whenever the
  // canvas re-renders (moving the pointer in and out is enough). Both of the
  // inputs it cares about arrive as fresh objects each render — pinInfo is a
  // getter that builds a new array, and componentProperties a new object — so
  // depend on stable string digests of them instead of their identities.
  const propsKey = Object.entries(componentProperties)
    .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 32 ? v.length : String(v)}`)
    .join('|');
  const pinsKey = pinInfo.map((p) => `${p.name}:${p.x},${p.y}`).join('|');
  // componentMetadata is stable for components (the registry hands back the
  // same object) but NOT for boards, whose metadata the canvas builds inline
  // per render — depending on its identity remounted the preview on every
  // parent render and the dialog flickered under the pointer.
  const metaKey = `${componentMetadata.id}|${componentMetadata.tagName}|${Object.entries(
    componentMetadata.defaultValues ?? {},
  )
    .map(([k, v]) => `${k}=${String(v).slice(0, 24)}`)
    .join(',')}`;
  const metaRef = useRef(componentMetadata);
  metaRef.current = componentMetadata;

  // ── Live preview: mount the real element, measure, lay out pins ──────────
  useEffect(() => {
    const host = previewHostRef.current;
    if (!host) return;
    setPreviewFailed(false);
    setLayout(null);
    host.textContent = '';

    const tag = previewTagName || metaRef.current.tagName;
    if (!tag || !customElements.get(tag)) {
      // Unregistered tag (or none): the header thumbnail already shows the
      // art, so the preview just reports there is nothing live to mount.
      setPreviewFailed(true);
      return;
    }
    const el = document.createElement(tag) as HTMLElement & {
      pinInfo?: Array<{ name: string; x: number; y: number; signals?: any[] }>;
    };
    // Apply the instance's properties (an LED's color/flip changes both the
    // art and, for flip, the pinInfo itself), then the metadata defaults for
    // whatever the instance does not carry.
    for (const [k, v] of Object.entries({
      ...metaRef.current.defaultValues,
      ...componentProperties,
    })) {
      try {
        (el as any)[k] = v;
      } catch {
        /* read-only prop on some element - ignore */
      }
    }
    // Boards select their art through an ATTRIBUTE (board-kind), not a
    // property: velxio-esp32 renders nothing until it has one.
    for (const [k, v] of Object.entries(previewAttributes ?? {})) el.setAttribute(k, v);
    el.classList.add('pid-preview-element');
    host.appendChild(el);

    let cancelled = false;
    let tries = 0;
    const measure = () => {
      if (cancelled) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if ((w < 2 || h < 2) && tries < 12) {
        // Elements render in connectedCallback and settle a tick later —
        // same retry pattern as the canvas PinOverlay (issues #230/#232).
        tries++;
        setTimeout(() => requestAnimationFrame(measure), tries < 4 ? 16 : 50);
        return;
      }
      if (w < 2 || h < 2) {
        setPreviewFailed(true);
        return;
      }
      const pins: InspectorPinInput[] = (el.pinInfo && el.pinInfo.length ? el.pinInfo : pinInfo) ?? [];
      const art = PINS_ART;
      const result = layoutInspectorPins(pins, { width: w, height: h }, {
        maxArtWidth: art,
        maxArtHeight: art,
      });
      el.style.transform = `scale(${result.scale})`;
      el.style.transformOrigin = 'top left';
      setLayout(result);
    };
    requestAnimationFrame(measure);

    // Some parts move their pins at runtime (LED flip, custom chip JSON).
    const onPinsChange = () => requestAnimationFrame(measure);
    el.addEventListener('pininfo-change', onPinsChange);
    return () => {
      cancelled = true;
      el.removeEventListener('pininfo-change', onPinsChange);
      host.textContent = '';
    };
    // propsKey/pinsKey stand in for componentProperties/pinInfo: a real change
    // (a colour edit, an LED flip) changes the digest and repaints; a bare
    // re-render does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaKey, propsKey, pinsKey, previewTagName]);

  // ── Position: viewport coords, clamped, portaled to body ─────────────────
  // NOTE the guard inside place(): setDialogPos only fires on a real move.
  // Without it the ResizeObserver below and this effect feed each other and
  // the dialog jitters.
  // Re-run on every SIZE change, not just on the inputs we can name. The
  // datasheet arrives asynchronously (loadDoc) and the markdown can be long,
  // so a one-shot measure placed the dialog while it was still short and it
  // then grew off the bottom of the screen — the user only saw it corrected
  // when some other event happened to re-render and re-measure it.
  useLayoutEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const place = () => {
      const margin = 12;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let x = position.x + 16;
      let y = position.y;
      if (x + w > vw - margin) x = Math.max(margin, position.x - w - 16);
      x = Math.max(margin, Math.min(x, vw - w - margin));
      y = Math.max(margin, Math.min(y, vh - h - margin));
      setDialogPos((prev) =>
        prev && Math.abs(prev.x - x) < 0.5 && Math.abs(prev.y - y) < 0.5 ? prev : { x, y },
      );
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [position]);

  // ── Close behaviours (unchanged semantics) ───────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) onClose();
    };
    // Delay to avoid immediate close from the click that opened the dialog.
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // ── Data for the datasheet tab (the picker card's own body) ──────────────
  const panelData: PanelData = {
    id: componentMetadata.id,
    name: componentMetadata.name,
    category: displayCategory(componentMetadata.category),
    description: componentMetadata.description,
    pinCount: componentMetadata.pinCount,
    properties: componentMetadata.properties,
    tags: componentMetadata.tags ?? [],
    thumbnail: componentMetadata.thumbnail,
    pro_only: componentMetadata.pro_only,
  };

  const svgThumb =
    componentMetadata.thumbnail && componentMetadata.thumbnail.trim().startsWith('<svg')
      ? componentMetadata.thumbnail
      : null;

  const editableProps = componentMetadata.properties.filter((p: any) => isEditable(p));
  const readOnlyProps = componentMetadata.properties.filter(
    (p: any) => !isEditable(p) && !HIDDEN_PROPS.has(p.name),
  );

  const pinTitle = (name: string, description?: string) => {
    const base = description ? `${name} (${description})` : name;
    if (!onPinSelect) return base;
    return `${base} - ${wireInProgress ? t('editor.componentProps.tapToConnect') : t('editor.componentProps.tapToWire')}`;
  };

  return createPortal(
    <div
      ref={dialogRef}
      className="part-inspector-dialog"
      style={{
        left: `${dialogPos?.x ?? position.x}px`,
        top: `${dialogPos?.y ?? position.y}px`,
        opacity: dialogPos ? 1 : 0,
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header: art + name + badges + brand, like the picker card. */}
      <div className="pid-header">
        {svgThumb && <div className="pid-thumb" dangerouslySetInnerHTML={{ __html: svgThumb }} />}
        <div className="pid-title">
          <span className="pid-name">{componentMetadata.name}</span>
          <span className="pid-badges">
            <span className="pid-cat">{panelData.category}</span>
            {componentMetadata.pro_only && <span className="pid-pro">PRO</span>}
            {componentMetadata.pinCount > 0 && (
              <span className="pid-pins-badge">{componentMetadata.pinCount} pins</span>
            )}
          </span>
          {doc?.brand && <span className="pid-brand">by {doc.brand}</span>}
        </div>
        <button className="pid-close" onClick={onClose} title={t('editor.componentProps.close')}>
          ×
        </button>
      </div>

      <div className="pid-columns">
        {/* Left column: live preview, pin toggle, actions. */}
        <div className="pid-left">
          <div
            className="pid-preview pid-preview--pins"
            style={
              layout
                ? {
                    width: layout.artWidth + layout.padLeft + layout.padRight,
                    height: layout.artHeight + layout.padTop + layout.padBottom,
                  }
                : undefined
            }
          >
            <div
              className="pid-preview-art"
              ref={previewHostRef}
              style={layout ? { left: layout.padLeft, top: layout.padTop } : undefined}
            />
            {previewFailed && !svgThumb && <div className="pid-preview-missing">—</div>}
            {previewFailed && svgThumb && (
              <div className="pid-preview-fallback" dangerouslySetInnerHTML={{ __html: svgThumb }} />
            )}

            {/* Pin markers + labels, at their true positions. */}
            {layout &&
              layout.pins.map((p) => {
                const ox = layout.padLeft;
                const oy = layout.padTop;
                const clickable = Boolean(onPinSelect);
                const activate = () => onPinSelect?.(componentId, p.name);
                const lit = hoverPin === p.name;
                // Hovering EITHER the label or the dot lights the whole run:
                // label, leader and pad. On a 32-pin board that is the only
                // way to be sure which pad a gutter name belongs to.
                const trace = {
                  onMouseEnter: () => setHoverPin(p.name),
                  onMouseLeave: () => setHoverPin((c) => (c === p.name ? null : c)),
                  onFocus: () => setHoverPin(p.name),
                  onBlur: () => setHoverPin((c) => (c === p.name ? null : c)),
                };
                return (
                  <React.Fragment key={p.name}>
                    {p.needsLeader && (
                      <svg
                        className={`pid-pin-leader${lit ? ' pid-pin-leader--lit' : ''}`}
                        aria-hidden="true"
                      >
                        <line
                          x1={ox + p.dotX}
                          y1={oy + p.dotY}
                          x2={ox + p.labelX}
                          y2={oy + p.labelY}
                        />
                      </svg>
                    )}
                    <button
                      type="button"
                      className={`pid-pin-dot pid-sig-${p.signalKind}${lit ? ' pid-pin-dot--lit' : ''}`}
                      style={{ left: ox + p.dotX, top: oy + p.dotY }}
                      title={pinTitle(p.name, pinInfo.find((q) => q.name === p.name)?.description)}
                      onClick={clickable ? activate : undefined}
                      disabled={!clickable}
                      {...trace}
                    />
                    <button
                      type="button"
                      className={`pid-pin-label pid-pin-label--${p.edge}${lit ? ' pid-pin-label--lit' : ''}`}
                      style={{ left: ox + p.labelX, top: oy + p.labelY }}
                      title={pinTitle(p.name, pinInfo.find((q) => q.name === p.name)?.description)}
                      onClick={clickable ? activate : undefined}
                      disabled={!clickable}
                      {...trace}
                    >
                      {p.name}
                    </button>
                  </React.Fragment>
                );
              })}
          </div>

          {pinInfo.length > 0 && (
            <div className="pid-pin-hint">
              {wireInProgress
                ? t('editor.componentProps.tapToConnect')
                : onPinSelect
                  ? t('editor.componentProps.tapToWire')
                  : t('editor.componentProps.pinRoles')}
            </div>
          )}

          <div className="pid-actions">
            {confirmingDelete ? (
              <>
                <span className="pid-confirm-label">
                  {t('editor.componentProps.confirmDelete', { name: componentMetadata.name })}
                  {deleteHint && <em className="pid-confirm-hint">{deleteHint}</em>}
                </span>
                <button
                  className="pid-action-button"
                  onClick={() => setConfirmingDelete(false)}
                  title={t('editor.componentProps.cancel')}
                >
                  {t('editor.componentProps.cancel')}
                </button>
                <button
                  className="pid-action-button pid-action-delete"
                  onClick={() => {
                    setConfirmingDelete(false);
                    onDelete(componentId);
                  }}
                  title={t('editor.componentProps.confirmDeleteTitle')}
                >
                  {deleteLabel ?? t('editor.componentProps.delete')}
                </button>
              </>
            ) : (
              <>
                {/* Boards pass no onRotate (they do not rotate); they pass
                    Board Options / Flash as extraActions instead. */}
                {onRotate && (
                  <button
                    className="pid-action-button"
                    onClick={() => onRotate(componentId)}
                    title={t('editor.componentProps.rotate90')}
                  >
                    {t('editor.componentProps.rotate')}
                  </button>
                )}
                {extraActions?.map((a) => (
                  <button
                    key={a.id}
                    className="pid-action-button"
                    onClick={a.disabled ? undefined : a.onSelect}
                    disabled={a.disabled}
                    title={a.title}
                  >
                    {a.label}
                  </button>
                ))}
                <button
                  className="pid-action-button pid-action-delete"
                  onClick={() => setConfirmingDelete(true)}
                  title={t('editor.componentProps.deleteTitle')}
                >
                  {deleteLabel ?? t('editor.componentProps.delete')}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Right column: tabs. */}
        <div className="pid-right">
          <div className="pid-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'properties'}
              className={`pid-tab${tab === 'properties' ? ' pid-tab--active' : ''}`}
              onClick={() => setTab('properties')}
            >
              {t('editor.inspector.propertiesTab')}
            </button>
            <button
              role="tab"
              aria-selected={tab === 'datasheet'}
              className={`pid-tab${tab === 'datasheet' ? ' pid-tab--active' : ''}`}
              onClick={() => setTab('datasheet')}
            >
              {t('editor.inspector.datasheetTab')}
            </button>
          </div>

          {tab === 'properties' ? (
            <div className="pid-tab-body">
              {/* Current Arduino pin assignment (read-only) */}
              {componentProperties.pin !== undefined && (
                <div className="pid-row">
                  <span className="pid-row-label">{t('editor.componentProps.arduinoPin')}</span>
                  <span className="pid-row-value">
                    {componentProperties.pin >= 14
                      ? `A${componentProperties.pin - 14}`
                      : `D${componentProperties.pin}`}
                  </span>
                </div>
              )}

              {/* Editable properties (select / text / number) */}
              {editableProps.map((prop: any) => {
                const current = String(componentProperties[prop.name] ?? prop.defaultValue ?? '');
                if (prop.control === 'select' && prop.options) {
                  return (
                    <div key={prop.name} className="pid-row">
                      <label className="pid-row-label">{prop.description || prop.name}</label>
                      <select
                        className="pid-select"
                        value={current}
                        onChange={(e) => onPropertyChange?.(componentId, prop.name, e.target.value)}
                      >
                        {prop.options.map((opt: string) => (
                          <option key={opt} value={opt}>
                            {opt.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }
                return (
                  <div key={prop.name} className="pid-row">
                    <label className="pid-row-label">{prop.description || prop.name}</label>
                    <input
                      type={prop.control === 'number' ? 'number' : 'text'}
                      className="pid-input"
                      value={current}
                      onChange={(e) => onPropertyChange?.(componentId, prop.name, e.target.value)}
                    />
                  </div>
                );
              })}

              {/* Keyboard binding - drive this pushbutton with a keyboard key */}
              {isKeyBindable(componentMetadata.id) && (
                <div className="pid-keybind">
                  <div className="pid-row">
                    <label className="pid-row-label">{t('editor.componentProps.keyboardKey')}</label>
                    <div className="keybind-controls">
                      <button
                        type="button"
                        className={`keybind-chip${capturingKey ? ' keybind-chip--capturing' : ''}${
                          !boundKey && !capturingKey ? ' keybind-chip--empty' : ''
                        }`}
                        onClick={() => setCapturingKey((c) => !c)}
                      >
                        {capturingKey
                          ? t('editor.componentProps.pressAKey')
                          : boundKey
                            ? formatKeyLabel(boundKey)
                            : t('editor.componentProps.assignKey')}
                      </button>
                      {boundKey && !capturingKey && (
                        <button
                          type="button"
                          className="keybind-clear"
                          title={t('editor.componentProps.clearKey')}
                          onClick={() => onPropertyChange?.(componentId, 'key', '')}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                  {keyInUseElsewhere && (
                    <div className="keybind-hint">{t('editor.componentProps.keyInUse')}</div>
                  )}
                </div>
              )}

              {/* microSD upload panel: the standalone card and any part that
                  declares its own TF slot (metadata.sdSlot). */}
              {(componentMetadata.id === 'microsd-card' || componentMetadata.sdSlot === true) && (
                <SdCardPanel
                  files={(componentProperties.sdFiles as UploadedSdFile[] | undefined) ?? []}
                  onChange={(next) => onPropertyChange?.(componentId, 'sdFiles', next)}
                />
              )}

              {/* Remaining defaults, read-only, like the picker card shows. */}
              {readOnlyProps.length > 0 && (
                <div className="pid-defaults">
                  {readOnlyProps.slice(0, 8).map((p) => (
                    <div className="pid-row pid-row--dim" key={p.name}>
                      <span className="pid-row-label">{p.name}</span>
                      <span className="pid-row-value">{formatValue(p)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="pid-tab-body pid-tab-body--doc">
              <ComponentInfoBody data={panelData} showProps={false} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
