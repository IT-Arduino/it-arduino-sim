/**
 * Online-only boards — the public "shop window".
 *
 * These boards are implemented by the hosted editor (velxio.com), where they
 * are free to use; their emulation engines and board wiring are not part of
 * the OSS tree. The OSS build knows only this list — name, art, a badge —
 * and renders advertisement cards in the picker that link to the online
 * editor.
 *
 * A build where a board actually exists (the hosted build registers the real
 * BoardKind) must NOT show its ad. Callers filter with `id in
 * BOARD_KIND_LABELS`: when the real kind is registered the ad disappears
 * automatically, so this list needs no per-build switches.
 */

export interface OnlineOnlyBoardAd {
  /** Stable id — matches the BoardKind the hosted build registers. */
  id: string;
  label: string;
  description: string;
  /** Inline SVG for the card thumbnail (rendered via innerHTML). */
  thumbnailSvg: string;
}

/** Where the ad cards send the user. */
export const ONLINE_EDITOR_URL = 'https://velxio.com';

export const ONLINE_ONLY_BOARD_ADS: OnlineOnlyBoardAd[] = [
  {
    id: 'esp32-c6',
    label: 'ESP32-C6-DevKitC-1',
    description: 'RISC-V single-core, WiFi 6 + BLE + 802.15.4 — in-browser emulation',
    thumbnailSvg:
      '<svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="14" y="4" width="44" height="64" rx="4" fill="#1a1a1a"/>' +
      '<rect x="22" y="8" width="28" height="20" rx="2" fill="#b8bec6"/>' +
      '<rect x="26" y="12" width="20" height="12" fill="#2d3138"/>' +
      '<text x="36" y="21" text-anchor="middle" font-size="5" font-family="monospace" fill="#e8e8e8">C6</text>' +
      '<rect x="30" y="60" width="12" height="6" rx="1" fill="#8a8f96"/>' +
      '<g fill="#d4af37">' +
      '<rect x="15" y="32" width="3" height="3"/><rect x="15" y="38" width="3" height="3"/>' +
      '<rect x="15" y="44" width="3" height="3"/><rect x="15" y="50" width="3" height="3"/>' +
      '<rect x="54" y="32" width="3" height="3"/><rect x="54" y="38" width="3" height="3"/>' +
      '<rect x="54" y="44" width="3" height="3"/><rect x="54" y="50" width="3" height="3"/>' +
      '</g></svg>',
  },
  {
    id: 'm5stack-core',
    label: 'M5Stack Core Basic',
    description: 'ESP32 all-in-one: 2" LCD, 3 buttons, speaker, microSD',
    thumbnailSvg:
      '<svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="8" y="8" width="56" height="56" rx="8" fill="#3a3d42"/>' +
      '<rect x="14" y="14" width="44" height="32" rx="2" fill="#101418"/>' +
      '<rect x="17" y="17" width="38" height="26" fill="#1c6ea4"/>' +
      '<circle cx="24" cy="55" r="4" fill="#26282c"/><circle cx="36" cy="55" r="4" fill="#26282c"/>' +
      '<circle cx="48" cy="55" r="4" fill="#26282c"/></svg>',
  },
  {
    id: 'cardputer-adv',
    label: 'M5 Cardputer ADV',
    description: 'ESP32-S3 card computer: ST7789 LCD + 56-key keyboard',
    thumbnailSvg:
      '<svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="6" y="14" width="60" height="44" rx="5" fill="#e8e4dc"/>' +
      '<rect x="10" y="18" width="52" height="18" rx="2" fill="#101418"/>' +
      '<rect x="12" y="20" width="48" height="14" fill="#20242c"/>' +
      '<g fill="#c9c4ba">' +
      Array.from({ length: 3 }, (_, r) =>
        Array.from(
          { length: 12 },
          (_, c) => `<rect x="${11 + c * 4.2}" y="${40 + r * 5.5}" width="3.4" height="4.4" rx="0.8"/>`,
        ).join(''),
      ).join('') +
      '</g></svg>',
  },
  {
    id: 'pimoroni-pico-plus-2w',
    label: 'Pimoroni Pico Plus 2W',
    description: 'RP2350B dual-core RISC-V/ARM + WiFi, 16MB flash + 8MB PSRAM',
    thumbnailSvg:
      '<svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="22" y="4" width="28" height="64" rx="3" fill="#186329"/>' +
      '<rect x="28" y="10" width="16" height="12" rx="1" fill="#b8bec6"/>' +
      '<rect x="28" y="30" width="16" height="14" rx="2" fill="#101418"/>' +
      '<g fill="#d4af37">' +
      Array.from({ length: 8 }, (_, i) => `<rect x="23" y="${8 + i * 7}" width="3" height="3"/>`).join('') +
      Array.from({ length: 8 }, (_, i) => `<rect x="46" y="${8 + i * 7}" width="3" height="3"/>`).join('') +
      '</g></svg>',
  },
  {
    id: 'galactic-unicorn',
    label: 'Pimoroni Galactic Unicorn',
    description: 'RP2350 53×11 RGB LED matrix panel',
    thumbnailSvg:
      '<svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="4" y="22" width="64" height="28" rx="4" fill="#17181c"/>' +
      '<g>' +
      Array.from({ length: 5 }, (_, r) =>
        Array.from(
          { length: 14 },
          (_, c) =>
            `<circle cx="${9 + c * 4.2}" cy="${28 + r * 4.2}" r="1.4" fill="hsl(${(r * 14 + c) * 9},70%,55%)"/>`,
        ).join(''),
      ).join('') +
      '</g></svg>',
  },
  {
    id: 'badger-2350',
    label: 'Pimoroni Badger 2350',
    description: 'RP2350 wearable badge with 2.7" e-ink display',
    thumbnailSvg:
      '<svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="6" y="16" width="60" height="40" rx="4" fill="#17181c"/>' +
      '<rect x="12" y="21" width="48" height="30" fill="#f2f0ea"/>' +
      '<text x="36" y="38" text-anchor="middle" font-size="8" font-family="monospace" fill="#17181c">BADGER</text>' +
      '<circle cx="36" cy="12" r="2.5" fill="none" stroke="#3a3d42" stroke-width="2"/></svg>',
  },
];
