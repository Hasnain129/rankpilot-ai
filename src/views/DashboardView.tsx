import React, { useMemo } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  CheckCircle2,
  Gauge,
  Globe,
  Search,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { DualTrendChart, HorizontalBarList, ScoreRing } from '../components/charts/AnalyticsCharts';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import {
  AiSeoRecommendation,
  AnalyticsSnapshot,
  GscSnapshot,
  NavSection,
  SeoAudit,
  SeoOptimization,
  SiteCrawl,
  TechnicalSnapshot,
  TrackedKeyword,
  Website,
} from '../types';

interface DashboardViewProps {
  websites: Website[];
  seoAudits: SeoAudit[];
  siteCrawls: SiteCrawl[];
  seoOptimizations: SeoOptimization[];
  gscSnapshots: GscSnapshot[];
  analyticsSnapshots: AnalyticsSnapshot[];
  trackedKeywords: TrackedKeyword[];
  technicalSnapshots: TechnicalSnapshot[];
  seoRecommendations: AiSeoRecommendation[];
  selectedWebsiteId: string;
  loading: boolean;
  error: string | null;
  onNavigate: (section: NavSection) => void;
  onAddWebsite: () => void;
}

export function DashboardView({
  websites,
  seoAudits,
  siteCrawls,
  seoOptimizations,
  gscSnapshots,
  analyticsSnapshots,
  trackedKeywords,
  technicalSnapshots,
  seoRecommendations,
  selectedWebsiteId,
  loading,
  error,
  onNavigate,
  onAddWebsite,
}: DashboardViewProps) {
  const seoSummary = useMemo(() => {
    const scopeMatch = (wId: string) => selectedWebsiteId === 'all' || wId === selectedWebsiteId;
    const scopedSites = websites.filter((w) => scopeMatch(w.id));
    const crawls = siteCrawls.filter((c) => scopeMatch(c.websiteId));
    const audits = seoAudits.filter((a) => scopeMatch(a.websiteId));
    const opts = seoOptimizations.filter((o) => scopeMatch(o.websiteId));
    const gscs = gscSnapshots.filter((g) => scopeMatch(g.websiteId));
    const ga4s = analyticsSnapshots.filter((a) => scopeMatch(a.websiteId));
    const kws = trackedKeywords.filter((k) => scopeMatch(k.websiteId));
    const techs = technicalSnapshots.filter((t) => scopeMatch(t.websiteId));
    const recs = seoRecommendations.filter((r) => scopeMatch(r.websiteId));

    const latestCrawl = crawls[0] || null;
    const latestAudit = audits[0] || null;
    const latestGsc = gscs[0] || null;
    const latestGa4 = ga4s[0] || null;
    const latestTech = techs[0] || null;

    const scoredSites = scopedSites.filter((w) => w.seoScore > 0);
    const avgSiteScore =
      scoredSites.length > 0
        ? Math.round(scoredSites.reduce((s, w) => s + w.seoScore, 0) / scoredSites.length)
        : 0;
    const healthScore = latestCrawl?.overallScore || latestAudit?.score || avgSiteScore;

    const rankedKws = kws.filter((k) => k.currentPosition > 0);
    const avgKeywordPos =
      rankedKws.length > 0
        ? rankedKws.reduce((s, k) => s + k.currentPosition, 0) / rankedKws.length
        : 0;
    const improvedCount = kws.filter(
      (k) => k.previousPosition > 0 && k.currentPosition > 0 && k.currentPosition < k.previousPosition
    ).length;
    const declinedCount = kws.filter(
      (k) => k.previousPosition > 0 && k.currentPosition > 0 && k.currentPosition > k.previousPosition
    ).length;

    const openRecsAll = recs.filter((r) => r.status === 'open');
    const crawlCriticalCount = latestCrawl
      ? latestCrawl.siteIssues.filter((i) => i.severity === 'critical').length
      : latestAudit
      ? latestAudit.issues.filter((i) => i.severity === 'critical').length
      : 0;

    return {
      latestCrawl,
      latestAudit,
      latestGsc,
      latestGa4,
      latestTech,
      healthScore,
      totalKeywords: kws.length,
      rankedCount: rankedKws.length,
      avgKeywordPos,
      improvedCount,
      declinedCount,
      crawlCriticalCount,
      openRecsCount: openRecsAll.length,
      openRecs: openRecsAll.slice(0, 5),
      appliedOptsCount: opts.filter((o) => o.status === 'applied').length,
      pendingOptsCount: opts.filter((o) => o.status === 'pending_review').length,
      movingKws: rankedKws
        .map((k) => ({
          keyword: k.keyword,
          pos: k.currentPosition,
          delta: k.previousPosition > 0 ? k.previousPosition - k.currentPosition : 0,
        }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 5),
    };
  }, [
    websites,
    siteCrawls,
    seoAudits,
    seoOptimizations,
    gscSnapshots,
    analyticsSnapshots,
    trackedKeywords,
    technicalSnapshots,
    seoRecommendations,
    selectedWebsiteId,
  ]);

  const gscTrendSeries = useMemo(() => {
    if (!seoSummary.latestGsc || seoSummary.latestGsc.dailySeries.length === 0) return [];
    return seoSummary.latestGsc.dailySeries.map((d) => ({
      label: d.date.slice(5),
      primary: d.clicks,
      secondary: d.impressions,
    }));
  }, [seoSummary.latestGsc]);

  const ga4TopChannels = useMemo(() => {
    if (!seoSummary.latestGa4 || seoSummary.latestGa4.trafficSources.length === 0) return [];
    return seoSummary.latestGa4.trafficSources.slice(0, 5).map((s) => ({
      label: s.channel,
      value: s.sessions,
    }));
  }, [seoSummary.latestGa4]);

  const auditFindings = useMemo(() => {
    if (seoSummary.latestCrawl) {
      return seoSummary.latestCrawl.siteIssues
        .filter((i) => i.severity !== 'passed')
        .slice(0, 5)
        .map((i) => ({
          severity: i.severity,
          title: i.title,
          detail: i.detail,
          meta: `${i.affectedCount} item(s)`,
        }));
    }
    if (seoSummary.latestAudit) {
      return seoSummary.latestAudit.issues
        .filter((i) => i.severity !== 'passed')
        .slice(0, 5)
        .map((i) => ({
          severity: i.severity,
          title: i.title,
          detail: i.detail,
          meta: i.category,
        }));
    }
    return [];
  }, [seoSummary.latestCrawl, seoSummary.latestAudit]);

  if (error) {
    return <ErrorBanner message={`Unable to load SEO dashboard metrics: ${error}`} />;
  }

  if (!loading && websites.length === 0) {
    return (
      <EmptyState
        title="Add your first website to launch RankPilot SEO Growth"
        description="Connect your website URL to run live multi-page SEO audits, sync Google Search Console & GA4, research keywords, and deploy technical fixes."
        actionLabel="Add First Website"
        onAction={onAddWebsite}
      />
    );
  }

  const kpis: Array<{
    label: string;
    value: string;
    sub: string;
    icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
  }> = [];

  if (seoSummary.healthScore > 0) {
    kpis.push({
      label: 'SEO Health Score',
      value: `${seoSummary.healthScore}/100`,
      sub: seoSummary.latestCrawl
        ? `Live Crawl · ${seoSummary.latestCrawl.pagesCrawled} page(s)`
        : 'Live Page Audit',
      icon: Search,
      onClick: () => onNavigate('website-audit'),
    });
  }

  if (seoSummary.latestGsc) {
    kpis.push(
      {
        label: 'Google Search Clicks',
        value: seoSummary.latestGsc.totalClicks.toLocaleString(),
        sub: `${seoSummary.latestGsc.dateRangeStart} → ${seoSummary.latestGsc.dateRangeEnd}`,
        icon: BarChart2,
        onClick: () => onNavigate('search-console'),
      },
      {
        label: 'Search Impressions',
        value: seoSummary.latestGsc.totalImpressions.toLocaleString(),
        sub: `GSC CTR ${seoSummary.latestGsc.avgCtr.toFixed(2)}%`,
        icon: Globe,
        onClick: () => onNavigate('search-console'),
      },
      {
        label: 'Avg Search Position',
        value: `#${seoSummary.latestGsc.avgPosition.toFixed(1)}`,
        sub: 'GSC Verified Average',
        icon: Target,
        onClick: () => onNavigate('search-console'),
      }
    );
  } else if (seoSummary.avgKeywordPos > 0) {
    kpis.push({
      label: 'Avg Keyword Position',
      value: `#${seoSummary.avgKeywordPos.toFixed(1)}`,
      sub: `${seoSummary.rankedCount} ranked keyword(s)`,
      icon: Target,
      onClick: () => onNavigate('rank-tracker'),
    });
  }

  if (seoSummary.latestGa4) {
    kpis.push({
      label: 'GA4 Organic Sessions',
      value: seoSummary.latestGa4.organicSessions.toLocaleString(),
      sub: `${seoSummary.latestGa4.conversions.toLocaleString()} conversions (${seoSummary.latestGa4.conversionRate}%)`,
      icon: Activity,
      onClick: () => onNavigate('ga4-integration'),
    });
  }

  if (seoSummary.rankedCount > 0) {
    kpis.push({
      label: 'Ranked Keywords',
      value: `${seoSummary.rankedCount}/${seoSummary.totalKeywords}`,
      sub: `+${seoSummary.improvedCount} gained · -${seoSummary.declinedCount} dropped`,
      icon: TrendingUp,
      onClick: () => onNavigate('rank-tracker'),
    });
  }

  if (seoSummary.openRecsCount > 0 || seoSummary.crawlCriticalCount > 0) {
    kpis.push({
      label: 'Open SEO Actions',
      value: (seoSummary.openRecsCount + seoSummary.crawlCriticalCount).toLocaleString(),
      sub: `${seoSummary.openRecsCount} AI priority tasks · ${seoSummary.crawlCriticalCount} critical issues`,
      icon: AlertTriangle,
      onClick: () => onNavigate(seoSummary.openRecsCount > 0 ? 'ai-recommendations' : 'website-audit'),
    });
  }

  const showGscChart = gscTrendSeries.length > 0 && seoSummary.latestGsc !== null;
  const showHealthPanel =
    seoSummary.healthScore > 0 || seoSummary.latestTech !== null || ga4TopChannels.length > 0;
  const showMoversPanel = seoSummary.movingKws.length > 0;
  const showRecsPanel = seoSummary.openRecs.length > 0;
  const showTopPagesPanel = Boolean(seoSummary.latestGsc && seoSummary.latestGsc.topPages.length > 0);
  const showAuditFindingsPanel = auditFindings.length > 0;

  const hasAnyVerifiedTelemetry =
    kpis.length > 0 ||
    showGscChart ||
    showHealthPanel ||
    showMoversPanel ||
    showRecsPanel ||
    showTopPagesPanel ||
    showAuditFindingsPanel;

  return (
    <div className="space-y-6">
      {/* Header Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Verified organic Search Console telemetry, GA4 sessions, live website audits, and prioritized SEO actions
          </p>
        </div>
        {hasAnyVerifiedTelemetry && (
          <button
            type="button"
            onClick={() => onNavigate('seo-reports')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
          >
            Export SEO Report
          </button>
        )}
      </div>

      {!loading && !hasAnyVerifiedTelemetry ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            No verified SEO telemetry recorded for this scope yet
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            RankPilot only displays real audit findings, verified Google Search Console &amp; GA4 telemetry, and live PageSpeed metrics. Run an audit or connect a source below to populate your SEO Dashboard.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button
              type="button"
              onClick={() => onNavigate('website-audit')}
              className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 text-left hover:border-indigo-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-indigo-700 dark:hover:bg-slate-800/50"
            >
              <Search className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Run Website Audit</div>
                <div className="mt-0.5 text-[11px] text-slate-500">Crawl pages, metadata &amp; broken links</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('search-console')}
              className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 text-left hover:border-indigo-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-indigo-700 dark:hover:bg-slate-800/50"
            >
              <BarChart2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Connect Search Console</div>
                <div className="mt-0.5 text-[11px] text-slate-500">Sync verified clicks, CTR &amp; positions</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('ga4-integration')}
              className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 text-left hover:border-indigo-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-indigo-700 dark:hover:bg-slate-800/50"
            >
              <Activity className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Connect Analytics 4</div>
                <div className="mt-0.5 text-[11px] text-slate-500">Import organic sessions &amp; conversions</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('technical-seo')}
              className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 text-left hover:border-indigo-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-indigo-700 dark:hover:bg-slate-800/50"
            >
              <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Run PageSpeed CWV</div>
                <div className="mt-0.5 text-[11px] text-slate-500">Measure live LCP, CLS &amp; INP vitals</div>
              </div>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Verified KPI Cards */}
          {kpis.length > 0 && (
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpis.map((kpi) => {
                const Icon = kpi.icon;
                return (
                  <button
                    key={kpi.label}
                    type="button"
                    onClick={kpi.onClick}
                    className="group rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{kpi.label}</span>
                      <Icon className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 dark:text-slate-500 dark:group-hover:text-indigo-400" />
                    </div>
                    <div className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                      {loading ? '—' : kpi.value}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{kpi.sub}</div>
                  </button>
                );
              })}
            </section>
          )}

          {/* GSC Chart + Site Health & GA4 Channels */}
          {(showGscChart || showHealthPanel) && (
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {showGscChart && seoSummary.latestGsc && (
                <div
                  className={`${
                    showHealthPanel ? 'lg:col-span-8' : 'lg:col-span-12'
                  } rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900`}
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Organic Clicks &amp; Search Impressions ({seoSummary.latestGsc.dailySeries.length}d)
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Verified Search Console stream for {seoSummary.latestGsc.propertyUrl}
                      </p>
                    </div>
                    <StatusText label="GSC Verified" tone="success" />
                  </div>
                  <DualTrendChart
                    data={gscTrendSeries}
                    primaryLabel="Search Clicks"
                    secondaryLabel="Impressions"
                    formatSecondary={(n) => n.toLocaleString()}
                  />
                </div>
              )}

              {showHealthPanel && (
                <div
                  className={`${
                    showGscChart ? 'lg:col-span-4' : 'lg:col-span-12'
                  } rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between`}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-sm font-semibold">Site Health &amp; CWV</h2>
                      <button
                        type="button"
                        onClick={() => onNavigate('website-audit')}
                        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        Run Audit
                      </button>
                    </div>

                    {seoSummary.healthScore > 0 && (
                      <div className="mt-5 flex items-center gap-5">
                        <ScoreRing score={seoSummary.healthScore} size={88} />
                        <div className="space-y-1">
                          <StatusText
                            label={
                              seoSummary.healthScore >= 80
                                ? 'Healthy Baseline'
                                : seoSummary.healthScore >= 55
                                ? 'Needs Optimization'
                                : 'Critical Issues'
                            }
                            tone={
                              seoSummary.healthScore >= 80
                                ? 'success'
                                : seoSummary.healthScore >= 55
                                ? 'warning'
                                : 'danger'
                            }
                          />
                          {seoSummary.latestTech && (
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              PageSpeed {seoSummary.latestTech.performanceScore}/100 · LCP{' '}
                              {(seoSummary.latestTech.lcpMs / 1000).toFixed(2)}s
                            </div>
                          )}
                          {seoSummary.appliedOptsCount + seoSummary.pendingOptsCount > 0 && (
                            <div className="text-[11px] text-slate-500">
                              On-Page Drafts: {seoSummary.appliedOptsCount} applied · {seoSummary.pendingOptsCount}{' '}
                              pending
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {seoSummary.healthScore === 0 && seoSummary.latestTech && (
                      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                        PageSpeed ({seoSummary.latestTech.strategy}):{' '}
                        <strong>{seoSummary.latestTech.performanceScore}/100</strong> · LCP{' '}
                        {(seoSummary.latestTech.lcpMs / 1000).toFixed(2)}s · CLS {seoSummary.latestTech.cls.toFixed(3)}
                      </div>
                    )}
                  </div>

                  {ga4TopChannels.length > 0 && (
                    <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
                      <h3 className="mb-3 text-xs font-semibold text-slate-700 dark:text-slate-300">
                        GA4 Session Channels
                      </h3>
                      <HorizontalBarList items={ga4TopChannels} />
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Working Telemetry Lists: Audit Findings, Keyword Rankings, AI Actions, Top Search Pages */}
          {(showAuditFindingsPanel || showMoversPanel || showRecsPanel || showTopPagesPanel) && (
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {showAuditFindingsPanel && (
                <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                    <h2 className="font-display text-sm font-semibold">Latest Website Audit Findings</h2>
                    <button
                      type="button"
                      onClick={() => onNavigate('website-audit')}
                      className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Inspect Audit
                    </button>
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {auditFindings.map((item, idx) => (
                      <div key={idx} className="flex items-start justify-between gap-3 px-5 py-3 text-xs">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {item.severity === 'critical' ? (
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                          ) : item.severity === 'warning' ? (
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 dark:text-slate-100">{item.title}</div>
                            <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500 dark:text-slate-400">
                              {item.detail}
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-[11px] text-slate-500">{item.meta}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showMoversPanel && (
                <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                    <h2 className="font-display text-sm font-semibold">Verified Keyword Rankings</h2>
                    <button
                      type="button"
                      onClick={() => onNavigate('rank-tracker')}
                      className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Rank Tracker
                    </button>
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {seoSummary.movingKws.map((kw) => (
                      <div key={kw.keyword} className="flex items-center justify-between gap-2 px-5 py-3 text-xs">
                        <span className="truncate font-medium">{kw.keyword}</span>
                        <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums shrink-0">
                          <span className="font-semibold">#{kw.pos.toFixed(1)}</span>
                          {kw.delta !== 0 && (
                            <span
                              className={`inline-flex items-center ${
                                kw.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {kw.delta > 0 ? (
                                <ArrowUpRight className="h-3 w-3" />
                              ) : (
                                <ArrowDownRight className="h-3 w-3" />
                              )}
                              {Math.abs(kw.delta).toFixed(1)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showRecsPanel && (
                <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                    <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>Priority SEO Actions</span>
                    </h2>
                    <button
                      type="button"
                      onClick={() => onNavigate('ai-recommendations')}
                      className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      View All
                    </button>
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {seoSummary.openRecs.map((rec) => (
                      <button
                        key={rec.id}
                        type="button"
                        onClick={() => onNavigate('ai-recommendations')}
                        className="w-full px-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <StatusText
                            label={rec.priority}
                            tone={rec.priority === 'Critical' ? 'danger' : rec.priority === 'High' ? 'warning' : 'info'}
                          />
                          <span className="truncate font-mono text-[10px] text-slate-400">{rec.affectedPage}</span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-xs font-medium text-slate-800 dark:text-slate-200">
                          {rec.whatIsWrong}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showTopPagesPanel && seoSummary.latestGsc && (
                <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                    <h2 className="font-display text-sm font-semibold">Top Search Pages (GSC)</h2>
                    <button
                      type="button"
                      onClick={() => onNavigate('search-console')}
                      className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Inspect
                    </button>
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {seoSummary.latestGsc.topPages.slice(0, 5).map((p) => (
                      <div key={p.page} className="flex items-center justify-between gap-2 px-5 py-3 text-xs">
                        <span className="truncate font-mono text-[11px] text-slate-700 dark:text-slate-300">
                          {p.page}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">
                          {p.clicks} clicks · #{p.position.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
