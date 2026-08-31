/**
 * Tests for the fork's component catalog filter (src/lib/componentCatalog).
 *
 * Two behaviours matter enough to pin down:
 *
 *   - A part belonging to a board this fork does not simulate must stay gone
 *     no matter what the administrator's config says. Putting an ESP32 devkit
 *     back would put a part on the canvas that can never run.
 *   - A broken or hostile config must never empty the catalog. An
 *     administrator who mistypes the file should lose their customisation,
 *     not the simulator.
 */
import { describe, it, expect } from 'vitest';
import type { ComponentMetadata } from '../types/component-metadata';
import { filterComponents, parseCatalogConfig } from '../lib/componentCatalog';

function part(id: string): ComponentMetadata {
  return {
    id,
    tagName: `wokwi-${id}`,
    name: id,
    category: 'output',
    thumbnail: '',
    properties: [],
    defaultValues: {},
    pinCount: 2,
    tags: [],
  };
}

const CATALOG = [
  part('led'),
  part('resistor-220'),
  part('epaper-2in9-bw'),
  // Boards of families this fork removed — hard-disabled.
  part('esp32-devkit-v1'),
  part('raspberry-pi-3'),
];

const ids = (list: ComponentMetadata[]) => list.map((c) => c.id);

describe('filterComponents', () => {
  it('drops parts of removed boards even with an empty config', () => {
    const out = filterComponents(CATALOG, { disabled: [], enabledOnly: null });
    expect(ids(out)).toEqual(['led', 'resistor-220', 'epaper-2in9-bw']);
  });

  it('cannot be talked into restoring a removed board', () => {
    // enabledOnly naming a hard-disabled id must not bring it back.
    const out = filterComponents(CATALOG, {
      disabled: [],
      enabledOnly: ['led', 'esp32-devkit-v1', 'raspberry-pi-3'],
    });
    expect(ids(out)).toEqual(['led']);
  });

  it('hides ids listed in disabled', () => {
    const out = filterComponents(CATALOG, {
      disabled: ['epaper-2in9-bw'],
      enabledOnly: null,
    });
    expect(ids(out)).toEqual(['led', 'resistor-220']);
  });

  it('shows only enabledOnly when it is set', () => {
    const out = filterComponents(CATALOG, {
      disabled: [],
      enabledOnly: ['resistor-220'],
    });
    expect(ids(out)).toEqual(['resistor-220']);
  });

  it('lets disabled win over enabledOnly for the same id', () => {
    const out = filterComponents(CATALOG, {
      disabled: ['led'],
      enabledOnly: ['led', 'resistor-220'],
    });
    expect(ids(out)).toEqual(['resistor-220']);
  });

  it('ignores ids that match no part', () => {
    const out = filterComponents(CATALOG, {
      disabled: ['not-a-real-part'],
      enabledOnly: null,
    });
    expect(ids(out)).toEqual(['led', 'resistor-220', 'epaper-2in9-bw']);
  });
});

describe('parseCatalogConfig', () => {
  it('reads a well-formed config', () => {
    expect(parseCatalogConfig({ disabled: ['a'], enabledOnly: ['b'] })).toEqual({
      disabled: ['a'],
      enabledOnly: ['b'],
    });
  });

  it('treats a missing enabledOnly as "show everything"', () => {
    expect(parseCatalogConfig({ disabled: ['a'] })).toEqual({
      disabled: ['a'],
      enabledOnly: null,
    });
  });

  it('ignores the administrator comment keys', () => {
    const parsed = parseCatalogConfig({ _readme: 'подсказка', disabled: [] });
    expect(parsed).toEqual({ disabled: [], enabledOnly: null });
  });

  it('falls back to an empty config for junk input', () => {
    const empty = { disabled: [], enabledOnly: null };
    expect(parseCatalogConfig(null)).toEqual(empty);
    expect(parseCatalogConfig('nope')).toEqual(empty);
    expect(parseCatalogConfig(42)).toEqual(empty);
    // `disabled` of the wrong type must not throw or hide everything.
    expect(parseCatalogConfig({ disabled: 'led' })).toEqual(empty);
  });

  it('keeps the string entries of a partly wrong list', () => {
    expect(parseCatalogConfig({ disabled: ['led', 7, null] })).toEqual({
      disabled: ['led'],
      enabledOnly: null,
    });
  });
});
