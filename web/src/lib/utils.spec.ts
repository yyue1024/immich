import { AssetTypeEnum } from '@immich/sdk';
import { clearStoredAccessToken, setStoredAccessToken } from '$lib/utils/access-token';
import { getAssetMediaUrl, getAssetUrl, semverToName, uploadRequest } from '$lib/utils';
import { assetFactory } from '@test-data/factories/asset-factory';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';

describe('utils', () => {
  const resetAuthState = () => {
    clearStoredAccessToken();
    document.cookie = 'immich_is_authenticated=; Max-Age=0; Path=/';
  };

  beforeEach(resetAuthState);
  afterEach(resetAuthState);

  describe(getAssetMediaUrl.name, () => {
    it('中继缺少认证 Cookie 时在媒体地址中添加会话密钥', () => {
      setStoredAccessToken('session-token');

      const url = getAssetMediaUrl({ id: crypto.randomUUID() });

      expect(new URL(url, 'https://immich.example').searchParams.get('sessionKey')).toBe('session-token');
    });

    it('局域网认证 Cookie 正常时不在媒体地址中添加会话密钥', () => {
      setStoredAccessToken('session-token');
      document.cookie = 'immich_is_authenticated=true; Path=/';

      const url = getAssetMediaUrl({ id: crypto.randomUUID() });

      expect(new URL(url, 'https://immich.example').searchParams.has('sessionKey')).toBe(false);
    });
  });

  describe(uploadRequest.name, () => {
    it('将自定义请求头设置到上传 XHR', async () => {
      const listeners = new Map<string, EventListener>();
      const setRequestHeader = vi.fn();
      const xhr = {
        abort: vi.fn(),
        addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
        open: vi.fn(),
        readyState: 4,
        response: { id: 'asset-id' },
        responseType: '',
        send: vi.fn(() => listeners.get('load')?.(new Event('load'))),
        setRequestHeader,
        status: 201,
        statusText: 'Created',
        upload: { addEventListener: vi.fn() },
      };
      vi.stubGlobal(
        'XMLHttpRequest',
        vi.fn(function () {
          return xhr;
        }),
      );

      try {
        await uploadRequest({
          url: '/api/assets',
          data: new FormData(),
          headers: { Authorization: 'Bearer session-token' },
        });
      } finally {
        vi.unstubAllGlobals();
      }

      expect(setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer session-token');
    });
  });

  describe(getAssetUrl.name, () => {
    it('should return thumbnail URL for static images', () => {
      const asset = assetFactory.build({
        originalPath: 'image.jpg',
        originalMimeType: 'image/jpeg',
        type: AssetTypeEnum.Image,
      });

      const url = getAssetUrl({ asset });

      // Should return a thumbnail URL (contains /thumbnail)
      expect(url).toContain('/thumbnail');
      expect(url).toContain(asset.id);
    });

    it('should return thumbnail URL for static gifs', () => {
      const asset = assetFactory.build({
        originalPath: 'image.gif',
        originalMimeType: 'image/gif',
        type: AssetTypeEnum.Image,
      });

      const url = getAssetUrl({ asset });

      expect(url).toContain('/thumbnail');
      expect(url).toContain(asset.id);
    });

    it('should return thumbnail URL for static webp images', () => {
      const asset = assetFactory.build({
        originalPath: 'image.webp',
        originalMimeType: 'image/webp',
        type: AssetTypeEnum.Image,
      });

      const url = getAssetUrl({ asset });

      expect(url).toContain('/thumbnail');
      expect(url).toContain(asset.id);
    });

    it('should return original URL for animated gifs', () => {
      const asset = assetFactory.build({
        originalPath: 'image.gif',
        originalMimeType: 'image/gif',
        type: AssetTypeEnum.Image,
        duration: 2000,
      });

      const url = getAssetUrl({ asset });

      // Should return original URL (contains /original)
      expect(url).toContain('/original');
      expect(url).toContain(asset.id);
    });

    it('should return original URL for animated webp images', () => {
      const asset = assetFactory.build({
        originalPath: 'image.webp',
        originalMimeType: 'image/webp',
        type: AssetTypeEnum.Image,
        duration: 2000,
      });

      const url = getAssetUrl({ asset });

      expect(url).toContain('/original');
      expect(url).toContain(asset.id);
    });

    it('should return original URL for video assets with forceOriginal', () => {
      const asset = assetFactory.build({
        originalPath: 'video.mp4',
        originalMimeType: 'video/mp4',
        type: AssetTypeEnum.Video,
      });

      const url = getAssetUrl({ asset, forceOriginal: true });

      expect(url).toContain('/original');
      expect(url).toContain(asset.id);
    });

    it('should return thumbnail URL for video assets without forceOriginal', () => {
      const asset = assetFactory.build({
        originalPath: 'video.mp4',
        originalMimeType: 'video/mp4',
        type: AssetTypeEnum.Video,
      });

      const url = getAssetUrl({ asset });

      expect(url).toContain('/thumbnail');
      expect(url).toContain(asset.id);
    });

    it('should return thumbnail URL for static images in shared link even with download and showMetadata permissions', () => {
      const asset = assetFactory.build({
        originalPath: 'image.gif',
        originalMimeType: 'image/gif',
        type: AssetTypeEnum.Image,
      });
      const sharedLink = sharedLinkFactory.build({ allowDownload: true, showMetadata: true, assets: [asset] });

      const url = getAssetUrl({ asset, sharedLink });

      expect(url).toContain('/thumbnail');
      expect(url).toContain(asset.id);
    });

    it('should return original URL for animated images in shared link with download and showMetadata permissions', () => {
      const asset = assetFactory.build({
        originalPath: 'image.gif',
        originalMimeType: 'image/gif',
        type: AssetTypeEnum.Image,
        duration: 2000,
      });
      const sharedLink = sharedLinkFactory.build({ allowDownload: true, showMetadata: true, assets: [asset] });

      const url = getAssetUrl({ asset, sharedLink });

      expect(url).toContain('/original');
      expect(url).toContain(asset.id);
    });

    it('should return thumbnail URL (not original) for animated images when shared link download permission is false', () => {
      const asset = assetFactory.build({
        originalPath: 'image.gif',
        originalMimeType: 'image/gif',
        type: AssetTypeEnum.Image,
        duration: 2000,
      });
      const sharedLink = sharedLinkFactory.build({ allowDownload: false, assets: [asset] });

      const url = getAssetUrl({ asset, sharedLink });

      expect(url).toContain('/thumbnail');
      expect(url).not.toContain('/original');
      expect(url).toContain(asset.id);
    });

    it('should return thumbnail URL (not original) for animated images when shared link showMetadata permission is false', () => {
      const asset = assetFactory.build({
        originalPath: 'image.gif',
        originalMimeType: 'image/gif',
        type: AssetTypeEnum.Image,
        duration: 2000,
      });
      const sharedLink = sharedLinkFactory.build({ showMetadata: false, assets: [asset] });

      const url = getAssetUrl({ asset, sharedLink });

      expect(url).toContain('/thumbnail');
      expect(url).not.toContain('/original');
      expect(url).toContain(asset.id);
    });
  });
  describe('semverToName', () => {
    it('should not append release candidate tag if prelease is not set', () => {
      expect(semverToName({ major: 3, minor: 0, patch: 0, prerelease: null })).toEqual('v3.0.0');
    });

    it('should append release candidate if set', () => {
      expect(semverToName({ major: 3, minor: 0, patch: 0, prerelease: 0 })).toEqual('v3.0.0-rc.0');
    });
  });
});
