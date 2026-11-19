import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Globe,
  Layers,
  Loader2,
  Search,
  Wand2,
} from 'lucide-react';
import { ScoreRing } from '../components/charts/AnalyticsCharts';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/apiClient';
import { CrawledPageSummary, CrawledPageType, SeoAudit, SiteCrawl, Website } from '../types';

interface SeoAnalyzerViewProps {
  websites: Website[];
  seoAudits: SeoAudit[];
  siteCrawls: SiteCrawl[];
  selectedWebsiteId: string;
  initialTargetUrl?: string;
  onSaveAudit: (websiteId: string, audit: Omit<SeoAudit, 'id' | 'ownerId' | 'websiteId' | 'createdAt'>) => Promise<void>;
  onAddWebsitePrompt: () => void;
  onSendPageToOptimizer: (page: CrawledPageSummary, websiteId: string) => void;
}

export function SeoAnalyzerView({
  websites,
  seoAudits,
  siteCrawls,
  selectedWebsiteId,
  initialTargetUrl,
  onSaveAudit,
  onAddWebsitePrompt,
  onSendPageToOptimizer,
}: SeoAnalyzerViewProps) {
  const { toast } = useToast();
  const defaultSiteId = selectedWebsiteId !== 'all' ? selectedWebsiteId : websites[0]?.id || '';
  const [mode, setMode] = useState<'full' | 'single'>('full');
  const [targetWebsiteId, setTargetWebsiteId] = useState(defaultSiteId);
  const [scanUrl, setScanUrl] = useState(initialTargetUrl || websites[0]?.url || '');
  const [maxPages, setMaxPages] = useState(15);
  const [pageFilter, setPageFilter] = useState<'all' | CrawledPageType>('all');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [activeAudit, setActiveAudit] = useState<Omit<SeoAudit, 'id' | 'ownerId' | 'websiteId' | 'createdAt'> | null>(null);
  const [activeCrawl, setActiveCrawl] = useState<SiteCrawl | null>(null);

  useEffect(() => {
    if (initialTargetUrl) {
      setScanUrl(initialTargetUrl);
      const match = websites.find((w) => w.url === initialTargetUrl);
      if (match) setTargetWebsiteId(match.id);
    } else if (selectedWebsiteId !== 'all') {
      const site = websites.find((w) => w.id === selectedWebsiteId);
      if (site) {
        setTargetWebsiteId(site.id);
        setScanUrl(site.url);
      }
    } else if (websites[0]) {
      setTargetWebsiteId((prev) => prev || websites[0].id);
      setScanUrl((prev) => prev || websites[0].url);
    }
  }, [selectedWebsiteId, initialTargetUrl, websites]);

  const displayedAudit =
    activeAudit ||
    seoAudits.find((a) => !targetWebsiteId || a.websiteId === targetWebsiteId) ||
    seoAudits[0] ||
    null;

  const displayedCrawl =
    activeCrawl ||
    siteCrawls.find((c) => !targetWebsiteId || c.websiteId === targetWebsiteId) ||
    siteCrawls[0] ||
    null;

  const handleAnalyzeSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanUrl.trim()) return;
    setScanning(true);
    setScanError(null);
    try {
      const data = await apiFetch<Omit<SeoAudit, 'id' | 'ownerId' | 'websiteId' | 'createdAt'> & { domain: string }>(
        '/api/seo/analyze',
        {
          method: 'POST',
          body: JSON.stringify({ url: scanUrl.trim() }),
        }
      );
      setActiveAudit(data);
      if (targetWebsiteId) {
        await onSaveAudit(targetWebsiteId, data);
      }
      toast({
        title: `Single Page Audit Complete (${data.score}/100)`,
        description: `Crawled ${data.domain} in ${data.loadTimeMs} ms.`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to analyze website.';
      setScanError(msg);
      toast({ title: 'SEO Scan Failed', description: msg, variant: 'error' });
    } finally {
      setScanning(false);
    }
  };

  const handleCrawlSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetWebsiteId) {
      toast({ title: 'Select or add a website first', variant: 'error' });
      return;
    }
    if (!scanUrl.trim()) return;
    setScanning(true);
    setScanError(null);
    try {
      const crawl = await apiFetch<SiteCrawl>('/api/seo/crawl-site', {
        method: 'POST',
        body: JSON.stringify({
          websiteId: targetWebsiteId,
          rootUrl: scanUrl.trim(),
          maxPages,
        }),
      });
      setActiveCrawl(crawl);
      toast({
        title: `Full-Site Crawl Complete (${crawl.overallScore}/100)`,
        description: `Audited ${crawl.pagesCrawled} page(s) across ${new URL(crawl.rootUrl).hostname}.`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Full-site crawl failed.';
      setScanError(msg);
      toast({ title: 'Site Crawl Failed', description: msg, variant: 'error' });
    } finally {
      setScanning(false);
    }
  };

  const filteredPages = (displayedCrawl?.pages || []).filter(
    (p) => pageFilter === 'all' || p.pageType === pageFilter
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setMode('full')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'full'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Full-Site Crawl</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('single')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'single'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            <span>Single-URL Audit</span>
          </button>
        </div>

        <span className="text-xs text-slate-500 dark:text-slate-400">
          Parses robots.txt, XML sitemaps, schema JSON-LD, duplicate metadata &amp; broken links
        </span>
      </div>

      {/* Scanner Form */}
      <form
        onSubmit={mode === 'full' ? handleCrawlSite : handleAnalyzeSingle}
        className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="w-full lg:w-60">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Target Website
            </label>
            <select
              value={targetWebsiteId}
              onChange={(e) => {
                const nextId = e.target.value;
                setTargetWebsiteId(nextId);
                const found = websites.find((w) => w.id === nextId);
                if (found) setScanUrl(found.url);
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            >
              {websites.length === 0 && <option value="">No connected website</option>}
              {websites.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.domain})
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              {mode === 'full' ? 'Root Website URL' : 'Page URL to Audit'}
            </label>
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                required
                value={scanUrl}
                onChange={(e) => setScanUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>

          {mode === 'full' && (
            <div className="w-full lg:w-36">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                Crawl Depth
              </label>
              <select
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              >
                <option value={8}>Up to 8 pages</option>
                <option value={15}>Up to 15 pages</option>
                <option value={25}>Up to 25 pages</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={scanning}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span>
              {scanning
                ? mode === 'full'
                  ? 'Crawling Site...'
                  : 'Auditing URL...'
                : mode === 'full'
                ? 'Run Full-Site Audit'
                : 'Audit Single URL'}
            </span>
          </button>
        </div>

        {websites.length === 0 && (
          <p className="mt-2.5 text-xs text-slate-500">
            Tip:{' '}
            <button type="button" onClick={onAddWebsitePrompt} className="font-medium text-indigo-600 hover:underline">
              Connect a website
            </button>{' '}
            first to persist crawl history in Firestore.
          </p>
        )}
      </form>

      {scanError && <ErrorBanner message={scanError} />}

      {/* MODE 1: FULL-SITE CRAWL */}
      {mode === 'full' && (
        <>
          {!displayedCrawl ? (
            <EmptyState
              title="Run a complete multi-page SEO audit"
              description="Crawl your homepage, product pages, categories, blog articles, robots.txt, and sitemap.xml to catch duplicate metadata, noindex blocks, broken links, and missing Schema markup."
            />
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 flex items-center gap-5">
                  <ScoreRing score={displayedCrawl.overallScore} size={92} />
                  <div className="min-w-0 space-y-1">
                    <div className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                      {displayedCrawl.rootUrl}
                    </div>
                    <StatusText
                      label={
                        displayedCrawl.overallScore >= 80
                          ? 'Healthy Site Architecture'
                          : displayedCrawl.overallScore >= 55
                          ? 'Needs Prioritized Fixes'
                          : 'Critical Technical Gaps'
                      }
                      tone={
                        displayedCrawl.overallScore >= 80
                          ? 'success'
                          : displayedCrawl.overallScore >= 55
                          ? 'warning'
                          : 'danger'
                      }
                    />
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {displayedCrawl.summary}
                    </p>
                  </div>
                </div>

                <div className="lg:col-span-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Pages Crawled', value: `${displayedCrawl.pagesCrawled}` },
                    { label: 'Sitemap URLs', value: displayedCrawl.sitemapFound ? displayedCrawl.sitemapUrlsCount.toLocaleString() : 'Missing' },
                    { label: 'Robots.txt', value: displayedCrawl.robotsBlockingAll ? 'Blocking!' : displayedCrawl.robotsTxtFound ? 'Crawlable' : 'Missing' },
                    { label: 'Duplicate Titles', value: `${displayedCrawl.duplicateTitlesCount}` },
                    { label: 'Duplicate Metas', value: `${displayedCrawl.duplicateMetaCount}` },
                    { label: 'Noindex Pages', value: `${displayedCrawl.noindexCount}` },
                    { label: 'Broken Sample Links', value: `${displayedCrawl.brokenLinksCount}` },
                    { label: 'Schemas Found', value: `${displayedCrawl.pages.filter((p) => p.schemaTypes.length > 0).length} / ${displayedCrawl.pages.length}` },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{stat.label}</div>
                      <div className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Site-Wide Issues */}
              <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                  <h3 className="font-display text-sm font-semibold">Site-Wide Technical &amp; Indexing Findings</h3>
                </div>
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {displayedCrawl.siteIssues.map((issue, idx) => (
                    <div key={idx} className="flex items-start justify-between gap-4 px-5 py-3">
                      <div className="flex items-start gap-3">
                        {issue.severity === 'critical' && (
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                        )}
                        {issue.severity === 'warning' && (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        )}
                        {issue.severity === 'passed' && (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        )}
                        <div>
                          <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                            {issue.title}
                            <span className="ml-2 text-[11px] font-normal text-slate-400">{issue.category}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{issue.detail}</p>
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500">
                        {issue.affectedCount} items
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Discovered Pages Table */}
              <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                  <h3 className="font-display text-sm font-semibold">
                    Discovered Pages ({filteredPages.length})
                  </h3>
                  <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                    {(['all', 'product', 'category', 'blog', 'landing', 'other'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setPageFilter(t)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                          pageFilter === t
                            ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Page &amp; Type</th>
                        <th className="px-4 py-2.5 font-medium">Title / Meta</th>
                        <th className="px-4 py-2.5 font-medium">Schema</th>
                        <th className="px-4 py-2.5 font-medium text-right">Words</th>
                        <th className="px-4 py-2.5 font-medium text-right">Missing Alt</th>
                        <th className="px-4 py-2.5 font-medium text-right">Score</th>
                        <th className="px-4 py-2.5 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {filteredPages.map((pg) => (
                        <tr key={pg.url} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 max-w-[260px]">
                            <div className="truncate font-medium text-slate-900 dark:text-slate-100" title={pg.url}>
                              {pg.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              <span className="capitalize">{pg.pageType}</span> · HTTP {pg.httpStatus} · {pg.loadTimeMs}ms
                              {(pg.redirectCount ?? 0) > 0 && ` · ${pg.redirectCount} redirect hop(s)`}
                              {pg.noindex && ' · NOINDEX'}
                            </div>
                          </td>
                          <td className="px-4 py-3 max-w-[260px]">
                            <div className="truncate font-medium text-slate-800 dark:text-slate-200">
                              {pg.title || <span className="text-red-600 dark:text-red-400">Missing title</span>}
                            </div>
                            <div className="truncate text-[11px] text-slate-500">
                              {pg.metaDescription || <span className="text-amber-600 dark:text-amber-400">Missing meta description</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-600 dark:text-slate-300">
                            {pg.schemaTypes.length > 0 ? pg.schemaTypes.join(', ') : 'None'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{pg.wordCount}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">
                            {pg.missingAltCount > 0 ? (
                              <span className="text-amber-600 dark:text-amber-400">{pg.missingAltCount}</span>
                            ) : (
                              '0'
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                            {pg.score}/100
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => onSendPageToOptimizer(pg, displayedCrawl.websiteId)}
                              className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400 whitespace-nowrap"
                            >
                              <Wand2 className="h-3.5 w-3.5" />
                              <span>Optimize</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* MODE 2: SINGLE-PAGE AUDIT */}
      {mode === 'single' && (
        <>
          {!displayedAudit ? (
            <EmptyState
              title="Run a live single-URL SEO audit"
              description="Enter any public website URL above to inspect page title, meta description, heading hierarchy, broken links, image alt tags, mobile viewport, load time, and Gemini AI recommendations."
            />
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 flex items-center gap-5">
                  <ScoreRing score={displayedAudit.score} size={92} />
                  <div className="min-w-0 space-y-1">
                    <div className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                      {displayedAudit.url}
                    </div>
                    <StatusText
                      label={
                        displayedAudit.score >= 80
                          ? 'Strong Technical SEO'
                          : displayedAudit.score >= 55
                          ? 'Optimization Needed'
                          : 'Critical Fixes Required'
                      }
                      tone={displayedAudit.score >= 80 ? 'success' : displayedAudit.score >= 55 ? 'warning' : 'danger'}
                    />
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {displayedAudit.summary}
                    </p>
                  </div>
                </div>

                <div className="lg:col-span-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'HTTP Status', value: `${displayedAudit.httpStatus}` },
                    { label: 'HTML Load Time', value: `${displayedAudit.loadTimeMs} ms` },
                    { label: 'Headings (H1/H2/H3)', value: `${displayedAudit.h1Count}/${displayedAudit.h2Count}/${displayedAudit.h3Count}` },
                    { label: 'Word Count', value: displayedAudit.wordCount.toLocaleString() },
                    { label: 'Images Missing Alt', value: `${displayedAudit.missingAltCount} / ${displayedAudit.totalImages}` },
                    { label: 'Internal / External Links', value: `${displayedAudit.internalLinks} / ${displayedAudit.externalLinks}` },
                    { label: 'Broken Sampled Links', value: `${displayedAudit.brokenLinksCount}` },
                    { label: 'Mobile Viewport', value: displayedAudit.mobileFriendly ? 'Configured' : 'Missing' },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{stat.label}</div>
                      <div className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
                <h3 className="font-display text-sm font-semibold">On-Page Metadata &amp; Indexability Preview</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-xs">
                  <div>
                    <div className="font-medium text-slate-500 dark:text-slate-400">
                      Page Title ({displayedAudit.title.length} chars)
                    </div>
                    <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                      {displayedAudit.title || 'Missing <title> tag'}
                    </p>
                  </div>
                  <div>
                    <div className="font-medium text-slate-500 dark:text-slate-400">
                      Meta Description ({displayedAudit.metaDescription.length} chars)
                    </div>
                    <p className="mt-1 text-slate-700 dark:text-slate-300">
                      {displayedAudit.metaDescription || 'Missing meta description'}
                    </p>
                  </div>
                  <div>
                    <div className="font-medium text-slate-500 dark:text-slate-400">
                      Robots &amp; HTTP Header Directives
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                      meta robots: {displayedAudit.metaRobots || 'index, follow (default)'} · X-Robots-Tag: {displayedAudit.xRobotsTag || 'none'}
                    </p>
                  </div>
                  <div>
                    <div className="font-medium text-slate-500 dark:text-slate-400">
                      Redirect Trace ({displayedAudit.redirectCount ?? 0} hop{(displayedAudit.redirectCount ?? 0) === 1 ? '' : 's'})
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate">
                      {displayedAudit.redirectChain && displayedAudit.redirectChain.length > 0
                        ? displayedAudit.redirectChain.join(' → ')
                        : 'Direct 200 response (no redirects)'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                  <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                    <h3 className="font-display text-sm font-semibold">Technical Checks</h3>
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {displayedAudit.issues.map((issue, idx) => (
                      <div key={idx} className="flex items-start gap-3 px-5 py-3">
                        {issue.severity === 'critical' && (
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                        )}
                        {issue.severity === 'warning' && (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        )}
                        {issue.severity === 'passed' && (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                            {issue.title}
                            <span className="ml-2 text-[11px] font-normal text-slate-400">
                              {issue.category}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{issue.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                  <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                    <h3 className="font-display text-sm font-semibold">AI Actionable Recommendations</h3>
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {displayedAudit.recommendations.map((rec, idx) => (
                      <div key={idx} className="px-5 py-3.5 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {idx + 1}. {rec.title}
                          </span>
                          <StatusText
                            label={`${rec.priority} Priority`}
                            tone={rec.priority.toLowerCase() === 'high' ? 'danger' : rec.priority.toLowerCase() === 'medium' ? 'warning' : 'info'}
                          />
                        </div>
                        <p className="text-xs text-indigo-700 dark:text-indigo-300">Impact: {rec.impact}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">{rec.actionSteps}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
