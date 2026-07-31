/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { handleCancel, setAccessToken } from './request';

const sw = globalThis as unknown as ServiceWorkerGlobalScope;

export const installMessageListener = () => {
  sw.addEventListener('message', (event) => {
    if (!event.data?.type) {
      return;
    }

    switch (event.data.type) {
      case 'access-token': {
        const accessToken = event.data.accessToken;
        setAccessToken(typeof accessToken === 'string' && accessToken.length > 0 ? accessToken : undefined);
        break;
      }

      case 'cancel': {
        const url = event.data.url ? new URL(event.data.url, self.location.origin) : undefined;
        if (!url) {
          return;
        }

        const client = event.source;
        if (!client) {
          return;
        }

        handleCancel(url);
        break;
      }
    }
  });
};
