import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  Loader2,
  Monitor,
  RefreshCw,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import { ScoreRing } from '../components/charts/AnalyticsCharts';
import { EmptyState, StatusText } from '../components/ui/DataState';
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

interface LastLiveMeta {
  id: string;
  cached: boolean;
  durationMs?: number;
  upstreamStatus?: number;
  attempts?: number;
}

interface AuditErrorDetail {
  message: string;
  status?: number;
  durationMs?: number;
  timeoutMs?: number;
  strategy: 'mobile' | 'desktop';
  url: string;
}

interface TechnicalFinding {
  severity: 'Critical' | 'Warning' | 'Info';
  tone: 'danger' | 'warning' | 'info';
  area: string;
  title: string;
  impact: string;
  recommendation: string;
}

function normalizePublicUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    parsed.hash = '';
    return parsed.toString().slice(0, 500);
  } catch {
    return trimmed;
  }
}

function formatAgeLabel(ageMs: number): string {
  if (ageMs < 60_000) return 'just now';
  const mins = Math.max(1, Math.round(ageMs / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs >= 24) {
    const days = Math.floor(hrs / 24);
    const remHrs = hrs % 24;
    return remHrs > 0 ? `${days}d ${remHrs}h ago` : `${days}d ago`;
  }
  return remMins > 0 ? `${hrs}h ${remMins}m ago` : `${hrs}h ago`;
}

function formatRemainingWindow(remainingMs: number): string {
  if (remainingMs <= 0) return 'Expired';
  const mins = Math.max(1, Math.round(remainingMs / 60_000));
  if (mins < 60) return `${mins}m remaining`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m remaining` : `${hrs}h remaining`;
}

function isQuotaBlockActive(block: QuotaBlockInfo | null): boolean {
  if (!block) return false;
  if (!block.retryAfter) return true;
  const untilMs = Date.parse(block.retryAfter);
  return Number.isFinite(untilMs) ? untilMs > Date.now() : true;
}

function scoreTone(score: number): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (score >= 90) return { label: 'Good', tone: 'success' };
  if (score >= 50) return { label: 'Needs Work', tone: 'warning' };
  return { label: 'Poor', tone: 'danger' };
}

function vitalTone(
  metric: 'lcp' | 'cls' | 'inp' | 'fcp' | 'ttfb',
  val: number
): 'success' | 'warning' | 'danger' {
  if (metric === 'lcp') return val <= 2500 ? 'success' : val <= 4000 ? 'warning' : 'danger';
  if (metric === 'cls') return val <= 0.1 ? 'success' : val <= 0.25 ? 'warning' : 'danger';
  if (metric === 'inp') return val <= 200 ? 'success' : val <= 500 ? 'warning' : 'danger';
  if (metric === 'fcp') return val <= 1800 ? 'success' : val <= 3000 ? 'warning' : 'danger';
  return val <= 800 ? 'success' : val <= 1800 ? 'warning' : 'danger';
}

interface TechnicalMonitorViewProps {
  websites: Website[];
  technicalSnapshots: TechnicalSnapshot[];
  siteCrawls?: SiteCrawl[];
  selectedWebsiteId: string;
  initialUrl?: string;
  onAddWebsitePrompt: () => void;
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
  const [historyDeviceFilter, setHistoryDeviceFilter] = useState<'all' | 'mobile' | 'desktop'>('all');
  const [running, setRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pendingCheck, setPendingCheck] = useState<{
    url: string;
    strategy: 'mobile' | 'desktop';
  } | null>(null);
  const [errorDetail, setErrorDetail] = useState<AuditErrorDetail | null>(null);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [lastLiveMeta, setLastLiveMeta] = useState<LastLiveMeta | null>(null);
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
    if (!running) {
      setElapsedSeconds(0);
      return;
    }
    const started = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

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
              'Google PageSpeed Insights daily API quota is exhausted on the server. Live checks are paused until the daily quota resets or a new PAGESPEED_API_KEY is configured.',
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
    return technicalSnapshots
      .filter((s) => s.websiteId === activeSite.id)
      .slice()
      .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
  }, [technicalSnapshots, activeSite]);

  const normalizedFormUrl = useMemo(() => normalizePublicUrl(targetUrl), [targetUrl]);

  // Strict URL + Strategy isolation: never silently show Desktop scores when Mobile is selected (or vice versa)
  const matchingSnapsForDevice = useMemo(() => {
    return scopedSnaps.filter((snap) => {
      if (snap.strategy !== strategy) return false;
      if (normalizedFormUrl && normalizePublicUrl(snap.url) !== normalizedFormUrl) return false;
      return true;
    });
  }, [scopedSnaps, strategy, normalizedFormUrl]);

  const activeSnap = useMemo(() => {
    if (activeSnapId) {
      const explicit = matchingSnapsForDevice.find((s) => s.id === activeSnapId);
      if (explicit) return explicit;
    }
    return matchingSnapsForDevice[0] || null;
  }, [matchingSnapsForDevice, activeSnapId]);

  const otherStrategy: 'mobile' | 'desktop' = strategy === 'mobile' ? 'desktop' : 'mobile';
  const otherStrategySnap = useMemo(() => {
    return (
      scopedSnaps.find((snap) => {
        if (snap.strategy !== otherStrategy) return false;
        if (normalizedFormUrl && normalizePublicUrl(snap.url) !== normalizedFormUrl) return false;
        return true;
      }) || null
    );
  }, [scopedSnaps, otherStrategy, normalizedFormUrl]);

  const findCached24hSnap = (
    rawUrl: string,
    strat: 'mobile' | 'desktop'
  ): TechnicalSnapshot | null => {
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

  const activeSnapTs = activeSnap ? getTimestampMs(activeSnap.createdAt) : 0;
  const activeSnapAgeMs = activeSnapTs > 0 ? Math.max(0, Date.now() - activeSnapTs) : 0;
  const activeSnapWithin24h = Boolean(
    activeSnap && activeSnapTs > 0 && activeSnapAgeMs < PSI_CACHE_TTL_MS
  );
  const activeSnapCacheRemainingMs = activeSnapWithin24h
    ? Math.max(0, PSI_CACHE_TTL_MS - activeSnapAgeMs)
    : 0;

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

  const auditFindings = useMemo<TechnicalFinding[]>(() => {
    if (!activeSnap) return [];
    const findings: TechnicalFinding[] = [];

    if (activeSnap.seoScore < 90) {
      findings.push({
        severity: activeSnap.seoScore < 70 ? 'Critical' : 'Warning',
        tone: activeSnap.seoScore < 70 ? 'danger' : 'warning',
        area: 'Lighthouse SEO',
        title: `Lighthouse SEO score is ${activeSnap.seoScore}/100 (${activeSnap.strategy})`,
        impact: 'Search engines may struggle to index, crawl, or understand page relevance.',
        recommendation:
          'Verify indexable meta robots, descriptive title/meta description, valid canonical tag, crawlable anchor links, and descriptive image alt text.',
      });
    }

    if (activeSnap.performanceScore < 90) {
      findings.push({
        severity: activeSnap.performanceScore < 50 ? 'Critical' : 'Warning',
        tone: activeSnap.performanceScore < 50 ? 'danger' : 'warning',
        area: 'Performance',
        title: `${activeSnap.strategy === 'mobile' ? 'Mobile' : 'Desktop'} Performance score is ${activeSnap.performanceScore}/100`,
        impact: 'Slow page rendering increases bounce rate and reduces Core Web Vitals signals.',
        recommendation:
          'Address the top Lighthouse opportunities below—prioritize render-blocking scripts/CSS, image compression, and server page caching.',
      });
    }

    if (activeSnap.lcpMs > 2500) {
      findings.push({
        severity: activeSnap.lcpMs > 4000 ? 'Critical' : 'Warning',
        tone: activeSnap.lcpMs > 4000 ? 'danger' : 'warning',
        area: 'LCP',
        title: `Largest Contentful Paint is ${(activeSnap.lcpMs / 1000).toFixed(2)}s`,
        impact: 'Target is <= 2.50s for Good Core Web Vitals.',
        recommendation:
          'Preload the hero image or LCP asset, serve modern WebP/AVIF formats, and inline critical above-the-fold CSS.',
      });
    }

    if (activeSnap.cls > 0.1) {
      findings.push({
        severity: activeSnap.cls > 0.25 ? 'Critical' : 'Warning',
        tone: activeSnap.cls > 0.25 ? 'danger' : 'warning',
        area: 'CLS',
        title: `Cumulative Layout Shift is ${activeSnap.cls.toFixed(3)}`,
        impact: 'Target is <= 0.100 to prevent visual jumps while loading.',
        recommendation:
          'Set explicit width and height attributes on images, ads, and embeds, and reserve height for dynamically injected banners.',
      });
    }

    if (activeSnap.inpMs > 200) {
      findings.push({
        severity: activeSnap.inpMs > 500 ? 'Critical' : 'Warning',
        tone: activeSnap.inpMs > 500 ? 'danger' : 'warning',
        area: 'INP / FID',
        title: `Interaction responsiveness is ${activeSnap.inpMs}ms`,
        impact: 'Target is <= 200ms for smooth user interactions.',
        recommendation:
          'Defer non-critical third-party JavaScript, break up long main-thread tasks, and minimize heavy DOM hydration.',
      });
    }

    if (activeSnap.ttfbMs > 800) {
      findings.push({
        severity: activeSnap.ttfbMs > 1800 ? 'Critical' : 'Warning',
        tone: activeSnap.ttfbMs > 1800 ? 'danger' : 'warning',
        area: 'TTFB',
        title: `Time to First Byte is ${activeSnap.ttfbMs}ms`,
        impact: 'Target is <= 800ms; slow origin response delays all downstream rendering.',
        recommendation:
          'Enable full-page caching, optimize database queries, and serve HTML/static assets behind an edge CDN.',
      });
    }

    if (activeSnap.robotsStatus?.includes('Blocked')) {
      findings.push({
        severity: 'Critical',
        tone: 'danger',
        area: 'Crawlability',
        title: 'robots.txt is blocking all crawlers (Disallow: /)',
        impact: 'Search engines cannot crawl or index this site.',
        recommendation: 'Update /robots.txt to allow search crawlers on public content routes.',
      });
    } else if (activeSnap.robotsStatus?.includes('Missing')) {
      findings.push({
        severity: 'Warning',
        tone: 'warning',
        area: 'Crawlability',
        title: 'Missing /robots.txt file',
        impact: 'Crawlers lack explicit sitemap discovery and crawl directive guidance.',
        recommendation: 'Publish a valid /robots.txt referencing your primary XML sitemap URL.',
      });
    }

    if (activeSnap.sitemapStatus?.includes('Missing')) {
      findings.push({
        severity: 'Warning',
        tone: 'warning',
        area: 'Sitemap',
        title: 'No XML sitemap detected at standard paths',
        impact: 'Slows discovery of new or updated URLs by search engines.',
        recommendation:
          'Generate /sitemap.xml (or /sitemap_index.xml) and declare it inside robots.txt and Google Search Console.',
      });
    }

    if (crawlTechSummary) {
      if (crawlTechSummary.missingCanonicalCount > 0) {
        findings.push({
          severity: 'Warning',
          tone: 'warning',
          area: 'Canonicals',
          title: `${crawlTechSummary.missingCanonicalCount} crawled page(s) missing canonical tags`,
          impact: 'Increases risk of duplicate URL indexing across query parameters.',
          recommendation: 'Add self-referencing <link rel="canonical"> tags on indexable pages.',
        });
      }
      if (crawlTechSummary.duplicateTitles > 0 || crawlTechSummary.duplicateMetas > 0) {
        findings.push({
          severity: 'Warning',
          tone: 'warning',
          area: 'Duplication',
          title: `${crawlTechSummary.duplicateTitles} duplicate titles · ${crawlTechSummary.duplicateMetas} duplicate meta descriptions`,
          impact: 'Duplicate metadata dilutes CTR and keyword differentiation.',
          recommendation: 'Customize unique SEO titles and meta descriptions in On-Page SEO.',
        });
      }
    }

    activeSnap.opportunities.forEach((opp) => {
      findings.push({
        severity: 'Warning',
        tone: 'warning',
        area: 'Lighthouse',
        title: opp.title,
        impact: opp.savings,
        recommendation:
          opp.description || 'Review Lighthouse diagnostics for this resource optimization.',
      });
    });

    return findings;
  }, [activeSnap, crawlTechSummary]);

  const filteredHistory = useMemo(() => {
    if (historyDeviceFilter === 'all') return scopedSnaps;
    return scopedSnaps.filter((s) => s.strategy === historyDeviceFilter);
  }, [scopedSnaps, historyDeviceFilter]);

  if (!activeSite) {
    return (
      <EmptyState
        title="Add a website for Technical SEO monitoring"
        description="Run Google PageSpeed Insights v5 audits for Mobile and Desktop to inspect Lighthouse scores, Core Web Vitals, robots.txt, and sitemap.xml."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  const handleStrategySelect = (nextStrategy: 'mobile' | 'desktop') => {
    if (running || nextStrategy === strategy) return;
    setStrategy(nextStrategy);
    setActiveSnapId('');
    setErrorDetail(null);
    setCacheNotice(null);
  };

  const runCheck = async (urlToTest: string, strat: 'mobile' | 'desktop') => {
    const trimmed = urlToTest.trim();
    if (!trimmed || running) return;

    setErrorDetail(null);
    setCacheNotice(null);

    // Prevent duplicate PageSpeed API calls by reusing any <24h cached snapshot for this exact URL + strategy
    const cachedSnap = findCached24hSnap(trimmed, strat);
    if (cachedSnap) {
      const ageLabel = formatAgeLabel(Math.max(0, Date.now() - getTimestampMs(cachedSnap.createdAt)));
      setTargetUrl(cachedSnap.url);
      setStrategy(cachedSnap.strategy);
      setActiveSnapId(cachedSnap.id);
      setLastLiveMeta({ id: cachedSnap.id, cached: true });
      setCacheNotice(
        `Loaded cached ${strat === 'mobile' ? 'Mobile' : 'Desktop'} audit (${ageLabel}). Audits are cached separately per URL and device for 24 hours to prevent duplicate API calls.`
      );
      toast({
        title: `Loaded cached ${strat} audit`,
        description: `Perf ${cachedSnap.performanceScore}/100 · SEO ${cachedSnap.seoScore}/100 · ${ageLabel}`,
        variant: 'info',
      });
      return;
    }

    if (activeQuotaBlock) {
      toast({
        title: 'PageSpeed daily quota exhausted',
        description:
          'Live API requests are paused until quota resets or a new PAGESPEED_API_KEY is configured.',
        variant: 'error',
      });
      return;
    }

    setRunning(true);
    setPendingCheck({ url: trimmed, strategy: strat });
    try {
      const data = await apiFetch<{
        id: string;
        url: string;
        strategy: 'mobile' | 'desktop';
        performanceScore: number;
        seoScore: number;
        lcpMs: number;
        cached?: boolean;
        cachedAt?: string;
        durationMs?: number;
        upstreamStatus?: number;
        attempts?: number;
      }>('/api/pagespeed/analyze', {
        method: 'POST',
        body: JSON.stringify({
          websiteId: activeSite.id,
          url: trimmed,
          strategy: strat,
        }),
      });

      setStrategy(data.strategy || strat);
      setTargetUrl(data.url || trimmed);
      setActiveSnapId(data.id);
      setLastLiveMeta({
        id: data.id,
        cached: Boolean(data.cached),
        durationMs: data.durationMs,
        upstreamStatus: data.upstreamStatus,
        attempts: data.attempts,
      });

      if (data.cached) {
        setCacheNotice(
          `Loaded 24-hour cached ${strat === 'mobile' ? 'Mobile' : 'Desktop'} result from server without calling Google PageSpeed again.`
        );
      }

      toast({
        title: data.cached
          ? `Loaded cached ${strat} audit`
          : `Completed ${strat} PageSpeed audit`,
        description: `Perf ${data.performanceScore}/100 · SEO ${data.seoScore}/100 · LCP ${(
          data.lcpMs / 1000
        ).toFixed(2)}s`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to complete PageSpeed analysis.';
      const apiErr = err instanceof ApiRequestError ? err : null;
      const isQuotaError =
        Boolean(
          apiErr &&
            (apiErr.status === 429 ||
              apiErr.code === 'PAGESPEED_QUOTA_EXCEEDED' ||
              Boolean(apiErr.data?.quotaExceeded))
        ) || /quota\s*exceeded|queries\s*per\s*day/i.test(msg);

      if (isQuotaError) {
        const data = apiErr?.data;
        const info: QuotaBlockInfo = {
          message: msg,
          consumerProject:
            typeof data?.consumerProject === 'string' ? data.consumerProject : undefined,
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
          description: 'Repeated retries are paused until the daily quota resets.',
          variant: 'error',
        });
      } else {
        setErrorDetail({
          message: msg,
          status: apiErr?.status,
          durationMs:
            typeof apiErr?.data?.durationMs === 'number' ? apiErr.data.durationMs : undefined,
          timeoutMs:
            typeof apiErr?.data?.timeoutMs === 'number' ? apiErr.data.timeoutMs : undefined,
          strategy: strat,
          url: trimmed,
        });
        toast({ title: 'Technical audit failed', description: msg, variant: 'error' });
      }
    } finally {
      setRunning(false);
      setPendingCheck(null);
    }
  };

  const mobileCount = scopedSnaps.filter((s) => s.strategy === 'mobile').length;
  const desktopCount = scopedSnaps.filter((s) => s.strategy === 'desktop').length;

  return (
    <div className="space-y-6">
      {/* Workspace Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Technical SEO &amp; Core Web Vitals
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Run separate Mobile and Desktop Google PageSpeed Insights v5 diagnostics with 24-hour per-device caching.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          <span>Mobile audits: {mobileCount}</span>
          <span aria-hidden="true">·</span>
          <span>Desktop audits: {desktopCount}</span>
        </div>
      </div>

      {/* Audit Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runCheck(targetUrl, strategy);
        }}
        className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-12 md:items-end">
          <div className="md:col-span-6">
            <label
              htmlFor="technical-url-input"
              className="mb-1.5 block text-[11px] font-medium text-slate-600 dark:text-slate-300"
            >
              Target Public URL
            </label>
            <input
              id="technical-url-input"
              type="url"
              required
              value={targetUrl}
              onChange={(e) => {
                setTargetUrl(e.target.value);
                setActiveSnapId('');
                setErrorDetail(null);
              }}
              placeholder={activeSite.url}
              disabled={running}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs text-slate-900 outline-none focus:border-indigo-600 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div className="md:col-span-3">
            <span className="mb-1.5 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
              Device Strategy
            </span>
            <div
              role="group"
              aria-label="PageSpeed device strategy"
              className="grid h-10 grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800"
            >
              <button
                type="button"
                onClick={() => handleStrategySelect('mobile')}
                disabled={running}
                aria-pressed={strategy === 'mobile'}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  strategy === 'mobile'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5 shrink-0" />
                <span>Mobile</span>
              </button>
              <button
                type="button"
                onClick={() => handleStrategySelect('desktop')}
                disabled={running}
                aria-pressed={strategy === 'desktop'}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  strategy === 'desktop'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                <Monitor className="h-3.5 w-3.5 shrink-0" />
                <span>Desktop</span>
              </button>
            </div>
          </div>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={running || (Boolean(activeQuotaBlock) && !cachedMatchForForm)}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              ) : cachedMatchForForm ? (
                <Clock className="h-4 w-4 shrink-0" />
              ) : (
                <Gauge className="h-4 w-4 shrink-0" />
              )}
              <span>
                {running
                  ? 'Running Audit...'
                  : cachedMatchForForm
                  ? `Load 24h Cached (${strategy === 'mobile' ? 'Mobile' : 'Desktop'})`
                  : activeQuotaBlock
                  ? 'Daily Quota Exhausted'
                  : 'Run Audit'}
              </span>
            </button>
          </div>
        </div>
      </form>

      {/* Live Loading Progress */}
      {running && pendingCheck && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/80 px-5 py-4 text-xs text-indigo-950 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-200"
        >
          <div className="flex items-start gap-3">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-indigo-600 dark:text-indigo-400" />
            <div>
              <div className="font-semibold">
                Running {pendingCheck.strategy === 'mobile' ? 'Mobile' : 'Desktop'} Google PageSpeed Insights audit...
              </div>
              <p className="mt-0.5 text-indigo-800/90 dark:text-indigo-300/80">
                Inspecting <span className="font-mono">{pendingCheck.url}</span>.{' '}
                {pendingCheck.strategy === 'mobile'
                  ? 'Mobile Lighthouse throttled simulations typically take 15–40 seconds.'
                  : 'Desktop Lighthouse audits typically take 8–25 seconds.'}
              </p>
            </div>
          </div>
          <div className="font-mono text-xs font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">
            Elapsed: {elapsedSeconds}s
          </div>
        </div>
      )}

      {/* Daily Quota Banner */}
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
                ? `Automatic retries are paused until ${new Date(activeQuotaBlock.retryAfter).toLocaleString()}. `
                : 'Automatic retries are paused until the daily quota resets. '}
              {activeQuotaBlock.consumerProject
                ? `Google Cloud consumer project: ${activeQuotaBlock.consumerProject}. `
                : ''}
              Saved Mobile and Desktop snapshots remain viewable below without consuming quota.
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

      {/* Actionable Error / Timeout Card */}
      {errorDetail && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/35 dark:text-red-200"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <div className="space-y-1">
                <div className="font-semibold">
                  {errorDetail.strategy === 'mobile' ? 'Mobile' : 'Desktop'} PageSpeed Audit Failed
                  {errorDetail.status ? ` (HTTP ${errorDetail.status})` : ''}
                </div>
                <p className="leading-relaxed">{errorDetail.message}</p>
                {(errorDetail.durationMs !== undefined || errorDetail.timeoutMs !== undefined) && (
                  <p className="font-mono text-[11px] tabular-nums text-red-700/90 dark:text-red-300/80">
                    {errorDetail.durationMs !== undefined
                      ? `Request duration: ${(errorDetail.durationMs / 1000).toFixed(1)}s`
                      : ''}
                    {errorDetail.durationMs !== undefined && errorDetail.timeoutMs !== undefined
                      ? ' · '
                      : ''}
                    {errorDetail.timeoutMs !== undefined
                      ? `Configured API timeout: ${Math.round(errorDetail.timeoutMs / 1000)}s`
                      : ''}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => runCheck(errorDetail.url, errorDetail.strategy)}
                disabled={running}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Retry {errorDetail.strategy === 'mobile' ? 'Mobile' : 'Desktop'} Audit</span>
              </button>
              {errorDetail.strategy === 'mobile' && (
                <button
                  type="button"
                  onClick={() => {
                    setStrategy('desktop');
                    setErrorDetail(null);
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 text-xs font-medium text-red-800 hover:bg-red-100/60 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 whitespace-nowrap"
                >
                  <Monitor className="h-3.5 w-3.5" />
                  <span>View Desktop</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Results View: Strict Device Matching */}
      {!activeSnap ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            {strategy === 'mobile' ? (
              <Smartphone className="h-5 w-5" />
            ) : (
              <Monitor className="h-5 w-5" />
            )}
          </div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            No {strategy === 'mobile' ? 'Mobile' : 'Desktop'} audit available
          </h3>
          <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {otherStrategySnap
              ? `A ${otherStrategy === 'mobile' ? 'Mobile' : 'Desktop'} audit exists for ${
                  targetUrl || activeSite.url
                }, but no ${
                  strategy === 'mobile' ? 'Mobile' : 'Desktop'
                } audit is stored yet. Mobile and Desktop caches are kept strictly separate.`
              : `Run a Google PageSpeed Insights v5 ${
                  strategy === 'mobile' ? 'Mobile' : 'Desktop'
                } check for ${targetUrl || activeSite.url} to inspect Lighthouse scores, Core Web Vitals, and crawlability directives.`}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => runCheck(targetUrl || activeSite.url, strategy)}
              disabled={running || Boolean(activeQuotaBlock)}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>
                {errorDetail
                  ? `Retry ${strategy === 'mobile' ? 'Mobile' : 'Desktop'} Audit`
                  : `Run ${strategy === 'mobile' ? 'Mobile' : 'Desktop'} Audit`}
              </span>
            </button>
            {otherStrategySnap && (
              <button
                type="button"
                onClick={() => handleStrategySelect(otherStrategy)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                {otherStrategy === 'mobile' ? (
                  <Smartphone className="h-3.5 w-3.5" />
                ) : (
                  <Monitor className="h-3.5 w-3.5" />
                )}
                <span>Switch to {otherStrategy === 'mobile' ? 'Mobile' : 'Desktop'}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Result Metadata Banner: Device + Cached/Live + Audit Time + Cache Age */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 text-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                {activeSnap.strategy === 'mobile' ? (
                  <Smartphone className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                ) : (
                  <Monitor className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                )}
                <span>{activeSnap.strategy === 'mobile' ? 'Mobile' : 'Desktop'} Results</span>
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                ·
              </span>
              <StatusText
                label={
                  lastLiveMeta?.id === activeSnap.id && !lastLiveMeta.cached
                    ? 'Live Result'
                    : activeSnapWithin24h
                    ? 'Cached Result (24h)'
                    : 'Saved Snapshot'
                }
                tone={
                  lastLiveMeta?.id === activeSnap.id && !lastLiveMeta.cached
                    ? 'success'
                    : activeSnapWithin24h
                    ? 'info'
                    : 'neutral'
                }
              />
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                ·
              </span>
              <span className="truncate max-w-md font-mono text-[11px] text-slate-600 dark:text-slate-400">
                {activeSnap.url}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              {activeSnapTs > 0 && (
                <span>
                  Last audit: {new Date(activeSnapTs).toLocaleString()} ({formatAgeLabel(activeSnapAgeMs)})
                </span>
              )}
              {activeSnapWithin24h && (
                <span>· {formatRemainingWindow(activeSnapCacheRemainingMs)}</span>
              )}
              {lastLiveMeta?.id === activeSnap.id &&
                !lastLiveMeta.cached &&
                lastLiveMeta.durationMs !== undefined && (
                  <span>
                    · {(lastLiveMeta.durationMs / 1000).toFixed(1)}s
                    {lastLiveMeta.upstreamStatus ? ` (HTTP ${lastLiveMeta.upstreamStatus})` : ''}
                  </span>
                )}
            </div>
          </div>

          {/* 4 Lighthouse Score Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: 'Performance', score: activeSnap.performanceScore },
              { label: 'SEO Audit', score: activeSnap.seoScore },
              { label: 'Accessibility', score: activeSnap.accessibilityScore },
              { label: 'Best Practices', score: activeSnap.bestPracticesScore },
            ].map((cat) => {
              const status = scoreTone(cat.score);
              return (
                <div
                  key={cat.label}
                  className="flex flex-col items-center rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <ScoreRing score={cat.score} size={86} />
                  <div className="mt-3 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {cat.label}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    <span className="font-mono uppercase text-slate-500 dark:text-slate-400">
                      {activeSnap.strategy}
                    </span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                      ·
                    </span>
                    <StatusText label={status.label} tone={status.tone} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Core Web Vitals Summary & Crawlability Directives */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Core Web Vitals Summary ({activeSnap.strategy === 'mobile' ? 'Mobile' : 'Desktop'})
                  </h3>
                </div>
                <span className="truncate max-w-xs font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {activeSnap.url}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  {
                    name: 'LCP',
                    val: `${(activeSnap.lcpMs / 1000).toFixed(2)}s`,
                    target: '<= 2.5s',
                    tone: vitalTone('lcp', activeSnap.lcpMs),
                  },
                  {
                    name: 'CLS',
                    val: activeSnap.cls.toFixed(3),
                    target: '<= 0.10',
                    tone: vitalTone('cls', activeSnap.cls),
                  },
                  {
                    name: 'INP / FID',
                    val: `${activeSnap.inpMs}ms`,
                    target: '<= 200ms',
                    tone: vitalTone('inp', activeSnap.inpMs),
                  },
                  {
                    name: 'FCP',
                    val: `${(activeSnap.fcpMs / 1000).toFixed(2)}s`,
                    target: '<= 1.8s',
                    tone: vitalTone('fcp', activeSnap.fcpMs),
                  },
                  {
                    name: 'TTFB',
                    val: `${activeSnap.ttfbMs}ms`,
                    target: '<= 800ms',
                    tone: vitalTone('ttfb', activeSnap.ttfbMs),
                  },
                ].map((m) => (
                  <div
                    key={m.name}
                    className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60"
                  >
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {m.name}
                    </div>
                    <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {m.val}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-1 text-[10px]">
                      <span className="font-mono text-slate-400">{m.target}</span>
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
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Crawlability Directives
                </h3>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
                  <span className="text-slate-500 dark:text-slate-400">robots.txt</span>
                  <StatusText
                    label={activeSnap.robotsStatus || 'Checked'}
                    tone={
                      activeSnap.robotsStatus?.includes('Blocked')
                        ? 'danger'
                        : activeSnap.robotsStatus?.includes('Missing') ||
                          activeSnap.robotsStatus?.includes('timed out')
                        ? 'warning'
                        : 'success'
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
                  <span className="text-slate-500 dark:text-slate-400">XML Sitemap</span>
                  <StatusText
                    label={activeSnap.sitemapStatus || 'Checked'}
                    tone={
                      activeSnap.sitemapStatus?.includes('Missing') ||
                      activeSnap.sitemapStatus?.includes('timed out')
                        ? 'warning'
                        : 'success'
                    }
                  />
                </div>
                {crawlTechSummary ? (
                  <>
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                      <span className="text-slate-500 dark:text-slate-400">
                        Crawled Pages ({crawlTechSummary.totalPages})
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-300">
                        {crawlTechSummary.duplicateTitles} dup titles ·{' '}
                        {crawlTechSummary.duplicateMetas} dup meta
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                      <span className="text-slate-500 dark:text-slate-400">
                        Indexability &amp; Redirects
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-300">
                        {crawlTechSummary.noindexCount} noindex · {crawlTechSummary.redirectCount}{' '}
                        redirects · {crawlTechSummary.missingCanonicalCount} no canonical
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                    Run a site crawl in Website Audit to include canonical, noindex, and redirect checks.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* SEO Audit Findings & History */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            {/* Audit Findings with Severity & Fixes */}
            <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    SEO Audit Findings &amp; Recommended Fixes
                  </h3>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                  {auditFindings.length} finding(s)
                </span>
              </div>

              {auditFindings.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  All checked Lighthouse categories, Core Web Vitals, and crawlability directives meet recommended thresholds for {activeSnap.strategy}.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {auditFindings.map((finding, idx) => (
                    <div key={idx} className="px-5 py-4 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <StatusText label={finding.severity} tone={finding.tone} />
                          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                            ·
                          </span>
                          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {finding.area}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {finding.impact}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {finding.title}
                      </div>
                      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          Fix:{' '}
                        </span>
                        {finding.recommendation}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Technical Check History (Strict Mobile/Desktop Clarity) */}
            <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-3.5 space-y-2.5 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Audit History ({filteredHistory.length})
                  </h3>
                  <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                    {(['all', 'mobile', 'desktop'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setHistoryDeviceFilter(f)}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                          historyDeviceFilter === f
                            ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                        }`}
                      >
                        {f === 'all' ? 'All' : f === 'mobile' ? 'Mobile' : 'Desktop'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {filteredHistory.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No recorded {historyDeviceFilter === 'all' ? '' : `${historyDeviceFilter} `}audits yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 max-h-[420px] overflow-y-auto dark:divide-slate-800">
                  {filteredHistory.map((snap) => {
                    const snapTs = getTimestampMs(snap.createdAt);
                    const snapAge = snapTs > 0 ? Math.max(0, Date.now() - snapTs) : 0;
                    const snapWithin24h = snapTs > 0 && snapAge < PSI_CACHE_TTL_MS;
                    const recheckBlocked = Boolean(activeQuotaBlock) && !snapWithin24h;
                    const isSelected = activeSnap.id === snap.id;

                    return (
                      <div
                        key={snap.id}
                        className={`flex items-center justify-between gap-2 px-5 py-3 text-xs transition-colors ${
                          isSelected
                            ? 'bg-indigo-50/75 dark:bg-indigo-950/35'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setTargetUrl(snap.url);
                            setStrategy(snap.strategy);
                            setActiveSnapId(snap.id);
                            setErrorDetail(null);
                            setCacheNotice(null);
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="truncate font-mono text-[11px] text-slate-900 dark:text-slate-100">
                            {snap.url}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                            <span className="font-semibold uppercase text-indigo-700 dark:text-indigo-400">
                              {snap.strategy}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>Perf {snap.performanceScore}</span>
                            <span>·</span>
                            <span>SEO {snap.seoScore}</span>
                            <span>·</span>
                            <span>LCP {(snap.lcpMs / 1000).toFixed(1)}s</span>
                            {snapTs > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{formatAgeLabel(snapAge)}</span>
                              </>
                            )}
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
                              : `Run fresh ${snap.strategy} audit`
                          }
                          className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          aria-label={`Recheck ${snap.strategy} audit`}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
