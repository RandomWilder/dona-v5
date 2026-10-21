// The installed portal. #286. The manifest is JSON. The worker is the one script
// with a src. It keeps the stylesheets, the fonts and the icons, and it returns
// before touching any other response, so a page is never cached.

import { currentPortalLanguage, portalDir, portalText } from './copy.ts';

const STATIC = [
  '/ui/tokens.css',
  '/ui/portal.css',
  '/ui/fonts/heebo-hebrew.woff2',
  '/ui/fonts/heebo-latin.woff2',
  '/ui/fonts/noto-sans-cyrillic.woff2',
  '/ui/fonts/ibm-plex-mono-latin-400.woff2',
  '/ui/fonts/ibm-plex-mono-latin-500.woff2',
  '/ui/icons/portal-icon-180.png',
  '/ui/icons/portal-icon-192.png',
  '/ui/icons/portal-icon-512.png',
] as const;

export function portalManifest(): {
  name: string;
  short_name: string;
  start_url: '/';
  scope: '/';
  display: 'standalone';
  lang: string;
  dir: 'rtl' | 'ltr';
  background_color: '#f2f2f3';
  theme_color: '#2c455d';
  icons: Array<{
    src: string;
    sizes: string;
    type: 'image/png';
    purpose: 'any';
  }>;
} {
  const language = currentPortalLanguage();
  return {
    name: portalText('install.name'),
    short_name: portalText('install.short'),
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: language,
    dir: portalDir(language),
    // The same two colours as --tp-bg and --tp-accent-800.
    background_color: '#f2f2f3',
    theme_color: '#2c455d',
    icons: [
      {
        src: '/ui/icons/portal-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/ui/icons/portal-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}

export function portalWorkerSource(): string {
  return `/* dona.portal.worker */
const STATIC = ${JSON.stringify(STATIC)};
const CACHE = 'dona-portal-static-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STATIC))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (!STATIC.includes(url.pathname)) return;
  event.respondWith(fromNetwork(event.request));
});

async function fromNetwork(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}
`;
}
