import crypto from 'node:crypto';
import { inspectRobotsAndSitemap } from './crawler.ts';

export const PSI_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PSI_REQUEST_TIMEOUT_MS = 25_000;
const PSI_MAX_CACHE_ENTRIES = 500;

export type PsiStrategy = 'mobile' | 'desktop';
export type PageSpeedKeySource = 'PAGESPEED_API_KEY' | 'GOOGLE_PAGESPEED_API_KEY' | 'none';

export interface PsiOpportunity {
  title: string;
  savings: string;
  description: string;
}

export interface PsiMetricsPayload {
  url: string;
  strategy: PsiStrategy;
  performanceScore: number;
  seoScore: number;
  accessibilityScore: number;
  bestPracticesScore: number;
  lcpMs: number;
  cls: number;
  inpMs: number;
  fcpMs: number;
  ttfbMs: number;
  robotsStatus: string;
  sitemapStatus: string;
  opportunities: PsiOpportunity[];
}

export interface PsiCacheEntry {
  cachedAt: number;
  expiresAt: number;
  payload: PsiMetricsPayload;
}

interface QuotaBlockEntry {
  until: number;
  message: string;
  consumerProject: string;
  keySource: PageSpeedKeySource;
}

export class PageSpeedApiError extends Error {
  status: number;
  code: 'PAGESPEED_KEY_MISSING' | 'PAGESPEED_QUOTA_EXCEEDED' | 'PAGESPEED_API_ERROR';
  quotaExceeded: boolean;
  consumerProject?: string;
  keySource?: PageSpeedKeySource;
  retryAfter?: string;

  constructor(
    message: string,
    opts: {
      status: number;
      code: 'PAGESPEED_KEY_MISSING' | 'PAGESPEED_QUOTA_EXCEEDED' | 'PAGESPEED_API_ERROR';
      quotaExceeded?: boolean;
      consumerProject?: string;
      keySource?: PageSpeedKeySource;
      retryAfter?: string;
    }
  ) {
    super(message);
    this.name = 'PageSpeedApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.quotaExceeded = Boolean(opts.quotaExceeded);
    this.consumerProject = opts.consumerProject;
    this.keySource = opts.keySource;
    this.retryAfter = opts.retryAfter;
  }
}

const psiMemoryCache = new Map<string, PsiCacheEntry>();
const psiInFlight = new Map<string, Promise<PsiMetricsPayload>>();
const psiQuotaBlockedByKey = new Map<string, QuotaBlockEntry>();

export function getPageSpeedKeyConfig(): {
  apiKey: string;
  source: PageSpeedKeySource;
  fingerprint: string;
} {
  const primary = process.env.PAGESPEED_API_KEY?.trim() || '';
  if (primary) {
    return {
      apiKey: primary,
      source: 'PAGESPEED_API_KEY',
      fingerprint: crypto.createHash('sha256').update(primary).digest('hex').slice(0, 12),
    };
  }
  const fallback = process.env.GOOGLE_PAGESPEED_API_KEY?.trim() || '';
  if (fallback) {
    return {
      apiKey: fallback,
      source: 'GOOGLE_PAGESPEED_API_KEY',
      fingerprint: crypto.createHash('sha256').update(fallback).digest('hex').slice(0, 12),
    };
  }
  return { apiKey: '', source: 'none', fingerprint: '' };
}

export function normalizePsiUrl(parsedUrl: URL): string {
  const normalized = new URL(parsedUrl.toString());
  normalized.hash = '';
  return normalized.toString().slice(0, 500);
}

export function makePsiCacheKey(normalizedUrl: string, strategy: PsiStrategy): string {
  return `${normalizedUrl}::${strategy}`;
}

