import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  Wand2,
} from 'lucide-react';
import { DualTrendChart } from '../components/charts/AnalyticsCharts';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/apiClient';
import { GscSnapshot, Website } from '../types';

interface SearchConsoleViewProps {
  websites: Website[];
  gscSnapshots: GscSnapshot[];
  selectedWebsiteId: string;
  onAddWebsitePrompt: () => void;
  onOptimizeUrl: (url: string, websiteId: string, query?: string) => void;
  onTrackKeyword: (keyword: string, url: string, websiteId: string) => Promise<void>;
}

interface GscSiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

interface UrlInspectionResult {
  verdict: string;
  coverageState: string;
  indexingState: string;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
}

export function SearchConsoleView({
  websites,
  gscSnapshots,
  selectedWebsiteId,
  onAddWebsitePrompt,
  onOptimizeUrl,
  onTrackKeyword,
}: SearchConsoleViewProps) {
  const { gscAccessToken, connectGoogleSearchConsole, clearGscToken } = useAuth();
  const { toast } = useToast();

  const activeSite =
    (selectedWebsiteId !== 'all' ? websites.find((w) => w.id === selectedWebsiteId) : websites[0]) ||
    null;

  const [connectingOauth, setConnectingOauth] = useState(false);
  const [gscSites, setGscSites] = useState<GscSiteEntry[]>([]);
  const [selectedProperty, setSelectedProperty] = useState('');
  const [days, setDays] = useState<7 | 28 | 90>(28);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableTab, setTableTab] = useState<'queries' | 'opportunities' | 'pages' | 'countries' | 'devices'>('queries');

  // URL Indexing Inspection
  const [inspectUrl, setInspectUrl] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [inspectionResult, setInspectionResult] = useState<UrlInspectionResult | null>(null);

  const scopedSnapshots = useMemo(() => {
    if (!activeSite) return [];
    return gscSnapshots.filter((s) => s.websiteId === activeSite.id);
  }, [gscSnapshots, activeSite]);

  const latestSnapshot = scopedSnapshots[0] || null;

  useEffect(() => {
    if (latestSnapshot?.propertyUrl && !selectedProperty) {
      setSelectedProperty(latestSnapshot.propertyUrl);
    }
    if (activeSite?.url && !inspectUrl) {
      setInspectUrl(activeSite.url);
    }
  }, [latestSnapshot, activeSite, selectedProperty, inspectUrl]);

  // Auto-load verified Search Console properties when OAuth token is present
  useEffect(() => {
    if (!gscAccessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<{ siteEntry?: GscSiteEntry[] }>('/api/gsc/sites', {
          method: 'POST',
          googleAccessToken: gscAccessToken,
        });
        if (!cancelled && Array.isArray(data.siteEntry)) {
          setGscSites(data.siteEntry);
          if (data.siteEntry[0]?.siteUrl) {
            const domainMatch = activeSite
              ? data.siteEntry.find((s: GscSiteEntry) =>
                  s.siteUrl.toLowerCase().includes(activeSite.domain.toLowerCase())
                )
              : undefined;
            setSelectedProperty((prev) => prev || domainMatch?.siteUrl || data.siteEntry![0].siteUrl);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.toLowerCase().includes('401')) {
          clearGscToken();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gscAccessToken, activeSite, clearGscToken]);

  if (!activeSite) {
    return (
      <EmptyState
        title="Add a website to connect Google Search Console"
        description="Link your Search Console verified property via Google OAuth to import clicks, impressions, CTR, average position, and URL indexing telemetry."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  const handleConnectGoogle = async () => {
    setError(null);
    setConnectingOauth(true);
    try {
      await connectGoogleSearchConsole();
      toast({
        title: 'Google Search Console authorized',
        description: 'Select a verified Search Console property below and click Sync.',
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google OAuth sign-in failed.';
      setError(msg);
      toast({ title: 'OAuth connection failed', description: msg, variant: 'error' });
    } finally {
      setConnectingOauth(false);
    }
  };

  const handleSyncPerformance = async () => {
    setError(null);
    if (!gscAccessToken) {
      setError('Authorize Google Search Console OAuth first.');
      return;
    }
    if (!selectedProperty) {
      setError('Select or enter a verified Search Console property URL.');
      return;
    }
    setSyncing(true);
    try {
      const data = await apiFetch<{
        totalClicks: number;
        totalImpressions: number;
        dateRangeStart: string;
        dateRangeEnd: string;
      }>('/api/gsc/performance', {
        method: 'POST',
        googleAccessToken: gscAccessToken,
        body: JSON.stringify({
          websiteId: activeSite.id,
          propertyUrl: selectedProperty.trim(),
          days,
        }),
      });
      toast({
        title: 'Search Console data synced',
        description: `${data.totalClicks.toLocaleString()} clicks · ${data.totalImpressions.toLocaleString()} impressions (${data.dateRangeStart} → ${data.dateRangeEnd})`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GSC sync error.';
      if (msg.toLowerCase().includes('401') || msg.toLowerCase().includes('invalid credentials')) {
        clearGscToken();
      }
      setError(msg);
      toast({ title: 'Sync failed', description: msg, variant: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const handleInspectUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gscAccessToken || !selectedProperty || !inspectUrl.trim()) return;
    setInspecting(true);
    setError(null);
    try {
      const data = await apiFetch<UrlInspectionResult>('/api/gsc/inspect', {
        method: 'POST',
        googleAccessToken: gscAccessToken,
        body: JSON.stringify({
          inspectionUrl: inspectUrl.trim(),
          siteUrl: selectedProperty.trim(),
        }),
      });
      setInspectionResult(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'URL inspection failed.';
      setError(msg);
      toast({ title: 'Inspection failed', description: msg, variant: 'error' });
    } finally {
      setInspecting(false);
    }
  };

  // Opportunities: ranking positions 4 to 20 with impressions > 0 & low CTR (< 4%)
  const lowCtrOpportunities = useMemo(() => {
    if (!latestSnapshot) return [];
    return latestSnapshot.topQueries
      .filter((q) => q.position >= 3.5 && q.position <= 25 && q.impressions >= 20)
      .sort((a, b) => b.impressions - a.impressions);
  }, [latestSnapshot]);

  const clicksDeltaPct =
    latestSnapshot && latestSnapshot.prevClicks > 0
      ? ((latestSnapshot.totalClicks - latestSnapshot.prevClicks) / latestSnapshot.prevClicks) * 100
      : null;

  const imprDeltaPct =
    latestSnapshot && latestSnapshot.prevImpressions > 0
      ? ((latestSnapshot.totalImpressions - latestSnapshot.prevImpressions) / latestSnapshot.prevImpressions) * 100
      : null;

  return (
    <div className="space-y-6">
      {/* OAuth & Property Sync Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold">
              Google Search Console OAuth ({activeSite.domain})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              100% live Google Search Console API data (`webmasters.readonly`). RankPilot never displays synthetic search performance metrics.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusText
              label={gscAccessToken ? 'Google OAuth Connected' : 'OAuth Not Authorized'}
              tone={gscAccessToken ? 'success' : 'neutral'}
            />
            <button
              type="button"
              onClick={handleConnectGoogle}
              disabled={connectingOauth}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {connectingOauth ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              <span>{gscAccessToken ? 'Re-authorize Google' : 'Connect Google Search Console'}</span>
            </button>
          </div>
        </div>

        {gscAccessToken && (
          <div className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 md:grid-cols-12 dark:border-slate-800">
            <div className="md:col-span-6">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                Verified Search Console Property
              </label>
              {gscSites.length > 0 ? (
                <select
                  value={selectedProperty}
                  onChange={(e) => setSelectedProperty(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                >
                  {gscSites.map((s) => (
                    <option key={s.siteUrl} value={s.siteUrl}>
                      {s.siteUrl} ({s.permissionLevel})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={selectedProperty}
                  onChange={(e) => setSelectedProperty(e.target.value)}
                  placeholder="sc-domain:example.com or https://example.com/"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                />
              )}
            </div>

            <div className="md:col-span-3">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Comparison Window</label>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value) as 7 | 28 | 90)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              >
                <option value={7}>Last 7 Days vs Prev 7d</option>
                <option value={28}>Last 28 Days vs Prev 28d</option>
                <option value={90}>Last 90 Days vs Prev 90d</option>
              </select>
            </div>

            <div className="md:col-span-3 flex items-end">
              <button
                type="button"
                onClick={handleSyncPerformance}
                disabled={syncing}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-600 bg-indigo-50 px-4 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-950/50 dark:text-indigo-300"
              >
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                <span>{syncing ? 'Syncing GSC...' : 'Sync Search Console'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {!latestSnapshot ? (
        <EmptyState
          title="No Google Search Console snapshot synced yet"
          description="Authorize your Google account via the button above, choose a verified Search Console property, and click Sync Search Console to inspect real impressions, clicks, CTR, and page rankings."
        />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs font-medium text-slate-500">Organic Clicks</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
                {latestSnapshot.totalClicks.toLocaleString()}
              </div>
              {clicksDeltaPct !== null && (
                <div className={`mt-1 inline-flex items-center gap-1 text-[11px] font-mono ${clicksDeltaPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {clicksDeltaPct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  <span>{clicksDeltaPct >= 0 ? '+' : ''}{clicksDeltaPct.toFixed(1)}% vs prior period</span>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs font-medium text-slate-500">Impressions</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
                {latestSnapshot.totalImpressions.toLocaleString()}
              </div>
              {imprDeltaPct !== null && (
                <div className={`mt-1 inline-flex items-center gap-1 text-[11px] font-mono ${imprDeltaPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {imprDeltaPct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  <span>{imprDeltaPct >= 0 ? '+' : ''}{imprDeltaPct.toFixed(1)}% vs prior period</span>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs font-medium text-slate-500">Average CTR</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
                {latestSnapshot.avgCtr.toFixed(2)}%
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {latestSnapshot.dateRangeStart} → {latestSnapshot.dateRangeEnd}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs font-medium text-slate-500">Average Position</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
                #{latestSnapshot.avgPosition.toFixed(1)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 truncate font-mono">
                {latestSnapshot.propertyUrl}
              </div>
            </div>
          </div>

          {/* Trend Chart + URL Inspection */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold">Clicks &amp; Impressions Trend</h3>
                <span className="font-mono text-[11px] text-slate-500">
                  {latestSnapshot.dailySeries.length} days
                </span>
              </div>
              <DualTrendChart
                data={latestSnapshot.dailySeries.slice(-14).map((d) => ({
                  label: d.date.slice(5),
                  primary: d.clicks,
                  secondary: d.impressions,
                }))}
                primaryLabel="Clicks"
                secondaryLabel="Impressions"
                formatSecondary={(n) => n.toLocaleString()}
              />
            </div>

            <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-display text-sm font-semibold">Live URL Index Inspection</h3>
              </div>
              <form onSubmit={handleInspectUrl} className="space-y-2.5">
                <input
                  type="url"
                  required
                  value={inspectUrl}
                  onChange={(e) => setInspectUrl(e.target.value)}
                  placeholder="https://example.com/product"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                />
                <button
                  type="submit"
                  disabled={inspecting || !gscAccessToken}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                >
                  {inspecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  <span>{inspecting ? 'Inspecting Google Index...' : 'Check Google Indexing'}</span>
                </button>
              </form>

              {inspectionResult && (
                <div className="rounded-lg bg-slate-50 p-3 space-y-1.5 text-xs dark:bg-slate-800/60">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Verdict</span>
                    <StatusText
                      label={inspectionResult.verdict}
                      tone={inspectionResult.verdict === 'PASS' ? 'success' : 'warning'}
                    />
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Coverage</span>
                    <span className="text-right font-medium">{inspectionResult.coverageState}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Indexing</span>
                    <span className="text-right">{inspectionResult.indexingState}</span>
                  </div>
                  {inspectionResult.lastCrawlTime && (
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Last Crawl</span>
                      <span className="font-mono text-[11px]">{inspectionResult.lastCrawlTime.slice(0, 10)}</span>
                    </div>
                  )}
                  {inspectionResult.googleCanonical && (
                    <div className="pt-1 border-t border-slate-200 dark:border-slate-700">
                      <div className="text-[11px] text-slate-500">Google Canonical</div>
                      <div className="truncate font-mono text-[11px]">{inspectionResult.googleCanonical}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Search Queries / Opportunities / Pages Table */}
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-display text-sm font-semibold">Search Performance Breakdown</h3>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'queries', label: `Top Queries (${latestSnapshot.topQueries.length})` },
                  { id: 'opportunities', label: `Opportunities (${lowCtrOpportunities.length})` },
                  { id: 'pages', label: `Pages (${latestSnapshot.topPages.length})` },
                  { id: 'countries', label: `Countries (${latestSnapshot.topCountries?.length || 0})` },
                  { id: 'devices', label: `Devices (${latestSnapshot.topDevices?.length || 0})` },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTableTab(t.id as 'queries' | 'opportunities' | 'pages' | 'countries' | 'devices')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                      tableTab === t.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {tableTab === 'countries' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Country</th>
                      <th className="px-4 py-2.5 font-medium text-right">Clicks</th>
                      <th className="px-4 py-2.5 font-medium text-right">Impressions</th>
                      <th className="px-4 py-2.5 font-medium text-right">CTR</th>
                      <th className="px-4 py-2.5 font-medium text-right">Avg Position</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {(latestSnapshot.topCountries || []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                          Re-sync Search Console above to pull country-level breakdowns.
                        </td>
                      </tr>
                    ) : (
                      (latestSnapshot.topCountries || []).map((row) => (
                        <tr key={row.country} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 font-medium font-mono">{row.country}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{row.clicks.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{row.impressions.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{row.ctr.toFixed(2)}%</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                            #{row.position.toFixed(1)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : tableTab === 'devices' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Device</th>
                      <th className="px-4 py-2.5 font-medium text-right">Clicks</th>
                      <th className="px-4 py-2.5 font-medium text-right">Impressions</th>
                      <th className="px-4 py-2.5 font-medium text-right">CTR</th>
                      <th className="px-4 py-2.5 font-medium text-right">Avg Position</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {(latestSnapshot.topDevices || []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                          Re-sync Search Console above to pull Desktop / Mobile / Tablet breakdowns.
                        </td>
                      </tr>
                    ) : (
                      (latestSnapshot.topDevices || []).map((row) => (
                        <tr key={row.device} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 font-medium font-mono">{row.device}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{row.clicks.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{row.impressions.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{row.ctr.toFixed(2)}%</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                            #{row.position.toFixed(1)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : tableTab !== 'pages' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Search Query</th>
                      <th className="px-4 py-2.5 font-medium text-right">Clicks</th>
                      <th className="px-4 py-2.5 font-medium text-right">Impressions</th>
                      <th className="px-4 py-2.5 font-medium text-right">CTR</th>
                      <th className="px-4 py-2.5 font-medium text-right">Avg Position</th>
                      <th className="px-4 py-2.5 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {(tableTab === 'queries' ? latestSnapshot.topQueries : lowCtrOpportunities).map((row) => (
                      <tr key={row.query} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{row.query}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{row.clicks.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{row.impressions.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{row.ctr.toFixed(2)}%</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                          #{row.position.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => onTrackKeyword(row.query, activeSite.url, activeSite.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                          >
                            <TrendingUp className="h-3 w-3" />
                            <span>Track</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Page URL</th>
                      <th className="px-4 py-2.5 font-medium text-right">Clicks</th>
                      <th className="px-4 py-2.5 font-medium text-right">Impressions</th>
                      <th className="px-4 py-2.5 font-medium text-right">CTR</th>
                      <th className="px-4 py-2.5 font-medium text-right">Position (Delta)</th>
                      <th className="px-4 py-2.5 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {latestSnapshot.topPages.map((row) => {
                      const delta = row.positionDelta || 0;
                      return (
                        <tr key={row.page} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 max-w-sm truncate font-mono text-[11px] text-slate-800 dark:text-slate-200">
                            {row.page}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{row.clicks.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{row.impressions.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{row.ctr.toFixed(2)}%</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">
                            <span className="font-semibold">#{row.position.toFixed(1)}</span>
                            {delta !== 0 && (
                              <span
                                className={`ml-1.5 text-[11px] ${
                                  delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                                }`}
                              >
                                ({delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => onOptimizeUrl(row.page, activeSite.id)}
                              className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300"
                            >
                              <Wand2 className="h-3 w-3" />
                              <span>Optimize</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
