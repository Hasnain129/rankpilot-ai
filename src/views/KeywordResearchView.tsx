import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Info,
  Loader2,
  MapPin,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/apiClient';
import {
  KeywordMappingResult,
  KeywordProject,
  SiteCrawl,
  Website,
  WpEntity,
} from '../types';

interface KeywordResearchViewProps {
  websites: Website[];
  keywordProjects: KeywordProject[];
  siteCrawls: SiteCrawl[];
  wpEntities: WpEntity[];
  selectedWebsiteId: string;
  onSaveProject: (project: Omit<KeywordProject, 'id' | 'ownerId' | 'createdAt'>) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onSendToContentStudio: (keyword: string, suggestedTitle?: string) => void;
  onAddTrackedKeyword: (input: {
    websiteId: string;
    keyword: string;
    targetUrl?: string;
    country: string;
    language: string;
    device: 'desktop' | 'mobile';
  }) => Promise<string>;
}

export function KeywordResearchView({
  websites,
  keywordProjects,
  siteCrawls,
  wpEntities,
  selectedWebsiteId,
  onSaveProject,
  onDeleteProject,
  onSendToContentStudio,
  onAddTrackedKeyword,
}: KeywordResearchViewProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'seed' | 'mapping'>('seed');
  const [seedKeyword, setSeedKeyword] = useState('');
  const [targetMarket, setTargetMarket] = useState('United States / English');
  const [generating, setGenerating] = useState(false);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingResult, setMappingResult] = useState<KeywordMappingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const activeWebsite =
    (selectedWebsiteId !== 'all'
      ? websites.find((w) => w.id === selectedWebsiteId)
      : websites[0]) || null;
  const currentProject = keywordProjects[activeIndex] || keywordProjects[0] || null;

  const inventoryPages = useMemo(() => {
    if (!activeWebsite) return [];
    const list: Array<{ url: string; title: string; pageType: string; existingKeyword?: string }> = [];
    const seen = new Set<string>();

    wpEntities
      .filter((e) => e.websiteId === activeWebsite.id)
      .forEach((e) => {
        if (!seen.has(e.url)) {
          seen.add(e.url);
          list.push({
            url: e.url,
            title: e.title,
            pageType: e.entityType,
            existingKeyword: e.focusKeyword,
          });
        }
      });

    const latestCrawl = siteCrawls.find((c) => c.websiteId === activeWebsite.id);
    latestCrawl?.pages.forEach((p) => {
      if (!seen.has(p.url)) {
        seen.add(p.url);
        list.push({
          url: p.url,
          title: p.title || p.h1 || p.url,
          pageType: p.pageType,
        });
      }
    });

    if (list.length === 0) {
      list.push({ url: activeWebsite.url, title: activeWebsite.name, pageType: 'landing' });
    }
    return list.slice(0, 20);
  }, [activeWebsite, wpEntities, siteCrawls]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seedKeyword.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const data = await apiFetch<{
        seedKeyword: string;
        targetMarket: string;
        relatedKeywords: KeywordProject['relatedKeywords'];
        longTailKeywords: KeywordProject['longTailKeywords'];
        clusters: KeywordProject['clusters'];
        contentIdeas: KeywordProject['contentIdeas'];
        suggestedTitles: KeywordProject['suggestedTitles'];
      }>('/api/ai/keywords', {
        method: 'POST',
        body: JSON.stringify({
          seedKeyword: seedKeyword.trim(),
          targetMarket,
          websiteUrl: activeWebsite?.url || '',
        }),
      });
      await onSaveProject({
        websiteId: selectedWebsiteId,
        seedKeyword: data.seedKeyword,
        targetMarket: data.targetMarket,
        relatedKeywords: data.relatedKeywords,
        longTailKeywords: data.longTailKeywords,
        clusters: data.clusters,
        contentIdeas: data.contentIdeas,
        suggestedTitles: data.suggestedTitles,
      });
      setActiveIndex(0);
      setSeedKeyword('');
      toast({
        title: 'Keyword strategy generated',
        description: `Saved topic clusters and ideas for "${data.seedKeyword}".`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to generate keywords.';
      setError(msg);
      toast({ title: 'Keyword Research Error', description: msg, variant: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const handleRunMapping = async () => {
    if (!activeWebsite) return;
    setMappingLoading(true);
    setError(null);
    try {
      const res = await apiFetch<KeywordMappingResult>('/api/ai/keyword-map', {
        method: 'POST',
        body: JSON.stringify({
          websiteDomain: activeWebsite.domain,
          targetMarket,
          pages: inventoryPages,
        }),
      });
      setMappingResult(res);
      toast({
        title: 'Keyword Mapping & Cannibalization Check Complete',
        description: `Mapped ${res.mappings.length} URL(s) and found ${res.cannibalizationAlerts.length} cannibalization alert(s).`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to map keywords.';
      setError(msg);
      toast({ title: 'Mapping Failed', description: msg, variant: 'error' });
    } finally {
      setMappingLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
        <div>
          <strong>AI Estimates vs. Verified Google Data:</strong> Keyword intent, competition tiers, and cannibalization maps below are AI-generated strategy estimates. RankPilot never invents search volumes or exact rankings—connect <strong>Google Search Console</strong> to view verified clicks, impressions, and positions.
        </div>
      </div>

      <div className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-800">
        <button
          type="button"
          onClick={() => setTab('seed')}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
            tab === 'seed'
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Seed Keyword Research</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('mapping')}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
            tab === 'mapping'
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <MapPin className="h-3.5 w-3.5" />
          <span>Page Mapping &amp; Cannibalization</span>
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {tab === 'mapping' ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="font-display text-sm font-semibold">
                Map Keywords to Website Inventory ({inventoryPages.length} URLs ready)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Analyzes crawled pages and imported WooCommerce/WordPress items for {activeWebsite?.domain || 'your website'} to assign unique target keywords and detect cannibalization.
              </p>
            </div>
            <button
              type="button"
              disabled={!activeWebsite || mappingLoading}
              onClick={handleRunMapping}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
            >
              {mappingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              <span>{mappingLoading ? 'Mapping & Checking...' : 'Analyze Page Keyword Map'}</span>
            </button>
          </div>

          {!mappingResult ? (
            <EmptyState
              title="Analyze page-level keyword mapping & cannibalization"
              description="Run a Full-Site Audit or import your WooCommerce/WordPress catalog first, then click Analyze Page Keyword Map to assign non-overlapping keywords per URL."
            />
          ) : (
            <div className="space-y-6">
              {mappingResult.cannibalizationAlerts.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20 overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-amber-200 px-5 py-3 dark:border-amber-900/60">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <h3 className="font-display text-sm font-semibold text-amber-950 dark:text-amber-200">
                      Keyword Cannibalization Alerts ({mappingResult.cannibalizationAlerts.length})
                    </h3>
                  </div>
                  <div className="divide-y divide-amber-200/70 dark:divide-amber-900/40">
                    {mappingResult.cannibalizationAlerts.map((alert, i) => (
                      <div key={i} className="px-5 py-3.5 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            Competing Topic: {alert.competingTopic}
                          </span>
                          <StatusText
                            label={alert.severity}
                            tone={alert.severity.toLowerCase().includes('high') ? 'danger' : 'warning'}
                          />
                        </div>
                        <div className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                          URLs: {alert.urls.join(' · ')}
                        </div>
                        <p className="text-slate-700 dark:text-slate-300">{alert.resolutionAdvice}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800 flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold">URL Keyword Assignments</h3>
                  <span className="text-[11px] text-slate-500">{mappingResult.dataNotice}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Page URL</th>
                        <th className="px-4 py-2.5 font-medium">Primary Target Keyword</th>
                        <th className="px-4 py-2.5 font-medium">Long-Tail Variations</th>
                        <th className="px-4 py-2.5 font-medium">Intent · AI Comp.</th>
                        <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {mappingResult.mappings.map((m, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 max-w-[230px]">
                            <div className="truncate font-mono text-[11px] text-slate-800 dark:text-slate-200" title={m.url}>
                              {m.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                            </div>
                            <div className="text-[11px] text-slate-500 capitalize">{m.pageType}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{m.primaryKeyword}</div>
                            <div className="text-[11px] text-slate-500">{m.opportunityNote}</div>
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-600 dark:text-slate-300">
                            {m.longTailKeywords.join(' · ')}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div>{m.searchIntent}</div>
                            <div className="text-[11px] text-slate-500">AI Est: {m.competitionEstimate}</div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-3">
                              {activeWebsite && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await onAddTrackedKeyword({
                                      websiteId: activeWebsite.id,
                                      keyword: m.primaryKeyword,
                                      targetUrl: m.url,
                                      country: 'US',
                                      language: 'en',
                                      device: 'desktop',
                                    });
                                    toast({ title: `Added "${m.primaryKeyword}" to Rank Tracker`, variant: 'success' });
                                  }}
                                  className="inline-flex items-center gap-1 text-slate-700 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
                                >
                                  <Target className="h-3.5 w-3.5" />
                                  <span>Track</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => onSendToContentStudio(m.primaryKeyword)}
                                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                              >
                                Draft
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <form
            onSubmit={handleGenerate}
            className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Seed Keyword or Product Category
                </label>
                <input
                  type="text"
                  required
                  value={seedKeyword}
                  onChange={(e) => setSeedKeyword(e.target.value)}
                  placeholder="e.g. waterproof waxed canvas backpack"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="w-full lg:w-64">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Target Market
                </label>
                <input
                  type="text"
                  value={targetMarket}
                  onChange={(e) => setTargetMarket(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <button
                type="submit"
                disabled={generating}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span>{generating ? 'Researching...' : 'Generate Keywords'}</span>
              </button>
            </div>
          </form>

          {keywordProjects.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Saved Research:</span>
              {keywordProjects.slice(0, 10).map((proj, i) => (
                <div
                  key={proj.id}
                  className={`inline-flex items-center rounded-lg text-xs font-medium transition-colors ${
                    i === activeIndex
                      ? 'bg-slate-900 text-white dark:bg-indigo-600'
                      : 'border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveIndex(i)}
                    className="px-3 py-1.5 text-left"
                  >
                    {proj.seedKeyword}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await onDeleteProject(proj.id);
                      setActiveIndex(0);
                      toast({ title: 'Keyword project deleted', variant: 'info' });
                    }}
                    aria-label={`Delete ${proj.seedKeyword}`}
                    className="pr-2.5 pl-1 py-1.5 opacity-60 hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {!currentProject ? (
            <EmptyState
              title="Start your first AI keyword research session"
              description="Enter a product, service, or core topic above to generate related terms, long-tail buyer queries, search intent groupings, and editorial title ideas."
            />
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                  <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800 flex items-center justify-between">
                    <h3 className="font-display text-sm font-semibold">
                      Related Keywords · {currentProject.seedKeyword}
                    </h3>
                    <span className="text-[11px] text-slate-500">AI Intent &amp; Competition Estimate</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                        <tr>
                          <th className="px-4 py-2.5 font-medium">Keyword</th>
                          <th className="px-4 py-2.5 font-medium">Intent</th>
                          <th className="px-4 py-2.5 font-medium">AI Est. Comp.</th>
                          <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {currentProject.relatedKeywords.map((kw, idx) => (
                          <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-900 dark:text-slate-100">{kw.keyword}</div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">{kw.rationale}</div>
                            </td>
                            <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{kw.intent}</td>
                            <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">
                              {kw.competitionEstimate}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-2.5">
                                {activeWebsite && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await onAddTrackedKeyword({
                                        websiteId: activeWebsite.id,
                                        keyword: kw.keyword,
                                        country: 'US',
                                        language: 'en',
                                        device: 'desktop',
                                      });
                                      toast({ title: `Tracking "${kw.keyword}"`, variant: 'success' });
                                    }}
                                    className="text-slate-600 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
                                  >
                                    Track
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onSendToContentStudio(kw.keyword)}
                                  className="text-indigo-600 font-medium hover:underline dark:text-indigo-400 whitespace-nowrap"
                                >
                                  Draft
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                  <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                    <h3 className="font-display text-sm font-semibold">Long-Tail Keywords</h3>
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {currentProject.longTailKeywords.map((lt, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-900 dark:text-slate-100">{lt.keyword}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {lt.intent} · Funnel: {lt.funnelStage}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSendToContentStudio(lt.keyword)}
                          className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Write
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="font-display text-sm font-semibold mb-4">Keyword Topic Clusters</h3>
                  <div className="space-y-4">
                    {currentProject.clusters.map((cluster, idx) => (
                      <div key={idx} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0 dark:border-slate-800">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                          <TrendingUp className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                          <span>{cluster.clusterName}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          Pillar: {cluster.pillarTopic}
                        </div>
                        <div className="mt-1.5 text-xs text-slate-700 dark:text-slate-300">
                          {cluster.keywords.join(' · ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="font-display text-sm font-semibold mb-4">Content Ideas &amp; Suggested Titles</h3>
                  <div className="space-y-3">
                    {currentProject.contentIdeas.map((idea, idx) => (
                      <div key={idx} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{idea.title}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {idea.format} · Target: {idea.targetKeyword}
                          </p>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{idea.angle}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSendToContentStudio(idea.targetKeyword, idea.title)}
                          className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                        >
                          Generate
                        </button>
                      </div>
                    ))}
                    {currentProject.suggestedTitles.length > 0 && (
                      <div className="pt-1">
                        <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Additional Headline Variations</div>
                        <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300 list-disc pl-4">
                          {currentProject.suggestedTitles.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    )}
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
