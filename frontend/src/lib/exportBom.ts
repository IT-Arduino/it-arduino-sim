/**
 * Bill of Materials as CSV, built in the browser.
 *
 * Upstream served this from a paid `/api/pro/projects/{id}/bom.csv` endpoint
 * that this fork does not have, so the button answered 404 and reported
 * "не удалось". Everything the list needs is already in the simulator store,
 * so nothing has to leave the page — and no saved project is required either.
 */

import registry from '../services/ComponentRegistry';
import { COMPONENT_RU, categoryLabelRu } from './componentNamesRu';

/**
 * Only what a BOM row needs. Structural on purpose: the canvas store keys a
 * part by `metadataId` while types/components calls the same thing `type`, and
 * this module has no reason to care which shape the caller holds.
 */
export interface BomComponent {
  metadataId?: string;
  type?: string;
  properties?: Record<string, unknown>;
}

const partId = (component: BomComponent): string =>
  component.metadataId || component.type || 'unknown';

export interface BomRow {
  name: string;
  id: string;
  category: string;
  quantity: number;
  details: string;
}

/** Property keys that describe placement on the canvas, not the part itself. */
const IGNORED_PROPERTIES = new Set(['x', 'y', 'rotation', 'label', 'name']);

function describeProperties(properties: Record<string, unknown> | undefined): string {
  if (!properties) return '';

  return Object.entries(properties)
    .filter(([key, value]) => {
      if (IGNORED_PROPERTIES.has(key)) return false;
      if (value === null || value === undefined || value === '') return false;
      return typeof value !== 'object';
    })
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('; ');
}

/**
 * Collapses the canvas into one row per (type + properties) pair: ten identical
 * resistors read as a single line with quantity 10, while a 220 Ω and a 10 kΩ
 * resistor stay on separate lines — which is the point of a BOM.
 */
export function buildBomRows(components: readonly BomComponent[]): BomRow[] {
  const rows = new Map<string, BomRow>();

  for (const component of components) {
    const id = partId(component);
    const meta = registry.getById(id);
    const details = describeProperties(component.properties);
    const key = `${id} ${details}`;

    const existing = rows.get(key);
    if (existing) {
      existing.quantity += 1;
      continue;
    }

    rows.set(key, {
      name: COMPONENT_RU[id]?.name || meta?.name || id,
      id,
      category: meta?.category ? categoryLabelRu(meta.category) : '',
      quantity: 1,
      details,
    });
  }

  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** RFC 4180 quoting: double the quotes, wrap anything holding a separator. */
function csvCell(value: string | number): string {
  const text = String(value);
  if (!/[";\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function bomToCsv(rows: BomRow[]): string {
  const header = ['Деталь', 'Идентификатор', 'Категория', 'Количество', 'Параметры'];
  const lines = [
    header.join(';'),
    ...rows.map((r) => [r.name, r.id, r.category, r.quantity, r.details].map(csvCell).join(';')),
  ];

  // Semicolons plus a leading BOM: Excel under a Russian locale splits on ';'
  // and needs the BOM to read the file as UTF-8 instead of the system codepage.
  return `﻿${lines.join('\r\n')}\r\n`;
}
