import React, { useMemo } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  DollarSign,
  Gauge,
  Globe,
  Percent,
  Receipt,
  Search,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { DualTrendChart, HorizontalBarList, ScoreRing } from '../components/charts/AnalyticsCharts';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { computeWorkspaceAnalytics, formatCurrency, getTimestampMs, toLocalDateKey } from '../lib/analytics';
import {
  GscSnapshot,
  Lead,
  NavSection,
  Order,
  Quote,
  SeoAudit,
  SeoOptimization,
  SiteCrawl,
  TechnicalSnapshot,
  TrackedKeyword,
  VisitorEvent,
  Website,
} from '../types';

interface DashboardViewProps {
  websites: Website[];
  seoAudits: SeoAudit[];
  siteCrawls: SiteCrawl[];
  seoOptimizations: SeoOptimization[];
  gscSnapshots: GscSnapshot[];
  trackedKeywords: TrackedKeyword[];
  technicalSnapshots: TechnicalSnapshot[];
  visitorEvents: VisitorEvent[];
  leads: Lead[];
  quotes: Quote[];
  orders: Order[];
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
  trackedKeywords,
  technicalSnapshots,
  visitorEvents,
  leads,
  quotes,
  orders,
  selectedWebsiteId,
  loading,
  error,
  onNavigate,
  onAddWebsite,
}: DashboardViewProps) {
  const analytics = useMemo(
    () =>
      computeWorkspaceAnalytics({
        websites,
        visitorEvents,
        leads,
        quotes,
        orders,
        seoAudits,
        selectedWebsiteId,
      }),
    [websites, visitorEvents, leads, quotes, orders, seoAudits, selectedWebsiteId]
  );

  // Scoped Phase 1–7 SEO Growth metrics
  const seoGrowth = useMemo(() => {
    const scopeMatch = (wId: string) => selectedWebsiteId === 'all' || wId === selectedWebsiteId;
    const crawls = siteCrawls.filter((c) => scopeMatch(c.websiteId));
    const opts = seoOptimizations.filter((o) => scopeMatch(o.websiteId));
    const gscs = gscSnapshots.filter((g) => scopeMatch(g.websiteId));
    const kws = trackedKeywords.filter((k) => scopeMatch(k.websiteId));
    const techs = technicalSnapshots.filter((t) => scopeMatch(t.websiteId));

    const latestCrawl = crawls[0] || null;
    const latestGsc = gscs[0] || null;
    const latestTech = techs[0] || null;

    const appliedCount = opts.filter((o) => o.status === 'applied').length;
    const pendingReviewCount = opts.filter((o) => o.status === 'pending_review').length;
    const approvedCount = opts.filter((o) => o.status === 'approved').length;

    const rankedKws = kws.filter((k) => k.currentPosition > 0);
    const avgKeywordPos =
      rankedKws.length > 0
        ? rankedKws.reduce((s, k) => s + k.currentPosition, 0) / rankedKws.length
        : 0;

    const movingKws = kws
      .filter((k) => k.currentPosition > 0)
      .map((k) => ({
        keyword: k.keyword,
        pos: k.currentPosition,
        delta: k.previousPosition > 0 ? k.previousPosition - k.currentPosition : 0,
        sourceType: k.sourceType,
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 5);

    const openTechIssues = latestCrawl
      ? latestCrawl.siteIssues.filter((i) => i.severity !== 'passed')
      : [];

    const healthScore =
      latestCrawl?.overallScore || analytics.avgSeoScore;

    return {
      latestCrawl,
      latestGsc,
      latestTech,
      appliedCount,
      pendingReviewCount,
      approvedCount,
      totalKeywords: kws.length,
      rankedCount: rankedKws.length,
      avgKeywordPos,
      movingKws,
      openTechIssues,
      healthScore,
    };
  }, [
    siteCrawls,
    seoOptimizations,
    gscSnapshots,
    trackedKeywords,
    technicalSnapshots,
    selectedWebsiteId,
    analytics.avgSeoScore,
  ]);

  // Build 7-day trend points using local YYYY-MM-DD date keys
  const trendData = useMemo(() => {
    const days: Array<{ key: string; label: string; primary: number; secondary: number }> = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = toLocalDateKey(d);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      days.push({ key, label, primary: 0, secondary: 0 });
    }
    const dayMap = new Map(days.map((d) => [d.key, d]));

    analytics.scopedEvents.forEach((ev) => {
      const ms = getTimestampMs(ev.createdAt);
      if (!ms) return;
      const key = toLocalDateKey(new Date(ms));
      const target = dayMap.get(key);
      if (target) target.primary += 1;
    });

    analytics.validOrders.forEach((ord) => {
      const key = ord.orderDate?.slice(0, 10);
      const target = key ? dayMap.get(key) : undefined;
      if (target) target.secondary += Number(ord.amount) || 0;
    });

    return days;
  }, [analytics.scopedEvents, analytics.validOrders]);

  const channelBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    analytics.scopedEvents.forEach((ev) => {
      map.set(ev.trafficSource, (map.get(ev.trafficSource) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [analytics.scopedEvents]);

  const recentActivities = useMemo(() => {
    const items: Array<{ id: string; title: string; detail: string; time: number; section: NavSection }> = [];

    seoOptimizations
      .filter((o) => selectedWebsiteId === 'all' || o.websiteId === selectedWebsiteId)
      .slice(0, 3)
      .forEach((o) => {
        items.push({
          id: `opt_${o.id}`,
          title: `Optimization ${o.status.replace('_', ' ')}: ${o.optimizedDraft.title || o.targetUrl}`,
          detail: o.targetKeyword || o.entityType.toUpperCase(),
          time: getTimestampMs(o.createdAt),
          section: 'optimization-center',
        });
      });

    analytics.scopedAudits.slice(0, 3).forEach((a) => {
      items.push({
        id: `a_${a.id}`,
        title: `SEO audit completed (${a.score}/100)`,
        detail: a.url,
        time: getTimestampMs(a.createdAt),
        section: 'seo-analyzer',
      });
    });
    analytics.scopedLeads.slice(0, 3).forEach((l) => {
      items.push({
        id: `l_${l.id}`,
        title: `Lead ${l.status.toLowerCase()}: ${l.name}`,
        detail: `${l.leadSource} · ${formatCurrency(l.estimatedValue)}`,
        time: getTimestampMs(l.createdAt),
        section: 'leads',
      });
    });
    analytics.scopedQuotes.slice(0, 2).forEach((q) => {
      items.push({
        id: `q_${q.id}`,
        title: `Quote ${q.status.toLowerCase()} for ${q.customerName}`,
        detail: `${q.serviceOrProduct} · ${formatCurrency(q.amount)}`,
        time: getTimestampMs(q.createdAt),
        section: 'quotes',
      });
    });
    analytics.scopedOrders.slice(0, 2).forEach((o) => {
      items.push({
        id: `o_${o.id}`,
        title: `Order ${o.orderNumber} (${o.status})`,
        detail: `${o.customerName} · ${formatCurrency(o.amount)}`,
        time: getTimestampMs(o.createdAt),
        section: 'orders',
      });
    });

    return items.sort((a, b) => b.time - a.time).slice(0, 8);
  }, [
    seoOptimizations,
    selectedWebsiteId,
    analytics.scopedAudits,
    analytics.scopedLeads,
    analytics.scopedQuotes,
    analytics.scopedOrders,
  ]);

  if (error) {
    return <ErrorBanner message={`Unable to load workspace metrics: ${error}`} />;
  }

  if (!loading && websites.length === 0) {
    return (
      <div className="space-y-6">
        <EmptyState
          title="Connect your first website to unlock RankPilot AI"
          description="Add a website URL to generate a unique visitor tracking script, run a real technical SEO crawl, and track leads, quotes, and revenue in one workspace."
          actionLabel="Add First Website"
          onAction={onAddWebsite}
        />
      </div>
    );
  }

  const kpis = [
    { label: 'Connected Websites', value: analytics.scopedWebsites.length.toString(), icon: Globe, onClick: () => onNavigate('websites') },
    { label: 'Website Visitors', value: analytics.uniqueVisitors.toLocaleString(), icon: Activity, onClick: () => onNavigate('visitor-tracking') },
    { label: 'Leads Generated', value: analytics.scopedLeads.length.toLocaleString(), icon: Users, onClick: () => onNavigate('leads') },
    { label: 'Customers', value: analytics.totalCustomers.toLocaleString(), icon: UserCheck, onClick: () => onNavigate('sales-analytics') },
    { label: 'Total Orders', value: analytics.validOrders.length.toLocaleString(), icon: ShoppingBag, onClick: () => onNavigate('orders') },
    { label: 'Quote Requests', value: analytics.scopedQuotes.length.toLocaleString(), icon: Receipt, onClick: () => onNavigate('quotes') },
    { label: 'Total Revenue', value: formatCurrency(analytics.totalRevenue), icon: DollarSign, onClick: () => onNavigate('sales-analytics') },
    { label: 'Lead Conv. Rate', value: `${analytics.visitorToLeadRate.toFixed(1)}%`, icon: Percent, onClick: () => onNavigate('sales-analytics') },
  ];

  return (
    <div className="space-y-6">
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
            </button>
          );
        })}
      </section>

      {/* Phase 8: SEO Growth Engine Overview */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3.5 dark:border-slate-800">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              SEO Growth Engine Overview
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Organic clicks, verified rank positions, optimization pipeline, and Core Web Vitals status
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate('seo-analyzer')}
              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Site Audit
            </button>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <button
              type="button"
              onClick={() => onNavigate('optimization-center')}
              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Optimization Center
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => onNavigate('search-console')}
            className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-left hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/40"
          >
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Search Console Organic</span>
              <BarChart2 className="h-3.5 w-3.5" />
            </div>
            {seoGrowth.latestGsc ? (
              <>
                <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums">
                  {seoGrowth.latestGsc.totalClicks.toLocaleString()} clicks
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                  {seoGrowth.latestGsc.totalImpressions.toLocaleString()} impr · CTR {seoGrowth.latestGsc.avgCtr.toFixed(1)}%
                </div>
              </>
            ) : (
              <div className="mt-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                Connect Google Search Console →
              </div>
            )}
          </button>

          <button
            type="button"
            onClick={() => onNavigate('rank-tracker')}
            className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-left hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/40"
          >
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Tracked Keyword Ranks</span>
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
            <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums">
              {seoGrowth.avgKeywordPos > 0 ? `Avg #${seoGrowth.avgKeywordPos.toFixed(1)}` : `${seoGrowth.totalKeywords} tracked`}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
              {seoGrowth.rankedCount}/{seoGrowth.totalKeywords} ranking in top 50
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('optimization-center')}
            className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-left hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/40"
          >
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Optimization Pipeline</span>
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums">
              {seoGrowth.appliedCount} applied live
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
              {seoGrowth.approvedCount} approved · {seoGrowth.pendingReviewCount} pending review
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('technical-monitor')}
            className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-left hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/40"
          >
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Core Web Vitals</span>
              <Gauge className="h-3.5 w-3.5" />
            </div>
            {seoGrowth.latestTech ? (
              <>
                <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums">
                  Perf {seoGrowth.latestTech.performanceScore}/100
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                  LCP {(seoGrowth.latestTech.lcpMs / 1000).toFixed(2)}s · CLS {seoGrowth.latestTech.cls.toFixed(3)}
                </div>
              </>
            ) : (
              <div className="mt-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                Run PageSpeed Insights Check →
              </div>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 pt-1">
          {/* Top Performing Pages (from GSC) or Open Technical Issues */}
          <div>
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span>Top Search Pages &amp; Technical Issues</span>
              <button
                type="button"
                onClick={() => onNavigate(seoGrowth.latestGsc ? 'search-console' : 'seo-analyzer')}
                className="font-normal text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Inspect Details
              </button>
            </div>
            {seoGrowth.latestGsc && seoGrowth.latestGsc.topPages.length > 0 ? (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {seoGrowth.latestGsc.topPages.slice(0, 4).map((p) => (
                  <div key={p.page} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="truncate font-mono text-[11px] text-slate-700 dark:text-slate-300">
                      {p.page}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">
                      {p.clicks} clicks · #{p.position.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            ) : seoGrowth.openTechIssues.length > 0 ? (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {seoGrowth.openTechIssues.slice(0, 4).map((iss, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="truncate text-slate-700 dark:text-slate-300">{iss.title}</span>
                    <StatusText
                      label={`${iss.affectedCount} affected`}
                      tone={iss.severity === 'critical' ? 'danger' : 'warning'}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-800">
                Run a Full-Site Crawl or sync Google Search Console to view page performance &amp; technical gaps.
              </div>
            )}
          </div>

          {/* Gaining / Losing Tracked Keywords */}
          <div>
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span>Tracked Keyword Positions</span>
              <button
                type="button"
                onClick={() => onNavigate('rank-tracker')}
                className="font-normal text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Open Rank Tracker
              </button>
            </div>
            {seoGrowth.movingKws.length > 0 ? (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {seoGrowth.movingKws.map((kw) => (
                  <div key={kw.keyword} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="truncate font-medium text-slate-800 dark:text-slate-200">{kw.keyword}</span>
                    <div className="flex items-center gap-2 shrink-0 font-mono text-[11px] tabular-nums">
                      <span className="font-semibold">#{kw.pos.toFixed(1)}</span>
                      {kw.delta !== 0 && (
                        <span
                          className={`inline-flex items-center ${
                            kw.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {kw.delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {Math.abs(kw.delta).toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-800">
                Add keywords in Rank Tracker and sync with Google Search Console or SERP API to monitor movement.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Traffic Events &amp; Revenue (Last 7 Days)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Daily tracked visitor sessions overlaid with recorded order revenue
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('sales-analytics')}
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400 whitespace-nowrap"
            >
              <span>Full Analytics</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <DualTrendChart
            data={trendData}
            primaryLabel="Visitor Events"
            secondaryLabel="Revenue"
          />
        </div>

        <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                SEO Health Overview
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('seo-analyzer')}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                <Search className="h-3.5 w-3.5" />
                <span>Run Scan</span>
              </button>
            </div>

            <div className="mt-5 flex items-center gap-5">
              <ScoreRing score={seoGrowth.healthScore} size={88} />
              <div className="space-y-1">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Average Technical Score
                </div>
                <StatusText
                  label={
                    seoGrowth.healthScore >= 80
                      ? 'Healthy Baseline'
                      : seoGrowth.healthScore >= 55
                      ? 'Needs Optimization'
                      : seoGrowth.healthScore > 0
                      ? 'Critical Issues'
                      : 'Not Scanned Yet'
                  }
                  tone={
                    seoGrowth.healthScore >= 80
                      ? 'success'
                      : seoGrowth.healthScore >= 55
                      ? 'warning'
                      : seoGrowth.healthScore > 0
                      ? 'danger'
                      : 'neutral'
                  }
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {analytics.scopedAudits.length} audit(s) logged across {analytics.scopedWebsites.length} site(s)
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
            <h3 className="mb-3 text-xs font-semibold text-slate-700 dark:text-slate-300">
              Top Traffic Sources
            </h3>
            <HorizontalBarList items={channelBreakdown} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
            <h2 className="font-display text-sm font-semibold">Connected Websites</h2>
            <button
              type="button"
              onClick={() => onNavigate('websites')}
              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Manage All
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Website</th>
                  <th className="px-4 py-2.5 font-medium">Tracking ID</th>
                  <th className="px-4 py-2.5 font-medium text-right">Pages</th>
                  <th className="px-4 py-2.5 font-medium text-right">SEO Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {analytics.scopedWebsites.slice(0, 5).map((site) => (
                  <tr key={site.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{site.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{site.domain}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      {site.trackingId}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {site.pagesScanned}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                      {site.seoScore > 0 ? `${site.seoScore}/100` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
            <h2 className="font-display text-sm font-semibold">Recent Activities</h2>
          </div>
          {recentActivities.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No activities yet. Run an SEO scan or log your first lead.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {recentActivities.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => onNavigate(act.section)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                      {act.title}
                    </p>
                    <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{act.detail}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400 tabular-nums">
                    {act.time ? new Date(act.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Recent'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
