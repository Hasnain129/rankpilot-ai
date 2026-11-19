import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/apiClient';
import {
  AiSeoRecommendation,
  AnalyticsSnapshot,
  GscSnapshot,
  NavSection,
  RecommendationCategory,
  RecommendationPriority,
  RecommendationStatus,
  SeoAudit,
  SiteCrawl,
  TechnicalSnapshot,
  Website,
} from '../types';

interface AiRecommendationsViewProps {
  websites: Website[];
  seoRecommendations: AiSeoRecommendation[];
  seoAudits: SeoAudit[];
  siteCrawls: SiteCrawl[];
  gscSnapshots: GscSnapshot[];
  analyticsSnapshots: AnalyticsSnapshot[];
  technicalSnapshots: TechnicalSnapshot[];
  selectedWebsiteId: string;
  onUpdateStatus: (id: string, status: RecommendationStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onNavigateToTarget: (section: NavSection, url?: string) => void;
  onAddWebsitePrompt: () => void;
}

const CATEGORIES: Array<{ id: 'all' | RecommendationCategory; label: string }> = [
  { id: 'all', label: 'All Categories' },
  { id: 'technical', label: 'Technical' },
  { id: 'on_page', label: 'On-Page' },
  { id: 'keyword', label: 'Keyword' },
  { id: 'content', label: 'Content' },
  { id: 'internal_linking', label: 'Internal Linking' },
];

function priorityTone(p: RecommendationPriority): 'danger' | 'warning' | 'info' | 'neutral' {
  if (p === 'Critical') return 'danger';
  if (p === 'High') return 'warning';
  if (p === 'Medium') return 'info';
  return 'neutral';
}

function targetRouteForCategory(cat: string): NavSection {
  if (cat === 'technical') return 'technical-seo';
  if (cat === 'keyword' || cat === 'competitor') return 'keyword-research';
  return 'on-page-seo';
}

export function AiRecommendationsView({
  websites,
  seoRecommendations,
  seoAudits,
  siteCrawls,
  gscSnapshots,
  analyticsSnapshots,
  technicalSnapshots,
  selectedWebsiteId,
  onUpdateStatus,
  onDelete,
  onNavigateToTarget,
  onAddWebsitePrompt,
}: AiRecommendationsViewProps) {
  const { toast } = useToast();

  const defaultSiteId = selectedWebsiteId !== 'all' ? selectedWebsiteId : websites[0]?.id || '';
  const [targetWebsiteId, setTargetWebsiteId] = useState(defaultSiteId);
  const [categoryFilter, setCategoryFilter] = useState<'all' | RecommendationCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RecommendationStatus>('all');
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (selectedWebsiteId !== 'all') {
      setTargetWebsiteId(selectedWebsiteId);
    } else if (!targetWebsiteId && websites[0]) {
      setTargetWebsiteId(websites[0].id);
    }
  }, [selectedWebsiteId, websites, targetWebsiteId]);

  const scopedRecs = useMemo(() => {
    const bySite =
      selectedWebsiteId === 'all'
        ? seoRecommendations
        : seoRecommendations.filter((r) => r.websiteId === selectedWebsiteId);
    return bySite.filter((r) => {
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    });
  }, [seoRecommendations, selectedWebsiteId, categoryFilter, statusFilter]);

  if (websites.length === 0) {
    return (
      <EmptyState
        title="Add a website to generate AI SEO recommendations"
        description="RankPilot AI synthesizes audits, Search Console queries, PageSpeed Core Web Vitals, and GA4 metrics into prioritized tasks."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  const handleGenerate = async () => {
    const site = websites.find((w) => w.id === targetWebsiteId) || websites[0];
    if (!site) return;

    setErrorMsg(null);

    const latestAudit = seoAudits.find((a) => a.websiteId === site.id);
    const latestCrawl = siteCrawls.find((c) => c.websiteId === site.id);
    const latestGsc = gscSnapshots.find((g) => g.websiteId === site.id);
    const latestGa4 = analyticsSnapshots.find((a) => a.websiteId === site.id);
    const latestTech = technicalSnapshots.find((t) => t.websiteId === site.id);

    const contextSummary = [
      `Website: ${site.name} (${site.url}), SEO Score: ${site.seoScore}/100`,
      latestAudit
        ? `Latest Single Audit (${latestAudit.url}): Score ${latestAudit.score}/100, Title "${latestAudit.title}", Missing Alt: ${latestAudit.missingAltCount}, Broken Links: ${latestAudit.brokenLinksCount}, Top Issues: ${latestAudit.issues.slice(0, 5).map((i) => i.title).join('; ')}`
        : 'No single-page audit recorded yet.',
      latestCrawl
        ? `Full Site Crawl (${latestCrawl.pagesCrawled} pages, Overall Score ${latestCrawl.overallScore}/100): Duplicate Titles=${latestCrawl.duplicateTitlesCount}, Duplicate Meta=${latestCrawl.duplicateMetaCount}, Noindex=${latestCrawl.noindexCount}, Broken Links=${latestCrawl.brokenLinksCount}, Site Issues=${latestCrawl.siteIssues.slice(0, 5).map((s) => `${s.title} (${s.affectedCount})`).join('; ')}`
        : 'No full site crawl recorded yet.',
      latestGsc
        ? `Google Search Console: ${latestGsc.totalClicks} clicks, ${latestGsc.totalImpressions} impressions, CTR ${latestGsc.avgCtr}%, Avg Pos ${latestGsc.avgPosition}. Low CTR / High Impression queries: ${latestGsc.topQueries.filter((q) => q.impressions > 50 && q.position > 4).slice(0, 6).map((q) => `"${q.query}" (pos ${q.position}, ${q.impressions} impr)`).join('; ')}`
        : 'GSC not synced yet.',
      latestTech
        ? `PageSpeed (${latestTech.strategy}): Perf ${latestTech.performanceScore}, SEO ${latestTech.seoScore}, LCP ${(latestTech.lcpMs / 1000).toFixed(2)}s, CLS ${latestTech.cls}, INP ${latestTech.inpMs}ms, Robots=${latestTech.robotsStatus}, Sitemap=${latestTech.sitemapStatus}. Top Opportunities: ${latestTech.opportunities.slice(0, 4).map((o) => o.title).join('; ')}`
        : 'PageSpeed not checked yet.',
      latestGa4
        ? `GA4 (${latestGa4.dateRangeStart} to ${latestGa4.dateRangeEnd}): ${latestGa4.sessions} sessions, ${latestGa4.organicSessions} organic, ${latestGa4.conversions} conversions (${latestGa4.conversionRate}%).`
        : 'GA4 not synced yet.',
    ].join('\n\n');

    setGenerating(true);
    try {
      const res = await apiFetch<{ createdCount: number }>('/api/ai/recommendations', {
        method: 'POST',
        body: JSON.stringify({
          websiteId: site.id,
          domain: site.domain,
          contextSummary,
        }),
      });
      toast({
        title: `Generated ${res.createdCount} prioritized SEO actions`,
        description: `Action plan saved for ${site.domain}.`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to generate AI SEO recommendations.';
      setErrorMsg(msg);
      toast({ title: 'Generation failed', description: msg, variant: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="font-display text-sm font-semibold">AI SEO Growth Recommendations</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Grounded in your live site crawls, Search Console data, PageSpeed Core Web Vitals, and GA4 conversions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={targetWebsiteId}
            onChange={(e) => setTargetWebsiteId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
          >
            {websites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.domain})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span>{generating ? 'Synthesizing...' : 'Generate SEO Action Plan'}</span>
          </button>
        </div>
      </div>

      {errorMsg && <ErrorBanner message={errorMsg} />}

      {/* Filter Bars */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategoryFilter(cat.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                categoryFilter === cat.id
                  ? 'bg-indigo-600 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | RecommendationStatus)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>

      {/* Recommendations List */}
      {scopedRecs.length === 0 ? (
        <EmptyState
          title="No recommendations match this filter"
          description="Click Generate SEO Action Plan above to analyze your workspace telemetry and produce prioritized growth actions."
          actionLabel="Generate SEO Action Plan"
          onAction={handleGenerate}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {scopedRecs.map((rec) => {
            const targetRoute = targetRouteForCategory(rec.category);
            return (
              <div
                key={rec.id}
                className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <StatusText label={rec.priority} tone={priorityTone(rec.priority)} />
                      <span className="text-xs text-slate-300 dark:text-slate-700">|</span>
                      <span className="font-mono text-[11px] uppercase text-slate-500">
                        {rec.category.replace('_', ' ')}
                      </span>
                      <span className="text-xs text-slate-300 dark:text-slate-700">|</span>
                      <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                        {rec.affectedPage}
                      </span>
                    </div>
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {rec.whatIsWrong}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={rec.status}
                      onChange={async (e) => {
                        await onUpdateStatus(rec.id, e.target.value as RecommendationStatus);
                        toast({ title: 'Recommendation status updated', variant: 'info' });
                      }}
                      className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-medium outline-none dark:border-slate-700 dark:bg-slate-800"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="dismissed">Dismissed</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => onNavigateToTarget(targetRoute, rec.affectedPage)}
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      <span>Take Action</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        await onDelete(rec.id);
                        toast({ title: 'Recommendation removed', variant: 'info' });
                      }}
                      className="rounded p-1.5 text-slate-400 hover:text-red-600"
                      aria-label="Delete recommendation"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3 border-t border-slate-100 pt-3 text-xs dark:border-slate-800/80">
                  <div>
                    <div className="font-semibold text-slate-700 dark:text-slate-300 mb-1">Why It Matters</div>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{rec.whyItMatters}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-700 dark:text-slate-300 mb-1">How To Fix</div>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{rec.howToFix}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-emerald-700 dark:text-emerald-400 mb-1 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Expected Benefit</span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{rec.expectedBenefit}</p>
                    <p className="mt-1.5 font-mono text-[10px] text-slate-400">Basis: {rec.sourceBasis}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
