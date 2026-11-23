import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, Gauge, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { ScoreRing } from '../components/charts/AnalyticsCharts';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { getTimestampMs } from '../lib/analytics';
import { ApiRequestError, apiFetch } from '../lib/apiClient';
import { SiteCrawl, TechnicalSnapshot, Website } from '../types';

const PSI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const QUOTA_STORAGE_KEY = 'rp_psi_quota_block_v1';

interface QuotaBlockInfo {
  message: string;
  consumerProject?: string;
  keySource?: string;
  retryAfter?: string;
}

function normalizePublicUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    parsed.hash = '';
    return parsed.toString().toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function formatAgeLabel(ageMs: number): string {
  const mins = Math.max(1, Math.round(ageMs / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m ago` : `${hrs}h ago`;
}

function isQuotaBlockActive(block: QuotaBlockInfo | null): boolean {
  if (!block) return false;
  if (!block.retryAfter) return true;
  const untilMs = Date.parse(block.retryAfter);
  return Number.isFinite(untilMs) ? untilMs > Date.now() : true;
}

interface TechnicalMonitorViewProps {
  websites: Website[];
  technicalSnapshots: TechnicalSnapshot[];
  siteCrawls?: SiteCrawl[];
  selectedWebsiteId: string;
  initialUrl?: string;
  onAddWebsitePrompt: () => void;
}

function vitalTone(metric: 'lcp' | 'cls' | 'inp' | 'ttfb', val: number): 'success' | 'warning' | 'danger' {
  if (metric === 'lcp') return val <= 2500 ? 'success' : val <= 4000 ? 'warning' : 'danger';
  if (metric === 'cls') return val <= 0.1 ? 'success' : val <= 0.25 ? 'warning' : 'danger';
  if (metric === 'inp') return val <= 200 ? 'success' : val <= 500 ? 'warning' : 'danger';
  return val <= 800 ? 'success' : val <= 1800 ? 'warning' : 'danger';
}

export function TechnicalMonitorView({
  websites,
  technicalSnapshots,
  siteCrawls = [],
  selectedWebsiteId,
  initialUrl,
  onAddWebsitePrompt,
}: TechnicalMonitorViewProps) {
  const { toast } = useToast();

  const activeSite =
    (selectedWebsiteId !== 'all' ? websites.find((w) => w.id === selectedWebsiteId) : websites[0]) ||
    null;

  const [targetUrl, setTargetUrl] = useState(initialUrl || activeSite?.url || '');
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile');
  const [running, setRunning] = useState(false);
  const [pendingCheck, setPendingCheck] = useState<{ url: string; strategy: 'mobile' | 'desktop' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [quotaBlock, setQuotaBlock] = useState<QuotaBlockInfo | null>(() => {
    try {
      const raw = sessionStorage.getItem(QUOTA_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as QuotaBlockInfo;
      return isQuotaBlockActive(parsed) ? parsed : null;
    } catch {
      return null;
    }
  });
  const [activeSnapId, setActiveSnapId] = useState('');

  useEffect(() => {
    if (initialUrl) setTargetUrl(initialUrl);
    else if (activeSite?.url) setTargetUrl(activeSite.url);
  }, [initialUrl, activeSite]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((health) => {
        if (cancelled || !health?.capabilities) return;
        const caps = health.capabilities as {
          pageSpeedQuotaExhausted?: boolean;
          pageSpeedQuotaRetryAfter?: string | null;
          pageSpeedKeySource?: string;
        };
        if (caps.pageSpeedQuotaExhausted) {
          const info: QuotaBlockInfo = {
            message:
              'Google PageSpeed Insights daily API quota is exhausted on the server. Further live checks are paused until the daily quota resets or a new PAGESPEED_API_KEY is configured.',
            keySource: caps.pageSpeedKeySource,
            retryAfter: caps.pageSpeedQuotaRetryAfter || undefined,
          };
          setQuotaBlock(info);
          try {
            sessionStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(info));
          } catch {
            // ignore storage errors
          }
        } else if (caps.pageSpeedQuotaExhausted === false) {
          // Server reset/restarted cleanly (e.g., new key configured)
          setQuotaBlock(null);
          try {
            sessionStorage.removeItem(QUOTA_STORAGE_KEY);
          } catch {
            // ignore storage errors
          }
        }
      })
      .catch(() => {
        // non-fatal health probe
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scopedSnaps = useMemo(() => {
    if (!activeSite) return [];
    return technicalSnapshots.filter((s) => s.websiteId === activeSite.id);
  }, [technicalSnapshots, activeSite]);

  const activeSnap =
    scopedSnaps.find((s) => s.id === activeSnapId) || scopedSnaps[0] || null;

  const findCached24hSnap = (rawUrl: string, strat: 'mobile' | 'desktop'): TechnicalSnapshot | null => {
    const normalizedTarget = normalizePublicUrl(rawUrl);
    if (!normalizedTarget) return null;
    const now = Date.now();
    return (
      scopedSnaps.find((snap) => {
        if (snap.strategy !== strat) return false;
        if (normalizePublicUrl(snap.url) !== normalizedTarget) return false;
        const ts = getTimestampMs(snap.createdAt);
        return ts > 0 && now - ts < PSI_CACHE_TTL_MS;
      }) || null
    );
  };

  const cachedMatchForForm = useMemo(() => {
    const normalizedTarget = normalizePublicUrl(targetUrl);
    if (!normalizedTarget) return null;
    const now = Date.now();
    return (
      scopedSnaps.find((snap) => {
        if (snap.strategy !== strategy) return false;
        if (normalizePublicUrl(snap.url) !== normalizedTarget) return false;
        const ts = getTimestampMs(snap.createdAt);
        return ts > 0 && now - ts < PSI_CACHE_TTL_MS;
      }) || null
    );
  }, [scopedSnaps, targetUrl, strategy]);

  const activeSnapAgeMs = activeSnap ? Date.now() - getTimestampMs(activeSnap.createdAt) : 0;
  const activeSnapWithin24h = Boolean(
    activeSnap && getTimestampMs(activeSnap.createdAt) > 0 && activeSnapAgeMs < PSI_CACHE_TTL_MS
  );

  const activeQuotaBlock = isQuotaBlockActive(quotaBlock) ? quotaBlock : null;

  const latestCrawl = useMemo(() => {
    if (!activeSite) return null;
    return siteCrawls.find((c) => c.websiteId === activeSite.id) || null;
  }, [siteCrawls, activeSite]);

  const crawlTechSummary = useMemo(() => {
    if (!latestCrawl) return null;
    const pages = latestCrawl.pages || [];
    const noindexCount = pages.filter(
      (p) =>
        (p.metaRobots || '').toLowerCase().includes('noindex') ||
        (p.xRobotsTag || '').toLowerCase().includes('noindex')
    ).length;
    const redirectCount = pages.filter((p) => (p.redirectChain?.length || 0) > 1).length;
    const missingCanonicalCount = pages.filter((p) => !p.canonicalUrl).length;
    return {
      totalPages: pages.length,
      noindexCount: latestCrawl.noindexCount || noindexCount,
      redirectCount,
      missingCanonicalCount,
      duplicateTitles: latestCrawl.duplicateTitlesCount || 0,
      duplicateMetas: latestCrawl.duplicateMetaCount || 0,
    };
  }, [latestCrawl]);

  if (!activeSite) {
    return (
      <EmptyState
        title="Add a website for Technical & Core Web Vitals monitoring"
        description="Run live Google PageSpeed Insights v5 Lighthouse diagnostics to measure LCP, CLS, INP, TTFB, robots.txt, and sitemap.xml health."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  const runCheck = async (urlToTest: string, strat: 'mobile' | 'desktop') => {
    const trimmed = urlToTest.trim();
    if (!trimmed || running) return;

    setError(null);
    setCacheNotice(null);

    // 1. Prevent duplicate PageSpeed API calls by reusing any <24h cached snapshot for this URL + device
    const cachedSnap = findCached24hSnap(trimmed, strat);
    if (cachedSnap) {
      const ageLabel = formatAgeLabel(Date.now() - getTimestampMs(cachedSnap.createdAt));
      setActiveSnapId(cachedSnap.id);
      setTargetUrl(cachedSnap.url);
      setStrategy(cachedSnap.strategy);
      const msg = `Showing cached ${strat} PageSpeed result (${ageLabel}). Results are cached for 24 hours to prevent duplicate API calls.`;
      setCacheNotice(msg);
      toast({
        title: `Loaded cached ${strat} PageSpeed result`,
        description: `Perf ${cachedSnap.performanceScore}/100 · SEO ${cachedSnap.seoScore}/100 · Checked ${ageLabel}`,
        variant: 'info',
      });
      return;
    }

    // 2. Do not repeatedly retry requests when daily quota is known to be exhausted
    if (activeQuotaBlock) {
      toast({
        title: 'PageSpeed daily quota exhausted',
        description: 'Live API requests are paused until quota resets or a new PAGESPEED_API_KEY is configured.',
        variant: 'error',
      });
      return;
    }

    setRunning(true);
    setPendingCheck({ url: trimmed, strategy: strat });
    try {
      const data = await apiFetch<{
        id: string;
        performanceScore: number;
        seoScore: number;
        lcpMs: number;
        cached?: boolean;
        cachedAt?: string;
      }>('/api/pagespeed/analyze', {
        method: 'POST',
        body: JSON.stringify({
          websiteId: activeSite.id,
          url: trimmed,
          strategy: strat,
        }),
      });
      setActiveSnapId(data.id);
      if (data.cached) {
        const cachedMsg = 'Loaded 24-hour cached PageSpeed result from server without consuming additional API quota.';
        setCacheNotice(cachedMsg);
      }
      toast({
        title: data.cached ? `Loaded cached PageSpeed ${strat} audit` : `PageSpeed ${strat} audit completed`,
        description: `Perf ${data.performanceScore}/100 · SEO ${data.seoScore}/100 · LCP ${(data.lcpMs / 1000).toFixed(2)}s`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to complete PageSpeed analysis.';
      const isQuotaError =
        (err instanceof ApiRequestError &&
          (err.status === 429 || err.code === 'PAGESPEED_QUOTA_EXCEEDED' || Boolean(err.data?.quotaExceeded))) ||
        /quota\s*exceeded|queries\s*per\s*day/i.test(msg);

      if (isQuotaError) {
        const data = err instanceof ApiRequestError ? err.data : undefined;
        const info: QuotaBlockInfo = {
          message: msg,
          consumerProject: typeof data?.consumerProject === 'string' ? data.consumerProject : undefined,
          keySource: typeof data?.keySource === 'string' ? data.keySource : undefined,
          retryAfter: typeof data?.retryAfter === 'string' ? data.retryAfter : undefined,
        };
        setQuotaBlock(info);
        try {
          sessionStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(info));
        } catch {
          // ignore storage errors
        }
        toast({
          title: 'PageSpeed API quota exceeded',
          description: 'Repeated retries have been paused until the daily quota resets.',
          variant: 'error',
        });
      } else {
        setError(msg);
        toast({ title: 'Technical check failed', description: msg, variant: 'error' });
      }
    } finally {
      setRunning(false);
      setPendingCheck(null);
    }
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runCheck(targetUrl, strategy);
        }}
        className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-7">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Target Public URL for Live Lighthouse &amp; Vitals Check
            </label>
            <input
              type="url"
              required
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder={activeSite.url}
              disabled={running}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-indigo-600 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Device Emulation</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as 'mobile' | 'desktop')}
              disabled={running}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="mobile">Mobile</option>
              <option value="desktop">Desktop</option>
            </select>
          </div>
          <div className="md:col-span-3 flex items-end">
            <button
              type="submit"
              disabled={running || (Boolean(activeQuotaBlock) && !cachedMatchForForm)}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : cachedMatchForForm ? (
                <Clock className="h-4 w-4" />
              ) : (
                <Gauge className="h-4 w-4" />
              )}
              <span>
                {running
                  ? 'Running Lighthouse...'
                  : cachedMatchForForm
                  ? 'Load 24h Cached Result'
                  : activeQuotaBlock
                  ? 'Daily Quota Exhausted'
                  : 'Run PageSpeed Check'}
              </span>
            </button>
          </div>
        </div>
      </form>

      {running && pendingCheck && (
        <div className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50/80 px-5 py-4 text-xs text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-200">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-indigo-600 dark:text-indigo-400" />
          <div>
            <div className="font-semibold">
              Analyzing {pendingCheck.url} ({pendingCheck.strategy}) via Google PageSpeed Insights...
            </div>
            <p className="mt-0.5 text-indigo-700/90 dark:text-indigo-300/80">
              Capturing Lighthouse scores, Core Web Vitals, and robots/sitemap directives. Results will be cached for 24 hours.
            </p>
          </div>
        </div>
      )}

      {activeQuotaBlock && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-xs text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            <div className="font-semibold">PageSpeed Insights Daily Quota Exhausted</div>
            <p>{activeQuotaBlock.message}</p>
            <p className="text-[11px] text-amber-800 dark:text-amber-300/90">
              {activeQuotaBlock.retryAfter
                ? `Repeated retries are paused until ${new Date(activeQuotaBlock.retryAfter).toLocaleString()}. `
                : 'Repeated retries are paused until the daily quota resets. '}
              {activeQuotaBlock.consumerProject
                ? `Reported Google Cloud project: ${activeQuotaBlock.consumerProject}. `
                : ''}
              Configure a billed or dedicated <code className="font-mono">PAGESPEED_API_KEY</code> on the server to restore live checks immediately. Previously saved snapshots remain viewable below.
            </p>
          </div>
        </div>
      )}

      {cacheNotice && (
        <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
          <Clock className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <span>{cacheNotice}</span>
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      {!activeSnap ? (
        <EmptyState
          title="No Core Web Vitals snapshot recorded yet"
          description="Run a live Google PageSpeed Insights v5 check above to capture Lighthouse category scores, LCP, CLS, INP, TTFB, robots.txt, and sitemap.xml telemetry."
        />
      ) : (
        <>
          {activeSnapWithin24h && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                Cached snapshot active for <span className="font-mono">{activeSnap.url}</span> ({activeSnap.strategy})
              </span>
              <span className="font-mono">
                Recorded {formatAgeLabel(activeSnapAgeMs)} · 24h cache
              </span>
            </div>
          )}
          {/* 4 Lighthouse Score Rings */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: 'Performance', score: activeSnap.performanceScore },
              { label: 'SEO Audit', score: activeSnap.seoScore },
              { label: 'Accessibility', score: activeSnap.accessibilityScore },
              { label: 'Best Practices', score: activeSnap.bestPracticesScore },
            ].map((cat) => (
              <div
                key={cat.label}
                className="flex flex-col items-center rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <ScoreRing score={cat.score} size={86} />
                <div className="mt-3 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {cat.label}
                </div>
                <div className="mt-0.5 font-mono text-[11px] uppercase text-slate-400">
                  {activeSnap.strategy}
                </div>
              </div>
            ))}
          </div>

          {/* Core Web Vitals & Crawl Index Health */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  <h3 className="font-display text-sm font-semibold">Core Web Vitals Telemetry</h3>
                </div>
                <span className="truncate max-w-xs font-mono text-[11px] text-slate-500">
                  {activeSnap.url}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {[
                  {
                    name: 'LCP',
                    val: `${(activeSnap.lcpMs / 1000).toFixed(2)}s`,
                    target: '≤ 2.5s',
                    tone: vitalTone('lcp', activeSnap.lcpMs),
                  },
                  {
                    name: 'CLS',
                    val: activeSnap.cls.toFixed(3),
                    target: '≤ 0.10',
                    tone: vitalTone('cls', activeSnap.cls),
                  },
                  {
                    name: 'INP / FID',
                    val: `${activeSnap.inpMs}ms`,
                    target: '≤ 200ms',
                    tone: vitalTone('inp', activeSnap.inpMs),
                  },
                  {
                    name: 'FCP',
                    val: `${(activeSnap.fcpMs / 1000).toFixed(2)}s`,
                    target: '≤ 1.8s',
                    tone: activeSnap.fcpMs <= 1800 ? ('success' as const) : ('warning' as const),
                  },
                  {
                    name: 'TTFB',
                    val: `${activeSnap.ttfbMs}ms`,
                    target: '≤ 800ms',
                    tone: vitalTone('ttfb', activeSnap.ttfbMs),
                  },
                ].map((m) => (
                  <div key={m.name} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
                    <div className="text-[11px] font-medium text-slate-500">{m.name}</div>
                    <div className="mt-1 font-mono text-lg font-semibold tabular-nums">{m.val}</div>
                    <div className="mt-1 flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">{m.target}</span>
                      <StatusText
                        label={m.tone === 'success' ? 'Good' : m.tone === 'warning' ? 'Fair' : 'Poor'}
                        tone={m.tone}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="font-display text-sm font-semibold">Crawlability Directives</h3>
              </div>
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
                  <span className="text-slate-500">robots.txt</span>
                  <StatusText
                    label={activeSnap.robotsStatus || 'Checked'}
                    tone={activeSnap.robotsStatus?.includes('Blocked') ? 'danger' : 'success'}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
                  <span className="text-slate-500">XML Sitemap</span>
                  <StatusText
                    label={activeSnap.sitemapStatus || 'Checked'}
                    tone={activeSnap.sitemapStatus?.includes('Missing') ? 'warning' : 'success'}
                  />
                </div>
                {crawlTechSummary ? (
                  <>
                    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                      <span className="text-slate-500">Crawled Pages ({crawlTechSummary.totalPages})</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        {crawlTechSummary.duplicateTitles} dup titles · {crawlTechSummary.duplicateMetas} dup meta
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                      <span className="text-slate-500">Indexability &amp; Redirects</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        {crawlTechSummary.noindexCount} noindex · {crawlTechSummary.redirectCount} redirects ·{' '}
                        {crawlTechSummary.missingCanonicalCount} no canonical
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Run a full-site crawl under Website Audit to populate canonical, noindex, and redirect diagnostics.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Opportunities & History */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <h3 className="font-display text-sm font-semibold">
                  Lighthouse Optimization Opportunities ({activeSnap.opportunities.length})
                </h3>
              </div>
              {activeSnap.opportunities.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No major Lighthouse performance opportunities flagged for this check.
                </p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {activeSnap.opportunities.map((opp, idx) => (
                    <div key={idx} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{opp.title}</span>
                        <span className="shrink-0 font-mono text-[11px] text-amber-700 dark:text-amber-400">
                          {opp.savings}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{opp.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                <h3 className="font-display text-sm font-semibold">Technical Check History ({scopedSnaps.length})</h3>
              </div>
              <div className="divide-y divide-slate-200 max-h-80 overflow-y-auto dark:divide-slate-800">
                {scopedSnaps.map((snap) => {
                  const snapTs = getTimestampMs(snap.createdAt);
                  const snapWithin24h = snapTs > 0 && Date.now() - snapTs < PSI_CACHE_TTL_MS;
                  const recheckBlocked = Boolean(activeQuotaBlock) && !snapWithin24h;
                  return (
                    <div
                      key={snap.id}
                      className={`flex items-center justify-between gap-2 px-5 py-3 text-xs ${
                        activeSnap.id === snap.id
                          ? 'bg-indigo-50/70 dark:bg-indigo-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveSnapId(snap.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate font-mono text-[11px] text-slate-800 dark:text-slate-200">
                          {snap.url}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
                          {snap.strategy.toUpperCase()} · Perf {snap.performanceScore} · SEO {snap.seoScore} · LCP{' '}
                          {(snap.lcpMs / 1000).toFixed(1)}s
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => runCheck(snap.url, snap.strategy)}
                        disabled={running || recheckBlocked}
                        title={
                          recheckBlocked
                            ? 'Daily PageSpeed API quota exhausted'
                            : snapWithin24h
                            ? 'Within 24h cache window (loads cached result)'
                            : 'Recheck URL'
                        }
                        className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
                        aria-label="Recheck URL"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
