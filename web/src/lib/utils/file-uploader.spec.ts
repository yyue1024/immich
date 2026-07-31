import { AssetMediaStatus, type AssetMediaResponseDto, type UserAdminResponseDto } from '@immich/sdk';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { uploadManager } from '$lib/managers/upload-manager.svelte';
import { uploadAssetsStore } from '$lib/stores/upload';
import { UploadState } from '$lib/types';
import * as utils from '$lib/utils';
import { clearStoredAccessToken, setStoredAccessToken } from '$lib/utils/access-token';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { fileUploadHandler } from './file-uploader';

describe('fileUploader error handling', () => {
  const mockFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
  const mockUserObject = { id: 'user-123', email: 'test@example.com' } as UserAdminResponseDto;
  const mockError = new Error('Upload failed');
  const mockUploadResponse = { id: 'mock-id', status: AssetMediaStatus.Created } as AssetMediaResponseDto;

  beforeEach(() => {
    vi.clearAllMocks();
    clearStoredAccessToken();
    document.cookie = 'immich_is_authenticated=; Max-Age=0; Path=/';
    vi.spyOn(uploadManager, 'getExtensions').mockReturnValue(['.jpg']);
    uploadAssetsStore.reset();
    authManager.reset();
  });

  for (const [name, mockUser] of [
    ['logged-in users', true],
    ['anonymous users', false],
  ] as const) {
    describe(`for ${name}`, () => {
      beforeEach(() => {
        if (mockUser) {
          authManager.setUser(mockUserObject);
        }
      });

      it(`should transition successful uploads to done`, async () => {
        vi.spyOn(utils, 'uploadRequest').mockResolvedValue({ status: 200, data: mockUploadResponse });

        await fileUploadHandler({ files: [mockFile] });

        const items = get(uploadAssetsStore);
        expect(items.length).toBe(1);
        expect(items[0].state).toBe(UploadState.DONE);
      });

      it('should capture errors', async () => {
        vi.spyOn(utils, 'uploadRequest').mockRejectedValue(mockError);

        await fileUploadHandler({ files: [mockFile] });

        const items = get(uploadAssetsStore);
        expect(items.length).toBe(1);
        expect(items[0].state).toBe(UploadState.ERROR);
      });
    });
  }

  it('should suppress errors on logout', async () => {
    authManager.setUser(mockUserObject);
    authManager.setPreferences(preferencesFactory.build());
    vi.spyOn(utils, 'uploadRequest').mockImplementationOnce(() => {
      authManager.reset();
      return Promise.reject(mockError);
    });

    await fileUploadHandler({ files: [mockFile] });

    const items = get(uploadAssetsStore);
    expect(items.length).toBe(1);
    expect(items[0].state).toBe(UploadState.STARTED);
  });

  it('中继缺少认证 Cookie 时为上传请求添加 Bearer 认证', async () => {
    authManager.setUser(mockUserObject);
    setStoredAccessToken('session-token');
    const uploadSpy = vi.spyOn(utils, 'uploadRequest').mockResolvedValue({ status: 200, data: mockUploadResponse });

    await fileUploadHandler({ files: [mockFile] });

    expect(uploadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { Authorization: 'Bearer session-token' } }),
    );
  });

  it('局域网认证 Cookie 正常时不为上传请求添加 Bearer 认证', async () => {
    authManager.setUser(mockUserObject);
    setStoredAccessToken('session-token');
    document.cookie = 'immich_is_authenticated=true; Path=/';
    const uploadSpy = vi.spyOn(utils, 'uploadRequest').mockResolvedValue({ status: 200, data: mockUploadResponse });

    await fileUploadHandler({ files: [mockFile] });

    expect(uploadSpy).toHaveBeenCalledWith(expect.objectContaining({ headers: undefined }));
  });
});
