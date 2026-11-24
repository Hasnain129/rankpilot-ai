import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Link2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { ApiRequestError, apiFetch } from '../lib/apiClient';
import {
  CrawledPageSummary,
  OptimizationDraftFields,
  SeoAudit,
  SeoOptimization,
  SiteCrawl,
  SyncLog,
  Website,
  WpConnection,
  WpEntity,
} from '../types';
import { WordPressView } from './WordPressView';

export interface OptimizationPrefill {
  websiteId: string;
  entityId?: string;
  remoteId?: number;
  entityType: 'product' | 'category' | 'page' | 'post' | 'url';
  targetUrl: string;
  title?: string;
  targetKeyword?: string;
}

export interface OnPageWorkspaceState {
  activeTab: 'drafts' | 'wordpress';
  targetWebsiteId: string;
  targetKey: string;
  customUrl: string;
  targetKeyword: string;
  selectedOptId: string;
}

interface OptimizationCenterViewProps {
  websites: Website[];
  wpConnections: WpConnection[];
  wpEntities: WpEntity[];
  syncLogs: SyncLog[];
  siteCrawls: SiteCrawl[];
  optimizations: SeoOptimization[];
  selectedWebsiteId: string;
  persistedState?: OnPageWorkspaceState;
  onPersistState?: (next: OnPageWorkspaceState) => void;
  initialTab?: 'drafts' | 'wordpress';
  onConsumeInitialTab?: () => void;
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
  onSaveAudit: (
    websiteId: string,
    audit: Omit<SeoAudit, 'id' | 'ownerId' | 'websiteId' | 'createdAt'>
  ) => Promise<void>;
  onAddWebsitePrompt: () => void;
}

type StatusFilter = 'all' | SeoOptimization['status'];

type FieldKey =
  | 'title'
  | 'focusKeyword'
  | 'seoTitle'
  | 'seoDescription'
  | 'shortDescription'
  | 'description'
  | 'headings'
  | 'imageAlt'
  | 'internalLinks';

type FieldDecision = 'pending' | 'approved' | 'rejected';

const DEFAULT_FIELD_DECISIONS: Record<FieldKey, FieldDecision> = {
  title: 'pending',
  focusKeyword: 'pending',
  seoTitle: 'pending',
  seoDescription: 'pending',
  shortDescription: 'pending',
  description: 'pending',
  headings: 'pending',
  imageAlt: 'pending',
  internalLinks: 'pending',
};

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

function stripTagsPreview(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatShortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url;
  }
}

interface ModelAttemptInfo {
  model: string;
  status: number;
  apiStatus?: string;
  attempts: number;
  detail?: string;
}

