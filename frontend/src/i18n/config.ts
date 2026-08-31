/**
 * Locale registry.
 *
 * Upstream ships nine locales and serves each one under its own URL prefix
 * (`/es/...`, `/ru/...`). This fork is a Russian-language product: Russian is
 * the only locale, so it is also DEFAULT_LOCALE, NON_DEFAULT_LOCALES is empty,
 * and no locale-prefixed routes are generated at all — a plain `/` is the
 * whole URL space again.
 *
 * The shape of every export is unchanged, so each of the ten call sites keeps
 * compiling untouched. Restoring a locale is: put its code back in LOCALES,
 * add its LOCALE_META row, and restore its directory under ./locales/.
 */

export const LOCALES = ["ru"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ru";

export const NON_DEFAULT_LOCALES: Exclude<Locale, "ru">[] = [];

export type LocaleMeta = {
  /** BCP-47 tag used in `<html lang>` and `hreflang`. */
  htmlLang: string;
  /** Native-language label shown in the language switcher. */
  nativeName: string;
  /** Open Graph locale code (Facebook). */
  ogLocale: string;
  /** Writing direction. */
  dir: "ltr" | "rtl";
};

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  ru: { htmlLang: "ru", nativeName: "Русский", ogLocale: "ru_RU", dir: "ltr" },
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}
