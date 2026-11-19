import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FolderTree,
  Globe,
  Info,
  Link2,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/apiClient';
import {
  CompetitorKeywordAnalysisResult,
  KeywordAssignment,
  KeywordMappingResult,
  KeywordMetricItem,
  KeywordProject,
  KeywordProviderStatus,
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
  onSaveProject: (project: Omit<KeywordProject, 'id' | 'ownerId' | 'createdAt'>) => Promise<string | void>;
  onAssignKeywordToPage: (projectId: string, assignment: KeywordAssignment) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onSendToOnPageSeo: (keyword: string, suggestedTitle?: string) => void;
  onAddTrackedKeyword: (input: {
    websiteId: string;
    keyword: string;
    targetUrl?: string;
    country: string;
    language: string;
    device: 'desktop' | 'mobile';
  }) => Promise<string>;
}

const COUNTRY_OPTIONS = [
  { code: 'PK', label: 'Pakistan (PK)' },
  { code: 'US', label: 'United States (US)' },
  { code: 'GB', label: 'United Kingdom (GB)' },
  { code: 'AE', label: 'United Arab Emirates (AE)' },
  { code: 'ALL', label: 'Worldwide (Global)' },
  { code: 'CA', label: 'Canada (CA)' },
  { code: 'AU', label: 'Australia (AU)' },
  { code: 'DE', label: 'Germany (DE)' },
  { code: 'IN', label: 'India (IN)' },
];

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ur', label: 'Urdu' },
  { code: 'ar', label: 'Arabic' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
];

type ResearchTab = 'discovery' | 'clusters' | 'opportunities' | 'mapping' | 'competitor' | 'providers';
type SortField = 'keyword' | 'searchVolume' | 'keywordDifficulty' | 'intent' | 'cpc' | 'country' | 'opportunityScore';

