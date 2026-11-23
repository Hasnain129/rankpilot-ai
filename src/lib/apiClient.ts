import { auth } from './firebase';

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  data?: Record<string, unknown>;

  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = typeof data?.code === 'string' ? data.code : undefined;
    this.data = data;
  }
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit & { googleAccessToken?: string | null } = {}
): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error(
      'Sign in with a verified RankPilot account to run live server crawls, AI optimizations, or API integrations.'
    );
  }
  if (!user.emailVerified) {
    throw new Error('Please verify your email address before running live SEO actions.');
  }

  const idToken = await user.getIdToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Authorization', `Bearer ${idToken}`);

  if (options.googleAccessToken) {
    headers.set('X-Google-Access-Token', options.googleAccessToken);
  }

  const { googleAccessToken: _gsc, ...fetchOpts } = options;
  const res = await fetch(url, { ...fetchOpts, headers });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiRequestError(`Server returned an invalid response (${res.status}).`, res.status);
  }

  if (!res.ok) {
    throw new ApiRequestError(
      String(json.error || `Request failed with status ${res.status}.`),
      res.status,
      json
    );
  }

  return json as T;
}
