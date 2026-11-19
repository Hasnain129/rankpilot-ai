import React, { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Gauge, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { ScoreRing } from '../components/charts/AnalyticsCharts';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/apiClient';
import { SiteCrawl, TechnicalSnapshot, Website } from '../types';

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
  const [error, setError] = useState<string | null>(null);
  const [activeSnapId, setActiveSnapId] = useState('');

  useEffect(() => {
    if (initialUrl) setTargetUrl(initialUrl);
    else if (activeSite?.url) setTargetUrl(activeSite.url);
  }, [initialUrl, activeSite]);

  const scopedSnaps = useMemo(() => {
    if (!activeSite) return [];
    return technicalSnapshots.filter((s) => s.websiteId === activeSite.id);
  }, [technicalSnapshots, activeSite]);

  const activeSnap =
    scopedSnaps.find((s) => s.id === activeSnapId) || scopedSnaps[0] || null;

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
    setError(null);
    if (!urlToTest.trim()) return;
    setRunning(true);
    try {
      const data = await apiFetch<{
        id: string;
        performanceScore: number;
        seoScore: number;
        lcpMs: number;
      }>('/api/pagespeed/analyze', {
        method: 'POST',
        body: JSON.stringify({
          websiteId: activeSite.id,
          url: urlToTest.trim(),
          strategy: strat,
        }),
      });
      setActiveSnapId(data.id);
      toast({
        title: `PageSpeed ${strat} audit completed`,
        description: `Perf ${data.performanceScore}/100 · SEO ${data.seoScore}/100 · LCP ${(data.lcpMs / 1000).toFixed(2)}s`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to complete PageSpeed analysis.';
      setError(msg);
      toast({ title: 'Technical check failed', description: msg, variant: 'error' });
    } finally {
      setRunning(false);
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
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Device Emulation</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as 'mobile' | 'desktop')}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="mobile">Mobile</option>
              <option value="desktop">Desktop</option>
            </select>
          </div>
          <div className="md:col-span-3 flex items-end">
            <button
              type="submit"
              disabled={running}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
              <span>{running ? 'Running Lighthouse...' : 'Run PageSpeed Check'}</span>
            </button>
          </div>
        </div>
      </form>

      {error && <ErrorBanner message={error} />}

      {!activeSnap ? (
        <EmptyState
          title="No Core Web Vitals snapshot recorded yet"
          description="Run a live Google PageSpeed Insights v5 check above to capture Lighthouse category scores, LCP, CLS, INP, TTFB, robots.txt, and sitemap.xml telemetry."
        />
      ) : (
        <>
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
                {scopedSnaps.map((snap) => (
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
                      disabled={running}
                      className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                      aria-label="Recheck URL"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
