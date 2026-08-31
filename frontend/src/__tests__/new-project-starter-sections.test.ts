/**
 * NewProjectDialog starter sections — what the fork's board filter leaves.
 *
 * Upstream's version of this file guarded the display order of the overlay
 * partner sections: M5Stack between ESP32 and STM32, DFRobot / Pimoroni /
 * Espressif after it, Seeed boards folded into the chip-family sections. Not
 * one of those sections can exist here — the fork filters buildStarterSections
 * through lib/boardAllowlist, and every family except Arduino empties out and
 * disappears.
 *
 * So the guard is rewritten around what actually matters now, which happens to
 * be a written acceptance criterion: the board picker offers exactly four
 * boards, and nothing an overlay registers can add a fifth. This dialog is the
 * third place in the app that lists boards — and the one we missed on the
 * first pass, caught only by opening the running app — so it is worth pinning
 * down.
 */
import { describe, it, expect } from 'vitest';
import { buildStarterSections } from '../components/editor/NewProjectDialog';
import { ALLOWED_BOARD_KINDS } from '../lib/boardAllowlist';
import type { ProBoardDef } from '../lib/proBoardRegistry';

const def = (kind: string, label: string, description: string): ProBoardDef => ({
  kind,
  label,
  description,
  fqbn: null,
  tag: `velxio-${kind}`,
  size: { w: 100, h: 100 },
});

const titles = (defs: ProBoardDef[]) =>
  buildStarterSections(defs)
    .filter((s) => s.entries.length > 0)
    .map((s) => s.title);

const kinds = (defs: ProBoardDef[]) =>
  buildStarterSections(defs).flatMap((s) => s.entries.map((e) => e.kind));

describe('NewProjectDialog starter sections', () => {
  it('leaves a single Arduino section', () => {
    expect(titles([])).toEqual(['Arduino']);
  });

  it('offers exactly the four boards this fork simulates', () => {
    expect(kinds([])).toEqual(['arduino-uno', 'arduino-mega', 'arduino-nano', 'attiny85']);
  });

  it('lists every allowed board kind and nothing else', () => {
    expect([...kinds([])].sort()).toEqual([...ALLOWED_BOARD_KINDS].sort());
  });

  it('gives every card a blurb', () => {
    for (const entry of buildStarterSections([]).flatMap((s) => s.entries)) {
      expect(entry.blurb, `blurb missing for ${entry.kind}`).not.toBe('');
    }
  });

  // The pro overlay is not part of this fork, but the registration seam it
  // uses is still in the tree. If someone ever mounts an overlay against this
  // build, its boards must not slip past the allowlist — the filter runs on
  // the assembled sections, after the overlay's entries were spliced in.
  it('ignores boards an overlay registers', () => {
    const defs = [
      def('m5stack-core', 'M5Stack Core', 'ESP32 all-in-one'),
      def('pimoroni-pico-plus-2w', 'Pico Plus 2 W', 'RP2350'),
      def('unihiker-m10', 'UNIHIKER M10', 'Linux single-board'),
    ];
    expect(titles(defs)).toEqual(['Arduino']);
    expect(kinds(defs)).toEqual(['arduino-uno', 'arduino-mega', 'arduino-nano', 'attiny85']);
  });

  it('never returns an empty section', () => {
    for (const section of buildStarterSections([])) {
      expect(section.entries.length, `empty section: ${section.title}`).toBeGreaterThan(0);
    }
  });
});
