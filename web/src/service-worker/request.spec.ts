import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleFetch, setAccessToken } from './request';

describe('Service Worker 媒体请求', () => {
  afterEach(() => {
    setAccessToken(undefined);
    vi.restoreAllMocks();
  });

  it('存在访问令牌时添加 Bearer 请求头', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image'));
    setAccessToken('access-token');

    await handleFetch(new Request('https://immich.example/api/assets/asset-id/thumbnail', { mode: 'no-cors' }));

    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.headers.get('authorization')).toBe('Bearer access-token');
    expect(request.mode).toBe('same-origin');
  });

  it('不存在访问令牌时保持原请求不变', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image'));
    const originalRequest = new Request('https://immich.example/api/assets/asset-id/thumbnail');

    await handleFetch(originalRequest);

    expect(fetchMock.mock.calls[0][0]).toBe(originalRequest);
  });

  it('不覆盖调用方已有的 Authorization 请求头', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image'));
    setAccessToken('fallback-token');

    await handleFetch(
      new Request('https://immich.example/api/assets/asset-id/thumbnail', {
        headers: { Authorization: 'Bearer request-token' },
      }),
    );

    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.headers.get('authorization')).toBe('Bearer request-token');
  });
});
