/**
 * Board-on-socket magnet — how a shield takes a board.
 *
 * Some components ARE sockets: the Seeed Round Display's back header takes a
 * XIAO the way a breadboard takes a part. Dragging the board near the socket
 * snaps it so the two pin grids coincide, exactly like the real stack; drag it
 * past the tolerance and it comes free again. Same feel as the breadboard
 * magnet in breadboardSnap.ts, but for BOARDS (which move through
 * setBoardPosition, not the component path).
 *
 * The contract is rule-6a style — read from the DOM element like pinInfo, so
 * private-overlay components can declare a socket without this file knowing
 * they exist:
 *
 *   get boardSocket(): { anchorPin: string; accepts: string[] }
 *
 * `anchorPin` names one of the component's OWN pinInfo pads. A dragged board
 * whose boardKind starts with any `accepts` prefix snaps so that ITS pad of
 * the same name lands on that pad. One anchor is enough: both sides lay out
 * their remaining pads at the same physical pitch, which is the whole point
 * of a socket.
 */
import { calculatePinPosition } from './pinPositionCalculator';

/** DynamicComponent wrapper inset: border 2 + padding 4 on every side. */
const WRAPPER_INSET = 6;

/**
 * Magnet range in world px. Chunkier than the breadboard's 9: a board is a
 * two-finger object and the gesture should feel like the magnet grabs it,
 * not like threading a needle. Still small enough that a deliberate drag
 * away releases immediately.
 */
export const SOCKET_SNAP_TOLERANCE = 18;

interface Pt {
  x: number;
  y: number;
}

interface ComponentLike {
  id: string;
  x: number;
  y: number;
  properties?: Record<string, unknown>;
}

/**
 * Snap a dragged board's tentative position onto the nearest accepting
 * socket, or null when none is in range (which is also how it lets go).
 */
export function snapBoardToSocket(
  boardId: string,
  boardKind: string,
  tentativeX: number,
  tentativeY: number,
  components: ComponentLike[],
): Pt | null {
  const boardEl = document.getElementById(boardId) as
    | (HTMLElement & { pinInfo?: Array<{ name: string; x: number; y: number }> })
    | null;
  const boardPins = boardEl?.pinInfo;
  if (!boardPins || boardPins.length === 0) return null;

  let best: { dx: number; dy: number; dist: number } | null = null;
  for (const c of components) {
    const el = document.getElementById(c.id) as
      | (HTMLElement & { boardSocket?: { anchorPin: string; accepts: string[] } })
      | null;
    const sock = el?.boardSocket;
    if (!sock || !Array.isArray(sock.accepts)) continue;
    if (!sock.accepts.some((p) => boardKind.startsWith(p))) continue;
    // Rotated sockets are not supported (same limit as the breadboard).
    if (Number(c.properties?.rotation) || 0) continue;

    const anchor = boardPins.find((p) => p.name === sock.anchorPin);
    if (!anchor) continue;
    const target = calculatePinPosition(
      c.id,
      sock.anchorPin,
      c.x + WRAPPER_INSET,
      c.y + WRAPPER_INSET,
      0,
    );
    if (!target) continue;

    const dx = target.x - (tentativeX + anchor.x);
    const dy = target.y - (tentativeY + anchor.y);
    const dist = Math.hypot(dx, dy);
    if (dist <= SOCKET_SNAP_TOLERANCE && (!best || dist < best.dist)) {
      best = { dx, dy, dist };
    }
  }
  return best ? { x: tentativeX + best.dx, y: tentativeY + best.dy } : null;
}

/**
 * True when the board's CURRENT position IS a socket seat (within half a
 * pixel). This is the z-order question, not the drag question: a seated
 * board must paint above its socket component, an unseated one must stay
 * below components like every other board — the blanket zIndex bump that
 * preceded this check hid a resistor behind an Arduino in every ordinary
 * example.
 */
export function isBoardSeated(
  boardId: string,
  boardKind: string,
  x: number,
  y: number,
  components: ComponentLike[],
): boolean {
  const seat = snapBoardToSocket(boardId, boardKind, x, y, components);
  return !!seat && Math.hypot(seat.x - x, seat.y - y) < 0.5;
}
