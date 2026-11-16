import React, { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Globe, Loader2, Search } from 'lucide-react';
import { ScoreRing } from '../components/charts/AnalyticsCharts';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { SeoAudit, Website } from '../types';

interface SeoAnalyzerViewProps {
  websites: Website[];
  seoAudits: SeoAudit[];
  selectedWebsiteId: string;
  initialTargetUrl?: string;
  onSaveAudit: (websiteId: string, audit: Omit<SeoAudit, 'id' | 'ownerId' | 'websiteId' | 'createdAt'>) => Promise<void>;
  onAddWebsitePrompt: () => void;
}

export function SeoAnalyzerView({
  websites,
  seoAudits,
  selectedWebsiteId,
  initialTargetUrl,
  onSaveAudit,
  onAddWebsitePrompt,
}: SeoAnalyzerViewProps) {
  const { toast } = useToast();
  const defaultSiteId = selectedWebsiteId !== 'all' ? selectedWebsiteId : websites[0]?.id || '';
  const [targetWebsiteId, setTargetWebsiteId] = useState(defaultSiteId);
  const [scanUrl, setScanUrl] = useState(initialTargetUrl || websites[0]?.url || '');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [activeAudit, setActiveAudit] = useState<Omit<SeoAudit, 'id' | 'ownerId' | 'websiteId' | 'createdAt'> | null>(
    null
  );

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
    } else if (!targetWebsiteId && websites[0]) {
      setTargetWebsiteId(websites[0].id);
      setScanUrl(websites[0].url);
    }
  }, [selectedWebsiteId, initialTargetUrl, websites, targetWebsiteId]);

  const displayedAudit = activeAudit || seoAudits.find((a) => !targetWebsiteId || a.websiteId === targetWebsiteId) || seoAudits[0] || null;

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanUrl.trim()) return;
    setScanning(true);
    setScanError(null);
    try {
      const res = await fetch('/api/seo/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scanUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'SEO crawl failed.');
      }
      setActiveAudit(data);
      if (targetWebsiteId) {
        await onSaveAudit(targetWebsiteId, data);
      }
      toast({
        title: `SEO Audit Complete (${data.score}/100)`,
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

  return (
    <div className="space-y-6">
      {/* Scanner Form */}
      <form
        onSubmit={handleAnalyze}
        className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="w-full lg:w-64">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Save Results to Website
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
              Page URL to Crawl & Audit
            </label>
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                required
                value={scanUrl}
                onChange={(e) => setScanUrl(e.target.value)}
                placeholder="https://example.com/pricing"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={scanning}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span>{scanning ? 'Crawling & Analyzing...' : 'Analyze Website'}</span>
          </button>
        </div>
        {websites.length === 0 && (
          <p className="mt-2.5 text-xs text-slate-500">
            Tip:{' '}
            <button type="button" onClick={onAddWebsitePrompt} className="font-medium text-indigo-600 hover:underline">
              Connect a website
            </button>{' '}
            first to persist audit history in Firestore.
          </p>
        )}
      </form>

      {scanError && <ErrorBanner message={scanError} />}

      {!displayedAudit ? (
        <EmptyState
          title="Run a live AI SEO audit"
          description="Enter any public website URL above to inspect page title, meta description, heading hierarchy, broken links, image alt tags, mobile viewport, load time, and Gemini AI recommendations."
        />
      ) : (
        <div className="space-y-6">
          {/* Score & Core Telemetry */}
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

          {/* Extracted Metadata Inspection */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="font-display text-sm font-semibold mb-3">On-Page Metadata Preview</h3>
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
            </div>
          </div>

          {/* Issues & AI Recommendations Split */}
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
    </div>
  );
}
