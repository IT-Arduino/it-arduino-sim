/**
 * Board allowlist — the four AVR boards this fork ships.
 *
 * Upstream's `BoardKind` union in types/board.ts lists thirty boards and its
 * compiler-enforced `Record<BoardKind, …>` maps cover every one of them. We
 * deliberately leave that union alone: trimming it would rewrite half a dozen
 * upstream files and turn every future `git merge upstream/master` into a
 * conflict. Instead, the boards a user can actually reach are filtered through
 * this list at the two places that offer a choice — the board picker and the
 * component catalog.
 *
 * The practical effect is the same (only these four are selectable) and the
 * cost of a future upstream merge stays near zero. A board upstream adds
 * later shows up here as "not allowed" by default rather than as a conflict.
 *
 * To offer another AVR board: add its kind here, make sure entrypoint.avr.sh
 * installs the arduino-cli core its FQBN needs, and check that
 * BOARD_KIND_LABELS / BOARD_KIND_FQBN in types/board.ts already know it.
 * Boards outside the AVR family need far more than a list entry — their
 * simulator, backend compiler lane and Docker toolchain were all removed.
 */
import type { BoardKind } from '../types/board';

export const ALLOWED_BOARD_KINDS = [
  'arduino-uno',
  'arduino-nano',
  'arduino-mega',
  'attiny85',
] as const satisfies readonly BoardKind[];

export type AllowedBoardKind = (typeof ALLOWED_BOARD_KINDS)[number];

const ALLOWED = new Set<string>(ALLOWED_BOARD_KINDS);

/** True for the four boards this fork simulates. */
export function isAllowedBoardKind(kind: BoardKind | string): boolean {
  return typeof kind === 'string' && ALLOWED.has(kind);
}

/**
 * True when every board a gallery example needs is one this fork simulates.
 *
 * An example for a removed board is worse than a missing one: it opens, the
 * canvas fills with a board that cannot run, and the student is left staring
 * at an error nobody explained. Filtering them out of the gallery is the
 * whole point.
 *
 * The parameter is typed structurally rather than as `ExampleProject` so this
 * module stays free of any import from data/examples — that file imports back
 * out of lib/, and a cycle between the two would be a silent trap.
 *
 * Three shapes, matching the example format:
 *   - `boards[]` set  → multi-board setup, EVERY board must be allowed;
 *   - `boardType` set → single board;
 *   - neither         → upstream's documented default is arduino-uno, and
 *                       pure analog circuits (no MCU at all) land here too.
 *                       Both are fine, so an example that declares no board
 *                       is kept.
 */
export function exampleRunsOnAllowedBoards(example: {
  boardType?: string;
  boards?: ReadonlyArray<{ boardKind: string }>;
}): boolean {
  if (example.boards && example.boards.length > 0) {
    return example.boards.every((b) => isAllowedBoardKind(b.boardKind));
  }
  if (example.boardType) return isAllowedBoardKind(example.boardType);
  return true;
}

/**
 * Component ids in components-metadata.json that ARE boards. The catalog
 * stores boards as ordinary components, and most of their ids match a
 * BoardKind one-for-one — but not all of them, so the odd ones are listed
 * here explicitly rather than guessed.
 */
export const BOARD_COMPONENT_IDS_TO_DROP = [
  // ESP32 board, shipped in the metadata file's `boards` category.
  'esp32-devkit-v1',
  // RP2040 board, filed under `other` in the metadata file.
  'nano-rp2040-connect',
  // Franzininho DIY. It is an ATtiny85 board, but it is not one of the four
  // this fork supports and it carries its own pinout; filed under `passive`.
  'franzininho',
  // Raspberry Pi boards, injected in code by ComponentRegistry rather than
  // read from the metadata file.
  'raspberry-pi-zero',
  'raspberry-pi-1',
  'raspberry-pi-2',
  'raspberry-pi-3',
  'raspberry-pi-4',
  'raspberry-pi-5',
] as const;
