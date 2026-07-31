export class ServiceWorkerMessenger {
  readonly #serviceWorker: ServiceWorkerContainer;

  constructor(serviceWorker: ServiceWorkerContainer) {
    this.#serviceWorker = serviceWorker;
  }

  /**
   * 向当前 Service Worker 发送单向消息。
   */
  send(type: string, data: Record<string, unknown>) {
    this.#serviceWorker.controller?.postMessage({
      type,
      ...data,
    });
  }

  /**
   * 向当前或即将激活的 Service Worker 发送单向消息。
   */
  sendWhenReady(type: string, data: Record<string, unknown>) {
    const message = { type, ...data };
    const controller = this.#serviceWorker.controller;
    controller?.postMessage(message);

    void this.#serviceWorker.ready
      .then((registration) => {
        if (registration.active && registration.active !== controller) {
          registration.active.postMessage(message);
        }
      })
      .catch(() => {
        // Service Worker 不可用时继续使用 Cookie 鉴权。
      });
  }
}
