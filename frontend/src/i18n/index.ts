/**
 * react-i18next bootstrap.
 *
 * Upstream loaded the English bundle synchronously and lazy-imported the
 * other eight on demand. This fork has one locale — Russian — so the whole
 * lazy-loading lane is gone: the bundle below is the only one that exists,
 * it is inlined, and loadLocale() has nothing left to fetch.
 *
 * The language detector stays configured but no longer decides anything:
 * with a single entry in supportedLngs there is nothing to detect.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import ruCommon from './locales/ru/common.json';
import ruCommon2 from './locales/ru/common2.json';
import ruReleases from './locales/ru/releases.json';
import ruDocs from './locales/ru/docs.json';
import ruDocs2 from './locales/ru/docs2.json';
import ruSeo from './locales/ru/seo.json';
import ruSeo2 from './locales/ru/seo2.json';
import ruSeo3 from './locales/ru/seo3.json';
import ruSeo4 from './locales/ru/seo4.json';
// Fork-only dictionary. Upstream's Russian bundle leans on English as the
// fallback language for keys it never translated; with English deleted those
// keys would render as raw ids or as English text. fork.json fills exactly
// those gaps and is merged LAST, so it also wins on any key it repeats.
// Keeping our strings in their own file means upstream can rewrite
// common.json freely without ever conflicting with us.
import ruFork from './locales/ru/fork.json';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './config';

/**
 * Deep merge for locale resource files. The namespace used to be built
 * with a SHALLOW spread, so a top-level section present in two files had
 * the later file silently clobber the earlier one wholesale: common2's
 * `editor` erased common.json's `editor.share.*` (the Share modal's
 * visibility labels rendered as raw keys), and the same collision on
 * `header` later wiped `header.auth.*` — the account menu showed
 * "header.auth.signOut". Merging by key ends the failure class.
 */
function deepMerge(
  base: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const prev = out[k];
    if (
      prev &&
      v &&
      typeof prev === 'object' &&
      typeof v === 'object' &&
      !Array.isArray(prev) &&
      !Array.isArray(v)
    ) {
      out[k] = deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const NAMESPACES = ['common'] as const;
type Namespace = (typeof NAMESPACES)[number];

const SUPPORTED_LANGS = LOCALES as readonly string[];

// Init is synchronous for the default locale (resources are inlined via
// the static import above), so we don't need to await the returned
// Promise for first-paint correctness. Awaiting it would force the
// project's tsconfig to enable top-level-await for ESM, which we're
// avoiding to keep build settings minimal.
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ru: {
        common: {
          ...deepMerge(deepMerge(deepMerge(ruCommon, ruCommon2), ruReleases), ruFork),
          seo: {
            ...ruSeo.seo,
            ...ruSeo2.seo,
            ...ruSeo3.seo,
            ...ruSeo4.seo,
          },
          docs: { ...ruDocs.docs, ...ruDocs2.docs },
        },
      },
    },
    // The only locale, inlined above. There is nothing for LocaleSync to
    // switch to, so this is both the starting and the final language.
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: SUPPORTED_LANGS,
    // Our locale codes are lowercase with a lowercase region ("zh-cn",
    // "pt-br"). i18next's default code formatting rewrites those to
    // "zh-CN" / "pt-BR", which then fail the `supportedLngs` check and get
    // dropped from the resolve hierarchy — leaving only the English
    // fallback, so those two locales never resolved their own bundle.
    // Forcing lowercase keeps the codes consistent with the bundles.
    lowerCaseLng: true,
    ns: NAMESPACES,
    defaultNS: 'common',
    interpolation: { escapeValue: false }, // React already escapes
    react: {
      useSuspense: false, // we register resources synchronously in dev
    },
    detection: {
      // LocaleSync makes the locale decision from the URL after mount;
      // detector is left configured for future fallback paths only.
      order: ['path', 'cookie', 'navigator'],
      lookupCookie: 'velxio_locale',
      caches: [], // we manage the cookie in src/i18n/cookie.ts
    },
  });

/**
 * No-op kept so LocaleSync's `await loadLocale(target)` call site stays
 * unchanged. Russian is the only locale and its bundle is inlined above, so
 * there is never anything to fetch. Upstream's dynamic-import block lived
 * here; restoring a second locale means restoring it too.
 */
export async function loadLocale(_locale: Locale): Promise<void> {
  return;
}

export { i18n };
export type { Locale, Namespace };
