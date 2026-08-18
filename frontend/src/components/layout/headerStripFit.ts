/**
 * Does the editor toolbar strip fit on the header's first row?
 *
 * The strip rides inside the header next to the brand + menus. When the
 * window is small or the AI chat is docked, one row genuinely cannot hold
 * it and it must drop to a full-width second bar. Deciding that with media
 * queries meant guessing thresholds (1040 / 1060 / 1400px by chat state)
 * that were only right for one board: a XIAO with display + camera + mic +
 * scope controls needs a wider strip than an Uno, so at 1440px with the
 * chat docked the strip wrapped INSIDE the header instead — an orphan
 * group of canvas controls floating in a tall header next to a black hole.
 *
 * So the header measures instead. Pure function over the DOM so it can be
 * unit-tested; `AppHeader` wires it to a ResizeObserver.
 */

export interface StripFitInput {
  /** Width of `.header-content` — the row the brand, menus and strip share. */
  contentWidth: number;
  /** Width of `.header-left` (brand + menus), pinned to the first row. */
  leftWidth: number;
  /** Horizontal margins of the strip host (`.header-editor-toolbar`). */
  hostMarginX: number;
  /** Horizontal padding of the strip itself (`.unified-toolbar`). */
  stripPaddingX: number;
  /** Natural width of each strip zone at its own content size. */
  zoneWidths: readonly number[];
}

/** Natural single-row width the strip needs. */
export function stripNeededWidth(i: StripFitInput): number {
  return i.zoneWidths.reduce((a, b) => a + b, 0) + i.stripPaddingX + i.hostMarginX;
}

/** Width the first row can give the strip next to the brand + menus. */
export function stripAvailableWidth(i: StripFitInput): number {
  return i.contentWidth - i.leftWidth;
}

/** True when the strip must drop below the brand row. */
export function stripMustDropBelow(i: StripFitInput): boolean {
  return stripNeededWidth(i) > stripAvailableWidth(i);
}

/**
 * Measure the live header. Zones are measured at `flex: 0 0 auto` so a
 * zone that flexbox has grown to fill the row (the editor zone) reports its
 * content width, not the width it happens to occupy — the styles are
 * restored before returning, and the whole thing runs before paint.
 */
export function measureStripFit(header: HTMLElement): StripFitInput | null {
  const content = header.querySelector<HTMLElement>(':scope > .header-content');
  const left = content?.querySelector<HTMLElement>(':scope > .header-left');
  const host = content?.querySelector<HTMLElement>(':scope > .header-editor-toolbar');
  const strip = host?.firstElementChild as HTMLElement | null | undefined;
  if (!content || !left || !host || !strip) return null;

  const zones = Array.from(strip.children) as HTMLElement[];
  const saved = zones.map((z) => z.style.flex);
  for (const z of zones) z.style.flex = '0 0 auto';
  const zoneWidths = zones.map((z) => z.getBoundingClientRect().width);
  zones.forEach((z, k) => {
    z.style.flex = saved[k];
  });

  const px = (v: string) => parseFloat(v) || 0;
  const hostCs = getComputedStyle(host);
  const stripCs = getComputedStyle(strip);
  return {
    contentWidth: content.clientWidth,
    leftWidth: left.getBoundingClientRect().width,
    hostMarginX: px(hostCs.marginLeft) + px(hostCs.marginRight),
    stripPaddingX: px(stripCs.paddingLeft) + px(stripCs.paddingRight),
    zoneWidths,
  };
}
