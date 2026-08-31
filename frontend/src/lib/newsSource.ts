/**
 * Product-news source registry ("What's New" modal).
 *
 * Same seam pattern as proSession.ts: OSS ships a default source and the
 * pro overlay may replace it.
 *
 *   - OSS default: fetch the local backend's /api/news/feed (a cached,
 *     opt-out-able proxy of velxio.dev's public feed — see
 *     backend/app/api/routes/news.py) and run the delivery queue in the
 *     browser, with seen-state in localStorage. An anonymous install has
 *     no accounts, so "once per user" means "once per browser" here.
 *   - Pro overlay: registers a server-backed source (GET /api/pro/news/next)
 *     where the queue and per-user seen tracking live in the database.
 *
 * Queue semantics (identical in both sources):
 *   - only posts with publish_date <= today and not expired;
 *   - at most one post per calendar day;
 *   - oldest publish_date first;
 *   - a post is marked seen when SERVED, never repeated.
 */

export interface NewsPost {
  id: string;
  title: string;
  body_md: string;
  publish_date: string; // YYYY-MM-DD
  expires_date?: string | null;
}

type NewsSource = () => Promise<NewsPost | null>;

let _source: NewsSource | null = null;
let _sourceRegistered: (() => void) | null = null;

// In a pro build the real source arrives via registerNewsSource() from a
// DYNAMICALLY IMPORTED overlay chunk, and the announcement fetch fires a
// mere 250ms after editor mount — early enough to race that import. If
// the race is lost the OSS fallback runs instead, which on the cloud
// deployment queries its own (empty) self-host proxy and silently shows
// nothing. So: in pro builds getNextNews() waits — bounded — for the
// registration before picking a source. OSS builds resolve immediately
// and never wait.
const PRO_BUILD = Boolean(import.meta.env.VITE_PRO_BUILD);
const _sourceReady: Promise<void> = PRO_BUILD
  ? new Promise((resolve) => {
      _sourceRegistered = resolve;
    })
  : Promise.resolve();
/** How long a pro build waits for the overlay chunk before degrading to
 *  the OSS source. Generous: a lost overlay means no announcement at all
 *  on the cloud, while the wait only delays a modal nobody is blocked on. */
const SOURCE_WAIT_MS = 8000;

export function registerNewsSource(source: NewsSource): void {
  _source = source;
  _sourceRegistered?.();
}

/**
 * This fork has no product-news feed, so the default source always answers
 * "nothing to show".
 *
 * Upstream's version fetched `/api/news/feed` — a backend proxy of
 * velxio.dev's product news — and kept a per-browser queue in localStorage
 * (one post per day, never repeated). Both halves are gone: the backend
 * router was removed (that feed is upstream's product news, and this
 * simulator must not reach a third-party host at runtime), and with no feed
 * there is no queue to keep. Leaving the fetch in place would 404 on every
 * page load and litter the console for no benefit.
 *
 * NewsAnnouncer still mounts and still calls this — that matters, because
 * lib/newsGate holds the "new project" dialog until the announcer reports a
 * decision, and `null` is the decision "no announcement".
 *
 * A fork that wants its own announcements adds a backend route and replaces
 * this body, or calls registerNewsSource() from its own module.
 */
async function ossFeedNext(): Promise<NewsPost | null> {
  return null;
}

/**
 * Resolve the next news post to show, or null. Never throws — news is
 * strictly best-effort and must not disturb the editor.
 */
export async function getNextNews(): Promise<NewsPost | null> {
  try {
    if (PRO_BUILD && !_source) {
      await Promise.race([
        _sourceReady,
        new Promise<void>((resolve) => setTimeout(resolve, SOURCE_WAIT_MS)),
      ]);
    }
    return _source ? await _source() : await ossFeedNext();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.debug('[oss] news source failed:', err);
    return null;
  }
}