function escapeCsvCell(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildLegacyKeywordItems(project: KeywordProject | null): KeywordMetricItem[] {
  if (!project) return [];
  if (Array.isArray(project.keywordItems) && project.keywordItems.length > 0) {
    return project.keywordItems;
  }
  const country = project.country || 'US';
  const language = project.language || 'en';
  const rows: KeywordMetricItem[] = [];
  const seen = new Set<string>();

  for (const r of project.relatedKeywords || []) {
    if (!seen.has(r.keyword.toLowerCase())) {
      seen.add(r.keyword.toLowerCase());
      rows.push({
        keyword: r.keyword,
        category: 'related',
        intent: r.intent,
        country,
        language,
        searchVolume: null,
        keywordDifficulty: null,
        cpc: null,
        competition: null,
        competitionEstimate: r.competitionEstimate.includes('AI') ? r.competitionEstimate : `${r.competitionEstimate} (AI Est.)`,
        opportunityScore: null,
        opportunityTier: 'AI Medium Opportunity',
        funnelStage: 'MOFU',
        rationale: r.rationale,
        dataSource: 'ai_estimate',
      });
    }
  }
  for (const lt of project.longTailKeywords || []) {
    if (!seen.has(lt.keyword.toLowerCase())) {
      seen.add(lt.keyword.toLowerCase());
      rows.push({
        keyword: lt.keyword,
        category: 'long_tail',
        intent: lt.intent,
        country,
        language,
        searchVolume: null,
        keywordDifficulty: null,
        cpc: null,
        competition: null,
        competitionEstimate: 'Low (AI Est.)',
        opportunityScore: null,
        opportunityTier: 'AI High Opportunity',
        funnelStage: lt.funnelStage,
        rationale: `Long-tail ${lt.funnelStage} keyword`,
        dataSource: 'ai_estimate',
      });
    }
  }
  return rows;
}

export function KeywordResearchView({
  websites,
  keywordProjects,
  siteCrawls,
  wpEntities,
  selectedWebsiteId,
  onSaveProject,
  onAssignKeywordToPage,
  onDeleteProject,
  onSendToOnPageSeo,
  onAddTrackedKeyword,
}: KeywordResearchViewProps) {
  const { toast } = useToast();

  const [tab, setTab] = useState<ResearchTab>('discovery');

  // Discovery Inputs
  const [sourceType, setSourceType] = useState<'keyword' | 'product' | 'url' | 'category'>('keyword');
  const [seedKeyword, setSeedKeyword] = useState('');
  const [targetUrlInput, setTargetUrlInput] = useState('');
  const [country, setCountry] = useState('PK');
  const [language, setLanguage] = useState('en');
  const [intentFocus, setIntentFocus] = useState('All');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Table Controls (Filter / Sort / Pagination)
  const [tableSearch, setTableSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'related' | 'long_tail' | 'question' | 'commercial' | 'synonym'>('all');
  const [intentFilter, setIntentFilter] = useState<string>('all');
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'assigned' | 'unassigned'>('all');
  const [sortField, setSortField] = useState<SortField>('opportunityScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Page Assignment Modal/Popover state
  const [assigningKeyword, setAssigningKeyword] = useState<string | null>(null);
  const [selectedAssignUrl, setSelectedAssignUrl] = useState('');
  const [savingAssignment, setSavingAssignment] = useState(false);

  // WooCommerce & Catalog Mapper
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingResult, setMappingResult] = useState<KeywordMappingResult | null>(null);

  // Competitor Analysis
  const [competitorUrlsText, setCompetitorUrlsText] = useState('');
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [competitorResult, setCompetitorResult] = useState<CompetitorKeywordAnalysisResult | null>(null);

  // Providers Status
  const [providers, setProviders] = useState<KeywordProviderStatus[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);

  const activeWebsite =
    (selectedWebsiteId !== 'all'
      ? websites.find((w) => w.id === selectedWebsiteId)
      : websites[0]) || null;

  const currentProject = keywordProjects[activeIndex] || keywordProjects[0] || null;

  // Load verified provider connection status
  useEffect(() => {
    let cancelled = false;
    setProvidersLoading(true);
    apiFetch<{ providers: KeywordProviderStatus[] }>('/api/keywords/providers')
      .then((res) => {
        if (!cancelled && Array.isArray(res.providers)) {
          setProviders(res.providers);
        }
      })
      .catch(() => {
        // Non-fatal if unverified or offline
      })
      .finally(() => {
        if (!cancelled) setProvidersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const inventoryPages = useMemo(() => {
    if (!activeWebsite) return [];
    const list: Array<{
      url: string;
      title: string;
      pageType: string;
      existingKeyword?: string;
      shortDescription?: string;
    }> = [];
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
            shortDescription: e.shortDescription || e.description,
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
    return list.slice(0, 40);
  }, [activeWebsite, wpEntities, siteCrawls]);

  const assignmentMap = useMemo(() => {
    const map = new Map<string, KeywordAssignment>();
    (currentProject?.assignments || []).forEach((a) => {
      map.set(a.keyword.toLowerCase(), a);
    });
    return map;
  }, [currentProject]);

  const allMetricRows = useMemo(() => buildLegacyKeywordItems(currentProject), [currentProject]);
  const hasVolumeCol = useMemo(
    () => allMetricRows.some((r) => r.searchVolume !== null),
    [allMetricRows]
  );
  const hasKdCol = useMemo(
    () => allMetricRows.some((r) => r.keywordDifficulty !== null),
    [allMetricRows]
  );
  const hasCpcCol = useMemo(
    () => allMetricRows.some((r) => r.cpc !== null),
    [allMetricRows]
  );
  const hasVerifiedMetrics = hasVolumeCol || hasKdCol || hasCpcCol;
  const visibleColCount = 6 + (hasVolumeCol ? 1 : 0) + (hasKdCol ? 1 : 0) + (hasCpcCol ? 1 : 0);

  const filteredAndSortedRows = useMemo(() => {
    const searchLower = tableSearch.trim().toLowerCase();
    const filtered = allMetricRows.filter((row) => {
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false;
      if (intentFilter !== 'all' && row.intent.toLowerCase() !== intentFilter.toLowerCase()) return false;
      const isAssigned = assignmentMap.has(row.keyword.toLowerCase());
      if (assignmentFilter === 'assigned' && !isAssigned) return false;
      if (assignmentFilter === 'unassigned' && isAssigned) return false;
      if (searchLower && !row.keyword.toLowerCase().includes(searchLower) && !row.rationale.toLowerCase().includes(searchLower)) {
        return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'keyword') return a.keyword.localeCompare(b.keyword) * mul;
      if (sortField === 'intent') return a.intent.localeCompare(b.intent) * mul;
      if (sortField === 'country') return a.country.localeCompare(b.country) * mul;
      if (sortField === 'searchVolume') {
        const av = a.searchVolume ?? -1;
        const bv = b.searchVolume ?? -1;
        return (av - bv) * mul;
      }
      if (sortField === 'cpc') {
        const av = a.cpc ?? -1;
        const bv = b.cpc ?? -1;
        return (av - bv) * mul;
      }
      if (sortField === 'keywordDifficulty') {
        const av = a.keywordDifficulty ?? -1;
        const bv = b.keywordDifficulty ?? -1;
        return (av - bv) * mul;
      }
      // opportunityScore: sort numeric verified scores first, then AI tier rank
      const tierRank = (tier: string) =>
        tier.includes('High') ? 3 : tier.includes('Medium') ? 2 : tier.includes('Niche') ? 1 : 0;
      const av = a.opportunityScore ?? tierRank(a.opportunityTier) * 10;
      const bv = b.opportunityScore ?? tierRank(b.opportunityTier) * 10;
      return (av - bv) * mul;
    });

    return sorted;
  }, [allMetricRows, tableSearch, categoryFilter, intentFilter, assignmentFilter, sortField, sortDir, assignmentMap]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredAndSortedRows.slice(start, start + pageSize);
  }, [filteredAndSortedRows, safePage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [activeIndex, tableSearch, categoryFilter, intentFilter, assignmentFilter, pageSize]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'keyword' || field === 'intent' || field === 'country' ? 'asc' : 'desc');
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seedKeyword.trim() && !targetUrlInput.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const data = await apiFetch<Omit<KeywordProject, 'id' | 'ownerId' | 'createdAt'>>('/api/ai/keywords', {
        method: 'POST',
        body: JSON.stringify({
          seedKeyword: seedKeyword.trim(),
          sourceType,
          targetUrl: sourceType === 'url' ? seedKeyword.trim() || targetUrlInput.trim() : targetUrlInput.trim(),
          country,
          language,
          intentFilter: intentFocus,
          websiteUrl: activeWebsite?.url || '',
        }),
      });
      await onSaveProject({
        websiteId: selectedWebsiteId,
        ...data,
        assignments: [],
      });
      setActiveIndex(0);
      setSeedKeyword('');
      setTargetUrlInput('');
      toast({
        title: 'Keyword discovery saved',
        description: `Generated ${data.keywordItems?.length || 0} keywords for ${country} (${language.toUpperCase()}).`,
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

  const handleExportCsv = () => {
    if (!currentProject || filteredAndSortedRows.length === 0) return;
    const headers = [
      'Keyword',
      'Category',
      ...(hasVolumeCol ? ['Search Volume'] : []),
      ...(hasKdCol ? ['Keyword Difficulty'] : []),
      'Search Intent',
      ...(hasCpcCol ? ['CPC (USD)'] : []),
      'Competition',
      'Country',
      'Language',
      'Opportunity Score',
      'Data Source',
      'Assigned Target URL',
      'Notes',
    ];
    const lines = [
      headers.join(','),
      ...filteredAndSortedRows.map((row) => {
        const assigned = assignmentMap.get(row.keyword.toLowerCase());
        return [
          row.keyword,
          row.category,
          ...(hasVolumeCol ? [row.searchVolume === null ? '' : row.searchVolume] : []),
          ...(hasKdCol ? [row.keywordDifficulty === null ? '' : row.keywordDifficulty] : []),
          row.intent,
          ...(hasCpcCol ? [row.cpc === null ? '' : row.cpc.toFixed(2)] : []),
          row.competition || row.competitionEstimate,
          row.country,
          row.language,
          row.opportunityScore !== null ? row.opportunityScore : row.opportunityTier,
          row.dataSource === 'ai_estimate' ? 'AI Estimate' : row.dataSource,
          assigned?.targetUrl || '',
          row.rationale,
        ]
          .map(escapeCsvCell)
          .join(',');
      }),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rankpilot-keywords-${currentProject.seedKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({ title: `Exported ${filteredAndSortedRows.length} keyword rows to CSV`, variant: 'success' });
  };

  const handleConfirmAssignPage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject || !assigningKeyword || !selectedAssignUrl) return;
    const targetPage = inventoryPages.find((p) => p.url === selectedAssignUrl);
    setSavingAssignment(true);
    try {
      await onAssignKeywordToPage(currentProject.id, {
        keyword: assigningKeyword,
        targetUrl: selectedAssignUrl,
        pageTitle: targetPage?.title || selectedAssignUrl,
        entityType: targetPage?.pageType || 'page',
        assignedAt: new Date().toISOString().slice(0, 32),
      });
      toast({
        title: 'Keyword assigned to page',
        description: `"${assigningKeyword}" → ${targetPage?.title || selectedAssignUrl}`,
        variant: 'success',
      });
      setAssigningKeyword(null);
      setSelectedAssignUrl('');
    } catch (err) {
      toast({
        title: 'Assignment failed',
        description: err instanceof Error ? err.message : 'Unable to save keyword assignment.',
        variant: 'error',
      });
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleRunMapping = async () => {
    if (!activeWebsite) return;
    setMappingLoading(true);
    setError(null);
    try {
      const targetMarketLabel = `${COUNTRY_OPTIONS.find((c) => c.code === country)?.label || country} / ${
        LANGUAGE_OPTIONS.find((l) => l.code === language)?.label || language
      }`;
      const res = await apiFetch<KeywordMappingResult>('/api/ai/keyword-map', {
        method: 'POST',
        body: JSON.stringify({
          websiteDomain: activeWebsite.domain,
          targetMarket: targetMarketLabel,
          pages: inventoryPages,
        }),
      });
      setMappingResult(res);
      toast({
        title: 'Catalog Mapping & Cannibalization Check Complete',
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

  const handleRunCompetitorAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    const urls = competitorUrlsText
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
      .slice(0, 3);
    if (urls.length === 0) return;

    setCompetitorLoading(true);
    setError(null);
    try {
      const res = await apiFetch<CompetitorKeywordAnalysisResult>('/api/ai/keyword-competitor', {
        method: 'POST',
        body: JSON.stringify({
          urls,
          country,
          language,
          ownDomain: activeWebsite?.domain || '',
        }),
      });
      setCompetitorResult(res);
      toast({
        title: 'Competitor keyword analysis complete',
        description: `Inspected ${res.crawledPages.length} competitor page(s) and extracted ${res.discoveredKeywords.length} keyword opportunities.`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Competitor analysis failed.';
      setError(msg);
      toast({ title: 'Competitor Analysis Error', description: msg, variant: 'error' });
    } finally {
      setCompetitorLoading(false);
    }
  };

  const verifiedProviderActive = providers.some(
    (p) => (p.id === 'google_ads' || p.id === 'dataforseo') && p.connected
  );

  const wpEntitiesCount = activeWebsite
    ? wpEntities.filter((e) => e.websiteId === activeWebsite.id).length
    : 0;

  return (
    <div className="space-y-6">
      {/* Truthfulness & Provider Status Banner */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-200">
        <div className="flex items-start gap-2.5 max-w-4xl">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <div>
            <strong>Verified Sources &amp; AI Strategy:</strong>{' '}
            {verifiedProviderActive
              ? 'An optional keyword data provider is connected on the server. Monthly search volume and CPC values show live API figures; AI qualitative fields remain labeled.'
              : 'Keyword discovery, search intent, clustering, and page opportunities run on Gemini AI and your synced website catalog, with Google Search Console providing verified organic search performance. Unconnected numeric volume and CPC columns are hidden.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setTab('providers')}
          className="inline-flex items-center gap-1.5 font-medium text-indigo-700 hover:underline dark:text-indigo-300 whitespace-nowrap"
        >
          <Database className="h-3.5 w-3.5" />
          <span>Data Sources</span>
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-800">
        {[
          { id: 'discovery', label: 'Discovery & Metrics', icon: Search },
          { id: 'clusters', label: 'Clusters & Content', icon: FolderTree },
          { id: 'opportunities', label: 'Opportunity Analysis', icon: TrendingUp },
          { id: 'mapping', label: `WooCommerce & Page Map (${inventoryPages.length})`, icon: MapPin },
          { id: 'competitor', label: 'Competitor URLs', icon: Globe },
          { id: 'providers', label: 'Data Providers', icon: Database },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as ResearchTab)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Assign Keyword Modal */}
      {assigningKeyword && currentProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleConfirmAssignPage}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Assign Keyword to Target Page / Product</h3>
              <button
                type="button"
                onClick={() => {
                  setAssigningKeyword(null);
                  setSelectedAssignUrl('');
                }}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
              >
                Close
              </button>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
              <span className="text-slate-500">Selected Keyword: </span>
              <strong className="text-slate-900 dark:text-slate-100">{assigningKeyword}</strong>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                Existing Product, Category, or Website Page
              </label>
              <select
                required
                value={selectedAssignUrl}
                onChange={(e) => setSelectedAssignUrl(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="">Select destination URL...</option>
                {inventoryPages.map((p) => (
                  <option key={p.url} value={p.url}>
                    [{p.pageType}] {p.title} — {p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setAssigningKeyword(null);
                  setSelectedAssignUrl('');
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingAssignment || !selectedAssignUrl}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingAssignment && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Save Assignment</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 1: DISCOVERY & METRICS */}
      {tab === 'discovery' && (
        <div className="space-y-6">
          <form
            onSubmit={handleGenerate}
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Input Mode
                </label>
                <select
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value as 'keyword' | 'product' | 'url' | 'category')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="keyword">Seed Keyword</option>
                  <option value="product">Product Name</option>
                  <option value="url">Product / Page URL</option>
                  <option value="category">Store Category</option>
                </select>
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  {sourceType === 'url'
                    ? 'Public Product or Landing Page URL'
                    : sourceType === 'product'
                    ? 'Product Name'
                    : sourceType === 'category'
                    ? 'Category / Collection Name'
                    : 'Seed Keyword or Topic'}
                </label>
                <input
                  type={sourceType === 'url' ? 'url' : 'text'}
                  required
                  value={seedKeyword}
                  onChange={(e) => setSeedKeyword(e.target.value)}
                  placeholder={
                    sourceType === 'url'
                      ? 'https://example.com/product/leather-jacket'
                      : sourceType === 'product'
                      ? 'Men handmade leather Chelsea boots'
                      : sourceType === 'category'
                      ? 'Solar inverters & lithium batteries'
                      : 'e.g. waterproof waxed canvas backpack'
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Target Country
                </label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                >
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                >
                  {LANGUAGE_OPTIONS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Intent Focus
                </label>
                <select
                  value={intentFocus}
                  onChange={(e) => setIntentFocus(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="All">All Intents</option>
                  <option value="Commercial">Commercial</option>
                  <option value="Transactional">Transactional</option>
                  <option value="Informational">Informational</option>
                  <option value="Navigational">Navigational</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              {sourceType !== 'url' ? (
                <div className="flex-1 min-w-[240px] max-w-md">
                  <input
                    type="url"
                    value={targetUrlInput}
                    onChange={(e) => setTargetUrlInput(e.target.value)}
                    placeholder="Optional: inspect a specific product/category URL for extra context"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              ) : (
                <div className="text-xs text-slate-500">
                  Live crawler extracts H1, title, and page copy before generating localized keywords.
                </div>
              )}

              <button
                type="submit"
                disabled={generating}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span>{generating ? 'Discovering Keywords...' : 'Discover Keywords'}</span>
              </button>
            </div>
          </form>

          {/* Saved Keyword Research Lists */}
          {keywordProjects.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Saved Keyword Lists:</span>
              {keywordProjects.slice(0, 12).map((proj, i) => (
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
                    <span>{proj.seedKeyword}</span>
                    <span className="ml-1.5 opacity-70 font-mono text-[10px]">
                      {proj.country || 'US'}
                    </span>
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
              title="Run your first keyword discovery session"
              description="Search using a seed keyword, product name, public product URL, or store category across Pakistan, USA, UK, UAE, or Worldwide."
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
              {/* Table Header & Controls */}
              <div className="border-b border-slate-200 p-4 space-y-3 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-display text-sm font-semibold">
                      Keyword Metrics · {currentProject.seedKeyword}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {hasVerifiedMetrics
                        ? currentProject.dataNotice || 'Showing verified keyword metrics alongside AI strategy.'
                        : 'Showing AI keyword strategy, search intent, and page opportunities. Verified organic performance is synced via Google Search Console.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                      placeholder="Filter keywords or rationale..."
                      className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value as typeof categoryFilter)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="all">All Types ({allMetricRows.length})</option>
                    <option value="related">Related</option>
                    <option value="long_tail">Long-Tail</option>
                    <option value="question">Questions</option>
                    <option value="commercial">Commercial</option>
                    <option value="synonym">Synonyms</option>
                  </select>
                  <select
                    value={intentFilter}
                    onChange={(e) => setIntentFilter(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="all">All Intents</option>
                    <option value="Commercial">Commercial</option>
                    <option value="Transactional">Transactional</option>
                    <option value="Informational">Informational</option>
                    <option value="Navigational">Navigational</option>
                  </select>
                  <select
                    value={assignmentFilter}
                    onChange={(e) => setAssignmentFilter(e.target.value as typeof assignmentFilter)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="all">All Assignments</option>
                    <option value="assigned">Assigned to Page</option>
                    <option value="unassigned">Unassigned</option>
                  </select>
                </div>
              </div>

              {/* Metrics Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">
                        <button type="button" onClick={() => toggleSort('keyword')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200">
                          <span>Keyword</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      {hasVolumeCol && (
                        <th className="px-3 py-2.5 font-medium text-right">
                          <button type="button" onClick={() => toggleSort('searchVolume')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200">
                            <span>Search Vol.</span>
                            <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </th>
                      )}
                      {hasKdCol && (
                        <th className="px-3 py-2.5 font-medium text-right">
                          <button type="button" onClick={() => toggleSort('keywordDifficulty')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200">
                            <span>KD</span>
                            <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </th>
                      )}
                      <th className="px-3 py-2.5 font-medium">
                        <button type="button" onClick={() => toggleSort('intent')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200">
                          <span>Intent</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      {hasCpcCol && (
                        <th className="px-3 py-2.5 font-medium text-right">
                          <button type="button" onClick={() => toggleSort('cpc')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200">
                            <span>CPC</span>
                            <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </th>
                      )}
                      <th className="px-3 py-2.5 font-medium">Competition</th>
                      <th className="px-3 py-2.5 font-medium">
                        <button type="button" onClick={() => toggleSort('country')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200">
                          <span>Country</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-3 py-2.5 font-medium">
                        <button type="button" onClick={() => toggleSort('opportunityScore')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200">
                          <span>Opportunity</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {pagedRows.length === 0 ? (
                      <tr>
                        <td colSpan={visibleColCount} className="px-4 py-8 text-center text-slate-500">
                          No keywords match the active filter criteria.
                        </td>
                      </tr>
                    ) : (
                      pagedRows.map((row, idx) => {
                        const assigned = assignmentMap.get(row.keyword.toLowerCase());
                        return (
                          <tr key={`${row.keyword}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="px-4 py-3 max-w-xs">
                              <div className="font-semibold text-slate-900 dark:text-slate-100">
                                {row.keyword}
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                <span className="uppercase font-mono text-[10px] text-indigo-600 dark:text-indigo-400 mr-1.5">
                                  {row.category.replace('_', '-')}
                                </span>
                                {row.rationale}
                              </div>
                              {assigned && (
                                <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                                  <Link2 className="h-3 w-3" />
                                  <span className="truncate max-w-[220px]" title={assigned.targetUrl}>
                                    Assigned: {assigned.targetUrl.replace(/^https?:\/\/[^/]+/, '') || '/'}
                                  </span>
                                </div>
                              )}
                            </td>
                            {hasVolumeCol && (
                              <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                                {row.searchVolume !== null ? (
                                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                                    {row.searchVolume.toLocaleString()}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            )}
                            {hasKdCol && (
                              <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                                {row.keywordDifficulty !== null ? (
                                  <span className="font-semibold">{row.keywordDifficulty}/100</span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            )}
                            <td className="px-3 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                              {row.intent}
                            </td>
                            {hasCpcCol && (
                              <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                                {row.cpc !== null ? (
                                  <span className="font-medium">${row.cpc.toFixed(2)}</span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            )}
                            <td className="px-3 py-3 whitespace-nowrap">
                              {row.competition ? (
                                <span className="font-medium text-slate-900 dark:text-slate-100">
                                  {row.competition}
                                </span>
                              ) : (
                                <span className="text-slate-600 dark:text-slate-400">
                                  {row.competitionEstimate}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 font-mono text-[11px] whitespace-nowrap">
                              {row.country} · {row.language.toUpperCase()}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              {row.opportunityScore !== null ? (
                                <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                  {row.opportunityScore}/100
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-600 dark:text-slate-300">
                                  {row.opportunityTier}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAssigningKeyword(row.keyword);
                                    setSelectedAssignUrl(assigned?.targetUrl || inventoryPages[0]?.url || '');
                                  }}
                                  className="text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
                                >
                                  {assigned ? 'Reassign' : 'Assign Page'}
                                </button>
                                {activeWebsite && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await onAddTrackedKeyword({
                                        websiteId: activeWebsite.id,
                                        keyword: row.keyword,
                                        targetUrl: assigned?.targetUrl || activeWebsite.url,
                                        country: row.country || 'US',
                                        language: row.language || 'en',
                                        device: 'desktop',
                                      });
                                      toast({
                                        title: `Saved "${row.keyword}" to Rank Tracker (${row.country})`,
                                        variant: 'success',
                                      });
                                    }}
                                    className="inline-flex items-center gap-1 text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
                                  >
                                    <Target className="h-3 w-3" />
                                    <span>Track</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onSendToOnPageSeo(row.keyword)}
                                  className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                                >
                                  Optimize
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
                <div>
                  Showing {filteredAndSortedRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–
                  {Math.min(safePage * pageSize, filteredAndSortedRows.length)} of {filteredAndSortedRows.length} keyword(s)
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value={10}>10 / page</option>
                    <option value={25}>25 / page</option>
                    <option value={50}>50 / page</option>
                  </select>
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-slate-300 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700"
                  >
                    Prev
                  </button>
                  <span className="font-mono tabular-nums">
                    {safePage}/{totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded border border-slate-300 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CLUSTERS & CONTENT IDEAS */}
      {tab === 'clusters' && (
        !currentProject ? (
          <EmptyState
            title="No keyword project selected"
            description="Generate or select a keyword research project under Discovery & Metrics to inspect clusters and content blueprints."
            actionLabel="Go to Discovery"
            onAction={() => setTab('discovery')}
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold">
                  Topic Clusters &amp; Cannibalization Risk · {currentProject.seedKeyword}
                </h3>
                <span className="text-[11px] text-slate-500">{currentProject.clusters.length} clusters</span>
              </div>
              <div className="space-y-4">
                {currentProject.clusters.map((cluster, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-slate-200 p-4 space-y-2 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                        {cluster.clusterName}
                      </div>
                      <div className="flex items-center gap-3 text-[11px]">
                        {cluster.suggestedAssetType && (
                          <span className="font-mono uppercase text-indigo-600 dark:text-indigo-400">
                            Target: {cluster.suggestedAssetType}
                          </span>
                        )}
                        {cluster.cannibalizationRisk && (
                          <StatusText
                            label={`Overlap Risk: ${cluster.cannibalizationRisk}`}
                            tone={
                              cluster.cannibalizationRisk.toLowerCase().includes('high')
                                ? 'danger'
                                : cluster.cannibalizationRisk.toLowerCase().includes('medium')
                                ? 'warning'
                                : 'success'
                            }
                          />
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Pillar Topic: {cluster.pillarTopic}
                      {cluster.recommendedPrimaryKeyword && (
                        <>
                          {' '}
                          · Primary Keyword:{' '}
                          <strong className="text-slate-800 dark:text-slate-200">
                            {cluster.recommendedPrimaryKeyword}
                          </strong>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                      {cluster.keywords.join(' · ')}
                    </div>
                  </div>
                ))}
              </div>

              {currentProject.synonyms && currentProject.synonyms.length > 0 && (
                <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Keyword Variations &amp; Synonyms
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {currentProject.synonyms.join(' · ')}
                  </p>
                </div>
              )}
            </div>

            <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-display text-sm font-semibold">Content Ideas &amp; Headlines</h3>
              <div className="space-y-3">
                {currentProject.contentIdeas.map((idea, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800"
                  >
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{idea.title}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {idea.format} · Keyword: {idea.targetKeyword}
                      </p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{idea.angle}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSendToOnPageSeo(idea.targetKeyword, idea.title)}
                      className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                    >
                      Optimize
                    </button>
                  </div>
                ))}
                {currentProject.suggestedTitles.length > 0 && (
                  <div className="pt-1">
                    <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Title Ideas</div>
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
        )
      )}

      {/* TAB 3: OPPORTUNITY ANALYSIS */}
      {tab === 'opportunities' && (
        !currentProject ? (
          <EmptyState
            title="No keyword opportunities generated yet"
            description="Run keyword discovery to surface low-competition candidates, buying-intent ecommerce queries, and blog growth angles."
            actionLabel="Go to Discovery"
            onAction={() => setTab('discovery')}
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {[
              {
                bucket: 'low_competition_candidate',
                title: 'Low-Competition Keyword Candidates',
                subtitle: 'Longer-tail or qualifier queries suited for faster organic traction',
              },
              {
                bucket: 'commercial_buying',
                title: 'Commercial & Buying-Intent Queries',
                subtitle: 'Bottom-of-funnel phrases signaling product comparison or purchase intent',
              },
              {
                bucket: 'ecommerce_priority',
                title: 'Prioritized Ecommerce Opportunities',
                subtitle: 'High-fit terms tailored for product pages and category hubs',
              },
              {
                bucket: 'informational_blog',
                title: 'Informational Blog Opportunities',
                subtitle: 'Educational guides capturing early research traffic & internal links',
              },
            ].map((section) => {
              const items = (currentProject.opportunities || []).filter((o) => o.bucket === section.bucket);
              return (
                <div
                  key={section.bucket}
                  className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden"
                >
                  <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                    <h3 className="font-display text-sm font-semibold">{section.title}</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{section.subtitle}</p>
                  </div>
                  {items.length === 0 ? (
                    <div className="px-5 py-6 text-xs text-slate-500">
                      Run a fresh discovery query under Discovery &amp; Metrics to populate this opportunity bucket.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {items.map((item, idx) => (
                        <div key={idx} className="px-5 py-3.5 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {item.keyword}
                            </span>
                            <div className="flex items-center gap-2 text-[11px]">
                              <span className="font-mono text-slate-500">
                                {item.isVerifiedMetric ? 'Verified API' : 'AI Strategic Est.'}
                              </span>
                              <button
                                type="button"
                                onClick={() => onSendToOnPageSeo(item.keyword)}
                                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                              >
                                Optimize {item.recommendedAssetType}
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300">{item.whyItWins}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* TAB 4: WOOCOMMERCE & PAGE MAPPER */}
      {tab === 'mapping' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="font-display text-sm font-semibold">
                WooCommerce &amp; Page Keyword Mapper ({inventoryPages.length} items ready · {wpEntitiesCount} imported WP/WC items)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Inspects product names, descriptions, categories, and crawled URLs on{' '}
                {activeWebsite?.domain || 'your website'} to recommend primary &amp; secondary keywords and catch cannibalization.
              </p>
            </div>
            <button
              type="button"
              disabled={!activeWebsite || mappingLoading}
              onClick={handleRunMapping}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
            >
              {mappingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              <span>{mappingLoading ? 'Mapping Catalog...' : 'Analyze Catalog & Page Map'}</span>
            </button>
          </div>

          {!mappingResult ? (
            <EmptyState
              title="Map target keywords across WooCommerce products, categories & pages"
              description="Import your WooCommerce catalog in WordPress & WooCommerce or run a site crawl first, then click Analyze Catalog & Page Map to detect duplicate targeting and assign primary keywords."
            />
          ) : (
            <div className="space-y-6">
              {mappingResult.cannibalizationAlerts.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20 overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-amber-200 px-5 py-3 dark:border-amber-900/60">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <h3 className="font-display text-sm font-semibold text-amber-950 dark:text-amber-200">
                      Duplicate Targeting &amp; Cannibalization Alerts ({mappingResult.cannibalizationAlerts.length})
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
                <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold">Recommended Page &amp; Product Keyword Assignments</h3>
                  <span className="text-[11px] text-slate-500">{mappingResult.dataNotice}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Page / Product URL</th>
                        <th className="px-4 py-2.5 font-medium">Primary Target Keyword</th>
                        <th className="px-4 py-2.5 font-medium">Secondary &amp; Long-Tail Keywords</th>
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
                                      country,
                                      language,
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
                                onClick={() => onSendToOnPageSeo(m.primaryKeyword)}
                                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                              >
                                Optimize
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
      )}

      {/* TAB 5: COMPETITOR KEYWORD ANALYSIS */}
      {tab === 'competitor' && (
        <div className="space-y-6">
          <form
            onSubmit={handleRunCompetitorAnalysis}
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div>
              <h2 className="font-display text-sm font-semibold">Competitor Page &amp; Content Gap Analyzer</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Crawls 1–3 publicly accessible competitor URLs to extract target keywords and topic gaps from live page titles, H1/H2 headings, and body text. Competitor Google ranking positions are never estimated or fabricated.
              </p>
            </div>
            <textarea
              rows={3}
              required
              value={competitorUrlsText}
              onChange={(e) => setCompetitorUrlsText(e.target.value)}
              placeholder={'https://competitor-store.com/product/example-item\nhttps://competitor-store.com/category/featured'}
              className="w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={competitorLoading}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {competitorLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                <span>{competitorLoading ? 'Crawling Competitor URLs...' : 'Extract Competitor Keywords'}</span>
              </button>
            </div>
          </form>

          {!competitorResult ? (
            <EmptyState
              title="Analyze competitor pages for missing keyword opportunities"
              description="Enter up to 3 public competitor product, category, or blog URLs above to extract evidenced target phrases and content gaps."
            />
          ) : (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <strong>Data Scope:</strong> {competitorResult.dataNotice}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {competitorResult.crawledPages.map((cp, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                        {cp.url}
                      </span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" />
                    </div>
                    {cp.error ? (
                      <div className="text-xs text-red-600 dark:text-red-400">{cp.error}</div>
                    ) : (
                      <>
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">
                          {cp.title || 'Untitled page'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          H1: {cp.h1 || 'None'} · {cp.wordCount.toLocaleString()} words
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                  <h3 className="font-display text-sm font-semibold">
                    Discovered Competitor Keyword Opportunities ({competitorResult.discoveredKeywords.length})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Keyword</th>
                        <th className="px-4 py-2.5 font-medium">Intent · Asset</th>
                        <th className="px-4 py-2.5 font-medium">Evidenced On</th>
                        <th className="px-4 py-2.5 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {competitorResult.discoveredKeywords.map((dk, i) => (
                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{dk.keyword}</div>
                            <div className="text-[11px] text-slate-500">{dk.rationale}</div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div>{dk.intent}</div>
                            <div className="text-[11px] text-slate-500">
                              {dk.opportunityType} · {dk.recommendedTargetAsset}
                            </div>
                          </td>
                          <td className="px-4 py-3 max-w-[200px] truncate font-mono text-[11px] text-slate-600 dark:text-slate-400">
                            {dk.foundOnUrl}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2.5">
                              {activeWebsite && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await onAddTrackedKeyword({
                                      websiteId: activeWebsite.id,
                                      keyword: dk.keyword,
                                      targetUrl: activeWebsite.url,
                                      country,
                                      language,
                                      device: 'desktop',
                                    });
                                    toast({ title: `Added "${dk.keyword}" to Rank Tracker`, variant: 'success' });
                                  }}
                                  className="text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
                                >
                                  Track
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => onSendToOnPageSeo(dk.keyword)}
                                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                              >
                                Optimize
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {competitorResult.contentGaps.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="font-display text-sm font-semibold">Content Gap Angles</h3>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {competitorResult.contentGaps.map((gap, i) => (
                      <div key={i} className="rounded-lg border border-slate-200 p-3.5 space-y-1.5 dark:border-slate-800">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{gap.topic}</span>
                          <button
                            type="button"
                            onClick={() => onSendToOnPageSeo(gap.targetKeyword, gap.suggestedTitle)}
                            className="text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            Draft in On-Page SEO
                          </button>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300">{gap.competitorAngle}</p>
                        <p className="text-[11px] text-slate-500 font-mono">Suggested: {gap.suggestedTitle}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 6: DATA PROVIDERS & CREDENTIAL TRANSPARENCY */}
      {tab === 'providers' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-display text-sm font-semibold">Modular Keyword &amp; Search Data Providers</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              All external API credentials stay strictly server-side in environment secrets. Metrics are populated only from verified connected sources and never fabricated.
            </p>
          </div>

          {providersLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 p-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Checking server provider configuration...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {providers.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 space-y-2.5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{p.name}</h3>
                    <StatusText
                      label={p.connected ? 'Connected' : p.id === 'gemini_ai' ? 'Not Configured' : 'Optional · Inactive'}
                      tone={p.connected ? 'success' : 'neutral'}
                    />
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">{p.capability}</div>
                  <div className="flex items-center gap-2 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Model: {p.pricingTier}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{p.note}</p>
                  {p.id === 'gemini_ai' && p.missingEnvVars.length > 0 && (
                    <div className="border-t border-slate-100 pt-2 font-mono text-[11px] text-slate-500 dark:border-slate-800">
                      Required Server Env: {p.missingEnvVars.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