export function OptimizationCenterView({
  websites,
  wpConnections,
  wpEntities,
  syncLogs,
  siteCrawls,
  optimizations,
  selectedWebsiteId,
  persistedState,
  onPersistState,
  initialTab,
  onConsumeInitialTab,
  prefill,
  onClearPrefill,
  onCreateOptimization,
  onUpdateOptimization,
  onDeleteOptimization,
  onSaveAudit,
  onAddWebsitePrompt,
}: OptimizationCenterViewProps) {
  const { toast } = useToast();

  const initialWebsiteId =
    persistedState?.targetWebsiteId &&
    websites.some((w) => w.id === persistedState.targetWebsiteId)
      ? persistedState.targetWebsiteId
      : selectedWebsiteId !== 'all'
      ? selectedWebsiteId
      : websites[0]?.id || '';

  const [activeTab, setActiveTab] = useState<'drafts' | 'wordpress'>(
    initialTab || persistedState?.activeTab || 'drafts'
  );
  const [targetWebsiteId, setTargetWebsiteId] = useState<string>(initialWebsiteId);
  const [targetKey, setTargetKey] = useState<string>(persistedState?.targetKey || '');
  const [customUrl, setCustomUrl] = useState<string>(persistedState?.customUrl || '');
  const [targetKeyword, setTargetKeyword] = useState<string>(persistedState?.targetKeyword || '');
  const [generating, setGenerating] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOptId, setSelectedOptId] = useState<string>(persistedState?.selectedOptId || '');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [errorAttempts, setErrorAttempts] = useState<ModelAttemptInfo[]>([]);
  const [lastActionFeedback, setLastActionFeedback] = useState<{
    message: string;
    tone: 'success' | 'info' | 'warning';
  } | null>(null);

  // Local editable draft synced to selectedOptId
  const [editDraft, setEditDraft] = useState<OptimizationDraftFields>({});
  const [editKeyword, setEditKeyword] = useState('');
  const [editFaqJson, setEditFaqJson] = useState('');
  const [fieldDecisions, setFieldDecisions] =
    useState<Record<FieldKey, FieldDecision>>(DEFAULT_FIELD_DECISIONS);
  const [showNotesAndSchema, setShowNotesAndSchema] = useState(false);

  const [savingEdits, setSavingEdits] = useState(false);
  const [applyingLive, setApplyingLive] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);

  // Sync workspace state back up to App so switching sidebar views preserves selections
  useEffect(() => {
    onPersistState?.({
      activeTab,
      targetWebsiteId,
      targetKey,
      customUrl,
      targetKeyword,
      selectedOptId,
    });
  }, [
    activeTab,
    targetWebsiteId,
    targetKey,
    customUrl,
    targetKeyword,
    selectedOptId,
    onPersistState,
  ]);

  // Keep website valid if global website changes or websites list loads
  useEffect(() => {
    if (selectedWebsiteId !== 'all') {
      if (websites.some((w) => w.id === selectedWebsiteId)) {
        setTargetWebsiteId((prev) => (prev === selectedWebsiteId ? prev : selectedWebsiteId));
      }
    } else if ((!targetWebsiteId || !websites.some((w) => w.id === targetWebsiteId)) && websites[0]) {
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
      source: 'wp' | 'crawl';
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
      crawlScore?: number;
    }> = [];

    scopedWpEntities.forEach((e) => {
      opts.push({
        key: `wpe:${e.id}`,
        source: 'wp',
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
        source: 'crawl',
        remoteId: 0,
        entityType: 'url',
        url: p.url,
        title: p.title || p.url,
        seoTitle: p.title,
        seoDescription: p.metaDescription,
        missingAltCount: p.missingAltCount,
        crawlScore: p.score,
      });
    });

    return opts;
  }, [scopedWpEntities, scopedCrawlPages]);

  const wpTargetOptions = useMemo(
    () => targetOptions.filter((o) => o.source === 'wp'),
    [targetOptions]
  );
  const crawlTargetOptions = useMemo(
    () => targetOptions.filter((o) => o.source === 'crawl'),
    [targetOptions]
  );

  const selectedFormTarget = useMemo(
    () => targetOptions.find((o) => o.key === targetKey),
    [targetOptions, targetKey]
  );

  useEffect(() => {
    if (!initialTab) return;
    setActiveTab(initialTab);
    onConsumeInitialTab?.();
  }, [initialTab, onConsumeInitialTab]);

  // Handle prefill from SeoAnalyzerView / WordPressView / SearchConsoleView / KeywordResearchView
  useEffect(() => {
    if (!prefill) return;
    setActiveTab('drafts');
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

  // All drafts scoped to website filter (source of truth for real summary counts)
  const websiteScopedOptimizations = useMemo(
    () =>
      selectedWebsiteId === 'all'
        ? optimizations
        : optimizations.filter((o) => o.websiteId === selectedWebsiteId),
    [optimizations, selectedWebsiteId]
  );

  const summaryStats = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let applied = 0;
    let rejected = 0;
    let rolledBack = 0;
    for (const opt of websiteScopedOptimizations) {
      if (opt.status === 'pending_review') pending++;
      else if (opt.status === 'approved') approved++;
      else if (opt.status === 'applied') applied++;
      else if (opt.status === 'rejected') rejected++;
      else if (opt.status === 'rolled_back') rolledBack++;
    }
    return {
      total: websiteScopedOptimizations.length,
      pending,
      approved,
      applied,
      rejected,
      rolledBack,
    };
  }, [websiteScopedOptimizations]);

  const filteredOptimizations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return websiteScopedOptimizations.filter((opt) => {
      if (statusFilter !== 'all' && opt.status !== statusFilter) return false;
      if (!q) return true;
      const title = (opt.optimizedDraft.title || opt.originalSnapshot.title || '').toLowerCase();
      const url = (opt.targetUrl || '').toLowerCase();
      const kw = (opt.targetKeyword || '').toLowerCase();
      return title.includes(q) || url.includes(q) || kw.includes(q);
    });
  }, [websiteScopedOptimizations, statusFilter, searchQuery]);

  const selectedOpt = useMemo(
    () =>
      filteredOptimizations.find((o) => o.id === selectedOptId) ||
      filteredOptimizations[0] ||
      null,
    [filteredOptimizations, selectedOptId]
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
    const initialDecision: FieldDecision =
      selectedOpt.status === 'approved' || selectedOpt.status === 'applied'
        ? 'approved'
        : selectedOpt.status === 'rejected'
        ? 'rejected'
        : 'pending';
    setFieldDecisions({
      title: initialDecision,
      focusKeyword: initialDecision,
      seoTitle: initialDecision,
      seoDescription: initialDecision,
      shortDescription: initialDecision,
      description: initialDecision,
      headings: initialDecision,
      imageAlt: initialDecision,
      internalLinks: initialDecision,
    });
    setLastActionFeedback(null);
  }, [selectedOpt]);

  const siteInventory = useMemo(() => {
    const inv: Array<{ title: string; url: string }> = [];
    scopedWpEntities.forEach((e) => inv.push({ title: e.title, url: e.url }));
    scopedCrawlPages.forEach((p) => {
      if (!inv.some((i) => i.url === p.url)) inv.push({ title: p.title || p.url, url: p.url });
    });
    return inv.slice(0, 12);
  }, [scopedWpEntities, scopedCrawlPages]);

  if (websites.length === 0) {
    return (
      <EmptyState
        title="Add a website to open On-Page SEO"
        description="Add your site or connect WordPress & WooCommerce to generate, compare, approve, and sync AI-powered SEO drafts."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setErrorAttempts([]);
    setLastActionFeedback(null);

    const chosen = selectedFormTarget;
    const resolvedUrl = chosen?.url || customUrl.trim();
    if (!resolvedUrl) {
      setActionError('Select a page/product or enter a valid target URL.');
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
        meta?: { modelUsed?: string };
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
      setSearchQuery('');
      setLastActionFeedback({
        message: 'New AI draft saved as Pending Review. Review changes before approving.',
        tone: 'info',
      });
      toast({
        title: 'SEO suggestions generated',
        description: 'Review side-by-side changes and approve before syncing live.',
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to generate SEO suggestions.';
      setActionError(msg);
      if (err instanceof ApiRequestError && Array.isArray(err.data?.modelAttempts)) {
        setErrorAttempts(err.data.modelAttempts as ModelAttemptInfo[]);
      }
      toast({ title: 'SEO generation failed', description: msg, variant: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const canEditSelected =
    selectedOpt &&
    (selectedOpt.status === 'pending_review' ||
      selectedOpt.status === 'approved' ||
      selectedOpt.status === 'rejected');

  const buildEffectivePayload = (decisionsOverride?: Record<FieldKey, FieldDecision>) => {
    const activeDecisions = decisionsOverride || fieldDecisions;
    if (!selectedOpt) {
      return { draft: editDraft, keyword: editKeyword.trim() };
    }
    return {
      keyword:
        activeDecisions.focusKeyword === 'rejected'
          ? selectedOpt.originalSnapshot.focusKeyword || ''
          : editKeyword.trim(),
      draft: {
        ...editDraft,
        title:
          activeDecisions.title === 'rejected'
            ? selectedOpt.originalSnapshot.title || ''
            : editDraft.title || '',
        seoTitle:
          activeDecisions.seoTitle === 'rejected'
            ? selectedOpt.originalSnapshot.seoTitle || ''
            : editDraft.seoTitle || '',
        seoDescription:
          activeDecisions.seoDescription === 'rejected'
            ? selectedOpt.originalSnapshot.seoDescription || ''
            : editDraft.seoDescription || '',
        shortDescription:
          activeDecisions.shortDescription === 'rejected'
            ? selectedOpt.originalSnapshot.shortDescription || ''
            : editDraft.shortDescription || '',
        description:
          activeDecisions.description === 'rejected'
            ? selectedOpt.originalSnapshot.description || ''
            : editDraft.description || '',
        headingSuggestions:
          activeDecisions.headings === 'rejected' ? [] : editDraft.headingSuggestions || [],
        imageAltSuggestions:
          activeDecisions.imageAlt === 'rejected' ? [] : editDraft.imageAltSuggestions || [],
      },
    };
  };

  const handleFieldDecision = (field: FieldKey, decision: 'approved' | 'rejected') => {
    setFieldDecisions((prev) => ({ ...prev, [field]: decision }));
    if (decision === 'approved' && selectedOpt) {
      if (field === 'title' && !editDraft.title) {
        setEditDraft((d) => ({ ...d, title: selectedOpt.optimizedDraft.title || '' }));
      } else if (field === 'focusKeyword' && !editKeyword) {
        setEditKeyword(selectedOpt.targetKeyword || '');
      } else if (field === 'seoTitle' && !editDraft.seoTitle) {
        setEditDraft((d) => ({ ...d, seoTitle: selectedOpt.optimizedDraft.seoTitle || '' }));
      } else if (field === 'seoDescription' && !editDraft.seoDescription) {
        setEditDraft((d) => ({
          ...d,
          seoDescription: selectedOpt.optimizedDraft.seoDescription || '',
        }));
      } else if (field === 'shortDescription' && !editDraft.shortDescription) {
        setEditDraft((d) => ({
          ...d,
          shortDescription: selectedOpt.optimizedDraft.shortDescription || '',
        }));
      } else if (field === 'description' && !editDraft.description) {
        setEditDraft((d) => ({
          ...d,
          description: selectedOpt.optimizedDraft.description || '',
        }));
      }
    }
  };

  const handleSaveEdits = async () => {
    if (!selectedOpt || !canEditSelected) return;
    setSavingEdits(true);
    setActionError(null);
    try {
      const effective = buildEffectivePayload();
      await onUpdateOptimization(selectedOpt.id, {
        optimizedDraft: effective.draft,
        targetKeyword: effective.keyword,
        faqSchemaJson: editFaqJson,
      });
      setLastActionFeedback({
        message: `Draft edits saved at ${new Date().toLocaleTimeString()}.`,
        tone: 'success',
      });
      toast({ title: 'Draft changes saved', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unable to save draft edits.',
        variant: 'error',
      });
    } finally {
      setSavingEdits(false);
    }
  };

  const handleBulkDecision = async (mode: 'approve_all' | 'approve_selected' | 'reject_all') => {
    if (!selectedOpt || !canEditSelected) return;
    setSavingEdits(true);
    setActionError(null);
    try {
      let nextDecisions: Record<FieldKey, FieldDecision>;
      if (mode === 'approve_all') {
        nextDecisions = {
          title: 'approved',
          focusKeyword: 'approved',
          seoTitle: 'approved',
          seoDescription: 'approved',
          shortDescription: 'approved',
          description: 'approved',
          headings: 'approved',
          imageAlt: 'approved',
          internalLinks: 'approved',
        };
      } else if (mode === 'reject_all') {
        nextDecisions = {
          title: 'rejected',
          focusKeyword: 'rejected',
          seoTitle: 'rejected',
          seoDescription: 'rejected',
          shortDescription: 'rejected',
          description: 'rejected',
          headings: 'rejected',
          imageAlt: 'rejected',
          internalLinks: 'rejected',
        };
      } else {
        nextDecisions = {
          title: fieldDecisions.title === 'rejected' ? 'rejected' : 'approved',
          focusKeyword: fieldDecisions.focusKeyword === 'rejected' ? 'rejected' : 'approved',
          seoTitle: fieldDecisions.seoTitle === 'rejected' ? 'rejected' : 'approved',
          seoDescription: fieldDecisions.seoDescription === 'rejected' ? 'rejected' : 'approved',
          shortDescription:
            fieldDecisions.shortDescription === 'rejected' ? 'rejected' : 'approved',
          description: fieldDecisions.description === 'rejected' ? 'rejected' : 'approved',
          headings: fieldDecisions.headings === 'rejected' ? 'rejected' : 'approved',
          imageAlt: fieldDecisions.imageAlt === 'rejected' ? 'rejected' : 'approved',
          internalLinks: fieldDecisions.internalLinks === 'rejected' ? 'rejected' : 'approved',
        };
      }

      setFieldDecisions(nextDecisions);
      const nextStatus: 'approved' | 'rejected' = mode === 'reject_all' ? 'rejected' : 'approved';
      const effective = buildEffectivePayload(nextDecisions);

      await onUpdateOptimization(selectedOpt.id, {
        status: nextStatus,
        optimizedDraft: effective.draft,
        targetKeyword: effective.keyword,
        faqSchemaJson: editFaqJson,
      });

      const msg =
        nextStatus === 'approved'
          ? selectedOpt.remoteId > 0
            ? 'Approved and ready to apply to WordPress / WooCommerce (not published yet).'
            : 'Approved and saved to workspace.'
          : 'All suggestions rejected. Live website remains unchanged.';

      setLastActionFeedback({
        message: msg,
        tone: nextStatus === 'approved' ? 'success' : 'warning',
      });
      toast({
        title:
          mode === 'reject_all'
            ? 'All suggestions rejected'
            : mode === 'approve_all'
            ? 'All suggestions approved'
            : 'Selected suggestions approved',
        description: msg,
        variant: nextStatus === 'approved' ? 'success' : 'info',
      });
    } catch (err) {
      toast({
        title: 'Status update failed',
        description: err instanceof Error ? err.message : 'Unable to update approval status.',
        variant: 'error',
      });
    } finally {
      setSavingEdits(false);
    }
  };

  const handleApplyToWordPress = async () => {
    if (!selectedOpt) return;
    setConfirmApplyOpen(false);
    setApplyingLive(true);
    setActionError(null);
    setErrorAttempts([]);
    try {
      const data = await apiFetch<{ detail: string; verifiedScore?: number }>(
        '/api/wordpress/apply',
        {
          method: 'POST',
          body: JSON.stringify({ optimizationId: selectedOpt.id, recheckLive: true }),
        }
      );
      setLastActionFeedback({
        message: data.verifiedScore
          ? `Applied live. Verified SEO score: ${data.verifiedScore}/100.`
          : data.detail,
        tone: 'success',
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
    setRollingBack(true);
    setActionError(null);
    try {
      const data = await apiFetch<{ detail: string }>('/api/wordpress/rollback', {
        method: 'POST',
        body: JSON.stringify({ optimizationId: selectedOpt.id }),
      });
      setLastActionFeedback({
        message: `Rolled back to original snapshot. ${data.detail}`,
        tone: 'warning',
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
    setRechecking(true);
    try {
      const data = await apiFetch<
        Omit<SeoAudit, 'id' | 'ownerId' | 'websiteId' | 'createdAt'>
      >('/api/seo/analyze', {
        method: 'POST',
        body: JSON.stringify({ url: selectedOpt.targetUrl }),
      });
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

  const hasRejectedField = Object.values(fieldDecisions).some((d) => d === 'rejected');
  const activeWpConn = selectedOpt
    ? wpConnections.find((c) => c.websiteId === selectedOpt.websiteId && c.status === 'connected')
    : undefined;

  const statusTabs: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: 'all', label: 'All', count: summaryStats.total },
    { key: 'pending_review', label: 'Pending', count: summaryStats.pending },
    { key: 'approved', label: 'Approved', count: summaryStats.approved },
    { key: 'applied', label: 'Applied', count: summaryStats.applied },
    { key: 'rejected', label: 'Rejected', count: summaryStats.rejected },
    ...(summaryStats.rolledBack > 0
      ? [{ key: 'rolled_back' as StatusFilter, label: 'Rolled Back', count: summaryStats.rolledBack }]
      : []),
  ];

  const comparisonFields = selectedOpt
    ? [
        {
          key: 'title' as FieldKey,
          label: 'Page Title',
          current: selectedOpt.originalSnapshot.title || 'Not set',
          recommended: (
            <input
              type="text"
              disabled={!canEditSelected || fieldDecisions.title === 'rejected'}
              value={editDraft.title || ''}
              onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-indigo-600 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-800/40"
            />
          ),
        },
        {
          key: 'focusKeyword' as FieldKey,
          label: 'Focus Keyword',
          current: selectedOpt.originalSnapshot.focusKeyword || 'Not set',
          recommended: (
            <input
              type="text"
              disabled={!canEditSelected || fieldDecisions.focusKeyword === 'rejected'}
              value={editKeyword}
              onChange={(e) => setEditKeyword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-indigo-600 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-800/40"
            />
          ),
        },
        {
          key: 'seoTitle' as FieldKey,
          label: 'SEO Meta Title',
          current: selectedOpt.originalSnapshot.seoTitle || 'Not set',
          recommended: (
            <div className="space-y-1">
              <input
                type="text"
                disabled={!canEditSelected || fieldDecisions.seoTitle === 'rejected'}
                value={editDraft.seoTitle || ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, seoTitle: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-indigo-600 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-800/40"
              />
              <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                <span>Recommended: 50–60 chars</span>
                <span
                  className={
                    (editDraft.seoTitle || '').length > 60
                      ? 'font-medium text-amber-600 dark:text-amber-400'
                      : ''
                  }
                >
                  {(editDraft.seoTitle || '').length} / 60
                </span>
              </div>
            </div>
          ),
        },
        {
          key: 'seoDescription' as FieldKey,
          label: 'Meta Description',
          current: selectedOpt.originalSnapshot.seoDescription || 'Not set',
          recommended: (
            <div className="space-y-1">
              <textarea
                rows={3}
                disabled={!canEditSelected || fieldDecisions.seoDescription === 'rejected'}
                value={editDraft.seoDescription || ''}
                onChange={(e) =>
                  setEditDraft((d) => ({ ...d, seoDescription: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs leading-relaxed text-slate-900 outline-none focus:border-indigo-600 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-800/40"
              />
              <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                <span>Recommended: 135–155 chars</span>
                <span
                  className={
                    (editDraft.seoDescription || '').length > 160
                      ? 'font-medium text-amber-600 dark:text-amber-400'
                      : ''
                  }
                >
                  {(editDraft.seoDescription || '').length} / 155
                </span>
              </div>
            </div>
          ),
        },
        {
          key: 'shortDescription' as FieldKey,
          label: 'Short Description / Excerpt',
          current:
            stripTagsPreview(selectedOpt.originalSnapshot.shortDescription) || 'Not set',
          recommended: (
            <textarea
              rows={2}
              disabled={!canEditSelected || fieldDecisions.shortDescription === 'rejected'}
              value={editDraft.shortDescription || ''}
              onChange={(e) =>
                setEditDraft((d) => ({ ...d, shortDescription: e.target.value }))
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs leading-relaxed text-slate-900 outline-none focus:border-indigo-600 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-800/40"
            />
          ),
        },
        {
          key: 'description' as FieldKey,
          label: 'Body Copy / HTML',
          current:
            stripTagsPreview(selectedOpt.originalSnapshot.description).slice(0, 420) ||
            'No body copy captured in snapshot',
          recommended: (
            <textarea
              rows={5}
              disabled={!canEditSelected || fieldDecisions.description === 'rejected'}
              value={editDraft.description || ''}
              onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-900 outline-none focus:border-indigo-600 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-800/40"
            />
          ),
        },
        {
          key: 'headings' as FieldKey,
          label: 'Heading Structure',
          current: 'Existing page H1 / H2 hierarchy',
          recommended:
            (editDraft.headingSuggestions || []).length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                No heading changes suggested.
              </div>
            ) : (
              <ul className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-700 list-disc dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-200">
                {editDraft.headingSuggestions!.map((h, i) => (
                  <li key={i} className="ml-2">
                    {h}
                  </li>
                ))}
              </ul>
            ),
        },
        {
          key: 'imageAlt' as FieldKey,
          label: 'Image Alt Text',
          current: 'Existing image alt attributes',
          recommended:
            (editDraft.imageAltSuggestions || []).length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                No image alt text changes suggested.
              </div>
            ) : (
              <ul className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-700 list-disc dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-200">
                {editDraft.imageAltSuggestions!.map((alt, i) => (
                  <li key={i} className="ml-2">
                    {alt}
                  </li>
                ))}
              </ul>
            ),
        },
        {
          key: 'internalLinks' as FieldKey,
          label: 'Internal Links',
          current: 'Existing outbound internal links',
          recommended:
            selectedOpt.internalLinksSuggested.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                No internal link recommendations generated.
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                {selectedOpt.internalLinksSuggested.map((lnk, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {lnk.anchorText}
                      </div>
                      <div className="truncate font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                        {lnk.targetUrl}
                      </div>
                      {lnk.reason && (
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {lnk.reason}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ),
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Workspace Header & Tab Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            On-Page SEO Workspace
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Generate AI-assisted on-page recommendations, compare side-by-side drafts, and approve before syncing live.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="On-Page SEO sections"
          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'drafts'}
            onClick={() => setActiveTab('drafts')}
            className={`inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'drafts'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>On-Page SEO Drafts</span>
            <span className="font-mono text-[11px] tabular-nums opacity-85">
              {summaryStats.total}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'wordpress'}
            onClick={() => setActiveTab('wordpress')}
            className={`inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'wordpress'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>WordPress &amp; WooCommerce Sync</span>
            <span className="font-mono text-[11px] tabular-nums opacity-85">
              {wpEntities.length}
            </span>
          </button>
        </div>
      </div>

      {activeTab === 'wordpress' ? (
        <WordPressView
          websites={websites}
          wpConnections={wpConnections}
          wpEntities={wpEntities}
          syncLogs={syncLogs}
          optimizations={optimizations}
          selectedWebsiteId={selectedWebsiteId}
          onAddWebsitePrompt={onAddWebsitePrompt}
          onOptimizeEntity={(entity) => {
            setTargetWebsiteId(entity.websiteId);
            setTargetKey(`wpe:${entity.id}`);
            setCustomUrl('');
            setTargetKeyword(entity.focusKeyword || '');
            setActiveTab('drafts');
          }}
        />
      ) : (
        <>
          {/* 1. Dashboard Summary (Real Data Only) */}
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Total Pages
                </span>
                <FileText className="h-4 w-4 text-slate-400 dark:text-slate-500" />
              </div>
              <div className="mt-1.5 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {summaryStats.total}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {targetOptions.length} selectable catalog &amp; crawled targets
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Pending Review
                </span>
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="mt-1.5 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {summaryStats.pending}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Awaiting human verification
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Approved Drafts
                </span>
                <CheckCircle2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="mt-1.5 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {summaryStats.approved}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Ready for controlled WordPress sync
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Applied / Synced Changes
                </span>
                <UploadCloud className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="mt-1.5 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {summaryStats.applied}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Confirmed live on site
              </div>
            </div>
          </div>

          {/* 2. Page Optimization Form */}
          <form
            onSubmit={handleGenerate}
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Page Optimization
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Choose a website, page or product, and target keyword to draft reviewable SEO improvements.
                </p>
              </div>
              {selectedFormTarget && (
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {selectedFormTarget.entityType.toUpperCase()}
                  {selectedFormTarget.remoteId > 0 ? ` · #${selectedFormTarget.remoteId}` : ''}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-12">
              <div className="md:col-span-4">
                <label
                  htmlFor="onpage-website-select"
                  className="mb-1.5 block text-[11px] font-medium text-slate-600 dark:text-slate-300"
                >
                  Website
                </label>
                <select
                  id="onpage-website-select"
                  value={targetWebsiteId}
                  onChange={(e) => {
                    setTargetWebsiteId(e.target.value);
                    setTargetKey('');
                  }}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {websites.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.domain})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-8">
                <label
                  htmlFor="onpage-target-select"
                  className="mb-1.5 block text-[11px] font-medium text-slate-600 dark:text-slate-300"
                >
                  Page / Product
                </label>
                <select
                  id="onpage-target-select"
                  value={targetKey}
                  onChange={(e) => setTargetKey(e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Select an imported product, page, or crawled URL...</option>
                  {wpTargetOptions.length > 0 && (
                    <optgroup label="WordPress & WooCommerce Catalog">
                      {wpTargetOptions.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          [{opt.entityType.toUpperCase()}] {opt.title}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {crawlTargetOptions.length > 0 && (
                    <optgroup label="Crawled Website Pages">
                      {crawlTargetOptions.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.title}
                          {opt.crawlScore !== undefined ? ` (Audit ${opt.crawlScore}/100)` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <option value="custom">Enter a custom page URL...</option>
                </select>
              </div>

              {targetKey === 'custom' && (
                <div className="md:col-span-5">
                  <label
                    htmlFor="onpage-custom-url"
                    className="mb-1.5 block text-[11px] font-medium text-slate-600 dark:text-slate-300"
                  >
                    Custom Target URL
                  </label>
                  <input
                    id="onpage-custom-url"
                    type="url"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://example.com/your-page"
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              )}

              <div className={targetKey === 'custom' ? 'md:col-span-4' : 'md:col-span-8'}>
                <label
                  htmlFor="onpage-keyword-input"
                  className="mb-1.5 block text-[11px] font-medium text-slate-600 dark:text-slate-300"
                >
                  Focus Keyword
                </label>
                <input
                  id="onpage-keyword-input"
                  type="text"
                  value={targetKeyword}
                  onChange={(e) => setTargetKeyword(e.target.value)}
                  placeholder="Enter target keyword (optional — defaults to page title)"
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div
                className={`flex items-end ${
                  targetKey === 'custom' ? 'md:col-span-3' : 'md:col-span-4'
                }`}
              >
                <button
                  type="submit"
                  disabled={generating}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60 whitespace-nowrap"
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  ) : (
                    <Sparkles className="h-4 w-4 shrink-0" />
                  )}
                  <span>
                    {generating ? 'Generating SEO Suggestions...' : 'Generate SEO Suggestions'}
                  </span>
                </button>
              </div>
            </div>
          </form>

          {actionError && (
            <div className="space-y-2">
              <ErrorBanner message={actionError} />
              {errorAttempts.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Model attempts:{' '}
                  </span>
                  <span className="font-mono">
                    {errorAttempts
                      .map(
                        (a) =>
                          `${a.model} -> HTTP ${a.status} (${a.attempts}x${
                            a.detail ? `, ${a.detail}` : ''
                          })`
                      )
                      .join(' · ')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 3. SEO Draft Management: Desktop Two-Panel, Mobile Stacked */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            {/* Left Panel: Searchable Page Queue */}
            <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden flex flex-col">
              <div className="border-b border-slate-200 p-4 space-y-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                    SEO Drafts
                  </h3>
                  <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                    {filteredOptimizations.length} of {summaryStats.total}
                  </span>
                </div>

                {/* Search Input */}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search title, URL, or keyword..."
                    aria-label="Search SEO drafts"
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-8 text-xs text-slate-900 outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Status Filters */}
                <div className="flex flex-wrap gap-1.5">
                  {statusTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setStatusFilter(tab.key)}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        statusFilter === tab.key
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span className="font-mono tabular-nums opacity-80">{tab.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {filteredOptimizations.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  {summaryStats.total === 0
                    ? 'No SEO drafts yet. Select a page above and click Generate SEO Suggestions.'
                    : 'No drafts match the current search or status filter.'}
                </div>
              ) : (
                <div className="divide-y divide-slate-200 max-h-[720px] overflow-y-auto dark:divide-slate-800">
                  {filteredOptimizations.map((opt) => {
                    const st = formatStatusLabel(opt.status);
                    const active = selectedOpt?.id === opt.id;
                    const confirmingDelete = confirmDeleteId === opt.id;
                    return (
                      <div
                        key={opt.id}
                        className={`px-4 py-3 transition-colors ${
                          active
                            ? 'bg-indigo-50/75 dark:bg-indigo-950/35'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedOptId(opt.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {opt.optimizedDraft.title ||
                                opt.originalSnapshot.title ||
                                opt.targetUrl}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                              {opt.targetKeyword
                                ? `${opt.targetKeyword} · ${formatShortUrl(opt.targetUrl)}`
                                : formatShortUrl(opt.targetUrl)}
                            </div>
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <StatusText label={st.label} tone={st.tone} />
                              <span className="font-mono text-[10px] uppercase text-slate-400 dark:text-slate-500">
                                {opt.entityType}
                                {opt.remoteId > 0 ? ` #${opt.remoteId}` : ''}
                              </span>
                            </div>
                          </button>

                          {!confirmingDelete ? (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(opt.id)}
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800 dark:hover:text-red-400"
                              aria-label="Delete draft"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={async () => {
                                  await onDeleteOptimization(opt.id);
                                  setConfirmDeleteId(null);
                                  toast({ title: 'Draft deleted', variant: 'info' });
                                }}
                                className="rounded bg-red-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-700"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="rounded border border-slate-300 px-2 py-1 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Panel: Selected Page Side-by-Side Comparison & Approval Workflow */}
            <div className="lg:col-span-8">
              {!selectedOpt ? (
                <EmptyState
                  title="Select an SEO draft to review"
                  description="Compare existing SEO values against AI recommendations side by side, approve or reject individual fields, and save or sync to WordPress."
                />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                  {/* Selected Page Header & Approval Bar */}
                  <div className="border-b border-slate-200 p-5 space-y-4 dark:border-slate-800">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                            {selectedOpt.optimizedDraft.title ||
                              selectedOpt.originalSnapshot.title ||
                              'Untitled SEO Draft'}
                          </h3>
                          <StatusText
                            label={formatStatusLabel(selectedOpt.status).label}
                            tone={formatStatusLabel(selectedOpt.status).tone}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <a
                            href={selectedOpt.targetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 truncate font-mono text-[11px] text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            <span className="truncate max-w-md">{selectedOpt.targetUrl}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          {selectedOpt.appliedAt && selectedOpt.status === 'applied' && (
                            <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                              Synced {new Date(selectedOpt.appliedAt).toLocaleString()}
                            </span>
                          )}
                          {selectedOpt.verifiedScore !== undefined && (
                            <span className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                              Verified Score: {selectedOpt.verifiedScore}/100
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Consistent Approval & Sync Action Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {canEditSelected && (
                          <>
                            <button
                              type="button"
                              onClick={handleSaveEdits}
                              disabled={savingEdits}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                              {savingEdits ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Save className="h-3.5 w-3.5" />
                              )}
                              <span>Save</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleBulkDecision('reject_all')}
                              disabled={savingEdits}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/30"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              <span>Reject All</span>
                            </button>

                            {hasRejectedField && (
                              <button
                                type="button"
                                onClick={() => handleBulkDecision('approve_selected')}
                                disabled={savingEdits}
                                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-50 px-3.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                              >
                                <Check className="h-3.5 w-3.5" />
                                <span>Approve Selected</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleBulkDecision('approve_all')}
                              disabled={savingEdits}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <CheckCheck className="h-3.5 w-3.5" />
                              <span>Approve All</span>
                            </button>
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {selectedOpt.status === 'approved' && selectedOpt.remoteId > 0 && (
                          <button
                            type="button"
                            onClick={() => setConfirmApplyOpen(true)}
                            disabled={applyingLive || !activeWpConn}
                            title={
                              !activeWpConn
                                ? 'Connect WordPress / WooCommerce first in the WordPress Sync tab'
                                : 'Push approved SEO changes to live site'
                            }
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
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
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              {rechecking ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5" />
                              )}
                              <span>Recheck Score</span>
                            </button>
                            {selectedOpt.remoteId > 0 && (
                              <button
                                type="button"
                                onClick={handleRollback}
                                disabled={rollingBack}
                                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300 px-3 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
                              >
                                {rollingBack ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                                <span>Undo Live Update</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {lastActionFeedback && (
                      <div
                        className={`rounded-lg border px-3 py-2 text-xs ${
                          lastActionFeedback.tone === 'success'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                            : lastActionFeedback.tone === 'warning'
                            ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
                            : 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300'
                        }`}
                      >
                        {lastActionFeedback.message}
                      </div>
                    )}
                  </div>

                  {/* Side-by-Side Comparison Header (Desktop) */}
                  <div className="hidden md:grid md:grid-cols-12 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <div className="md:col-span-5">Existing SEO Value</div>
                    <div className="md:col-span-7 pl-3">AI-Recommended Value</div>
                  </div>

                  {/* Side-by-Side Fields */}
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {comparisonFields.map((field) => {
                      const decision = fieldDecisions[field.key];
                      return (
                        <div key={field.key} className="p-5 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                {field.label}
                              </h4>
                              {decision !== 'pending' && (
                                <StatusText
                                  label={decision === 'approved' ? 'Approved' : 'Rejected'}
                                  tone={decision === 'approved' ? 'success' : 'danger'}
                                />
                              )}
                            </div>

                            {canEditSelected && (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleFieldDecision(field.key, 'approved')}
                                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                    decision === 'approved'
                                      ? 'bg-emerald-600 text-white'
                                      : 'border border-slate-300 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-emerald-950/30'
                                  }`}
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  <span>Approve</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleFieldDecision(field.key, 'rejected')}
                                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                    decision === 'rejected'
                                      ? 'bg-red-600 text-white'
                                      : 'border border-slate-300 text-slate-700 hover:bg-red-50 hover:text-red-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-red-950/30'
                                  }`}
                                >
                                  <XCircle className="h-3 w-3" />
                                  <span>Reject</span>
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                            <div className="md:col-span-5">
                              <div className="mb-1 text-[11px] font-medium text-slate-500 md:hidden">
                                Existing SEO Value
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300 min-h-[38px] break-words">
                                {field.current}
                              </div>
                            </div>

                            <div className="md:col-span-7">
                              <div className="mb-1 text-[11px] font-medium text-indigo-700 dark:text-indigo-400 md:hidden">
                                AI-Recommended Value
                              </div>
                              <div className={decision === 'rejected' ? 'opacity-50' : ''}>
                                {field.recommended}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Strategy Notes & FAQ JSON-LD Schema */}
                    <div className="p-5">
                      <button
                        type="button"
                        onClick={() => setShowNotesAndSchema((v) => !v)}
                        className="flex w-full items-center justify-between text-left text-xs font-semibold text-slate-800 hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-400"
                      >
                        <span>AI Strategy Notes &amp; FAQ JSON-LD Schema</span>
                        {showNotesAndSchema ? (
                          <ChevronUp className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        )}
                      </button>

                      {showNotesAndSchema && (
                        <div className="mt-4 space-y-4">
                          {selectedOpt.aiNotes && (
                            <div>
                              <div className="mb-1 text-[11px] font-medium text-slate-500">
                                AI Notes
                              </div>
                              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
                                {selectedOpt.aiNotes}
                              </p>
                            </div>
                          )}
                          <div>
                            <div className="mb-1 text-[11px] font-medium text-slate-500">
                              FAQPage Schema (JSON-LD)
                            </div>
                            <textarea
                              rows={6}
                              disabled={!canEditSelected}
                              value={editFaqJson}
                              onChange={(e) => setEditFaqJson(e.target.value)}
                              placeholder="No FAQ schema generated"
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-900 outline-none focus:border-indigo-600 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-800/40"
                            />
                          </div>
                        </div>
                      )}
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
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                    Confirm Live Site Update
                  </h3>
                  <button
                    type="button"
                    onClick={() => setConfirmApplyOpen(false)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    aria-label="Close confirmation"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  You are about to push approved SEO changes to live{' '}
                  <strong>
                    {selectedOpt.entityType.toUpperCase()} #{selectedOpt.remoteId}
                  </strong>{' '}
                  via the WordPress/WooCommerce REST API. Your original snapshot remains stored in
                  Firestore for rollback.
                </p>
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300 break-all">
                  Target URL: {selectedOpt.targetUrl}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmApplyOpen(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
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
        </>
      )}
    </div>
  );
}
