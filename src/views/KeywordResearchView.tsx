import React, { useState } from 'react';
import { Info, Loader2, Sparkles, Trash2, TrendingUp } from 'lucide-react';
import { EmptyState, ErrorBanner } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { KeywordProject, Website } from '../types';

interface KeywordResearchViewProps {
  websites: Website[];
  keywordProjects: KeywordProject[];
  selectedWebsiteId: string;
  onSaveProject: (project: Omit<KeywordProject, 'id' | 'ownerId' | 'createdAt'>) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onSendToContentStudio: (keyword: string, suggestedTitle?: string) => void;
}

export function KeywordResearchView({
  websites,
  keywordProjects,
  selectedWebsiteId,
  onSaveProject,
  onDeleteProject,
  onSendToContentStudio,
}: KeywordResearchViewProps) {
  const { toast } = useToast();
  const [seedKeyword, setSeedKeyword] = useState('');
  const [targetMarket, setTargetMarket] = useState('United States / English');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const activeWebsite = websites.find((w) => w.id === selectedWebsiteId);
  const currentProject = keywordProjects[activeIndex] || keywordProjects[0] || null;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seedKeyword.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seedKeyword: seedKeyword.trim(),
          targetMarket,
          websiteUrl: activeWebsite?.url || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Keyword generation failed.');
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

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
        <div>
          <strong>AI Strategic Keyword Intelligence vs. Verified Search Volume:</strong> Results below are AI-generated keyword ideas, search intent classifications, and topic clusters powered by Gemini. Connect Google Search Console in Integrations to verify live impressions, clicks, and ranking positions.
        </div>
      </div>

      <form
        onSubmit={handleGenerate}
        className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Seed Keyword or Topic
            </label>
            <input
              type="text"
              required
              value={seedKeyword}
              onChange={(e) => setSeedKeyword(e.target.value)}
              placeholder="e.g. b2b workflow automation software"
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

      {error && <ErrorBanner message={error} />}

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
                      <th className="px-4 py-2.5 font-medium">Est. Difficulty</th>
                      <th className="px-4 py-2.5 font-medium text-right">Action</th>
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
                          <button
                            type="button"
                            onClick={() => onSendToContentStudio(kw.keyword)}
                            className="text-indigo-600 font-medium hover:underline dark:text-indigo-400 whitespace-nowrap"
                          >
                            Draft Content
                          </button>
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
    </div>
  );
}
