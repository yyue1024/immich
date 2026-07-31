import { ServiceWorkerMessenger } from './sw-messenger';

const hasServiceWorker = globalThis.isSecureContext && 'serviceWorker' in navigator;
// eslint-disable-next-line compat/compat
const messenger = hasServiceWorker ? new ServiceWorkerMessenger(navigator.serviceWorker) : undefined;
let accessToken: string | undefined;

const sendAccessToken = () => messenger?.sendWhenReady('access-token', { accessToken });

if (hasServiceWorker) {
  navigator.serviceWorker.addEventListener('controllerchange', sendAccessToken);
}

export function setServiceWorkerAccessToken(value: string | undefined) {
  accessToken = value;
  sendAccessToken();
}

export function cancelImageUrl(url: string | undefined | null) {
  if (!url || !messenger) {
    return;
  }
  messenger.send('cancel', { url });
}