export function getPsiQuotaStatus(): {
  quotaExhausted: boolean;
  retryAfter: string | null;
  consumerProject: string | null;
  keySource: PageSpeedKeySource;
} {
  const keyCfg = getPageSpeedKeyConfig();
  if (!keyCfg.fingerprint) {
    return {
      quotaExhausted: false,
      retryAfter: null,
      consumerProject: null,
      keySource: keyCfg.source,
    };
  }
  const blocked = psiQuotaBlockedByKey.get(keyCfg.fingerprint);
  if (!blocked || blocked.until <= Date.now()) {
    if (blocked) psiQuotaBlockedByKey.delete(keyCfg.fingerprint);
    return {
      quotaExhausted: false,
      retryAfter: null,
      consumerProject: null,
      keySource: keyCfg.source,
    };
  }
  return {
    quotaExhausted: true,
    retryAfter: new Date(blocked.until).toISOString(),
    consumerProject: blocked.consumerProject || null,
    keySource: keyCfg.source,
  };
}

function getNextDailyResetTimestampMs(nowMs = Date.now()): number {
  // Google API daily quotas reset at midnight US Pacific time (PT).
  // Advance up to ~24h to next 00:05 PT (08:05 UTC standard / 07:05 UTC DST; use 08:05 UTC as safe reset bound).
  const now = new Date(nowMs);
  const nextUtc8 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 5, 0, 0);
  const target = nextUtc8 > nowMs ? nextUtc8 : nextUtc8 + 24 * 60 * 60 * 1000;
  return Math.max(nowMs + 60 * 60 * 1000, target);
}

function isQuotaExceededResponse(status: number, rawMessage: string, reason: string): boolean {
  if (status === 429) return true;
  return /quota\s*exceeded|dailyLimitExceeded|rateLimitExceeded|userRateLimitExceeded|queries\s*per\s*day/i.test(
    `${rawMessage} ${reason}`
  );
}

function extractConsumerProject(rawMessage: string): string {
  const match = rawMessage.match(/project_number[:\s]*(\d+)/i);
  return match ? match[1] : '';
}

function sanitizePsiErrorMessage(raw: string, apiKey: string): string {
  if (!raw) return '';
  return apiKey ? raw.split(apiKey).join('[REDACTED_KEY]') : raw;
}

function pruneCacheIfNeeded() {
  const now = Date.now();
  for (const [k, v] of psiMemoryCache.entries()) {
    if (v.expiresAt <= now) psiMemoryCache.delete(k);
  }
  if (psiMemoryCache.size > PSI_MAX_CACHE_ENTRIES) {
    const oldestKey = psiMemoryCache.keys().next().value;
    if (oldestKey) psiMemoryCache.delete(oldestKey);
  }
}

export function clearPsiStateForTests() {
  psiMemoryCache.clear();
  psiInFlight.clear();
  psiQuotaBlockedByKey.clear();
}

