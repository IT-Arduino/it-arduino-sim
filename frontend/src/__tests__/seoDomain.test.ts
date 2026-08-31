/**
 * seoDomain.test.ts — the fork must not advertise the upstream domain.
 *
 * Upstream declared its own domain in six separate places. Earlier fork
 * stages fixed the ones that were easy to see (index.html, seoRoutes.ts,
 * the example pages) and missed the ones that are only visible in the
 * rendered <head> or in a build artefact:
 *
 *   - useSEO.ts rebuilt canonical + every hreflang from its OWN constant
 *     for localized routes, discarding the absolute URL the page passed in.
 *     The prerenderer wrote the correct canonical into the static HTML and
 *     hydration then overwrote it.
 *   - generate-sitemap.mjs emitted 175 <loc> entries on the upstream domain.
 *
 * A canonical pointing at another domain tells a search engine this page is
 * a duplicate of that one — the fork's own address would never be indexed.
 * That failure is silent: the app looks perfect in a browser.
 *
 * So the test does not check one constant, it checks the whole surface.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const UPSTREAM = 'velxio\\.dev';

/**
 * Dead code: a Tauri desktop build signs in against upstream's server. The
 * fork ships no desktop build (there is no src-tauri/), nothing calls
 * beginSignIn, and our API lives on a different host than the site — so
 * pointing it at the site domain would be its own kind of wrong. Listed
 * here rather than silently fixed, so it stays visible.
 */
const ALLOWED = new Set([path.join('src', 'desktop', 'tauriBridge.ts')]);

/** Source files that ship, or that produce a shipped artefact. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', 'dist', '__tests__', 'locales']);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js|html)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'scripts'));
  out.push(path.join(ROOT, 'index.html'));
  return out;
}

describe('домен в SEO-разметке', () => {
  it('чужой домен не встречается в коде как значение', () => {
    // Ищем именно литерал в кавычках. Упоминание домена в комментарии —
    // это история изменений, а не то, что уедет в тег.
    const literal = new RegExp(`['"\`]https://${UPSTREAM}`);
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const rel = path.relative(ROOT, file);
      if (ALLOWED.has(rel)) continue;
      const src = fs.readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (literal.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('в разборе действительно есть что разбирать', () => {
    // Страховка: если обход каталогов однажды сломается и вернёт пустой
    // список, тест выше начнёт проходить впустую.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith('useSEO.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('generate-sitemap.mjs'))).toBe(true);
  });

  it('все объявления домена совпадают между собой', () => {
    // Причина ошибки была не в одном неверном литерале, а в том, что их
    // шесть и они разъехались. Здесь проверяется согласованность.
    const declared = new Set<string>();
    const decl = /const\s+DOMAIN\s*[^'"`]*['"`](https:\/\/[^'"`]+)['"`]/g;
    for (const file of sourceFiles()) {
      const rel = path.relative(ROOT, file);
      if (ALLOWED.has(rel)) continue;
      for (const m of fs.readFileSync(file, 'utf8').matchAll(decl)) declared.add(m[1]);
    }
    expect([...declared]).toEqual(['https://sim.it-arduino.ru']);
  });
});
