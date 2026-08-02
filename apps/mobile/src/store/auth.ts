import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import { create } from 'zustand';
import {
  api,
  clearTokens,
  hasSession,
  setSessionExpiredHandler,
  setTokens,
} from '../api/client.js';

/**
 * The session store.
 *
 * Tokens are never held here — they live in the Keychain via the API client, and this
 * store only ever mirrors *who* is signed in. Keeping the credential out of JS state
 * means a Redux-devtools-style dump, a crash report, or a serialized store can never
 * leak it.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  currency: string;
  xp: number;
  authProviders: string[];
  onboardedAt: string | null;
}

interface SessionResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  /** Only present on /auth/social. */
  isNew?: boolean;
}

interface MeResponse {
  user: User;
}

export type AuthStatus = 'loading' | 'authed' | 'anon';

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

interface ExpoExtra {
  googleIosClientId?: string;
  googleAndroidClientId?: string;
  googleWebClientId?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;

/**
 * Every day-boundary decision on the server — streaks, "today", the daily summary —
 * is computed in the user's zone. If the client never tells the server what that zone
 * is, the backend silently falls back to UTC and a user in Asia/Kolkata loses their
 * streak at 5:30am. So the zone is sent on every credential-creating call.
 */
function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

const GOOGLE_DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

function googleClientId(): string {
  const id = Platform.select({
    ios: extra.googleIosClientId,
    android: extra.googleAndroidClientId,
    default: extra.googleWebClientId,
  });

  if (!id) throw new Error('Google sign-in is not configured for this build.');
  return id;
}

/**
 * Google makes installed apps redirect to the REVERSED client id, as a custom URL scheme:
 *
 *   1234-abcd.apps.googleusercontent.com
 *     -> com.googleusercontent.apps.1234-abcd:/oauthredirect
 *
 * It will not accept an arbitrary app scheme (`synitheia://`) for an iOS or Android client,
 * so this cannot be the app's own scheme. The reversed scheme is registered in app.json, or
 * iOS has nowhere to deliver the redirect back to.
 *
 * Note the SINGLE slash. This is built by hand rather than with `makeRedirectUri({scheme,
 * path})`, which returns the conventional authority form `scheme://oauthredirect` — and
 * Google rejects that outright with `Error 400: invalid_request`. Verified against Google's
 * authorization endpoint: `:/oauthredirect` is accepted, `://oauthredirect` is not.
 */
function googleRedirectUri(clientId: string): string {
  const reversed = clientId.replace(/\.apps\.googleusercontent\.com$/, '');
  return `com.googleusercontent.apps.${reversed}:/oauthredirect`;
}

/** A user tapping "cancel" in a system sheet is not an error worth surfacing. */
function isUserCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ERR_REQUEST_CANCELED'
  );
}

interface AuthState {
  user: User | null;
  status: AuthStatus;

