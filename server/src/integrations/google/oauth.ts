/**
 * Google OAuth 2.0 — written by hand (no big library) so you can see every step.
 *
 * 📘 LESSON: The OAuth "authorization code" flow
 *   1. /api/gmail/connect  → we send the user to Google's login page with:
 *        client_id   (who is asking: our app)
 *        scope       (what we want: ONLY read Gmail)
 *        state       (random value → proves the answer is for OUR request; stops CSRF attacks)
 *        code_challenge (PKCE → proves the same app finishes the login)
 *   2. User logs in AT GOOGLE and clicks Allow. We never see their password.
 *   3. Google redirects to /api/gmail/callback?code=...&state=...
 *   4. We check `state`, then trade the `code` (+ secret + PKCE verifier) for TOKENS.
 *   5. Access token expires in ~1 hour → we use the refresh token to get a new one.
 *
 * 📘 Least privilege: we ask ONLY for "gmail.readonly". Even if something goes wrong,
 * this key cannot send, delete or change any email.
 */
import { createHash, randomBytes } from "node:crypto";
import { config } from "../../config.js";
import { deleteTokens, loadTokens, saveTokens, type GoogleTokens } from "./tokenStore.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

// Google sends the user back HERE (straight to the backend, port 4000).
// "Desktop app" OAuth clients may use any 127.0.0.1 address without registering it.
const redirectUri = () => `http://127.0.0.1:${config.port}/api/gmail/callback`;

export class GoogleAuthError extends Error {}

export function isConfigured(): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

export function gmailStatus() {
  const tokens = loadTokens();
  return { configured: isConfigured(), connected: Boolean(tokens), email: tokens?.email ?? null };
}

// Logins in progress: state → PKCE verifier. Kept in memory for 10 minutes.
const pending = new Map<string, { verifier: string; expires: number }>();

/** Step 1: build the Google login URL. */
export function buildAuthUrl(): string {
  if (!isConfigured()) throw new GoogleAuthError("Google client ID/secret missing in server/.env");

  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  pending.set(state, { verifier, expires: Date.now() + 10 * 60_000 });

  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline", // → also give us a refresh token
    prompt: "consent", // → always show the Allow screen (so we get a refresh token)
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  error?: string;
  error_description?: string;
};

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || data.error) {
    throw new GoogleAuthError(`${data.error ?? res.status}: ${data.error_description ?? "token request failed"}`);
  }
  return data;
}

/** Steps 3–4: Google sent us back a code → trade it for tokens. */
export async function handleCallback(code: string, state: string): Promise<string> {
  const login = pending.get(state);
  pending.delete(state); // one-time use
  if (!login || login.expires < Date.now()) {
    throw new GoogleAuthError("Login expired or invalid state. Please click Connect Gmail again.");
  }

  const data = await postToken({
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
    code_verifier: login.verifier,
  });
  if (!data.refresh_token) throw new GoogleAuthError("Google did not return a refresh token.");
  if (!data.scope.includes(GMAIL_SCOPE)) {
    throw new GoogleAuthError("Permission to read Gmail was not granted (the checkbox was left unticked).");
  }

  // Ask Gmail whose account this is
  const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const profile = (await profileRes.json()) as { emailAddress?: string; error?: { message: string } };
  if (!profileRes.ok) throw new GoogleAuthError(profile.error?.message ?? "Could not read Gmail profile");

  saveTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email: profile.emailAddress ?? "unknown",
    scope: data.scope,
  });
  return profile.emailAddress ?? "unknown";
}

let refreshing: Promise<string> | null = null;

/**
 * Step 5: get a valid access token, refreshing it if it is (almost) expired.
 * If Google says the refresh token is dead (e.g. 7-day limit in "Testing" mode),
 * we delete it so the UI shows "Connect Gmail" again.
 */
export async function getAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new GoogleAuthError("Gmail is not connected.");
  if (tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;

  // If two requests need a refresh at the same time, share ONE refresh call
  refreshing ??= (async () => {
    try {
      const data = await postToken({
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      });
      const updated: GoogleTokens = {
        ...tokens,
        accessToken: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };
      saveTokens(updated);
      return updated.accessToken;
    } catch (err) {
      if (err instanceof GoogleAuthError && err.message.startsWith("invalid_grant")) {
        deleteTokens();
        throw new GoogleAuthError("Gmail login expired. Please click Connect Gmail again.");
      }
      throw err;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Disconnect: tell Google to cancel the key, then delete our copy. */
export async function disconnect(): Promise<void> {
  const tokens = loadTokens();
  if (tokens) {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(tokens.refreshToken)}`, { method: "POST" }).catch(() => {});
  }
  deleteTokens();
}
