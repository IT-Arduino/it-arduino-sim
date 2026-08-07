/**
 * NewProjectDialog — starter-template picker.
 *
 * Shown (a) on a pristine `/editor` visit, instead of silently dropping the
 * user into the hardcoded Arduino Uno + LED starter, and (b) from the
 * "New workspace" button / File menu entry. Offers a blank workspace plus a
 * ready-to-run Blink starter per board family (Arduino, ESP32, Seeed XIAO,
 * STM32, Raspberry Pi).
 *
 * Selecting a board loads its gallery Blink example when one exists (full
 * wiring: 220Ω resistor + LED); boards without one get a fresh board whose
 * default sketch blinks the on-board LED. Pro-gated boards (STM32 + QEMU
 * Raspberry Pi) carry the same PRO pill as the component picker and go
 * through the same `boardGateDecision` seam before anything is created.
 */
import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { BoardKind } from '../../types/board';
import { BOARD_KIND_LABELS } from '../../types/board';
import {
  boardGateDecision,
  isProBoardKind,
  proBoardFeatureName,
  triggerProUpgradePrompt,
} from '../../lib/proBoardGate';
import {
  listProBoards,
  subscribeProBoards,
  getProBoardsVersion,
} from '../../lib/proBoardRegistry';
import { useSimulatorStore, DEFAULT_BOARD_POSITION } from '../../store/useSimulatorStore';
import { useProjectStore } from '../../store/useProjectStore';
import { getLocaleFromPath, localizedPath } from '../../i18n/path';
import { loadExample } from '../../utils/loadExample';
import type { ExampleProject } from '../../data/examples';
import { trackSelectBoard } from '../../utils/analytics';
import './NewProjectDialog.css';

