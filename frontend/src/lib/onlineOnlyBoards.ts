/**
 * Online-only advertisement cards — emptied in this fork.
 *
 * Upstream ships two lists here: sixteen board cards and twenty-three
 * component cards (M5Stack, Pimoroni, Seeed, DFRobot, Espressif dev kits and
 * a set of `pro-*` sensors). They are not parts the simulator can place —
 * they are advertisements shown in the picker, and clicking one opens the
 * hosted commercial editor at velxio.com.
 *
 * Both lists are empty here, for two independent reasons:
 *
 *   - Trademark. "Velxio" is the upstream author's mark. This fork removes
 *     the name and logo from the interface; a picker full of cards linking
 *     to velxio.com is exactly the use we are removing.
 *   - No outbound traffic. This simulator must work entirely from its own
 *     server, and an ad card exists only to send the user somewhere else.
 *
 * The exported shapes are unchanged so ComponentPickerModal — the single
 * consumer — keeps compiling and rendering untouched: it maps over the lists,
 * and mapping over an empty list draws nothing.
 *
 * Attribution to the upstream project lives in the About dialog instead,
 * which is where AGPLv3 and common courtesy both want it.
 */

export interface OnlineOnlyBoardAd {
  /** Stable id — matches the BoardKind the hosted build registers. */
  id: string;
  label: string;
  description: string;
  /** Inline SVG for the card thumbnail (rendered via innerHTML). */
  thumbnailSvg: string;
}

/**
 * Where an ad card would send the user. Nothing links here any more — both
 * ad lists are empty — but the export is kept so the consumer's import list
 * needs no edit. Points at our own repository rather than a third party.
 */
export const ONLINE_EDITOR_URL = 'https://github.com/IT-Arduino/it-arduino-sim';

/**
 * Ad suppression — the hosted overlay's escape hatch.
 *
 * Upstream's overlay calls this at mount with every id it manages so that an
 * embargoed item shows nothing instead of an ad. With no ads left there is
 * nothing to suppress, but the functions stay: they are part of the module's
 * published surface and cost nothing.
 */
const suppressedAdIds = new Set<string>();

export function suppressOnlineOnlyAds(ids: string[]): void {
  for (const id of ids) suppressedAdIds.add(id);
}

export function isOnlineOnlyAdSuppressed(id: string): boolean {
  return suppressedAdIds.has(id);
}

/** No board advertisements in this fork. */
export const ONLINE_ONLY_BOARD_ADS: OnlineOnlyBoardAd[] = [];

/** Advertisement entry for a hosted-editor-only COMPONENT (picker part).
 *  Shape preserved from upstream so the picker's typing is unchanged. */
export interface OnlineOnlyComponentAd {
  /** Stable id — matches the component metadata id the hosted build merges. */
  id: string;
  label: string;
  description: string;
  /** Picker category the ad card appears under (besides "all"). */
  category: string;
  /** Inline SVG for the card thumbnail (rendered via innerHTML). */
  thumbnailSvg: string;
}

/** No component advertisements in this fork. */
export const ONLINE_ONLY_COMPONENT_ADS: OnlineOnlyComponentAd[] = [];
