/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { installMessageListener } from './messaging';
import { handleFetch as handleAssetFetch } from './request';

const AUTHENTICATED_MEDIA_REQUEST_REGEXES = [
  /^\/api\/assets\/[a-f0-9-]+\/(original|thumbnail|video\/)/,
  /^\/api\/people\/[a-f0-9-]+\/thumbnail/,
  /^\/api\/users\/[a-f0-9-]+\/profile-image/,
];

const sw = globalThis as unknown as ServiceWorkerGlobalScope;

const handleActivate = (event: ExtendableEvent) => {
  event.waitUntil(sw.clients.claim());
};

const handleInstall = (event: ExtendableEvent) => {
  event.waitUntil(sw.skipWaiting());
};

const handleFetch = (event: FetchEvent): void => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  const isAuthenticatedMediaRequest = AUTHENTICATED_MEDIA_REQUEST_REGEXES.some((regex) => regex.test(url.pathname));
  if (url.origin === self.location.origin && isAuthenticatedMediaRequest) {
    event.respondWith(handleAssetFetch(event.request));
    return;
  }
};

sw.addEventListener('install', handleInstall, { passive: true });
sw.addEventListener('activate', handleActivate, { passive: true });
sw.addEventListener('fetch', handleFetch, { passive: true });
installMessageListener();
