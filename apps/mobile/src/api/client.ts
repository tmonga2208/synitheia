import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

/**
 * The API client.
 *
 * Two things it is responsible for, beyond fetching:
 *
 *  1. Tokens live in the Keychain / Android Keystore, never in AsyncStorage. A refresh
 *     token is a long-lived credential; AsyncStorage is plaintext on a rooted device.
 *
 *  2. A 401 triggers exactly ONE refresh, which every concurrent request then awaits.
 *     Without that single-flight guard, an app cold-starting with five parallel queries
 *     fires five refreshes; four of them present a token the first has already rotated,
 *     the server correctly reads that as token reuse, and it revokes the whole session.
 *     The user gets logged out for opening the app. See tokens.ts on the server.
 */

const ACCESS_KEY = 'synitheia.access';
const REFRESH_KEY = 'synitheia.refresh';
const MIGRATED_KEY = 'synitheia.tokens.v2';

/**
 * Readable after the first unlock since boot, on this device only.
 *
 * The default (readable only while unlocked) made every background sync on a locked
 * phone fail auth. This is the narrowest class that works in the background: the tokens
 * still never leave the device and never reach iCloud Keychain.
 */
const TOKEN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const baseUrl: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:4000';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error.code ?? 'unknown';
    this.details = body?.error.details;
  }
}

export async function setTokens(access: string, refresh: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, access, TOKEN_OPTIONS),
    SecureStore.setItemAsync(REFRESH_KEY, refresh, TOKEN_OPTIONS),
  ]);
}

/**
 * Move one keychain item to the background-readable class, keeping its value.
 *
 * Delete, then add — a plain re-save is NOT enough. Writing to a key that already exists
 * is an update of its value only; the accessibility class is fixed when the item is
 * created, so the old item would stay unreadable on a locked phone forever.
 */
async function restore(key: string, value: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
  try {
    await SecureStore.setItemAsync(key, value, TOKEN_OPTIONS);
  } catch {
    // The item is gone and the new one was refused. Put the value back the old way
    // rather than sign the user out over a storage-class upgrade.
    await SecureStore.setItemAsync(key, value);
    throw new Error('token accessibility upgrade failed');
  }
}

/**
 * Re-store tokens written before TOKEN_OPTIONS existed. Runs once, from the foreground,
 * where the old items are still readable.
 *
 * Never throws. If the keychain cannot be read (a launch while locked) or a write is
 * refused, the marker is not set and the next launch tries again.
 */
export async function migrateTokenAccessibility(): Promise<void> {
  try {
    if ((await SecureStore.getItemAsync(MIGRATED_KEY)) !== null) return;

    const [access, refresh] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
    ]);
    if (access !== null) await restore(ACCESS_KEY, access);
    if (refresh !== null) await restore(REFRESH_KEY, refresh);

    await SecureStore.setItemAsync(MIGRATED_KEY, '1', TOKEN_OPTIONS);
  } catch {
    // Tokens are still where they were; only the upgrade is deferred.
  }
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export async function hasSession(): Promise<boolean> {
  return (await SecureStore.getItemAsync(REFRESH_KEY)) !== null;
}

/** Set by the auth store so a failed refresh can drop the user to sign-in. */
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

/** The single-flight guard. Concurrent 401s all await this one promise. */
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Whether any request waiting on the in-flight refresh came from the foreground.
 *
 * The refresh is shared, so "may a failure sign the user out?" cannot be the property of
 * whichever caller happened to start it. If a background sync starts the refresh and a
 * screen joins it, someone IS looking, and a dead session has to be handled now.
 */
let foregroundWaiting = false;

async function refreshAccessToken(preserveSession = false): Promise<string | null> {
  if (!preserveSession) foregroundWaiting = true;

  refreshInFlight ??= (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!refreshToken) return null;

      const res = await fetch(`${baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        // A background task must never sign the user out: they are not looking, and the
        // next foreground request will find the same dead token and handle it properly.
        if (foregroundWaiting) {
          await clearTokens();
          onSessionExpired?.();
        }
        return null;
      }

      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      await setTokens(data.accessToken, data.refreshToken);
      return data.accessToken;
    } finally {
      refreshInFlight = null;
      foregroundWaiting = false;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set internally to stop a refreshed request from recursing forever. */
  _retried?: boolean;
  /** Set by background sync. A failed refresh then leaves the stored session untouched. */
  background?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, _retried, headers, background, ...rest } = options;
  const token = await getAccessToken();

  const isFormData = body instanceof FormData;
  const hasBody = body !== undefined;

  /**
   * Only declare a JSON content-type when there is actually JSON to send.
   *
   * Sending `content-type: application/json` with an EMPTY body — which is every DELETE
   * this app makes — causes Fastify to reject the request outright:
   *
   *     Body cannot be empty when content-type is set to 'application/json'
   *
   * It broke every delete button in the app, and it hid from curl, which does not send
   * the header unless you ask it to. The tests passed; the app did not.
   */
  const res = await fetch(`${baseUrl}/v1${path}`, {
    ...rest,
    headers: {
      ...(hasBody && !isFormData ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: isFormData ? (body as FormData) : hasBody ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !_retried) {
    const fresh = await refreshAccessToken(background === true);
    if (fresh) {
      return request<T>(path, { ...options, _retried: true });
    }
  }

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, errorBody, `Request failed with ${res.status}`);
  }

  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, options?: { background?: boolean }) =>
    request<T>(path, { method: 'POST', body, ...options }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body }),
  upload: <T>(path: string, form: FormData) =>
    request<T>(path, { method: 'POST', body: form }),
};
