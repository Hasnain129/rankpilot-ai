import React, { useMemo, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  Printer,
} from 'lucide-react';
import { EmptyState, StatusText } from '../components/ui/DataState';
import {
  AiSeoRecommendation,
  AnalyticsSnapshot,
  GscSnapshot,
  SeoAudit,
  SiteCrawl,
  TechnicalSnapshot,
  TrackedKeyword,
  Website,
} from '../types';

interface SeoReportsViewProps {
  websites: Website[];
  seoAudits: SeoAudit[];
  siteCrawls: SiteCrawl[];
  gscSnapshots: GscSnapshot[];
  analyticsSnapshots: AnalyticsSnapshot[];
  trackedKeywords: TrackedKeyword[];
  technicalSnapshots: TechnicalSnapshot[];
  seoRecommendations: AiSeoRecommendation[];
  selectedWebsiteId: string;
  onAddWebsitePrompt: () => void;
}

export function SeoReportsView({
  websites,
  seoAudits,
  siteCrawls,
  gscSnapshots,
  analyticsSnapshots,
  trackedKeywords,
  technicalSnapshots,
  seoRecommendations,
  selectedWebsiteId,
  onAddWebsitePrompt,
}: SeoReportsViewProps) {
  const [reportSiteId, setReportSiteId] = useState<string>(
    selectedWebsiteId !== 'all' ? selectedWebsiteId : websites[0]?.id || 'all'
  );

  const scopedSites = useMemo(
    () => (reportSiteId === 'all' ? websites : websites.filter((w) => w.id === reportSiteId)),
    [websites, reportSiteId]
  );

  const bySite = <T extends { websiteId?: string }>(arr: T[]) =>
    reportSiteId === 'all' ? arr : arr.filter((x) => x.websiteId === reportSiteId);

  const latestCrawl = bySite(siteCrawls)[0] || null;
  const latestAudit = bySite(seoAudits)[0] || null;
  const latestGsc = bySite(gscSnapshots)[0] || null;
  const latestGa4 = bySite(analyticsSnapshots)[0] || null;
  const latestTech = bySite(technicalSnapshots)[0] || null;
  const scopedKeywords = bySite(trackedKeywords);
  const scopedRecs = bySite(seoRecommendations);

  if (websites.length === 0) {
    return (
      <EmptyState
        title="Add a website to generate SEO Reports"
        description="Once you add websites and run audits, Search Console syncs, or PageSpeed checks, export unified CSV, JSON, and PDF executive reports here."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  const reportPayload = {
    generatedAt: new Date().toISOString(),
    scope:
      reportSiteId === 'all'
        ? `All Websites (${scopedSites.length})`
        : scopedSites[0]?.domain || reportSiteId,
    seoHealth: {
      latestCrawlScore: latestCrawl ? latestCrawl.overallScore : null,
      latestSingleAuditScore: latestAudit ? latestAudit.score : null,
      pagesCrawled: latestCrawl ? latestCrawl.pagesCrawled : 0,
      brokenLinks: latestCrawl?.brokenLinksCount ?? latestAudit?.brokenLinksCount ?? 0,
      duplicateTitles: latestCrawl?.duplicateTitlesCount ?? null,
    },
    googleSearchConsole: latestGsc
      ? {
          status: 'Connected / Verified',
          propertyUrl: latestGsc.propertyUrl,
          dateRange: `${latestGsc.dateRangeStart} to ${latestGsc.dateRangeEnd}`,
          clicks: latestGsc.totalClicks,
          impressions: latestGsc.totalImpressions,
          avgCtr: latestGsc.avgCtr,
          avgPosition: latestGsc.avgPosition,
          topQueries: latestGsc.topQueries.slice(0, 10),
        }
      : { status: 'Not Connected', clicks: null, impressions: null },
    googleAnalytics4: latestGa4
      ? {
          status: 'Connected / Verified',
          propertyId: latestGa4.propertyId,
          dateRange: `${latestGa4.dateRangeStart} to ${latestGa4.dateRangeEnd}`,
          totalUsers: latestGa4.totalUsers,
          sessions: latestGa4.sessions,
          organicSessions: latestGa4.organicSessions,
          conversions: latestGa4.conversions,
          purchaseRevenue: latestGa4.hasVerifiedRevenue ? latestGa4.purchaseRevenue : null,
        }
      : { status: 'Not Connected', sessions: null },
    rankTracking: {
      totalKeywords: scopedKeywords.length,
      keywords: scopedKeywords.map((k) => ({
        keyword: k.keyword,
        currentPosition: k.currentPosition || null,
        previousPosition: k.previousPosition || null,
        sourceType: k.sourceType,
      })),
    },
    technicalPerformance: latestTech
      ? {
          strategy: latestTech.strategy,
          performanceScore: latestTech.performanceScore,
          seoScore: latestTech.seoScore,
          lcpMs: latestTech.lcpMs,
          cls: latestTech.cls,
          inpMs: latestTech.inpMs,
        }
      : { status: 'Not Measured' },
    openRecommendationsCount: scopedRecs.filter((r) => r.status === 'open').length,
    recommendations: scopedRecs.slice(0, 15).map((r) => ({
      priority: r.priority,
      category: r.category,
      status: r.status,
      affectedPage: r.affectedPage,
      whatIsWrong: r.whatIsWrong,
      howToFix: r.howToFix,
    })),
  };

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(reportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rankpilot-seo-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const rows: string[][] = [
      ['Section', 'Metric / Item', 'Value', 'Source / Status'],
      [
        'SEO Health',
        'Crawl Score',
        latestCrawl ? `${latestCrawl.overallScore}/100` : 'No Data',
        latestCrawl ? 'Verified Live Crawl' : 'Unavailable',
      ],
      [
        'SEO Health',
        'Latest Page Audit Score',
        latestAudit ? `${latestAudit.score}/100` : 'No Data',
        latestAudit ? 'Verified Live Audit' : 'Unavailable',
      ],
      [
        'Google Search Console',
        'Clicks / Impressions',
        latestGsc ? `${latestGsc.totalClicks} / ${latestGsc.totalImpressions}` : 'Not Connected',
        latestGsc ? latestGsc.propertyUrl : 'Connect GSC OAuth',
      ],
      [
        'Google Search Console',
        'Avg CTR / Position',
        latestGsc ? `${latestGsc.avgCtr}% / ${latestGsc.avgPosition}` : 'Not Connected',
        latestGsc ? 'GSC Verified' : 'Unavailable',
      ],
      [
        'Google Analytics 4',
        'Users / Organic Sessions / Conversions',
        latestGa4
          ? `${latestGa4.totalUsers} / ${latestGa4.organicSessions} / ${latestGa4.conversions}`
          : 'Not Connected',
        latestGa4 ? latestGa4.propertyId : 'Connect GA4 OAuth',
      ],
      [
        'Technical SEO',
        'PageSpeed / LCP / CLS',
        latestTech
          ? `${latestTech.performanceScore}/100 | ${(latestTech.lcpMs / 1000).toFixed(2)}s | ${latestTech.cls}`
          : 'Not Checked',
        latestTech ? latestTech.strategy : 'Run PageSpeed Audit',
      ],
    ];
    scopedKeywords.forEach((kw) => {
      rows.push([
        'Rank Tracker',
        kw.keyword,
        kw.currentPosition > 0 ? `#${kw.currentPosition}` : 'Unretrieved',
        kw.sourceType,
      ]);
    });
    scopedRecs.slice(0, 20).forEach((rec) => {
      rows.push(['AI Recommendation', `${rec.priority} - ${rec.whatIsWrong}`, rec.status, rec.affectedPage]);
    });

    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rankpilot-seo-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Export Controls (hidden on print) */}
      <div className="no-print rounded-xl border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={reportSiteId}
            onChange={(e) => setReportSiteId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="all">All Websites ({websites.length})</option>
            {websites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.domain})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export JSON</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Print / Save PDF</span>
          </button>
        </div>
      </div>

      {/* Printable Report Canvas */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h2 className="font-display text-lg font-bold">
              RankPilot AI — Organic SEO Performance Report
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Scope: <strong>{reportPayload.scope}</strong> · Generated{' '}
              {new Date().toLocaleDateString()}
            </p>
          </div>
          <StatusText label="Verified Telemetry & Honest Unconnected Flags" tone="info" />
        </div>

        {/* Summary Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="text-xs text-slate-500">Site SEO Health Score</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {latestCrawl ? `${latestCrawl.overallScore}/100` : latestAudit ? `${latestAudit.score}/100` : '—'}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {latestCrawl ? `${latestCrawl.pagesCrawled} pages crawled` : latestAudit ? 'Homepage audited' : 'Run Website Audit'}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="text-xs text-slate-500">Google Search Clicks (GSC)</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {latestGsc ? latestGsc.totalClicks.toLocaleString() : '—'}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {latestGsc
                ? `${latestGsc.totalImpressions.toLocaleString()} impr · Avg Pos ${latestGsc.avgPosition}`
                : 'Search Console not connected'}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="text-xs text-slate-500">Organic Sessions (GA4)</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {latestGa4 ? latestGa4.organicSessions.toLocaleString() : '—'}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {latestGa4
                ? `${latestGa4.conversions} conversions (${latestGa4.conversionRate}%)`
                : 'GA4 not connected'}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="text-xs text-slate-500">PageSpeed / CWV Score</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {latestTech ? `${latestTech.performanceScore}/100` : '—'}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {latestTech
                ? `LCP ${(latestTech.lcpMs / 1000).toFixed(2)}s · CLS ${latestTech.cls}`
                : 'Run Technical SEO Audit'}
            </div>
          </div>
        </div>

        {/* Ranking Summary */}
        <div>
          <h3 className="font-display text-sm font-semibold mb-3">
            Tracked Keyword Rankings ({scopedKeywords.length})
          </h3>
          {scopedKeywords.length === 0 ? (
            <p className="text-xs text-slate-500">No tracked keywords in this scope.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/40">
                  <tr>
                    <th className="px-4 py-2 font-medium">Keyword</th>
                    <th className="px-4 py-2 font-medium">Position</th>
                    <th className="px-4 py-2 font-medium">Previous</th>
                    <th className="px-4 py-2 font-medium">Data Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {scopedKeywords.slice(0, 15).map((kw) => (
                    <tr key={kw.id}>
                      <td className="px-4 py-2 font-medium">{kw.keyword}</td>
                      <td className="px-4 py-2 font-mono">
                        {kw.currentPosition > 0 ? `#${kw.currentPosition}` : 'Unretrieved'}
                      </td>
                      <td className="px-4 py-2 font-mono">
                        {kw.previousPosition > 0 ? `#${kw.previousPosition}` : '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-500">{kw.sourceType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recommendations Summary */}
        <div>
          <h3 className="font-display text-sm font-semibold mb-3">
            Prioritized SEO Recommendations ({scopedRecs.length})
          </h3>
          {scopedRecs.length === 0 ? (
            <p className="text-xs text-slate-500">
              No AI SEO recommendations saved yet. Generate actions inside AI SEO Recommendations.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/40">
                  <tr>
                    <th className="px-4 py-2 font-medium">Priority</th>
                    <th className="px-4 py-2 font-medium">Affected Page</th>
                    <th className="px-4 py-2 font-medium">Issue &amp; Remediation</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {scopedRecs.slice(0, 15).map((rec) => (
                    <tr key={rec.id}>
                      <td className="px-4 py-2 font-medium">{rec.priority}</td>
                      <td className="px-4 py-2 font-mono text-[11px]">{rec.affectedPage}</td>
                      <td className="px-4 py-2">
                        <div className="font-medium">{rec.whatIsWrong}</div>
                        <div className="text-slate-500 mt-0.5">{rec.howToFix}</div>
                      </td>
                      <td className="px-4 py-2 uppercase font-mono text-[11px]">{rec.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