export async function fetchPageSpeedWithCache(
  parsedUrl: URL,
  strategy: PsiStrategy
): Promise<{
  metrics: PsiMetricsPayload;
  cached: boolean;
  cachedAt: string;
  cacheExpiresAt: string;
  keySource: PageSpeedKeySource;
}> {
  const normalizedUrl = normalizePsiUrl(parsedUrl);
  const cacheKey = makePsiCacheKey(normalizedUrl, strategy);
  const keyCfg = getPageSpeedKeyConfig();
  const now = Date.now();

  // 1. Return valid 24-hour cached result before checking quota or making external calls
  const existing = psiMemoryCache.get(cacheKey);
  if (existing && existing.expiresAt > now) {
    return {
      metrics: existing.payload,
      cached: true,
      cachedAt: new Date(existing.cachedAt).toISOString(),
      cacheExpiresAt: new Date(existing.expiresAt).toISOString(),
      keySource: keyCfg.source,
    };
  }

  // 2. Enforce server API key (strictly forbid anonymous or keyless requests)
  if (!keyCfg.apiKey) {
    throw new PageSpeedApiError(
      'PAGESPEED_API_KEY is not configured on the server. Anonymous or keyless PageSpeed Insights API requests are disabled.',
      {
        status: 503,
        code: 'PAGESPEED_KEY_MISSING',
        keySource: 'none',
      }
    );
  }

  // 3. Fail fast without calling Google PSI when daily quota is known to be exhausted for this key
  const blocked = psiQuotaBlockedByKey.get(keyCfg.fingerprint);
  if (blocked && blocked.until > now) {
    throw new PageSpeedApiError(blocked.message, {
      status: 429,
      code: 'PAGESPEED_QUOTA_EXCEEDED',
      quotaExceeded: true,
      consumerProject: blocked.consumerProject || undefined,
      keySource: keyCfg.source,
      retryAfter: new Date(blocked.until).toISOString(),
    });
  }
  if (blocked) {
    psiQuotaBlockedByKey.delete(keyCfg.fingerprint);
  }

  // 4. Deduplicate concurrent in-flight requests for the same URL and device
  const existingInFlight = psiInFlight.get(cacheKey);
  if (existingInFlight) {
    const metrics = await existingInFlight;
    const updatedCache = psiMemoryCache.get(cacheKey);
    return {
      metrics,
      cached: false,
      cachedAt: new Date(updatedCache?.cachedAt || Date.now()).toISOString(),
      cacheExpiresAt: new Date(updatedCache?.expiresAt || Date.now() + PSI_CACHE_TTL_MS).toISOString(),
      keySource: keyCfg.source,
    };
  }

  const runLiveRequest = async (): Promise<PsiMetricsPayload> => {
    const psiUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    psiUrl.searchParams.set('url', normalizedUrl);
    psiUrl.searchParams.set('strategy', strategy);
    ['performance', 'seo', 'accessibility', 'best-practices'].forEach((cat) =>
      psiUrl.searchParams.append('category', cat)
    );
    psiUrl.searchParams.set('key', keyCfg.apiKey);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PSI_REQUEST_TIMEOUT_MS);
    let psiRes: Response;
    try {
      psiRes = await fetch(psiUrl.toString(), { signal: ctrl.signal });
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'AbortError'
          ? 'PageSpeed Insights API timed out after 25 seconds.'
          : err instanceof Error
          ? err.message
          : 'Network error while contacting PageSpeed Insights API.';
      throw new PageSpeedApiError(sanitizePsiErrorMessage(msg, keyCfg.apiKey), {
        status: 504,
        code: 'PAGESPEED_API_ERROR',
        keySource: keyCfg.source,
      });
    } finally {
      clearTimeout(timer);
    }

    let psiJson: Record<string, any> = {};
    try {
      psiJson = (await psiRes.json()) as Record<string, any>;
    } catch {
      psiJson = {};
    }

    if (!psiRes.ok || psiJson?.error) {
      const rawMessage = sanitizePsiErrorMessage(
        String(psiJson?.error?.message || `PageSpeed Insights API returned HTTP ${psiRes.status}.`),
        keyCfg.apiKey
      );
      const reason = String(psiJson?.error?.errors?.[0]?.reason || '');

      if (isQuotaExceededResponse(psiRes.status, rawMessage, reason)) {
        const consumerProject = extractConsumerProject(rawMessage);
        const isDailyQuota = /per\s*day|dailyLimitExceeded|queries\s*per\s*day/i.test(
          `${rawMessage} ${reason}`
        );
        const blockedUntil = isDailyQuota
          ? getNextDailyResetTimestampMs()
          : Date.now() + 15 * 60 * 1000;
        const retryAfterIso = new Date(blockedUntil).toISOString();
        const projectSuffix = consumerProject ? ` (Consumer project: ${consumerProject})` : '';
        const friendlyMessage = isDailyQuota
          ? `Google PageSpeed Insights daily API quota exceeded for server key ${keyCfg.source}${projectSuffix}. Automatic retries are paused until quota resets or a new PAGESPEED_API_KEY is configured.`
          : `Google PageSpeed Insights API rate limit reached for server key ${keyCfg.source}${projectSuffix}. Requests are temporarily paused; please try again later.`;

        psiQuotaBlockedByKey.set(keyCfg.fingerprint, {
          until: blockedUntil,
          message: friendlyMessage,
          consumerProject,
          keySource: keyCfg.source,
        });

        throw new PageSpeedApiError(friendlyMessage, {
          status: 429,
          code: 'PAGESPEED_QUOTA_EXCEEDED',
          quotaExceeded: true,
          consumerProject: consumerProject || undefined,
          keySource: keyCfg.source,
          retryAfter: retryAfterIso,
        });
      }

      throw new PageSpeedApiError(rawMessage, {
        status: psiRes.status >= 400 && psiRes.status < 600 ? psiRes.status : 502,
        code: 'PAGESPEED_API_ERROR',
        keySource: keyCfg.source,
      });
    }

    const lh = psiJson?.lighthouseResult || {};
    const cats = lh.categories || {};
    const audits = lh.audits || {};

    const scoreOf = (catKey: string) =>
      Math.trunc(Math.round(((cats[catKey]?.score as number) || 0) * 100));
    const numAudit = (key: string) => Number(audits[key]?.numericValue || 0);

    const performanceScore = scoreOf('performance');
    const seoScore = scoreOf('seo');
    const accessibilityScore = scoreOf('accessibility');
    const bestPracticesScore = scoreOf('best-practices');

    const lcpMs = Math.round(numAudit('largest-contentful-paint'));
    const cls = Number(numAudit('cumulative-layout-shift').toFixed(3));
    const inpMs = Math.round(
      numAudit('interaction-to-next-paint') || numAudit('max-potential-fid') || 0
    );
    const fcpMs = Math.round(numAudit('first-contentful-paint'));
    const ttfbMs = Math.round(numAudit('server-response-time'));

    const opportunities: PsiOpportunity[] = Object.values(audits)
      .filter((a: unknown) => {
        const aud = a as { score?: number | null; details?: { type?: string }; title?: string };
        return (
          aud &&
          aud.score !== null &&
          aud.score !== undefined &&
          aud.score < 0.9 &&
          aud.details?.type === 'opportunity' &&
          aud.title
        );
      })
      .slice(0, 12)
      .map((a: unknown) => {
        const aud = a as {
          id?: string;
          title?: string;
          displayValue?: string;
          description?: string;
        };
        return {
          title: String(aud.title || '').slice(0, 140),
          savings: String(aud.displayValue || 'Optimization available').slice(0, 80),
          description: String(aud.description || '').replace(/\[.*?\]\(.*?\)/g, '').slice(0, 260),
        };
      });

    const robotsMeta = await inspectRobotsAndSitemap(parsedUrl);
    const robotsStatus = robotsMeta.robotsBlockingAll
      ? 'Blocked (Disallow: /)'
      : robotsMeta.robotsTxtFound
      ? 'Allowed'
      : 'Missing robots.txt';
    const sitemapStatus = robotsMeta.sitemapFound
      ? `Active (${robotsMeta.sitemapUrls.length} sampled URLs)`
      : 'Missing sitemap.xml';

    const payload: PsiMetricsPayload = {
      url: normalizedUrl,
      strategy,
      performanceScore,
      seoScore,
      accessibilityScore,
      bestPracticesScore,
      lcpMs,
      cls,
      inpMs,
      fcpMs,
      ttfbMs,
      robotsStatus: robotsStatus.slice(0, 120),
      sitemapStatus: sitemapStatus.slice(0, 120),
      opportunities,
    };

    const cachedAt = Date.now();
    psiMemoryCache.set(cacheKey, {
      cachedAt,
      expiresAt: cachedAt + PSI_CACHE_TTL_MS,
      payload,
    });
    pruneCacheIfNeeded();

    return payload;
  };

  const promise = runLiveRequest().finally(() => {
    psiInFlight.delete(cacheKey);
  });
  psiInFlight.set(cacheKey, promise);

  const metrics = await promise;
  const saved = psiMemoryCache.get(cacheKey);
  return {
    metrics,
    cached: false,
    cachedAt: new Date(saved?.cachedAt || Date.now()).toISOString(),
    cacheExpiresAt: new Date(saved?.expiresAt || Date.now() + PSI_CACHE_TTL_MS).toISOString(),
    keySource: keyCfg.source,
  };
}
