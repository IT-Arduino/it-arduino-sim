/**
 * Schematic → PNG, rasterised in the browser.
 *
 * Upstream rendered this server-side behind a paid endpoint this fork does not
 * have. The canvas is not a single SVG we could serialise — it is a DOM tree
 * (`.canvas-world`) holding a wire layer, boards, and wokwi-* custom elements
 * with their own shadow roots — so it goes through modern-screenshot, one of
 * the few rasterisers that walks shadow DOM.
 *
 * The world is a fixed 4000×3000 sheet carrying a pan/zoom transform. Capturing
 * all of it would yield a mostly-empty 12-megapixel image, so the export
 * measures where the content actually sits and crops to that.
 */

import { domToBlob } from 'modern-screenshot';

/** Breathing room around the content, in world pixels. */
const MARGIN = 40;

/** Beyond this the canvas backing store starts failing to allocate. */
const MAX_SIDE = 8000;

export class EmptySchematicError extends Error {
  constructor() {
    super('Схема пуста');
    this.name = 'EmptySchematicError';
  }
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Union of every board and component box, in world coordinates.
 *
 * Measured from the DOM rather than the store because a part's rendered size is
 * only known once its custom element has laid itself out. Screen rects are
 * divided by `zoom` to undo the world transform. The wire layer is deliberately
 * not measured — it spans the whole sheet and would defeat the crop.
 */
function measureContent(world: HTMLElement, zoom: number): Box | null {
  const nodes = world.querySelectorAll<HTMLElement>('[data-component-id], [data-board-id]');
  if (nodes.length === 0) return null;

  const worldRect = world.getBoundingClientRect();
  let box: Box | null = null;

  for (const node of nodes) {
    const r = node.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    const minX = (r.left - worldRect.left) / zoom;
    const minY = (r.top - worldRect.top) / zoom;
    const next = { minX, minY, maxX: minX + r.width / zoom, maxY: minY + r.height / zoom };

    box = box
      ? {
          minX: Math.min(box.minX, next.minX),
          minY: Math.min(box.minY, next.minY),
          maxX: Math.max(box.maxX, next.maxX),
          maxY: Math.max(box.maxY, next.maxY),
        }
      : next;
  }

  return box;
}

/**
 * Reads the live zoom off the element's own transform.
 *
 * The canvas keeps zoom in component state, not in the store, so asking the
 * DOM avoids threading it down through props just for the export.
 */
function readZoom(world: HTMLElement): number {
  const transform = getComputedStyle(world).transform;
  if (!transform || transform === 'none') return 1;

  try {
    const scale = new DOMMatrixReadOnly(transform).a;
    return scale > 0 ? scale : 1;
  } catch {
    return 1;
  }
}

export interface ExportSchematicOptions {
  /** Canvas background, so the PNG isn't transparent where the grid was. */
  background?: string;
  /** Oversampling for a crisper image; clamped so the result fits MAX_SIDE. */
  pixelRatio?: number;
}

export async function exportSchematicPng(
  world: HTMLElement,
  { background = '#1a1a1a', pixelRatio = 2 }: ExportSchematicOptions = {},
): Promise<Blob> {
  const content = measureContent(world, readZoom(world));
  if (!content) throw new EmptySchematicError();

  const x = Math.max(0, content.minX - MARGIN);
  const y = Math.max(0, content.minY - MARGIN);
  const width = Math.ceil(content.maxX - content.minX + MARGIN * 2);
  const height = Math.ceil(content.maxY - content.minY + MARGIN * 2);

  // Trim oversampling before anything else: a less crisp image beats failing to
  // allocate the canvas altogether.
  const ratio = Math.min(pixelRatio, MAX_SIDE / Math.max(width, height), 4);

  return domToBlob(world, {
    width,
    height,
    backgroundColor: background,
    scale: Math.max(1, ratio),
    // The clone renders without the live pan/zoom, so shifting it by the crop
    // origin puts the content's top-left corner at (0,0) of the output.
    style: {
      transform: `translate(${-x}px, ${-y}px)`,
      transformOrigin: '0 0',
    },
    // Pin overlays and drag handles are editing chrome, not schematic.
    filter: (node) => {
      if (!(node instanceof Element)) return true;
      return !node.classList.contains('pin-overlay') && !node.classList.contains('wire-handle');
    },
  });
}
