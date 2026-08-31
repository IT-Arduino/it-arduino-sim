/**
 * Single source of truth for all public, indexable routes and their SEO metadata.
 * Used by:
 *  1. scripts/generate-sitemap.mjs  → builds sitemap.xml at build time
 *  2. scripts/prerender-seo.mjs     → generates prerendered HTML per route
 *  3. Page components (via getSeoMeta) → useSEO() hook
 *
 * Routes with `noindex: true` are excluded from the sitemap.
 * Routes with `seoMeta` get prerendered HTML at build time.
 */

const DOMAIN = 'https://sim.it-arduino.ru';

export interface SeoMeta {
  title: string;
  description: string;
  url: string;
}

export interface SeoRoute {
  path: string;
  /** 0.0 – 1.0 (default 0.5) */
  priority?: number;
  changefreq?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** If true, excluded from sitemap */
  noindex?: boolean;
  /** SEO metadata — if present, this route gets a prerendered HTML page at build time. */
  seoMeta?: SeoMeta;
}

/** Look up the SEO metadata for a given path. */
export function getSeoMeta(path: string): SeoMeta | undefined {
  return SEO_ROUTES.find((r) => r.path === path)?.seoMeta;
}

export const SEO_ROUTES: SeoRoute[] = [
  // Upstream listed twenty-two routes here. Nineteen of them prerendered
  // static pages for addresses this build does not serve: five SEO landings
  // for boards the fork removed (ESP32, ESP32-S3, ESP32-C3, RP2040,
  // Raspberry Pi), three Velxio release showcases (/v2, /v2-5, /v3), the
  // marketing /about and a /classroom page quoting subscription prices.
  //
  // That is not an oversight on our side — it is what upstream's own comment
  // in App.tsx says: "Everything a VISITOR sees — landing, about, pricing,
  // docs, the SEO simulator landings, version showcases — moved to the pro
  // overlay. The OSS build is the editor; it ships no marketing site."
  //
  // What remains is what the router actually renders.
  {
    path: '/',
    priority: 1.0,
    changefreq: 'weekly',
    seoMeta: {
      title: 'IT-Arduino Симулятор — онлайн-симулятор Arduino в браузере',
      description:
        'Бесплатный симулятор Arduino прямо в браузере. Собирайте схемы из светодиодов, кнопок, датчиков и дисплеев, пишите скетчи на C++ и запускайте их на Arduino Uno, Nano, Mega 2560 и ATtiny85. Учебный проект сайта it-arduino.ru — без регистрации и без установки.',
      url: `${DOMAIN}/`,
    },
  },
  {
    path: '/editor',
    priority: 0.9,
    changefreq: 'weekly',
    // With seoMeta the route is prerendered, so nginx serves /editor/ as a
    // real page and 301s /editor to it. Without it both forms answered 200
    // with the homepage head, and search engines indexed /editor AND
    // /editor/ as two different pages.
    seoMeta: {
      title: 'Редактор — IT-Arduino Симулятор',
      description:
        'Соберите схему и запустите скетч на Arduino Uno, Nano, Mega 2560 или ATtiny85 прямо в браузере. Компиляция на нашем сервере, установка не нужна.',
      url: `${DOMAIN}/editor`,
    },
  },
  {
    path: '/examples',
    priority: 0.8,
    changefreq: 'weekly',
    // Галерея открыта только администратору, поэтому из карты сайта и из
    // пререндера она исключена: незачем звать людей из поиска на страницу,
    // которая уведёт их обратно в редактор. seoMeta остаётся — по ней
    // страница ставит себе заголовок вкладки, когда админ её открывает.
    noindex: true,
    seoMeta: {
      title: 'Примеры схем и скетчей — IT-Arduino Симулятор',
      description:
        'Готовые примеры для Arduino Uno, Nano, Mega 2560 и ATtiny85: мигание светодиодом, кнопки, потенциометры, датчики, дисплеи, а также аналоговые схемы с расчётом в ngspice. Открываются в браузере одним щелчком.',
      url: `${DOMAIN}/examples`,
    },
  },

  // Служебные страницы: закрыты от индексации, но остаются обходимыми —
  // роботу нужно увидеть сам тег noindex, а запрещённый в robots.txt адрес
  // может попасть в индекс по внешним ссылкам, без заголовка.
  { path: '/login', noindex: true },
  { path: '/register', noindex: true },
  { path: '/admin', noindex: true },
];
