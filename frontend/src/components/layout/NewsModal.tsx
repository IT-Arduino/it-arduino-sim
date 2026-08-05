/**
 * "What's New" modal — shows the next pending product-news post when the
 * user enters the editor. At most one per day, each post only ever once;
 * the queue/seen logic lives in lib/newsSource.ts (OSS: localStorage over
 * the local /api/news/feed proxy; pro overlay: server-backed per-user).
 *
 * The fetch is delayed a few seconds so it never competes with editor
 * startup, and every failure path resolves to "no modal".
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getNextNews, type NewsPost } from '../../lib/newsSource';
import './NewsModal.css';

const FETCH_DELAY_MS = 4000;

// Self-hosted privacy promise: the feed is proxied through the local
// backend precisely so users' browsers never contact velxio.dev — an
// inline remote image would undo that (one request per viewer). OSS
// builds therefore render images as their alt text; the pro cloud build
// (VITE_PRO_BUILD) shows them normally.
const SHOW_REMOTE_IMAGES = import.meta.env.VITE_PRO_BUILD === 'true';

export function NewsModal() {
  const [post, setPost] = useState<NewsPost | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void getNextNews().then((p) => {
        if (!cancelled && p) setPost(p);
      });
    }, FETCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (!post) return null;

  return createPortal(
    <div className="velxio-news-overlay" onClick={() => setPost(null)}>
      <div
        className="velxio-news-modal"
        role="dialog"
        aria-modal="true"
        aria-label={post.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="velxio-news-header">
          <div>
            <span className="velxio-news-kicker">What's new</span>
            <h2 className="velxio-news-title">{post.title}</h2>
          </div>
          <button
            className="velxio-news-close"
            aria-label="Close"
            onClick={() => setPost(null)}
          >
            ×
          </button>
        </div>
        <div className="velxio-news-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={
              SHOW_REMOTE_IMAGES
                ? undefined
                : { img: ({ alt }) => <em>[{alt || 'image'}]</em> }
            }
          >
            {post.body_md}
          </ReactMarkdown>
        </div>
        <div className="velxio-news-footer">
          <button className="velxio-news-ok" onClick={() => setPost(null)}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
