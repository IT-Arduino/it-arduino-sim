/**
 * Component catalog filter.
 *
 * ComponentRegistry loads every part from `/components-metadata.json` (a file
 * generated at build time from the wokwi-elements packages) and then pushes a
 * few code-defined extras onto the same list. This module is the single seam
 * between that list and the picker, and it does two separate jobs:
 *
 *   1. Hard removals. Parts belonging to boards this fork does not simulate
 *      are dropped unconditionally — an ESP32 devkit on the canvas of an
 *      AVR-only simulator is a broken part, not a choice. See
 *      BOARD_COMPONENT_IDS_TO_DROP in ./boardAllowlist.
 *
 *   2. Administrator toggles. `/components-config.json` sits next to the
 *      metadata in frontend/public/, so an administrator edits it on the
 *      server and the change takes effect on the next page load — no rebuild,
 *      no redeploy. Teachers running a beginners' course can cut the catalog
 *      down to the dozen parts a lesson uses and grow it later.
 *
 * Both the fetch and the parse are failure-tolerant on purpose: a missing or
 * malformed config must never take the whole catalog down. When anything goes
 * wrong the hard removals still apply and every other part stays visible, and
 * the reason is logged once.
 *
 * See docs/fork/COMPONENTS.ru.md for the administrator-facing instructions.
 */
import type { ComponentMetadata } from '../types/component-metadata';
import { BOARD_COMPONENT_IDS_TO_DROP } from './boardAllowlist';
import { translateComponents } from './componentNamesRu';

/** Where the administrator's toggle file lives, relative to the site root. */
const CONFIG_URL = '/components-config.json';

export interface CatalogConfig {
  /**
   * Ids to hide. Applied after `enabledOnly`, so an id in both lists is
   * hidden — "off" always wins, which is the safer reading of a config
   * someone edited in a hurry.
   */
  disabled: string[];
  /**
   * When non-null, ONLY these ids are shown (minus anything in `disabled`).
   * Null means "show everything except `disabled`", which is the default and
   * what an administrator wants unless they are curating a short lesson set.
   */
  enabledOnly: string[] | null;
}

const EMPTY_CONFIG: CatalogConfig = { disabled: [], enabledOnly: null };

/** Ids no config can bring back — their boards do not exist in this fork. */
const HARD_DISABLED = new Set<string>(BOARD_COMPONENT_IDS_TO_DROP);

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v): v is string => typeof v === 'string');
  // A list that lost entries to the type filter is a config the administrator
  // got wrong; say so rather than silently applying half of it.
  if (out.length !== value.length) {
    console.warn('[catalog] components-config.json: ignoring non-string entries');
  }
  return out;
}

/** Parse a fetched config body, tolerating every shape but the right one. */
export function parseCatalogConfig(raw: unknown): CatalogConfig {
  if (!raw || typeof raw !== 'object') return EMPTY_CONFIG;
  const obj = raw as Record<string, unknown>;
  return {
    disabled: asStringArray(obj.disabled) ?? [],
    enabledOnly: asStringArray(obj.enabledOnly),
  };
}

let _configPromise: Promise<CatalogConfig> | null = null;

/**
 * Fetch the administrator config once per page load. Cached in a module-level
 * promise so a second registry load (StrictMode double-mount in dev) does not
 * issue a second request.
 */
export function loadCatalogConfig(): Promise<CatalogConfig> {
  if (_configPromise) return _configPromise;
  _configPromise = (async () => {
    try {
      // `no-store` for the same reason ComponentRegistry uses it on the
      // metadata: an administrator who edits the file wants to see the result
      // after one refresh, not after a cache expiry.
      const response = await fetch(CONFIG_URL, { cache: 'no-store' });
      if (!response.ok) {
        // A deployment without the file is a legitimate setup, not an error.
        if (response.status !== 404) {
          console.warn(`[catalog] ${CONFIG_URL}: HTTP ${response.status}`);
        }
        return EMPTY_CONFIG;
      }
      return parseCatalogConfig(await response.json());
    } catch (err) {
      console.warn(`[catalog] ${CONFIG_URL} unreadable, showing full catalog:`, err);
      return EMPTY_CONFIG;
    }
  })();
  return _configPromise;
}

/** Apply a config to a component list. Pure — exported for the unit test. */
export function filterComponents(
  components: ComponentMetadata[],
  config: CatalogConfig,
): ComponentMetadata[] {
  const disabled = new Set(config.disabled);
  const allowed = config.enabledOnly ? new Set(config.enabledOnly) : null;
  return components.filter((c) => {
    if (HARD_DISABLED.has(c.id)) return false;
    if (allowed && !allowed.has(c.id)) return false;
    return !disabled.has(c.id);
  });
}

/**
 * The one call ComponentRegistry makes: fetch the config and apply it.
 */
export async function applyCatalogConfig(
  components: ComponentMetadata[],
): Promise<ComponentMetadata[]> {
  // Перевод — после фильтра, а не до: фильтр работает по `id` и `category`,
  // которых перевод не касается, а гонять через таблицу детали, которые всё
  // равно не покажутся, незачем.
  //
  // Названия и описания деталей приходят из метаданных `@wokwi/elements` и до
  // i18next не доходят вовсе — ComponentPickerModal печатает их как есть.
  // Поэтому русские строки подставляются здесь, в единственном шве, который у
  // форка уже врезан в ComponentRegistry.
  return translateComponents(filterComponents(components, await loadCatalogConfig()));
}
