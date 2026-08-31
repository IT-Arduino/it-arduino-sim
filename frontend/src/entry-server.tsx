/**
 * SSR entry point for prerendering SEO pages at build time.
 *
 * Used by scripts/prerender-seo.mjs via Vite's ssrLoadModule.
 * Renders each page component to an HTML string so the prerender script
 * can inject it into the static dist/index.html per route.
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
// Initialise i18next with the bundled English resources before any page
// renders: without this every t() call in the SSR output came back as its
// KEY ("landing.hero.titleLine1"), which is what the prerendered bodies
// shipped once they were actually injected.
import './i18n';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SEO_ROUTES } from './seoRoutes';

// ── SEO page components ─────────────────────────────────────────────────────
import { exampleProjects } from './data/examples';
import { ExamplesPage } from './pages/ExamplesPage';
import { ExampleDetailPage } from './pages/ExampleDetailPage';

// Map route paths to their React component. The OSS build prerenders only
// what it ships (the examples gallery); the marketing surface lives in the
// pro overlay and is merged in by loadRouteComponents() below.
/**
 * /editor is the live workspace (Monaco, WASM engines) — nothing there
 * survives renderToString, so its prerender is a static crawlable summary.
 * Being prerendered at all is what matters: nginx then serves /editor/ as
 * a real page and 301s /editor to it, instead of both forms answering 200
 * with the homepage head (Google had indexed the two as separate pages).
 */
const EditorSeoSummary: React.FC = () => (
  // Это тело читает поисковик на главной странице. Упоминались платы,
  // которых в форке нет (ESP32, Pico, Raspberry Pi), — обещать их значит
  // приводить человека на страницу, где их не окажется.
  <main>
    <h1>Редактор IT-Arduino Симулятора — схема и код в одном окне</h1>
    <p>
      Собирайте схему и пишите скетч на C++ прямо в браузере: Arduino Uno, Nano, Mega 2560 и
      ATtiny85 с настоящей эмуляцией AVR, аналоговая часть считается решателем SPICE. Бесплатно, с
      открытым исходным кодом, без установки и без регистрации.
    </p>
  </main>
);

const OSS_ROUTE_COMPONENTS: Record<string, React.FC> = {
  '/editor': EditorSeoSummary,
  '/examples': ExamplesPage,
};

let routeComponents: Record<string, React.FC> = OSS_ROUTE_COMPONENTS;

/**
 * Merge in the overlay's marketing pages (landing, about, docs, the SEO
 * simulator landings). Pro-gated dynamic import — the never-taken branch
 * keeps the OSS build from ever referencing files it does not have, the
 * same pattern main.tsx uses for mountPro. The prerender script awaits
 * this before asking for routes.
 */
export async function loadRouteComponents(): Promise<Record<string, React.FC>> {
  if (import.meta.env.VITE_PRO_BUILD) {
    const m = await import('@pro/pages/marketing');
    routeComponents = { ...OSS_ROUTE_COMPONENTS, ...m.MARKETING_ROUTE_COMPONENTS };
    // The overlay's own namespace ("pro": landing sections, pricing...),
    // else its t() calls render as keys too.
    try {
      const reg = await import('@pro/i18n/register');
      reg.registerProI18n?.();
    } catch (err) {
      console.warn('  ⚠ pro i18n not registered for SSR:', (err as Error).message);
    }
  }
  return routeComponents;
}

/**
 * Returns all routes that have both seoMeta and a renderable component.
 */
export function getPrerenderedRoutes() {
  // `noindex` отсекается и здесь, а не только в карте сайта: иначе nginx
  // отдавал бы закрытой странице готовый статический HTML со всем её
  // содержимым. Для /login, /register и /admin это ничего не меняет —
  // у них нет seoMeta, и первое условие их уже отсекало.
  return SEO_ROUTES.filter((r) => r.seoMeta && !r.noindex && routeComponents[r.path]);
}

/**
 * Render a route's page component to an HTML string.
 */
export function render(path: string): string {
  const Component = routeComponents[path];
  if (!Component) return '';

  try {
    return renderToString(
      <MemoryRouter initialEntries={[path]}>
        <Component />
      </MemoryRouter>,
    );
  } catch (err) {
    console.warn(`  ⚠ SSR render failed for ${path}:`, (err as Error).message);
    return '';
  }
}

/**
 * Returns all example routes to prerender, one per example project.
 */
export function getPrerenderedExampleRoutes() {
  return exampleProjects.map((e) => ({
    path: `/examples/${e.id}`,
    // Заголовок и описание уходят в <title> и <meta name="description">
    // 158 пререндеренных страниц — это первое, что видит поисковик.
    // Шаблон upstream был английским и нёс его марку.
    title: `${e.title} — пример для IT-Arduino Симулятора`,
    description: `${e.description} Запустите пример прямо в браузере: без установки и регистрации.`,
    url: `https://sim.it-arduino.ru/examples/${e.id}`,
  }));
}

/**
 * Render an example detail page to an HTML string.
 */
export function renderExample(exampleId: string): string {
  try {
    // Mounted under its real route so useParams() sees exampleId; rendered
    // bare it had no params and every example page SSR'd as "not found".
    return renderToString(
      <MemoryRouter initialEntries={[`/examples/${exampleId}`]}>
        <Routes>
          <Route path="/examples/:exampleId" element={<ExampleDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
  } catch (err) {
    console.warn(`  ⚠ SSR render failed for /examples/${exampleId}:`, (err as Error).message);
    return '';
  }
}
