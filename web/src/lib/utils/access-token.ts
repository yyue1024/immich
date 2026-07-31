import { defaults, setHeader } from '@immich/sdk';
import { browser } from '$app/environment';

const ACCESS_TOKEN_STORAGE_KEY = 'immich-web-access-token';
const AUTHORIZATION_HEADER = 'Authorization';

export const setStoredAccessToken = (accessToken: string) => {
  setHeader(AUTHORIZATION_HEADER, `Bearer ${accessToken}`);

  if (!browser) {
    return;
  }

  try {
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  } catch {
    // 忽略不可用的本地存储。
  }
};

export const loadStoredAccessToken = () => {
  if (!browser) {
    return false;
  }

  try {
    const accessToken = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    if (!accessToken) {
      return false;
    }

    setHeader(AUTHORIZATION_HEADER, `Bearer ${accessToken}`);
    return true;
  } catch {
    return false;
  }
};

export const clearStoredAccessToken = () => {
  if (defaults.headers) {
    delete defaults.headers[AUTHORIZATION_HEADER];
    delete defaults.headers[AUTHORIZATION_HEADER.toLowerCase()];
  }

  if (!browser) {
    return;
  }

  try {
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // 忽略不可用的本地存储。
  }
};
