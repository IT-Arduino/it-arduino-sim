import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import './index.css';
// Side-effect import: initialises i18next BEFORE any component renders so
// useTranslation() always resolves against a live instance. Must come
// before App.
import './i18n';
import { markProExamplesSettled } from './data/examples';
import { markProRoutesSettled } from './lib/proRoutes';
// Fork: hooks it-arduino.ru accounts into the editor's own seams. See
// lib/itArduinoMount.ts — nothing else in this file knows it exists.
import { mountItArduino } from './lib/itArduinoMount';

/** The overlay import has settled (either way): registries are final. */
const markProOverlaySettled = (): void => {
  markProExamplesSettled();
  markProRoutesSettled();
};
import './components/velxio-components/IC74HC595';
import './components/velxio-components/LogicGateElements';
import './components/velxio-components/TransistorElements';
import './components/velxio-components/OpAmpElements';
import './components/velxio-components/PowerElements';
import './components/velxio-components/DiodeElements';
import './components/velxio-components/RelayElements';
import './components/velxio-components/LogicICElements';
import './components/velxio-components/MotorDriverElements';
import './components/velxio-components/FlipFlopElements';
import './components/velxio-components/RaspberryPi3Element';
import './components/velxio-components/Bmp280Element';
import './components/velxio-components/Ds3231Element';
import './components/velxio-components/GpsNeo6mElement';
import './components/velxio-components/EPaperElement';
import App from './App.tsx';

// Configure monaco-editor for offline use via local static assets
const monacoVsPath = `${import.meta.env.BASE_URL}monaco/vs`;
loader.config({ paths: { vs: monacoVsPath } });

// Before the first render, deliberately. Auth start strips the one-time
// `?ticket=` parameter from the address bar, and the sooner that happens the
// smaller the window in which the ticket can leak through history or Referer.
mountItArduino();

createRoot(document.getElementById('root')!).render(<App />);

// Tear down the Tauri-only splash now that React has mounted. Wait
// two animation frames so React's first paint commits before we
// touch the splash — otherwise users see a black flash between the
// splash fading and the editor first appearing. Fade via CSS
// transition for a smoother handoff, then remove the node entirely
// once the transition finishes.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById('velxio-splash');
    if (!splash) return;
    splash.style.transition = 'opacity 250ms ease-out';
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    window.setTimeout(() => splash.remove(), 320);
  });
});

// Optional pro overlay. The `@pro` import resolves to a no-op stub in the
// open-source build (see vite.config.ts) and to the real overlay only when
// VITE_PRO_BUILD=true at build time. The dynamic import keeps the pro chunk
// out of the OSS bundle entirely (Vite tree-shakes the never-taken branch).
//
// Upstream also had two desktop build modes here, gated on VITE_DESKTOP.
// This fork is a web simulator only — the Tauri shell and everything under
// frontend/src/desktop/ are gone, so both branches went with them.
if (import.meta.env.VITE_PRO_BUILD) {
  import('@pro/index')
    .then((m) => m.mountPro?.())
    .catch((err) => console.warn('[pro] failed to load overlay:', err))
    .finally(markProOverlaySettled);
} else {
  // No overlay is coming: what the registries have now is all there will be.
  markProOverlaySettled();
}

// DEV-only: expose the core stores for E2E harnesses (the platform-bugs QA
// harness drives the STORE paths — property updates, group switches — the
// way the agent tools do, which raw DOM access cannot reach). Guarded by
// import.meta.env.DEV so production bundles never ship it.
if (import.meta.env.DEV) {
  Promise.all([
    import('./store/useSimulatorStore'),
    import('./store/useEditorStore'),
    import('./store/useElectricalStore'),
  ]).then(([sim, ed, el]) => {
    (window as unknown as Record<string, unknown>).__velxioStores = {
      useSimulatorStore: sim.useSimulatorStore,
      useEditorStore: ed.useEditorStore,
      useElectricalStore: el.useElectricalStore,
      getBoardSimulator: sim.getBoardSimulator,
    };
  });
}
