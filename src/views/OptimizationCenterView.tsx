import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Code2,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/apiClient';
import {
  CrawledPageSummary,
  OptimizationDraftFields,
  SeoAudit,
  SeoOptimization,
  SiteCrawl,
  Website,
  WpConnection,
  WpEntity,
} from '../types';

export interface OptimizationPrefill {
  websiteId: string;
  entityId?: string;
  remoteId?: number;
  entityType: 'product' | 'category' | 'page' | 'post' | 'url';
  targetUrl: string;
  title?: string;
  targetKeyword?: string;
}

interface OptimizationCenterViewProps {
  websites: Website[];
  wpConnections: WpConnection[];
  wpEntities: WpEntity[];
  siteCrawls: SiteCrawl[];
  optimizations: SeoOptimization[];
  selectedWebsiteId: string;
  prefill?: OptimizationPrefill | null;
  onClearPrefill?: () => void;
  onCreateOptimization: (input: {
    websiteId: string;
    entityId?: string;
    remoteId: number;
    entityType: 'product' | 'category' | 'page' | 'post' | 'url';
    targetUrl: string;
    targetKeyword?: string;
    originalSnapshot: OptimizationDraftFields & { focusKeyword?: string };
    optimizedDraft: OptimizationDraftFields;
    internalLinksSuggested: Array<{ anchorText: string; targetUrl: string; reason: string }>;
    faqSchemaJson?: string;
    aiNotes?: string;
  }) => Promise<string>;
  onUpdateOptimization: (
    id: string,
    updates: {
      status?: 'pending_review' | 'approved' | 'rejected';
      optimizedDraft?: OptimizationDraftFields;
      targetKeyword?: string;
      faqSchemaJson?: string;
      aiNotes?: string;
    }
  ) => Promise<void>;
  onDeleteOptimization: (id: string) => Promise<void>;
  onSaveAudit: (websiteId: string, audit: Omit<SeoAudit, 'id' | 'ownerId' | 'websiteId' | 'createdAt'>) => Promise<void>;
  onAddWebsitePrompt: () => void;
  onNavigateToWordPress: () => void;
}

type StatusFilter = 'all' | SeoOptimization['status'];

function formatStatusLabel(status: SeoOptimization['status']): {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
} {
  switch (status) {
    case 'approved':
      return { label: 'Approved · Ready', tone: 'info' };
    case 'applied':
      return { label: 'Applied Live', tone: 'success' };
    case 'rejected':
      return { label: 'Rejected', tone: 'danger' };
    case 'rolled_back':
      return { label: 'Rolled Back', tone: 'warning' };
    default:
      return { label: 'Pending Review', tone: 'warning' };
  }
}