interface NewProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Card blurbs (same voice as the component picker's board descriptions). */
const BOARD_BLURBS: Record<string, string> = {
  'arduino-uno': '8-bit AVR, 32KB flash, 14 digital I/O',
  esp32: 'Xtensa LX6 dual-core, WiFi+BT, 38 GPIO (QEMU)',
  'esp32-devkit-c-v4': 'ESP32 DevKit C V4, official Espressif (QEMU)',
  'esp32-cam': 'ESP32 + 2MP camera, microSD (QEMU)',
  'wemos-lolin32-lite': 'Compact ESP32, LiPo battery support (QEMU)',
  'esp32-s3': 'Xtensa LX7 dual-core, WiFi+BT, AI accel (QEMU)',
  'arduino-nano-esp32': 'Nano form-factor, ESP32-S3, RGB LED (QEMU)',
  'esp32-c3': 'RISC-V single-core, WiFi+BLE, 22 GPIO (QEMU)',
  'aitewinrobot-esp32c3-supermini': 'ESP32-C3 SuperMini (QEMU)',
  'xiao-esp32-s3': 'Seeed XIAO tiny form, 8MB flash+PSRAM (QEMU)',
  'xiao-esp32-c3': 'Seeed XIAO ESP32-C3 mini board (QEMU)',
  'stm32-bluepill': 'STM32F103C8 Cortex-M3, 64KB flash, 37 GPIO (QEMU)',
  'stm32-blackpill': 'STM32F411CE Cortex-M4, 512KB flash, 50 GPIO (QEMU)',
  'stm32-bluepill-f103cb': 'STM32F103CB Cortex-M3, 128KB flash, 37 GPIO (QEMU)',
  'stm32-blackpill-f401': 'STM32F401CE Cortex-M4, 512KB flash, 50 GPIO (QEMU)',
  'stm32-f4-discovery': 'STM32F407VG Cortex-M4, 1MB flash, 4 onboard LEDs (QEMU)',
  'stm32-olimex-h405': 'Olimex STM32-H405, F405RG Cortex-M4, 1MB flash (QEMU)',
  'stm32-netduino-plus2': 'Netduino Plus 2, STM32F405 Cortex-M4 (QEMU)',
  'stm32-netduino2': 'Netduino 2, STM32F205 Cortex-M3 (QEMU, serial)',
  'raspberry-pi-pico': 'RP2040 dual-core Cortex-M0+',
  'raspberry-pi-3': 'ARM64 Cortex-A53 quad-core, Linux/Python (QEMU)',
  'raspberry-pi-4': 'ARM64 Cortex-A72 quad-core, Linux/Python (QEMU)',
  'raspberry-pi-5': 'ARM64 Cortex-A76 quad-core + RP1 I/O, Linux/Python (QEMU)',
};

const ESP32_BOARDS: BoardKind[] = [
  'esp32',
  'esp32-devkit-c-v4',
  'esp32-cam',
  'wemos-lolin32-lite',
  'esp32-s3',
  'arduino-nano-esp32',
  'esp32-c3',
  'aitewinrobot-esp32c3-supermini',
];

const XIAO_BOARDS: BoardKind[] = ['xiao-esp32-s3', 'xiao-esp32-c3'];

const STM32_BOARDS: BoardKind[] = [
  'stm32-bluepill',
  'stm32-blackpill',
  'stm32-bluepill-f103cb',
  'stm32-blackpill-f401',
  'stm32-f4-discovery',
  'stm32-olimex-h405',
  'stm32-netduino-plus2',
  'stm32-netduino2',
];

const PI_BOARDS: BoardKind[] = [
  'raspberry-pi-pico',
  'raspberry-pi-3',
  'raspberry-pi-4',
  'raspberry-pi-5',
];

/**
 * Gallery Blink example per board kind, when one exists. Preferred ids first
 * (some kinds have several blink-ish examples — e.g. esp32 also has the
 * ESP-IDF variant); a generic single-board "blink" search covers overlay
 * examples registered at runtime.
 */
const PREFERRED_BLINK_EXAMPLE: Record<string, string> = {
  'arduino-uno': 'blink-led',
  esp32: 'esp32-blink-led',
  'esp32-s3': 'esp32s3-blink-led',
  'esp32-c3': 'c3-blink',
  'esp32-c6': 'c6-blink',
  'raspberry-pi-pico': 'pico-blink',
  'raspberry-pi-3': 'pi3-blink-led',
  'xiao-rp2040': 'xiao-rp2040-blink',
  'xiao-esp32c6': 'xiao-esp32c6-blink',
  'stm32-bluepill': 'stm32-bluepill-blink',
  'stm32-blackpill': 'stm32-blackpill-blink',
  'stm32-bluepill-f103cb': 'stm32-bluepill-f103cb-blink',
  'stm32-blackpill-f401': 'stm32-blackpill-f401-blink',
  'stm32-f4-discovery': 'stm32-f4-discovery-blink',
  'stm32-olimex-h405': 'stm32-olimex-h405-blink',
  'stm32-netduino-plus2': 'stm32-netduino-plus2-blink',
};

/** Dynamic import keeps the (large) gallery data out of the editor bundle
 *  until a starter is actually picked. */
async function findBlinkExample(kind: string): Promise<ExampleProject | undefined> {
  const { exampleProjects } = await import('../../data/examples');
  const preferredId = PREFERRED_BLINK_EXAMPLE[kind];
  if (preferredId) {
    const preferred = exampleProjects.find((e) => e.id === preferredId);
    if (preferred) return preferred;
  }
  return exampleProjects.find(
    (e) => !e.boards && e.boardType === kind && /blink/i.test(`${e.id} ${e.title}`),
  );
}

/**
 * Replace the workspace with the chosen starter. 'blank' leaves an empty
 * canvas (boards are optional — the board-less analog examples rely on the
 * same state). Board kinds load their gallery Blink example when one exists;
 * otherwise a fresh board whose default sketch already blinks the on-board
 * LED (createFileGroup picks the per-board/language blink content).
 */
async function applyStarter(kind: string | 'blank'): Promise<void> {
  // Clear currentProject FIRST — same auto-save hazard loadExample documents:
  // mutating the stores while a saved project is still "current" lets the
  // debounced PUT overwrite that project with the starter's content.
  useProjectStore.getState().clearCurrentProject();

  const sim = useSimulatorStore.getState();
  sim.boards.forEach((b) => sim.stopBoard(b.id));
  sim.boards.map((b) => b.id).forEach((id) => sim.removeBoard(id));
  sim.setComponents([]);
  sim.setWires([]);

  if (kind !== 'blank') {
    let example: ExampleProject | undefined;
    try {
      example = await findBlinkExample(kind);
    } catch {
      example = undefined;
    }
    if (example) {
      await loadExample(example);
    } else {
      const fresh = useSimulatorStore.getState();
      const newId = fresh.addBoard(
        kind as BoardKind,
        DEFAULT_BOARD_POSITION.x,
        DEFAULT_BOARD_POSITION.y,
      );
      fresh.setActiveBoardId(newId);
    }
  }

  // The workspace no longer belongs to whatever project URL we were on —
  // leaving it would silently reload the OLD project over this fresh
  // workspace on refresh. replaceState, not pushState (a back-entry at the
  // stale project URL would remount the project route and reload it).
  const locale = getLocaleFromPath(window.location.pathname);
  const editorPath = localizedPath('/editor', locale);
  if (window.location.pathname !== editorPath) {
    window.history.replaceState(null, '', editorPath);
  }
}

const ProPill: React.FC = () => (
  <span className="new-project-pro" title="Pro feature — paid plan or Velxio Desktop">
    PRO
  </span>
);

export const NewProjectDialog: React.FC<NewProjectDialogProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();

  // Late-overlay registrations (the @pro import is dynamic) must re-render an
  // already-mounted dialog — same contract as the component picker.
  const proBoardsVersion = useSyncExternalStore(
    subscribeProBoards,
    getProBoardsVersion,
    getProBoardsVersion,
  );

  const sections = useMemo(() => {
    const defs = listProBoards();
    const overlay = (prefix: string) =>
      defs
        .filter((d) => d.kind.startsWith(prefix))
        .map((d) => ({ kind: d.kind, blurb: d.description }));
    const oss = (kinds: BoardKind[]) =>
      kinds.map((k) => ({ kind: k as string, blurb: BOARD_BLURBS[k] ?? '' }));
    return [
      { title: 'Arduino', entries: oss(['arduino-uno']) },
      { title: 'ESP32', entries: [...oss(ESP32_BOARDS), ...overlay('esp32')] },
      { title: 'Seeed Studio XIAO', entries: [...oss(XIAO_BOARDS), ...overlay('xiao')] },
      { title: 'STM32', entries: oss(STM32_BOARDS) },
      { title: 'Raspberry Pi', entries: oss(PI_BOARDS) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proBoardsVersion]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelect = (kind: string | 'blank') => {
    if (kind !== 'blank' && boardGateDecision(kind as BoardKind) === 'block') {
      // Same gate as adding the board from the picker: close, prompt, create
      // nothing. The overlay's upgrade modal takes over from here.
      onClose();
      triggerProUpgradePrompt(proBoardFeatureName(kind));
      return;
    }
    if (kind !== 'blank') trackSelectBoard(kind);
    onClose();
    applyStarter(kind).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[editor] starter template failed to load:', err);
    });
  };

  // Portal to <body>: escape the canvas subtree so no ancestor stacking
  // context can pin the dialog below floating panels (e.g. the AI chat).
  return createPortal(
    <div className="new-project-overlay" onClick={onClose}>
      <div
        className="new-project-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="new-project-head">
          <h3 className="new-project-title">{t('editor.newProject.title')}</h3>
          <p className="new-project-sub">{t('editor.newProject.subtitle')}</p>
        </div>

        <div className="new-project-body">
          <div className="new-project-grid">
            <button
              className="new-project-card new-project-card-blank"
              onClick={() => handleSelect('blank')}
            >
              <span className="new-project-card-name">
                {t('editor.newProject.blankTitle')}
              </span>
              <span className="new-project-card-desc">
                {t('editor.newProject.blankDesc')}
              </span>
            </button>
          </div>

          {sections.map((section) =>
            section.entries.length === 0 ? null : (
              <React.Fragment key={section.title}>
                <div className="new-project-section-title">{section.title}</div>
                <div className="new-project-grid">
                  {section.entries.map(({ kind, blurb }) => (
                    <button
                      key={kind}
                      className="new-project-card"
                      onClick={() => handleSelect(kind)}
                    >
                      {isProBoardKind(kind) && <ProPill />}
                      <span className="new-project-card-name">
                        {BOARD_KIND_LABELS[kind as BoardKind] ?? kind}
                      </span>
                      <span className="new-project-card-desc">{blurb}</span>
                    </button>
                  ))}
                </div>
              </React.Fragment>
            ),
          )}
        </div>

        <div className="new-project-foot">
          <button className="new-project-cancel" onClick={onClose}>
            {t('editor.newProject.cancel')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
