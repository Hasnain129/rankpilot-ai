import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/apiClient';
import { GscSnapshot, TrackedKeyword, Website } from '../types';

interface RankTrackerViewProps {
  websites: Website[];
  trackedKeywords: TrackedKeyword[];
  gscSnapshots: GscSnapshot[];
  selectedWebsiteId: string;
  onAddTrackedKeyword: (input: {
    websiteId: string;
    keyword: string;
    targetUrl?: string;
    country: string;
    language: string;
    device: 'desktop' | 'mobile';
  }) => Promise<string>;
  onDeleteTrackedKeyword: (id: string) => Promise<void>;
  onAddWebsitePrompt: () => void;
}

function sourceLabel(src: TrackedKeyword['sourceType']): {
  label: string;
  tone: 'success' | 'info' | 'warning';
} {
  if (src === 'gsc_verified') return { label: 'Verified GSC', tone: 'success' };
  if (src === 'serp_api') return { label: 'SERP API', tone: 'info' };
  return { label: 'Unretrieved', tone: 'warning' };
}

function RankHistoryChart({ keyword }: { keyword: TrackedKeyword }) {
  const validPoints = (keyword.history || []).filter((p) => p.position > 0);
  if (validPoints.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-slate-500">
        No ranked checkpoints recorded yet. Run &ldquo;Sync Verified Rankings&rdquo; with Google Search Console or SERP API to plot positive positions.
      </div>
    );
  }

  const width = 560;
  const height = 180;
  const padL = 36;
  const padR = 16;
  const padT = 18;
  const padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const validPositions = validPoints.map((p) => p.position);
  const maxPos = Math.max(10, ...validPositions, 20);
  const getX = (i: number) =>
    validPoints.length <= 1 ? padL + innerW / 2 : padL + (i / (validPoints.length - 1)) * innerW;
  // Inverted Y-axis: Rank #1 at top
  const getY = (pos: number) => {
    const clamped = Math.min(maxPos, Math.max(1, pos));
    return padT + ((clamped - 1) / Math.max(1, maxPos - 1)) * innerH;
  };

  const poly = validPoints.map((p, i) => `${getX(i)},${getY(p.position)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full overflow-visible">
      {[1, Math.round(maxPos / 2), maxPos].map((tick) => {
        const y = getY(tick);
        return (
          <g key={tick}>
            <line
              x1={padL}
              y1={y}
              x2={width - padR}
              y2={y}
              stroke="currentColor"
              className="text-slate-200 dark:text-slate-800"
            />
            <text
              x={padL - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-slate-400 font-mono text-[10px]"
            >
              #{tick}
            </text>
          </g>
        );
      })}
      {validPoints.length > 1 && (
        <polyline
          fill="none"
          stroke="#4f46e5"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={poly}
        />
      )}
      {validPoints.map((p, i) => (
        <g key={p.date + i}>
          <circle
            cx={getX(i)}
            cy={getY(p.position)}
            r={3.5}
            className="fill-indigo-600 stroke-white dark:fill-indigo-400 dark:stroke-slate-900"
            strokeWidth="1.5"
          />
          <text
            x={getX(i)}
            y={height - 6}
            textAnchor="middle"
            className="fill-slate-400 font-mono text-[10px]"
          >
            {p.date.slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function RankTrackerView({
  websites,
  trackedKeywords,
  gscSnapshots,
  selectedWebsiteId,
  onAddTrackedKeyword,
  onDeleteTrackedKeyword,
  onAddWebsitePrompt,
}: RankTrackerViewProps) {
  const { gscAccessToken } = useAuth();
  const { toast } = useToast();

  const activeSite =
    (selectedWebsiteId !== 'all' ? websites.find((w) => w.id === selectedWebsiteId) : websites[0]) ||
    null;

  const [keyword, setKeyword] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [country, setCountry] = useState('US');
  const [language, setLanguage] = useState('en');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKwId, setSelectedKwId] = useState<string>('');

  const scopedKeywords = useMemo(() => {
    if (!activeSite) return [];
    return trackedKeywords.filter((k) => k.websiteId === activeSite.id);
  }, [trackedKeywords, activeSite]);

  const latestGscProp = useMemo(() => {
    if (!activeSite) return '';
    return gscSnapshots.find((s) => s.websiteId === activeSite.id)?.propertyUrl || '';
  }, [gscSnapshots, activeSite]);

  const selectedKw =
    scopedKeywords.find((k) => k.id === selectedKwId) || scopedKeywords[0] || null;

  if (!activeSite) {
    return (
      <EmptyState
        title="Add a website to start tracking rankings"
        description="Track verified Google Search Console positions or authorized SERP API rankings across desktop, mobile, country, and language targets."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) return;
    setAdding(true);
    try {
      const id = await onAddTrackedKeyword({
        websiteId: activeSite.id,
        keyword: keyword.trim(),
        targetUrl: targetUrl.trim() || activeSite.url,
        country,
        language,
        device,
      });
      setKeyword('');
      setTargetUrl('');
      setSelectedKwId(id);
      toast({ title: 'Keyword added to tracker', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Failed to add keyword',
        description: err instanceof Error ? err.message : 'Unable to save keyword.',
        variant: 'error',
      });
    } finally {
      setAdding(false);
    }
  };

  const handleSyncRankings = async () => {
    setError(null);
    if (scopedKeywords.length === 0) return;
    setSyncing(true);
    try {
      const data = await apiFetch<{ updated?: Array<{ id: string }> }>('/api/rank-tracker/check', {
        method: 'POST',
        googleAccessToken: gscAccessToken || undefined,
        body: JSON.stringify({
          websiteId: activeSite.id,
          keywordIds: scopedKeywords.slice(0, 20).map((k) => k.id),
          gscPropertyUrl: latestGscProp || activeSite.url,
        }),
      });
      toast({
        title: `Updated ${data.updated?.length || 0} tracked keyword(s)`,
        description: 'Ranking checkpoints saved to Firestore.',
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to check rankings.';
      setError(msg);
      toast({ title: 'Rank sync failed', description: msg, variant: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const ranked = scopedKeywords.filter((k) => k.currentPosition > 0);
  const avgPos =
    ranked.length > 0
      ? ranked.reduce((s, k) => s + k.currentPosition, 0) / ranked.length
      : 0;
  const gainersCount = scopedKeywords.filter(
    (k) => k.previousPosition > 0 && k.currentPosition > 0 && k.previousPosition > k.currentPosition
  ).length;
  const losersCount = scopedKeywords.filter(
    (k) => k.previousPosition > 0 && k.currentPosition > 0 && k.currentPosition > k.previousPosition
  ).length;

  return (
    <div className="space-y-6">
      {/* Honesty Notice */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <div>
            <strong>Verified Sources Only:</strong> Rank Tracker queries Google Search Console (`webmasters.readonly`) or a server-configured `SERP_API_KEY` (Serper / SerpApi). RankPilot never scrapes Google HTML or invents placeholder positions.
          </div>
        </div>
        <button
          type="button"
          onClick={handleSyncRankings}
          disabled={syncing || scopedKeywords.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          <span>{syncing ? 'Checking Positions...' : 'Sync Verified Rankings'}</span>
        </button>
      </div>

      {/* Add Keyword Form */}
      <form
        onSubmit={handleAdd}
        className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Keyword to Track</label>
            <input
              type="text"
              required
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. titanium gravel frame"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Target URL (optional)</label>
            <input
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder={activeSite.url}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="md:col-span-1">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Country</label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              {['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'IN'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-1">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Lang</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              {['en', 'de', 'fr', 'es'].map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-1">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Device</label>
            <select
              value={device}
              onChange={(e) => setDevice(e.target.value as 'desktop' | 'mobile')}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>
          </div>
          <div className="md:col-span-2 flex items-end">
            <button
              type="submit"
              disabled={adding}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{adding ? 'Adding...' : 'Track Keyword'}</span>
            </button>
          </div>
        </div>
      </form>

      {error && <ErrorBanner message={error} />}

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500">Tracked Keywords</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{scopedKeywords.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500">Ranked Keywords</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{ranked.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500">Average Rank Position</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
            {avgPos > 0 ? `#${avgPos.toFixed(1)}` : '—'}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500">Movers (Gainers / Losers)</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">+{gainersCount}</span>
            <span className="mx-1 text-slate-400">/</span>
            <span className="text-red-600 dark:text-red-400">-{losersCount}</span>
          </div>
        </div>
      </div>

      {scopedKeywords.length === 0 ? (
        <EmptyState
          title="No tracked keywords for this website yet"
          description="Add target keywords above or promote search queries directly from Keyword Research or Google Search Console."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Keyword</th>
                    <th className="px-4 py-2.5 font-medium">Locale / Device</th>
                    <th className="px-4 py-2.5 font-medium">Source</th>
                    <th className="px-4 py-2.5 font-medium text-right">Position</th>
                    <th className="px-4 py-2.5 font-medium text-right">Best</th>
                    <th className="px-4 py-2.5 font-medium text-right">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {scopedKeywords.map((kw) => {
                    const src = sourceLabel(kw.sourceType);
                    const delta =
                      kw.previousPosition > 0 && kw.currentPosition > 0
                        ? kw.previousPosition - kw.currentPosition
                        : 0;
                    const active = selectedKw?.id === kw.id;

                    return (
                      <tr
                        key={kw.id}
                        onClick={() => setSelectedKwId(kw.id)}
                        className={`cursor-pointer ${
                          active
                            ? 'bg-indigo-50/70 dark:bg-indigo-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 dark:text-slate-100">{kw.keyword}</div>
                          {kw.targetUrl && (
                            <div className="truncate max-w-[210px] font-mono text-[11px] text-slate-500">
                              {kw.targetUrl}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                          {kw.country}/{kw.language} · {kw.device}
                        </td>
                        <td className="px-4 py-3">
                          <StatusText label={src.label} tone={src.tone} />
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          <span
                            className="font-semibold"
                            title={
                              kw.currentPosition > 0
                                ? `Rank #${kw.currentPosition.toFixed(1)}`
                                : 'Not ranked in top 50 or not synced yet'
                            }
                          >
                            {kw.currentPosition > 0
                              ? `#${kw.currentPosition.toFixed(1)}`
                              : kw.sourceType === 'unverified'
                              ? 'Unretrieved'
                              : 'Not Ranked'}
                          </span>
                          {delta !== 0 && (
                            <span
                              className={`ml-1.5 inline-flex items-center text-[11px] ${
                                delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {delta > 0 ? (
                                <ArrowUpRight className="h-3 w-3" />
                              ) : (
                                <ArrowDownRight className="h-3 w-3" />
                              )}
                              {Math.abs(delta).toFixed(1)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-500">
                          {kw.bestPosition > 0 ? `#${kw.bestPosition.toFixed(1)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await onDeleteTrackedKeyword(kw.id);
                              toast({ title: 'Keyword removed', variant: 'info' });
                            }}
                            className="rounded p-1 text-slate-400 hover:text-red-600"
                            aria-label="Delete keyword"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <h3 className="font-display text-sm font-semibold truncate">
                {selectedKw ? selectedKw.keyword : 'Position History'}
              </h3>
            </div>
            {selectedKw && (
              <>
                <div className="text-xs text-slate-500">
                  {selectedKw.clicks > 0 || selectedKw.impressions > 0 ? (
                    <span className="font-mono tabular-nums">
                      GSC 14d: {selectedKw.clicks} clicks · {selectedKw.impressions.toLocaleString()} impressions
                    </span>
                  ) : (
                    <span>Position checkpoint trajectory (#1 at top)</span>
                  )}
                </div>
                <RankHistoryChart keyword={selectedKw} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
