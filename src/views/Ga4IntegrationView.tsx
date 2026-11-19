import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/apiClient';
import { AnalyticsSnapshot, Website } from '../types';

interface Ga4IntegrationViewProps {
  websites: Website[];
  analyticsSnapshots: AnalyticsSnapshot[];
  selectedWebsiteId: string;
  onAddWebsitePrompt: () => void;
}

interface Ga4PropertyOption {
  propertyId: string;
  displayName: string;
  accountName: string;
}

export function Ga4IntegrationView({
  websites,
  analyticsSnapshots,
  selectedWebsiteId,
  onAddWebsitePrompt,
}: Ga4IntegrationViewProps) {
  const { ga4AccessToken, connectGoogleAnalytics4, clearGa4Token } = useAuth();
  const { toast } = useToast();

  const defaultSiteId = selectedWebsiteId !== 'all' ? selectedWebsiteId : websites[0]?.id || '';
  const [targetWebsiteId, setTargetWebsiteId] = useState(defaultSiteId);
  const [properties, setProperties] = useState<Ga4PropertyOption[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [manualPropertyId, setManualPropertyId] = useState('');
  const [days, setDays] = useState<7 | 28 | 90>(28);

  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (selectedWebsiteId !== 'all') {
      setTargetWebsiteId(selectedWebsiteId);
    } else if (!targetWebsiteId && websites[0]) {
      setTargetWebsiteId(websites[0].id);
    }
  }, [selectedWebsiteId, websites, targetWebsiteId]);

  const scopedSnapshots = useMemo(() => {
    const id = selectedWebsiteId !== 'all' ? selectedWebsiteId : targetWebsiteId;
    return analyticsSnapshots.filter((s) => !id || s.websiteId === id);
  }, [analyticsSnapshots, selectedWebsiteId, targetWebsiteId]);

  const latest = scopedSnapshots[0] || null;

  if (websites.length === 0) {
    return (
      <EmptyState
        title="Add a website to connect Google Analytics 4"
        description="Bind your GA4 property to inspect organic sessions, conversion rates, landing page performance, and ecommerce revenue alongside SEO metrics."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  const loadPropertiesWithToken = async (token: string) => {
    const res = await apiFetch<{ properties: Ga4PropertyOption[] }>('/api/ga4/properties', {
      method: 'POST',
      googleAccessToken: token,
    });
    setProperties(res.properties || []);
    if (res.properties?.length && !selectedPropertyId) {
      setSelectedPropertyId(res.properties[0].propertyId);
    }
  };

  const handleConnectOAuth = async () => {
    setErrorMsg(null);
    setConnecting(true);
    try {
      const token = await connectGoogleAnalytics4();
      await loadPropertiesWithToken(token);
      toast({
        title: 'Google Analytics 4 connected',
        description: 'Select your GA4 property below and click Sync GA4 Report.',
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to connect Google Analytics 4 OAuth.';
      setErrorMsg(msg);
      toast({ title: 'GA4 connection failed', description: msg, variant: 'error' });
    } finally {
      setConnecting(false);
    }
  };

  const handleSyncReport = async () => {
    setErrorMsg(null);
    const prop = (manualPropertyId.trim() || selectedPropertyId).trim();
    if (!prop) {
      setErrorMsg('Select a GA4 property or enter a GA4 Property ID (e.g. properties/123456789).');
      return;
    }
    if (!ga4AccessToken) {
      setErrorMsg('Connect Google Analytics 4 OAuth first.');
      return;
    }

    setSyncing(true);
    try {
      const site = websites.find((w) => w.id === targetWebsiteId) || websites[0];
      const snap = await apiFetch<AnalyticsSnapshot>('/api/ga4/report', {
        method: 'POST',
        googleAccessToken: ga4AccessToken,
        body: JSON.stringify({
          websiteId: site.id,
          propertyId: prop,
          days,
        }),
      });
      toast({
        title: 'GA4 snapshot synced',
        description: `${snap.sessions.toLocaleString()} sessions & ${snap.conversions.toLocaleString()} conversions retrieved.`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GA4 sync failed.';
      setErrorMsg(msg);
      toast({ title: 'GA4 sync failed', description: msg, variant: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* OAuth & Property Sync Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-sm font-semibold">Google Analytics 4 Integration</h2>
                <StatusText
                  label={ga4AccessToken ? 'OAuth Connected' : latest ? 'Snapshot Saved · OAuth Disconnected' : 'Not Connected'}
                  tone={ga4AccessToken ? 'success' : latest ? 'info' : 'neutral'}
                />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Read-only OAuth scope (`analytics.readonly`) pulls verified users, organic sessions, landing pages, conversions, and ecommerce revenue directly from Google Analytics Data API v1beta.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {ga4AccessToken ? (
              <button
                type="button"
                onClick={clearGa4Token}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <Unplug className="h-3.5 w-3.5" />
                <span>Disconnect OAuth</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnectOAuth}
                disabled={connecting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                <span>{connecting ? 'Connecting...' : 'Connect Google Analytics 4'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Property Selector Row */}
        <div className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 md:grid-cols-12 dark:border-slate-800">
          <div className="md:col-span-3">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Workspace Website</label>
            <select
              value={targetWebsiteId}
              onChange={(e) => setTargetWebsiteId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
            >
              {websites.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.domain})
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Discovered GA4 Property</label>
            <select
              value={selectedPropertyId}
              onChange={(e) => setSelectedPropertyId(e.target.value)}
              disabled={properties.length === 0}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">
                {properties.length > 0 ? 'Choose GA4 property...' : 'Connect OAuth to list properties'}
              </option>
              {properties.map((p) => (
                <option key={p.propertyId} value={p.propertyId}>
                  {p.displayName} ({p.propertyId})
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Or Property ID</label>
            <input
              type="text"
              value={manualPropertyId}
              onChange={(e) => setManualPropertyId(e.target.value)}
              placeholder="properties/123456789"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Date Window</label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value) as 7 | 28 | 90)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
            >
              <option value={7}>Last 7 Days</option>
              <option value={28}>Last 28 Days</option>
              <option value={90}>Last 90 Days</option>
            </select>
          </div>

          <div className="md:col-span-2 flex items-end">
            <button
              type="button"
              onClick={handleSyncReport}
              disabled={syncing || !ga4AccessToken}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span>{syncing ? 'Syncing...' : 'Sync GA4'}</span>
            </button>
          </div>
        </div>
      </div>

      {errorMsg && <ErrorBanner message={errorMsg} />}

      {!latest ? (
        <EmptyState
          title="No Google Analytics 4 snapshot synced yet"
          description="Connect your Google Analytics 4 OAuth account above, pick your GA4 property, and run a sync to view live organic traffic, conversion events, and landing page revenue."
        />
      ) : (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs text-slate-500">Total / New / Returning Users</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
                {latest.totalUsers.toLocaleString()}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {latest.newUsers.toLocaleString()} new · {latest.returningUsers.toLocaleString()} returning
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs text-slate-500">Organic vs Direct / Referral</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                {latest.organicSessions.toLocaleString()}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Direct: {latest.directSessions.toLocaleString()} · Referral: {latest.referralSessions.toLocaleString()}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs text-slate-500">Goal Conversions</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {latest.conversions.toLocaleString()}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Rate: {latest.conversionRate}% across {latest.sessions.toLocaleString()} sessions
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs text-slate-500">Verified Ecommerce Revenue</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
                {latest.hasVerifiedRevenue ? `$${latest.purchaseRevenue.toLocaleString()}` : 'No Data'}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                <span>{latest.hasVerifiedRevenue ? 'GA4 Ecommerce Verified' : 'No Ecommerce Revenue'}</span>
              </div>
            </div>
          </div>

          {/* Traffic Sources & Landing Pages */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-3.5 flex items-center justify-between dark:border-slate-800">
                <h3 className="font-display text-sm font-semibold">Channel Attribution</h3>
                <span className="font-mono text-[11px] text-slate-500">{latest.propertyId}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/40">
                    <tr>
                      <th className="px-4 py-2 font-medium">Channel</th>
                      <th className="px-4 py-2 font-medium text-right">Sessions</th>
                      <th className="px-4 py-2 font-medium text-right">Conversions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {latest.trafficSources.map((src, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2.5 font-medium">{src.channel}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{src.sessions.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{src.conversions.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-3.5 flex items-center justify-between dark:border-slate-800">
                <h3 className="font-display text-sm font-semibold">Top Landing Pages</h3>
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  GA4 Data API
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/40">
                    <tr>
                      <th className="px-4 py-2 font-medium">Landing Page</th>
                      <th className="px-4 py-2 font-medium text-right">Sessions</th>
                      <th className="px-4 py-2 font-medium text-right">Conv.</th>
                      <th className="px-4 py-2 font-medium text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {latest.topLandingPages.slice(0, 12).map((pg, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2.5 font-mono text-[11px] truncate max-w-xs">{pg.page}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{pg.sessions.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{pg.conversions}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                          {pg.revenue > 0 ? `$${pg.revenue.toLocaleString()}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
