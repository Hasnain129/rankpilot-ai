import crypto from 'node:crypto';
import { inspectRobotsAndSitemap } from './crawler.ts';

export const PSI_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_PSI_REQUEST_TIMEOUT_MS = 45_000;
const MIN_PSI_TIMEOUT_MS = 10_000;
const MAX_PSI_TIMEOUT_MS = 55_000;
const DEFAULT_PSI_TOTAL_BUDGET_MS = 52_000;
const MIN_RETRY_BUDGET_MS = 15_000;
const PSI_MAX_CACHE_ENTRIES = 500;

export function getPsiRequestTimeoutMs(): number {
  const raw = Number(process.env.PAGESPEED_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(MIN_PSI_TIMEOUT_MS, Math.min(MAX_PSI_TIMEOUT_MS, Math.round(raw)));
  }
  return DEFAULT_PSI_REQUEST_TIMEOUT_MS;
}

export function getPsiTotalBudgetMs(perRequestTimeoutMs: number): number {
  const raw = Number(process.env.PAGESPEED_TOTAL_BUDGET_MS);
  const defaultBudget = Math.max(perRequestTimeoutMs + 5_000, DEFAULT_PSI_TOTAL_BUDGET_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(perRequestTimeoutMs, Math.min(58_000, Math.round(raw)));
  }
  return Math.min(58_000, defaultBudget);
}

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
  upstreamStatus?: number;
  durationMs?: number;
  attempts?: number;
  timeoutMs?: number;

  constructor(
    message: string,
    opts: {
      status: number;
      code: 'PAGESPEED_KEY_MISSING' | 'PAGESPEED_QUOTA_EXCEEDED' | 'PAGESPEED_API_ERROR';
      quotaExceeded?: boolean;
      consumerProject?: string;
      keySource?: PageSpeedKeySource;
      retryAfter?: string;
      upstreamStatus?: number;
      durationMs?: number;
      attempts?: number;
      timeoutMs?: number;
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
    this.upstreamStatus = opts.upstreamStatus;
    this.durationMs = opts.durationMs;
    this.attempts = opts.attempts;
    this.timeoutMs = opts.timeoutMs;
  }
}

const psiMemoryCache = new Map<string, PsiCacheEntry>();
const psiInFlight = new Map<
  string,
  Promise<{
    metrics: PsiMetricsPayload;
    durationMs: number;
    upstreamStatus: number;
    attempts: number;
    timeoutMs: number;
  }>
>();
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

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 500 || status === 502 || status === 503;
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

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchPageSpeedOptions {
  fetchFn?: typeof fetch;
  robotsFn?: typeof inspectRobotsAndSitemap;
  sleepFn?: (ms: number) => Promise<void>;
}

