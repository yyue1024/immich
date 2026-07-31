/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

type PendingRequest = {
  controller: AbortController;
  promise: Promise<Response>;
  cleanupTimeout?: ReturnType<typeof setTimeout>;
};

const pendingRequests = new Map<string, PendingRequest>();
let accessToken: string | undefined;

const getRequestKey = (request: URL | Request): string => (request instanceof URL ? request.href : request.url);

const CANCELATION_MESSAGE = 'Request canceled by application';
const CLEANUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const cancelPendingRequests = () => {
  for (const pendingRequest of pendingRequests.values()) {
    pendingRequest.controller.abort(CANCELATION_MESSAGE);
    if (pendingRequest.cleanupTimeout) {
      clearTimeout(pendingRequest.cleanupTimeout);
    }
  }
  pendingRequests.clear();
};

export const setAccessToken = (value: string | undefined) => {
  if (accessToken === value) {
    return;
  }

  accessToken = value;
  cancelPendingRequests();
};

const withAccessToken = (request: URL | Request) => {
  const originalRequest = request instanceof Request ? request : new Request(request);
  if (!accessToken || originalRequest.headers.has('authorization')) {
    return originalRequest;
  }

  const headers = new Headers(originalRequest.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);

  // 图片元素通常使用 no-cors 模式，该模式会丢弃 Authorization 请求头。
  return new Request(originalRequest, { headers, mode: 'same-origin' });
};

export const handleFetch = (request: URL | Request): Promise<Response> => {
  const requestKey = getRequestKey(request);
  const existing = pendingRequests.get(requestKey);

  if (existing) {
    // 响应体只能读取一次，每个调用方需要使用独立副本。
    return existing.promise.then((response) => response.clone());
  }

  const pendingRequest: PendingRequest = {
    controller: new AbortController(),
    promise: undefined as unknown as Promise<Response>,
    cleanupTimeout: undefined,
  };
  pendingRequests.set(requestKey, pendingRequest);

  // fetch 在收到响应头后返回，不会等待响应体传输完成。
  pendingRequest.promise = fetch(withAccessToken(request), { signal: pendingRequest.controller.signal })
    .catch((error: unknown) => {
      const standardError = error instanceof Error ? error : new Error(String(error));
      if (standardError.name === 'AbortError' || standardError.message === CANCELATION_MESSAGE) {
        // 使用空响应避免已取消请求在控制台产生网络错误。
        return new Response(undefined, { status: 204 });
      }
      throw standardError;
    })
    .finally(() => {
      // 延迟清理，保证流式响应体有时间完成传输。
      if (pendingRequests.get(requestKey) === pendingRequest) {
        const cleanupTimeout = setTimeout(() => {
          pendingRequests.delete(requestKey);
        }, CLEANUP_TIMEOUT_MS);
        pendingRequest.cleanupTimeout = cleanupTimeout;
      }
    });

  // 首个调用方也使用副本，为后续调用方保留原始响应。
  return pendingRequest.promise.then((response) => response.clone());
};

export const handleCancel = (url: URL) => {
  const requestKey = getRequestKey(url);

  const pendingRequest = pendingRequests.get(requestKey);
  if (pendingRequest) {
    pendingRequest.controller.abort(CANCELATION_MESSAGE);
    if (pendingRequest.cleanupTimeout) {
      clearTimeout(pendingRequest.cleanupTimeout);
    }
    pendingRequests.delete(requestKey);
  }
};
