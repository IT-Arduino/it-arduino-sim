/**
 * Whether the editor toolbar strip fits on the header's brand row.
 *
 * The complaint this fixes: with the AI chat docked at 1440px, a board with
 * many canvas controls (XIAO: display + camera + mic + scope) wrapped the
 * strip INSIDE the header — canvas controls orphaned on a second line next
 * to a black hole — because the drop-below fallback fired on guessed media
 * query thresholds instead of the strip's real width. These lock the rule:
 * needed width vs available width, nothing else.
 */
import { describe, it, expect } from 'vitest';
import {
  stripAvailableWidth,
  stripMustDropBelow,
  stripNeededWidth,
} from '../components/layout/headerStripFit';

const base = {
  contentWidth: 1044, // 1440 minus 16px header padding minus 380px docked chat
  leftWidth: 370, // brand + File/Edit/View/Account/Help
  hostMarginX: 20, // .header-editor-toolbar { margin: 0 10px }
  stripPaddingX: 6, // in-header strip pads 6px right
};

describe('header strip fit', () => {
  it('sums the zones plus the strip and host chrome', () => {
    expect(stripNeededWidth({ ...base, zoneWidths: [0, 382, 268] })).toBe(676);
    expect(stripAvailableWidth({ ...base, zoneWidths: [] })).toBe(674);
  });

  it('keeps an Uno-sized strip on the brand row at 1440 with the chat docked', () => {
    // 0 = the view-mode toggle hidden by its container query.
    expect(stripMustDropBelow({ ...base, zoneWidths: [0, 382, 266] })).toBe(false);
  });

  it('drops a XIAO-sized strip below at the same width', () => {
    // Display + camera + mic + scope + add: ~344px of canvas controls.
    expect(stripMustDropBelow({ ...base, zoneWidths: [0, 420, 344] })).toBe(true);
  });

  it('is decided by the real widths, not a viewport threshold', () => {
    // Same 1000px window without the chat: the old media query forced two
    // rows below 1040px; a strip whose labels have collapsed fits fine.
    const noChat = { ...base, contentWidth: 968, leftWidth: 352 };
    expect(stripMustDropBelow({ ...noChat, zoneWidths: [0, 322, 268] })).toBe(false);
    // ...and a wider one on the same window does not.
    expect(stripMustDropBelow({ ...noChat, zoneWidths: [139, 395, 268] })).toBe(true);
  });

  it('treats an exact fit as fitting', () => {
    expect(stripMustDropBelow({ ...base, zoneWidths: [0, 380, 268] })).toBe(false);
  });
});