export function OptimizationCenterView({
  websites,
  wpConnections,
  wpEntities,
  siteCrawls,
  optimizations,
  selectedWebsiteId,
  prefill,
  onClearPrefill,
  onCreateOptimization,
  onUpdateOptimization,
  onDeleteOptimization,
  onSaveAudit,
  onAddWebsitePrompt,
  onNavigateToWordPress,
}: OptimizationCenterViewProps) {
  const { isDemoMode } = useAuth();
  const { toast } = useToast();

  const defaultSiteId = selectedWebsiteId !== 'all' ? selectedWebsiteId : websites[0]?.id || '';
  const [targetWebsiteId, setTargetWebsiteId] = useState(defaultSiteId);
  const [targetKey, setTargetKey] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [targetKeyword, setTargetKeyword] = useState('');
  const [generating, setGenerating] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedOptId, setSelectedOptId] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);

  // Local editable draft synced to selectedOptId
  const [editDraft, setEditDraft] = useState<OptimizationDraftFields>({});
  const [editKeyword, setEditKeyword] = useState('');
  const [editFaqJson, setEditFaqJson] = useState('');
  const [savingEdits, setSavingEdits] = useState(false);
  const [applyingLive, setApplyingLive] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);

  useEffect(() => {
    if (selectedWebsiteId !== 'all') {
      setTargetWebsiteId(selectedWebsiteId);
    } else if (!targetWebsiteId && websites[0]) {
      setTargetWebsiteId(websites[0].id);
    }
  }, [selectedWebsiteId, websites, targetWebsiteId]);

  const scopedWpEntities = useMemo(
    () => wpEntities.filter((e) => !targetWebsiteId || e.websiteId === targetWebsiteId),
    [wpEntities, targetWebsiteId]
  );

  const scopedCrawlPages = useMemo<CrawledPageSummary[]>(() => {
    const crawl = siteCrawls.find((c) => c.websiteId === targetWebsiteId) || siteCrawls[0];
    return crawl?.pages || [];
  }, [siteCrawls, targetWebsiteId]);

  const targetOptions = useMemo(() => {
    const opts: Array<{
      key: string;
      label: string;
      entityId?: string;
      remoteId: number;
      entityType: 'product' | 'category' | 'page' | 'post' | 'url';
      url: string;
      title: string;
      seoTitle?: string;
      seoDescription?: string;
      shortDescription?: string;
      description?: string;
      focusKeyword?: string;
      missingAltCount?: number;
    }> = [];

    scopedWpEntities.forEach((e) => {
      opts.push({
        key: `wpe:${e.id}`,
        label: `[WC/WP ${e.entityType.toUpperCase()}] ${e.title} (${e.url})`,
        entityId: e.id,
        remoteId: e.remoteId,
        entityType: e.entityType,
        url: e.url,
        title: e.title,
        seoTitle: e.seoTitle,
        seoDescription: e.seoDescription,
        shortDescription: e.shortDescription,
        description: e.description,
        focusKeyword: e.focusKeyword,
        missingAltCount: e.missingAltCount,
      });
    });

    const seenUrls = new Set(opts.map((o) => o.url));
    scopedCrawlPages.forEach((p, idx) => {
      if (seenUrls.has(p.url)) return;
      opts.push({
        key: `crawl:${idx}:${p.url}`,
        label: `[Crawled ${p.pageType.toUpperCase()}] ${p.title || p.url} (Score ${p.score})`,
        remoteId: 0,
        entityType: 'url',
        url: p.url,
        title: p.title || p.url,
        seoTitle: p.title,
        seoDescription: p.metaDescription,
        missingAltCount: p.missingAltCount,
      });
    });

    return opts;
  }, [scopedWpEntities, scopedCrawlPages]);

  // Handle prefill from SeoAnalyzerView / WordPressView / SearchConsoleView
  useEffect(() => {
    if (!prefill) return;
    if (prefill.websiteId) setTargetWebsiteId(prefill.websiteId);
    if (prefill.targetKeyword) setTargetKeyword(prefill.targetKeyword);
    if (prefill.entityId) {
      setTargetKey(`wpe:${prefill.entityId}`);
      setCustomUrl('');
    } else if (prefill.targetUrl) {
      const match = targetOptions.find((o) => o.url === prefill.targetUrl);
      if (match) {
        setTargetKey(match.key);
        setCustomUrl('');
      } else {
        setTargetKey('custom');
        setCustomUrl(prefill.targetUrl);
      }
    }
    onClearPrefill?.();
  }, [prefill, targetOptions, onClearPrefill]);

  const scopedOptimizations = useMemo(() => {
    const base =
      selectedWebsiteId === 'all'
        ? optimizations
        : optimizations.filter((o) => o.websiteId === selectedWebsiteId);
    if (statusFilter === 'all') return base;
    return base.filter((o) => o.status === statusFilter);
  }, [optimizations, selectedWebsiteId, statusFilter]);

  const selectedOpt = useMemo(
    () =>
      scopedOptimizations.find((o) => o.id === selectedOptId) ||
      scopedOptimizations[0] ||
      null,
    [scopedOptimizations, selectedOptId]
  );

  useEffect(() => {
    if (!selectedOpt) return;
    setEditDraft({
      title: selectedOpt.optimizedDraft.title || '',
      seoTitle: selectedOpt.optimizedDraft.seoTitle || '',
      seoDescription: selectedOpt.optimizedDraft.seoDescription || '',
      shortDescription: selectedOpt.optimizedDraft.shortDescription || '',
      description: selectedOpt.optimizedDraft.description || '',
      headingSuggestions: selectedOpt.optimizedDraft.headingSuggestions || [],
      imageAltSuggestions: selectedOpt.optimizedDraft.imageAltSuggestions || [],
    });
    setEditKeyword(selectedOpt.targetKeyword || '');
    setEditFaqJson(selectedOpt.faqSchemaJson || '');
  }, [selectedOpt]);

  const siteInventory = useMemo(() => {
    const inv: Array<{ title: string; url: string }> = [];
    scopedWpEntities.forEach((e) => inv.push({ title: e.title, url: e.url }));
    scopedCrawlPages.forEach((p) => {
      if (!inv.some((i) => i.url === p.url)) inv.push({ title: p.title || p.url, url: p.url });
    });
    return inv.slice(0, 20);
  }, [scopedWpEntities, scopedCrawlPages]);

  if (websites.length === 0) {
    return (
      <EmptyState
        title="Add a website to launch the Optimization Center"
        description="Connect a website or WordPress/WooCommerce catalog to generate, diff, approve, and deploy AI-powered SEO optimizations."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);

    const chosen = targetOptions.find((o) => o.key === targetKey);
    const resolvedUrl = chosen?.url || customUrl.trim();
    if (!resolvedUrl) {
      setActionError('Select an imported page/product or enter a target URL.');
      return;
    }

    if (isDemoMode) {
      toast({
        title: 'Demo Mode Preview',
        description: 'Sign in with a verified account to run live Gemini SEO optimization drafts.',
        variant: 'info',
      });
      return;
    }

    setGenerating(true);
    try {
      const data = await apiFetch<{
        focusKeyword: string;
        optimizedDraft: OptimizationDraftFields;
        internalLinksSuggested: Array<{ anchorText: string; targetUrl: string; reason: string }>;
        faqSchemaJson?: string;
        aiNotes?: string;
      }>('/api/ai/optimize', {
        method: 'POST',
        body: JSON.stringify({
          entityType: chosen?.entityType || 'url',
          targetUrl: resolvedUrl,
          targetKeyword: targetKeyword.trim() || chosen?.focusKeyword || chosen?.title || '',
          currentTitle: chosen?.title || '',
          currentDescription: chosen?.description || '',
          currentShortDescription: chosen?.shortDescription || '',
          currentSeoTitle: chosen?.seoTitle || '',
          currentSeoDescription: chosen?.seoDescription || '',
          missingAltCount: chosen?.missingAltCount || 0,
          siteInventory,
        }),
      });

      const newId = await onCreateOptimization({
        websiteId: targetWebsiteId || websites[0].id,
        entityId: chosen?.entityId,
        remoteId: chosen?.remoteId || 0,
        entityType: chosen?.entityType || 'url',
        targetUrl: resolvedUrl,
        targetKeyword: data.focusKeyword || targetKeyword.trim() || chosen?.focusKeyword || '',
        originalSnapshot: {
          title: chosen?.title || '',
          seoTitle: chosen?.seoTitle || '',
          seoDescription: chosen?.seoDescription || '',
          shortDescription: chosen?.shortDescription || '',
          description: chosen?.description || '',
          focusKeyword: chosen?.focusKeyword || '',
        },
        optimizedDraft: data.optimizedDraft,
        internalLinksSuggested: data.internalLinksSuggested || [],
        faqSchemaJson: data.faqSchemaJson || '',
        aiNotes: data.aiNotes || '',
      });
      setSelectedOptId(newId);
      setStatusFilter('all');
      toast({
        title: 'Optimization draft created',
        description: 'Review the side-by-side diff and approve before applying live.',
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to generate optimization.';
      setActionError(msg);
      toast({ title: 'Optimization failed', description: msg, variant: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const canEditSelected =
    selectedOpt &&
    (selectedOpt.status === 'pending_review' ||
      selectedOpt.status === 'approved' ||
      selectedOpt.status === 'rejected');

  const handleSaveEdits = async () => {
    if (!selectedOpt || !canEditSelected) return;
    setSavingEdits(true);
    try {
      await onUpdateOptimization(selectedOpt.id, {
        optimizedDraft: editDraft,
        targetKeyword: editKeyword.trim(),
        faqSchemaJson: editFaqJson,
      });
      toast({ title: 'Optimization draft saved', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unable to update draft.',
        variant: 'error',
      });
    } finally {
      setSavingEdits(false);
    }
  };

  const handleDecision = async (status: 'approved' | 'rejected') => {
    if (!selectedOpt || !canEditSelected) return;
    setSavingEdits(true);
    try {
      await onUpdateOptimization(selectedOpt.id, {
        status,
        optimizedDraft: editDraft,
        targetKeyword: editKeyword.trim(),
        faqSchemaJson: editFaqJson,
      });
      toast({
        title: status === 'approved' ? 'Change approved' : 'Change rejected',
        description:
          status === 'approved'
            ? selectedOpt.remoteId > 0
              ? 'You can now push this approved update to your WordPress/WooCommerce site.'
              : 'Approved for manual copy/publish.'
            : 'Marked rejected. Live site untouched.',
        variant: status === 'approved' ? 'success' : 'info',
      });
    } catch (err) {
      toast({
        title: 'Status update failed',
        description: err instanceof Error ? err.message : 'Unable to update status.',
        variant: 'error',
      });
    } finally {
      setSavingEdits(false);
    }
  };

  const handleApplyToWordPress = async () => {
    if (!selectedOpt) return;
    setConfirmApplyOpen(false);
    if (isDemoMode) {
      toast({
        title: 'Demo Mode',
        description: 'Live WordPress REST mutation is disabled in Demo Mode.',
        variant: 'info',
      });
      return;
    }
    setApplyingLive(true);
    setActionError(null);
    try {
      const data = await apiFetch<{ detail: string; verifiedScore?: number }>('/api/wordpress/apply', {
        method: 'POST',
        body: JSON.stringify({ optimizationId: selectedOpt.id, recheckLive: true }),
      });
      toast({
        title: 'Applied to live site',
        description: data.verifiedScore
          ? `${data.detail} Live re-scan score: ${data.verifiedScore}/100.`
          : data.detail,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'WordPress update failed.';
      setActionError(msg);
      toast({ title: 'Live apply failed', description: msg, variant: 'error' });
    } finally {
      setApplyingLive(false);
    }
  };

  const handleRollback = async () => {
    if (!selectedOpt || selectedOpt.status !== 'applied') return;
    if (isDemoMode) {
      toast({ title: 'Demo Mode', description: 'Rollback runs against a connected WordPress site.', variant: 'info' });
      return;
    }
    setRollingBack(true);
    setActionError(null);
    try {
      const data = await apiFetch<{ detail: string }>('/api/wordpress/rollback', {
        method: 'POST',
        body: JSON.stringify({ optimizationId: selectedOpt.id }),
      });
      toast({
        title: 'Rolled back to original snapshot',
        description: data.detail,
        variant: 'info',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Rollback failed.';
      setActionError(msg);
      toast({ title: 'Rollback failed', description: msg, variant: 'error' });
    } finally {
      setRollingBack(false);
    }
  };

  const handleRecheckLivePage = async () => {
    if (!selectedOpt?.targetUrl) return;
    if (isDemoMode) {
      toast({ title: 'Demo Mode', description: 'Live crawler requires an authenticated workspace.', variant: 'info' });
      return;
    }
    setRechecking(true);
    try {
      const data = await apiFetch<Omit<SeoAudit, 'id' | 'ownerId' | 'websiteId' | 'createdAt'>>(
        '/api/seo/analyze',
        {
          method: 'POST',
          body: JSON.stringify({ url: selectedOpt.targetUrl }),
        }
      );
      await onSaveAudit(selectedOpt.websiteId, data);
      toast({
        title: `Live SEO score verified: ${data.score}/100`,
        description: `Audit saved for ${selectedOpt.targetUrl}`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Recheck failed',
        description: err instanceof Error ? err.message : 'Unable to scan URL.',
        variant: 'error',
      });
    } finally {
      setRechecking(false);
    }
  };

  const activeWpConn = selectedOpt
    ? wpConnections.find((c) => c.websiteId === selectedOpt.websiteId && c.status === 'connected')
    : undefined;

  return (
    <div className="space-y-6">
      {/* Safety Guarantee Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-2.5 text-slate-700 dark:text-slate-300">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <strong>Human-in-the-Loop Guarantee:</strong> AI drafts are saved with a full original snapshot. Live WordPress/WooCommerce records are never modified until you explicitly approve and confirm deployment, with one-click rollback.
          </div>
        </div>
        <button
          type="button"
          onClick={onNavigateToWordPress}
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400 whitespace-nowrap"
        >
          <span>WordPress / Woo Sync</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Generator Bar */}
      <form
        onSubmit={handleGenerate}
        className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold">Generate AI SEO Optimization Package</h2>
          <span className="text-[11px] text-slate-500">
            Grounded internal link inventory: {siteInventory.length} page(s)
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-3">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Website</label>
            <select
              value={targetWebsiteId}
              onChange={(e) => {
                setTargetWebsiteId(e.target.value);
                setTargetKey('');
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            >
              {websites.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.domain})
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-5">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Target Product, Page or URL
            </label>
            <select
              value={targetKey}
              onChange={(e) => setTargetKey(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">Select imported WP/Woo item or crawled page...</option>
              {targetOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
              <option value="custom">Custom Public URL...</option>
            </select>
            {targetKey === 'custom' && (
              <input
                type="url"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://example.com/product/sample"
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            )}
          </div>

          <div className="md:col-span-2">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Focus Keyword</label>
            <input
              type="text"
              value={targetKeyword}
              onChange={(e) => setTargetKeyword(e.target.value)}
              placeholder="e.g. titanium gravel bike"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>

          <div className="md:col-span-2 flex items-end">
            <button
              type="submit"
              disabled={generating}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span>{generating ? 'Optimizing...' : 'Generate Draft'}</span>
            </button>
          </div>
        </div>
      </form>

      {actionError && <ErrorBanner message={actionError} />}

      {/* Main Split Workspace: Optimization Queue + Side-by-Side Diff Editor */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Queue Column */}
        <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden flex flex-col">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xs font-semibold">
                Optimization Queue ({scopedOptimizations.length})
              </h3>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'pending_review', 'approved', 'applied', 'rejected'] as StatusFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    statusFilter === f
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {f === 'all' ? 'All' : f.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </button>
              ))}
            </div>
          </div>

          {scopedOptimizations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No optimization drafts match this filter yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-[680px] overflow-y-auto dark:divide-slate-800">
              {scopedOptimizations.map((opt) => {
                const st = formatStatusLabel(opt.status);
                const active = selectedOpt?.id === opt.id;
                return (
                  <div
                    key={opt.id}
                    className={`flex items-start justify-between gap-2 px-4 py-3 transition-colors ${
                      active
                        ? 'bg-indigo-50/70 dark:bg-indigo-950/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedOptId(opt.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {opt.optimizedDraft.title || opt.originalSnapshot.title || opt.targetUrl}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                        {opt.entityType.toUpperCase()} · {opt.targetKeyword || 'No keyword'}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <StatusText label={st.label} tone={st.tone} />
                        {opt.verifiedScore ? (
                          <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400 tabular-nums">
                            · Live {opt.verifiedScore}/100
                          </span>
                        ) : null}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await onDeleteOptimization(opt.id);
                        toast({ title: 'Optimization deleted', variant: 'info' });
                      }}
                      className="rounded p-1 text-slate-400 hover:text-red-600"
                      aria-label="Delete optimization"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Review & Diff Editor */}
        <div className="lg:col-span-8">
          {!selectedOpt ? (
            <EmptyState
              title="Select or generate an optimization draft"
              description="Compare original copy side-by-side against Gemini AI recommendations, fine-tune meta tags and structured FAQ schema, approve, and push directly to WordPress or WooCommerce."
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5 dark:border-slate-800 dark:bg-slate-900">
              {/* Header Bar */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusText
                      label={formatStatusLabel(selectedOpt.status).label}
                      tone={formatStatusLabel(selectedOpt.status).tone}
                    />
                    <span className="text-xs text-slate-400">·</span>
                    <span className="font-mono text-[11px] uppercase text-slate-500">
                      {selectedOpt.entityType}
                      {selectedOpt.remoteId > 0 ? ` #${selectedOpt.remoteId}` : ' (URL-only)'}
                    </span>
                  </div>
                  <a
                    href={selectedOpt.targetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 truncate font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    <span className="truncate max-w-md">{selectedOpt.targetUrl}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>

                {/* Workflow Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {canEditSelected && (
                    <>
                      <button
                        type="button"
                        onClick={handleSaveEdits}
                        disabled={savingEdits}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        <Save className="h-3.5 w-3.5" />
                        <span>Save Edits</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecision('rejected')}
                        disabled={savingEdits}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Reject</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecision('approved')}
                        disabled={savingEdits}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Approve</span>
                      </button>
                    </>
                  )}

                  {selectedOpt.status === 'approved' && selectedOpt.remoteId > 0 && (
                    <button
                      type="button"
                      onClick={() => setConfirmApplyOpen(true)}
                      disabled={applyingLive || !activeWpConn}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {applyingLive ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <UploadCloud className="h-3.5 w-3.5" />
                      )}
                      <span>{applyingLive ? 'Applying Live...' : 'Apply to WordPress'}</span>
                    </button>
                  )}

                  {selectedOpt.status === 'applied' && (
                    <>
                      <button
                        type="button"
                        onClick={handleRecheckLivePage}
                        disabled={rechecking}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        {rechecking ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        <span>Recheck Live Score</span>
                      </button>
                      {selectedOpt.remoteId > 0 && (
                        <button
                          type="button"
                          onClick={handleRollback}
                          disabled={rollingBack}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
                        >
                          {rollingBack ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          <span>Rollback Original</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {selectedOpt.status === 'approved' && selectedOpt.remoteId === 0 && (
                <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>
                    This draft targets a crawled URL without a linked WordPress/WooCommerce ID. Copy the approved fields manually into your CMS, or import the catalog via WordPress &amp; WooCommerce Sync to push via REST API.
                  </span>
                </div>
              )}

              {selectedOpt.aiNotes && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
                  <strong className="font-semibold">AI Optimization Rationale:</strong> {selectedOpt.aiNotes}
                </div>
              )}

              {/* Focus Keyword */}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Target Focus Keyword (Original: {selectedOpt.originalSnapshot.focusKeyword || 'None'})
                </label>
                <input
                  type="text"
                  disabled={!canEditSelected}
                  value={editKeyword}
                  onChange={(e) => setEditKeyword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              {/* Side-by-side Diff Grid */}
              <div className="space-y-4">
                {/* Title */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-slate-500">Original Title / Name</div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300 min-h-[40px]">
                      {selectedOpt.originalSnapshot.title || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-indigo-700 dark:text-indigo-400">
                      Optimized Title (Editable)
                    </div>
                    <input
                      type="text"
                      disabled={!canEditSelected}
                      value={editDraft.title || ''}
                      onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>
                </div>

                {/* Meta Title */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-slate-500">Original SEO Meta Title</div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300 min-h-[40px]">
                      {selectedOpt.originalSnapshot.seoTitle || 'Missing'}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] font-medium text-indigo-700 dark:text-indigo-400">
                      <span>Optimized SEO Meta Title</span>
                      <span className="font-mono tabular-nums">{(editDraft.seoTitle || '').length}/60</span>
                    </div>
                    <input
                      type="text"
                      disabled={!canEditSelected}
                      value={editDraft.seoTitle || ''}
                      onChange={(e) => setEditDraft((d) => ({ ...d, seoTitle: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>
                </div>

                {/* Meta Description */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-slate-500">Original Meta Description</div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300 min-h-[68px]">
                      {selectedOpt.originalSnapshot.seoDescription || 'Missing'}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] font-medium text-indigo-700 dark:text-indigo-400">
                      <span>Optimized Meta Description</span>
                      <span className="font-mono tabular-nums">{(editDraft.seoDescription || '').length}/155</span>
                    </div>
                    <textarea
                      rows={3}
                      disabled={!canEditSelected}
                      value={editDraft.seoDescription || ''}
                      onChange={(e) => setEditDraft((d) => ({ ...d, seoDescription: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>
                </div>

                {/* Short Description */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-slate-500">Original Short Description / Excerpt</div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300 max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {selectedOpt.originalSnapshot.shortDescription || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-indigo-700 dark:text-indigo-400">
                      Optimized Short Description
                    </div>
                    <textarea
                      rows={3}
                      disabled={!canEditSelected}
                      value={editDraft.shortDescription || ''}
                      onChange={(e) => setEditDraft((d) => ({ ...d, shortDescription: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>
                </div>

                {/* Full Description */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-slate-500">Original Body / Product Copy</div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300 max-h-56 overflow-y-auto whitespace-pre-wrap">
                      {selectedOpt.originalSnapshot.description || 'Not captured / Empty'}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-indigo-700 dark:text-indigo-400">
                      Optimized Body Copy / HTML
                    </div>
                    <textarea
                      rows={9}
                      disabled={!canEditSelected}
                      value={editDraft.description || ''}
                      onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-[11px] leading-relaxed outline-none focus:border-indigo-600 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>
                </div>
              </div>

              {/* Headings, Alt Tags, Internal Links, FAQ Schema */}
              <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 md:grid-cols-2 dark:border-slate-800">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                      Recommended Headings (H2/H3)
                    </div>
                    {(editDraft.headingSuggestions || []).length === 0 ? (
                      <p className="text-xs text-slate-500">No heading suggestions.</p>
                    ) : (
                      <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400 list-disc pl-4">
                        {editDraft.headingSuggestions!.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                      Image Alt Attribute Suggestions
                    </div>
                    {(editDraft.imageAltSuggestions || []).length === 0 ? (
                      <p className="text-xs text-slate-500">All inspected images have alt text or none supplied.</p>
                    ) : (
                      <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400 list-disc pl-4">
                        {editDraft.imageAltSuggestions!.map((alt, i) => (
                          <li key={i}>{alt}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                      <Link2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>Grounded Internal Link Suggestions</span>
                    </div>
                    {selectedOpt.internalLinksSuggested.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        Crawl additional pages or import WP catalog to populate grounded internal links.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {selectedOpt.internalLinksSuggested.map((lnk, i) => (
                          <div key={i} className="rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-800/50">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              Anchor: &ldquo;{lnk.anchorText}&rdquo;
                            </div>
                            <div className="truncate font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                              {lnk.targetUrl}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">{lnk.reason}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                    <Code2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>JSON-LD FAQPage Schema</span>
                  </div>
                  <textarea
                    rows={12}
                    disabled={!canEditSelected}
                    value={editFaqJson}
                    onChange={(e) => setEditFaqJson(e.target.value)}
                    placeholder="Structured JSON-LD FAQPage markup..."
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed outline-none focus:border-indigo-600 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Explicit Live Apply Confirmation Modal */}
      {confirmApplyOpen && selectedOpt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-base font-bold">Confirm Live Site Update</h3>
              <button
                type="button"
                onClick={() => setConfirmApplyOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              You are about to push approved SEO changes to live{' '}
              <strong>
                {selectedOpt.entityType.toUpperCase()} #{selectedOpt.remoteId}
              </strong>{' '}
              via WordPress/WooCommerce REST API. Your original snapshot remains stored in Firestore for one-click rollback.
            </p>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 font-mono text-[11px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
              Target URL: {selectedOpt.targetUrl}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmApplyOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyToWordPress}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                <span>Confirm &amp; Push Live</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