  /** Wire up the client's session-expiry callback exactly once, at app start. */
  init: () => void;
  hydrate: () => Promise<void>;
  refreshUser: () => Promise<void>;

  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => {
  async function adopt(session: SessionResponse): Promise<void> {
    await setTokens(session.accessToken, session.refreshToken);
    set({ user: session.user, status: 'authed' });
  }

  return {
    user: null,
    status: 'loading',

    init() {
      // A refresh that fails means the refresh token was revoked or reused. The client
      // has already cleared the Keychain; all that is left is to drop the UI to signed-out
      // so the router sends the user to sign-in instead of rendering an empty dashboard.
      setSessionExpiredHandler(() => set({ user: null, status: 'anon' }));
    },

    async hydrate() {
      set({ status: 'loading' });

      if (!(await hasSession())) {
        set({ user: null, status: 'anon' });
        return;
      }

      try {
        const { user } = await api.get<MeResponse>('/me');
        set({ user, status: 'authed' });
      } catch {
        // The client already attempted a refresh and cleared tokens if it failed.
        await clearTokens();
        set({ user: null, status: 'anon' });
      }
    },

    /**
     * Re-read the signed-in user, for a screen that shows something about them which
     * moves while the app is open. `xp` is the one that does: it is written server-side
     * by habit logs, water logs and the monthly budget award, and this store is
     * populated only by `hydrate()` and sign-in. Profile therefore showed whatever `xp`
     * was at launch — "Start collecting XP" for a whole session, no matter what the user
     * earned. Invisible before XP was ever awarded, because the value was always 0.
     *
     * Deliberately NOT `hydrate()`, which is a session gate rather than a refresh:
     *
     *   · it sets `status: 'loading'`, which stalls AuthGate's routing effect, and
     *   · its catch clears the Keychain and drops to `anon` on ANY throw — including a
     *     plain network failure. Calling it on every screen focus would sign a user out
     *     for opening Profile on a train.
     *
     * So this touches only `user`, and a failure leaves the last known value on screen.
     * A slightly stale number is the correct outcome of a failed refresh; a sign-out is
     * not.
     */
    async refreshUser() {
      try {
        const { user } = await api.get<MeResponse>('/me');
        set({ user });
      } catch {
        // Keep what we have. A genuinely dead session is handled by the client's
        // refresh flow and the onSessionExpired callback wired up in init().
      }
    },

    async signIn(email, password) {
      const session = await api.post<SessionResponse>('/auth/login', {
        email: email.trim(),
        password,
      });
      await adopt(session);
    },

    async signUp({ name, email, password }) {
      const session = await api.post<SessionResponse>('/auth/signup', {
        name: name.trim(),
        email: email.trim(),
        password,
        timezone: deviceTimeZone(),
      });
      await adopt(session);
    },

    async signInWithApple() {
      try {
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });

        if (!credential.identityToken) {
          throw new Error('Apple did not return an identity token.');
        }

        // Apple hands over the name ONLY on the very first authorization for this app.
        // Every subsequent sign-in — including after a reinstall — returns null, and the
        // name is not in the identity token either. If we do not capture and forward it
        // now, it is gone permanently and the account is stuck being called "there".
        const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
          .filter((part): part is string => Boolean(part))
          .join(' ')
          .trim();

        const session = await api.post<SessionResponse>('/auth/social', {
          provider: 'apple',
          idToken: credential.identityToken,
          name: fullName.length > 0 ? fullName : null,
          timezone: deviceTimeZone(),
        });

        await adopt(session);
      } catch (error) {
        if (isUserCancellation(error)) return;
        throw error;
      }
    },

    /**
     * Authorization code + PKCE, NOT the implicit id_token flow.
     *
     * Google does not support `response_type=id_token` for installed apps — that is a Web
     * client feature, and a web client may only redirect to https, which a native app has
     * no way to receive. An iOS/Android client must ask for a `code` and exchange it.
     *
     * PKCE is what makes that exchange safe without a client secret (and a native app can
     * never hold a secret — it ships inside the binary). The code that comes back through
     * the browser is useless to anyone who did not generate the verifier, and the ID token
     * itself never travels through the redirect at all: it is fetched directly from
     * Google's token endpoint over TLS.
     */
    async signInWithGoogle() {
      const clientId = googleClientId();
      const redirectUri = googleRedirectUri(clientId);

      const request = new AuthSession.AuthRequest({
        clientId,
        redirectUri,
        scopes: ['openid', 'profile', 'email'],
        responseType: AuthSession.ResponseType.Code,
        usePKCE: true,
      });

      const result = await request.promptAsync(GOOGLE_DISCOVERY);

      if (result.type === 'cancel' || result.type === 'dismiss') return;
      if (result.type !== 'success') {
        throw new Error('Google sign-in failed. Please try again.');
      }

      const code = result.params.code;
      if (!code) throw new Error('Google did not return an authorization code.');

      const tokens = await AuthSession.exchangeCodeAsync(
        {
          clientId,
          code,
          redirectUri,
          extraParams: { code_verifier: request.codeVerifier ?? '' },
        },
        GOOGLE_DISCOVERY,
      );

      // The only thing we want is the identity assertion. The access token would let us
      // call Google's APIs on the user's behalf, which this app has no reason to do.
      const idToken = tokens.idToken;
      if (!idToken) throw new Error('Google did not return an identity token.');

      const session = await api.post<SessionResponse>('/auth/social', {
        provider: 'google',
        idToken,
        timezone: deviceTimeZone(),
      });

      await adopt(session);
    },

    async signOut() {
      try {
        // logout-all rather than logout: the client deliberately does not expose the
        // refresh token (which /auth/logout wants in its body), and revoking every
        // session on an explicit sign-out is the safer default anyway.
        await api.post<void>('/auth/logout-all');
      } catch {
        // A network failure must not trap the user in a session they asked to leave.
      } finally {
        await clearTokens();
        set({ user: null, status: 'anon' });
      }
    },
  };
});