export async function fetchPageSpeedWithCache(
  parsedUrl: URL,
  strategy: PsiStrategy,
  options?: FetchPageSpeedOptions
): Promise<{
  metrics: PsiMetricsPayload;
  cached: boolean;
  cachedAt: string;
  cacheExpiresAt: string;
  keySource: PageSpeedKeySource;
  durationMs: number;
  upstreamStatus: number;
  attempts: number;
  timeoutMs: number;
}> {
  const normalizedUrl = normalizePsiUrl(parsedUrl);
  const cacheKey = makePsiCacheKey(normalizedUrl, strategy);
  const keyCfg = getPageSpeedKeyConfig();
  const timeoutMs = getPsiRequestTimeoutMs();
  const totalBudgetMs = getPsiTotalBudgetMs(timeoutMs);
  const now = Date.now();

  const fetchImpl = options?.fetchFn ?? fetch;
  const robotsImpl = options?.robotsFn ?? inspectRobotsAndSitemap;
  const sleepImpl = options?.sleepFn ?? defaultSleep;

  // 1. Return valid 24-hour cached result before checking quota or making external calls
  const existing = psiMemoryCache.get(cacheKey);
  if (existing && existing.expiresAt > now) {
    return {
      metrics: existing.payload,
      cached: true,
      cachedAt: new Date(existing.cachedAt).toISOString(),
      cacheExpiresAt: new Date(existing.expiresAt).toISOString(),
      keySource: keyCfg.source,
      durationMs: 0,
      upstreamStatus: 200,
      attempts: 0,
      timeoutMs,
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
        timeoutMs,
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
      upstreamStatus: 429,
      timeoutMs,
    });
  }
  if (blocked) {
    psiQuotaBlockedByKey.delete(keyCfg.fingerprint);
  }

  // 4. Deduplicate concurrent in-flight requests for the exact same URL and device strategy
  const existingInFlight = psiInFlight.get(cacheKey);
  if (existingInFlight) {
    const res = await existingInFlight;
    const updatedCache = psiMemoryCache.get(cacheKey);
    return {
      metrics: res.metrics,
      cached: false,
      cachedAt: new Date(updatedCache?.cachedAt || Date.now()).toISOString(),
      cacheExpiresAt: new Date(updatedCache?.expiresAt || Date.now() + PSI_CACHE_TTL_MS).toISOString(),
      keySource: keyCfg.source,
      durationMs: res.durationMs,
      upstreamStatus: res.upstreamStatus,
      attempts: res.attempts,
      timeoutMs: res.timeoutMs,
    };
  }

  const runLiveRequest = async (): Promise<{
    metrics: PsiMetricsPayload;
    durationMs: number;
    upstreamStatus: number;
    attempts: number;
    timeoutMs: number;
  }> => {
    const startedAt = Date.now();
    const psiUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    psiUrl.searchParams.set('url', normalizedUrl);
    psiUrl.searchParams.set('strategy', strategy);
    ['performance', 'seo', 'accessibility', 'best-practices'].forEach((cat) =>
      psiUrl.searchParams.append('category', cat)
    );
    psiUrl.searchParams.set('key', keyCfg.apiKey);

    // Run robots.txt + sitemap inspection in parallel with PageSpeed Insights (6s non-fatal cap)
    const robotsPromise = Promise.race([
      robotsImpl(parsedUrl).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
    ]);

    const maxAttempts = 2;
    let psiJson: Record<string, any> = {};
    let finalUpstreamStatus = 200;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const elapsedMs = Date.now() - startedAt;
      const remainingBudgetMs = totalBudgetMs - elapsedMs;
      if (attempt > 1 && remainingBudgetMs < MIN_RETRY_BUDGET_MS) {
        break;
      }

      const attemptTimeoutMs = Math.max(
        MIN_PSI_TIMEOUT_MS,
        Math.min(timeoutMs, remainingBudgetMs > 0 ? remainingBudgetMs : timeoutMs)
      );
      attemptsMade = attempt;

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), attemptTimeoutMs);
      let psiRes: Response;
      try {
        psiRes = await fetchImpl(psiUrl.toString(), { signal: ctrl.signal });
      } catch (err) {
        clearTimeout(timer);
        const totalDurationMs = Date.now() - startedAt;
        const isAbort =
          err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
        const canRetryTransient =
          !isAbort &&
          attempt < maxAttempts &&
          totalBudgetMs - totalDurationMs >= MIN_RETRY_BUDGET_MS;

        if (canRetryTransient) {
          console.warn(
            '[PageSpeed]',
            JSON.stringify({
              url: normalizedUrl,
              strategy,
              attempt,
              errorType: 'network_error',
              durationMs: totalDurationMs,
              retrying: true,
            })
          );
          await sleepImpl(1000);
          continue;
        }

        const msg = isAbort
          ? `PageSpeed Insights API (${strategy}) timed out after ${Math.round(
              attemptTimeoutMs / 1000
            )} seconds. Google Lighthouse ${strategy} audits can take up to 40s on heavy pages; please retry shortly.`
          : err instanceof Error
          ? err.message
          : 'Network error while contacting PageSpeed Insights API.';

        console.error(
          '[PageSpeed]',
          JSON.stringify({
            url: normalizedUrl,
            strategy,
            attempt,
            upstreamStatus: isAbort ? 504 : 502,
            durationMs: totalDurationMs,
            timeoutMs: attemptTimeoutMs,
          })
        );

        throw new PageSpeedApiError(sanitizePsiErrorMessage(msg, keyCfg.apiKey), {
          status: isAbort ? 504 : 502,
          code: 'PAGESPEED_API_ERROR',
          keySource: keyCfg.source,
          upstreamStatus: isAbort ? 504 : 502,
          durationMs: totalDurationMs,
          attempts: attemptsMade,
          timeoutMs: attemptTimeoutMs,
        });
      } finally {
        clearTimeout(timer);
      }

      finalUpstreamStatus = psiRes.status;
      try {
        psiJson = (await psiRes.json()) as Record<string, any>;
      } catch {
        psiJson = {};
      }

      if (psiRes.ok && !psiJson?.error) {
        break;
      }

      const rawMessage = sanitizePsiErrorMessage(
        String(psiJson?.error?.message || `PageSpeed Insights API returned HTTP ${psiRes.status}.`),
        keyCfg.apiKey
      );
      const reason = String(psiJson?.error?.errors?.[0]?.reason || '');
      const totalDurationMs = Date.now() - startedAt;

      // Never retry quota-exhausted responses
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
          upstreamStatus: psiRes.status,
          durationMs: totalDurationMs,
          attempts: attemptsMade,
          timeoutMs: attemptTimeoutMs,
        });
      }

      // Bounded retry ONLY for fast transient upstream failures (500/502/503/408)
      const remainingAfterError = totalBudgetMs - totalDurationMs;
      if (
        isTransientHttpStatus(psiRes.status) &&
        attempt < maxAttempts &&
        remainingAfterError >= MIN_RETRY_BUDGET_MS
      ) {
        console.warn(
          '[PageSpeed]',
          JSON.stringify({
            url: normalizedUrl,
            strategy,
            attempt,
            upstreamStatus: psiRes.status,
            durationMs: totalDurationMs,
            retrying: true,
          })
        );
        await sleepImpl(1200);
        continue;
      }

      console.error(
        '[PageSpeed]',
        JSON.stringify({
          url: normalizedUrl,
          strategy,
          attempt,
          upstreamStatus: psiRes.status,
          durationMs: totalDurationMs,
          retrying: false,
        })
      );

      throw new PageSpeedApiError(rawMessage, {
        status: psiRes.status >= 400 && psiRes.status < 600 ? psiRes.status : 502,
        code: 'PAGESPEED_API_ERROR',
        keySource: keyCfg.source,
        upstreamStatus: psiRes.status,
        durationMs: totalDurationMs,
        attempts: attemptsMade,
        timeoutMs: attemptTimeoutMs,
      });
    }

    const totalDurationMs = Date.now() - startedAt;
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

    const robotsMeta = await robotsPromise;
    const robotsStatus = !robotsMeta
      ? 'Check timed out'
      : robotsMeta.robotsBlockingAll
      ? 'Blocked (Disallow: /)'
      : robotsMeta.robotsTxtFound
      ? 'Allowed'
      : 'Missing robots.txt';
    const sitemapStatus = !robotsMeta
      ? 'Check timed out'
      : robotsMeta.sitemapFound
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

    console.info(
      '[PageSpeed]',
      JSON.stringify({
        url: normalizedUrl,
        strategy,
        upstreamStatus: finalUpstreamStatus,
        durationMs: totalDurationMs,
        attempts: attemptsMade,
        performanceScore,
        seoScore,
      })
    );

    return {
      metrics: payload,
      durationMs: totalDurationMs,
      upstreamStatus: finalUpstreamStatus,
      attempts: attemptsMade,
      timeoutMs,
    };
  };

  const promise = runLiveRequest().finally(() => {
    psiInFlight.delete(cacheKey);
  });
  psiInFlight.set(cacheKey, promise);

  const liveRes = await promise;
  const saved = psiMemoryCache.get(cacheKey);
  return {
    metrics: liveRes.metrics,
    cached: false,
    cachedAt: new Date(saved?.cachedAt || Date.now()).toISOString(),
    cacheExpiresAt: new Date(saved?.expiresAt || Date.now() + PSI_CACHE_TTL_MS).toISOString(),
    keySource: keyCfg.source,
    durationMs: liveRes.durationMs,
    upstreamStatus: liveRes.upstreamStatus,
    attempts: liveRes.attempts,
    timeoutMs: liveRes.timeoutMs,
  };
}
