/**
 * Pro web-flash registry.
 *
 * Flashing a real board over Web Serial (esptool-js) is implemented in the
 * pro overlay; the OSS app only knows the doorbell. Mirrors the other
 * OSS->Pro seams (`proBoardGate.ts`, `proSaveAction.ts`, `proRoutes.ts`):
 * the OSS app defines a stable interface, the overlay plugs in.
 *
 *   - OSS without an overlay -> no impl installed. The board context menu
 *     keeps its desktop-only gate and the web build behaves exactly as
 *     before this seam existed.
 *   - With the pro overlay   -> installWebFlashImpl() provides the real
 *     flasher; the "Flash to real board" menu item appears in supported
 *     browsers for supported board kinds.
 *
 * The seam speaks plain data only (base64 program, progress callbacks) —
 * OSS must never see esptool-js types.
 */

export interface WebFlashProgress {
  phase: 'connecting' | 'erasing' | 'writing' | 'resetting';
  /** 0-100, meaningful during 'writing'. */
  pct: number;
  /** Optional log line to append to the modal's console. */
  line?: string;
}

export interface WebFlashRequest {
  boardId: string;
  boardKind: string;
  /** The board's compiled program: base64 of the merged flash image. */
  binaryBase64: string;
  onProgress: (p: WebFlashProgress) => void;
  /** Aborting disconnects the transport; the chip stays recoverable. */
  signal: AbortSignal;
}

export interface WebFlashResult {
  /** Chip name as detected by the loader, e.g. "ESP32-S3". */
  chipName: string;
  elapsedMs: number;
}

export interface WebFlashImpl {
  /**
   * Whether this board kind can be flashed over Web Serial in this
   * browser (chip family supported AND `navigator.serial` present).
   */
  available(boardKind: string): boolean;
  /**
   * Request a port, connect, write the image and hard-reset. Rejects
   * with an Error whose message is user-presentable.
   */
  flash(req: WebFlashRequest): Promise<WebFlashResult>;
}

let _impl: WebFlashImpl | null = null;

/** Installed by the pro overlay (mountPro). Pass null to clear (hot reload). */
export function installWebFlashImpl(impl: WebFlashImpl | null): void {
  _impl = impl;
}

/** The overlay's flasher, or null in a pure OSS build. */
export function getWebFlashImpl(): WebFlashImpl | null {
  return _impl;
}

/**
 * Whether the installed flasher (if any) supports `boardKind` here.
 * Safe to call unconditionally — false in OSS builds and on browsers
 * without Web Serial.
 */
export function webFlashAvailable(boardKind: string): boolean {
  if (!_impl) return false;
  try {
    return _impl.available(boardKind);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[oss] web-flash impl threw in available():', err);
    return false;
  }
}
