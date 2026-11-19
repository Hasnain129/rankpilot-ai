import React, { useState } from 'react';
import { Copy, ExternalLink, Globe, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { ScoreRing } from '../components/charts/AnalyticsCharts';
import { EmptyState, StatusText, TableSkeleton } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { SeoAudit, SiteCrawl, Website } from '../types';

interface WebsitesViewProps {
  websites: Website[];
  seoAudits: SeoAudit[];
  siteCrawls?: SiteCrawl[];
  loading: boolean;
  showAddModal: boolean;
  onOpenAddModal: () => void;
  onCloseAddModal: () => void;
  onAddWebsite: (input: { name: string; url: string; industry?: string }) => Promise<Website>;
  onUpdateWebsite: (
    website: Website,
    updates: { name?: string; url?: string; industry?: string; status?: 'active' | 'paused' }
  ) => Promise<void>;
  onDeleteWebsite: (website: Website) => Promise<void>;
  onScanWebsite: (website: Website) => void;
}

export function WebsitesView({
  websites,
  seoAudits,
  siteCrawls = [],
  loading,
  showAddModal,
  onOpenAddModal,
  onCloseAddModal,
  onAddWebsite,
  onUpdateWebsite,
  onDeleteWebsite,
  onScanWebsite,
}: WebsitesViewProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [industry, setIndustry] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [selectedSite, setSelectedSite] = useState<Website | null>(null);
  const [editingSite, setEditingSite] = useState<Website | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editIndustry, setEditIndustry] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'paused'>('active');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const created = await onAddWebsite({ name, url, industry });
      toast({
        title: 'Website connected',
        description: `${created.domain} assigned tracking ID ${created.trackingId}`,
        variant: 'success',
      });
      setName('');
      setUrl('');
      setIndustry('');
      onCloseAddModal();
    } catch (err) {
      toast({
        title: 'Could not add website',
        description: err instanceof Error ? err.message : 'Check URL format and permissions.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (site: Website) => {
    setEditingSite(site);
    setEditName(site.name);
    setEditUrl(site.url);
    setEditIndustry(site.industry || '');
    setEditStatus(site.status);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSite) return;
    setSubmitting(true);
    try {
      await onUpdateWebsite(editingSite, {
        name: editName,
        url: editUrl,
        industry: editIndustry,
        status: editStatus,
      });
      toast({ title: 'Website updated', description: editName, variant: 'success' });
      setEditingSite(null);
    } catch (err) {
      toast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Check URL format and permissions.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyTrackingId = (tid: string) => {
    navigator.clipboard.writeText(tid);
    toast({ title: 'Tracking ID copied', description: tid, variant: 'info' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Connected Websites ({websites.length})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Connect multiple domains, inspect technical SEO scores, edit site details, and launch crawls.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenAddModal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Connect Website</span>
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <TableSkeleton rows={4} />
        </div>
      ) : websites.length === 0 ? (
        <EmptyState
          title="No websites connected yet"
          description="Enter your website URL to run live SEO crawls, connect Google Search Console & GA4, and track organic rankings per domain."
          actionLabel="Connect Website"
          onAction={onOpenAddModal}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {websites.map((site) => {
            const siteAuditsCount = seoAudits.filter((a) => a.websiteId === site.id).length;
            const latestSiteCrawl = siteCrawls.find((c) => c.websiteId === site.id);
            const crawledPagesCount = latestSiteCrawl?.pages?.length || site.pagesScanned || 0;

            return (
              <div
                key={site.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setSelectedSite(site)}
                        className="truncate text-left font-display text-sm font-semibold text-slate-900 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                      >
                        {site.name}
                      </button>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <Globe className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{site.domain}</span>
                      </div>
                    </div>
                    <ScoreRing score={site.seoScore} size={52} />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <StatusText
                      label={site.status === 'active' ? 'Active' : 'Paused'}
                      tone={site.status === 'active' ? 'success' : 'neutral'}
                    />
                    <span aria-hidden="true">·</span>
                    <span>{site.industry || 'General'}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{site.pagesScanned} scan(s)</span>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 border-y border-slate-100 py-3 dark:border-slate-800">
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">SEO Score</div>
                      <div className="font-mono text-sm font-semibold tabular-nums">
                        {site.seoScore > 0 ? `${site.seoScore}/100` : 'Unscanned'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Pages Crawled</div>
                      <div className="font-mono text-sm font-semibold tabular-nums">{crawledPagesCount}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Audits</div>
                      <div className="font-mono text-sm font-semibold tabular-nums">{siteAuditsCount}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
                    <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate">
                      ID: {site.trackingId}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyTrackingId(site.trackingId)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400 shrink-0"
                    >
                      <Copy className="h-3 w-3" />
                      <span>Copy</span>
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onScanWebsite(site)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span>Scan SEO</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedSite(site)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(site)}
                    aria-label={`Edit ${site.name}`}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await onDeleteWebsite(site);
                      toast({ title: 'Website removed', description: site.domain, variant: 'info' });
                    }}
                    aria-label={`Remove ${site.name}`}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Website Details Modal */}
      {selectedSite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold">{selectedSite.name}</h3>
                <a
                  href={selectedSite.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  <span>{selectedSite.url}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSite(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-3 text-xs">
              <div className="flex justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                <span className="text-slate-500">Tracking ID</span>
                <span className="font-mono font-medium">{selectedSite.trackingId}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                <span className="text-slate-500">Latest SEO Score</span>
                <span className="font-mono font-semibold">{selectedSite.seoScore}/100</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                <span className="text-slate-500">Audits Recorded</span>
                <span className="font-mono tabular-nums">
                  {seoAudits.filter((a) => a.websiteId === selectedSite.id).length}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1">
                <span className="text-slate-500">Monitoring Status</span>
                <button
                  type="button"
                  onClick={async () => {
                    const next = selectedSite.status === 'active' ? 'paused' : 'active';
                    await onUpdateWebsite(selectedSite, { status: next });
                    setSelectedSite({ ...selectedSite, status: next });
                    toast({ title: `Website ${next}`, variant: 'info' });
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1 font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  {selectedSite.status === 'active' ? 'Pause Monitoring' : 'Resume Monitoring'}
                </button>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const s = selectedSite;
                  setSelectedSite(null);
                  openEditModal(s);
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Edit Website
              </button>
              <button
                type="button"
                onClick={() => {
                  onScanWebsite(selectedSite);
                  setSelectedSite(null);
                }}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Run SEO Audit Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Website Modal */}
      {editingSite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold">Edit Website</h3>
              <button
                type="button"
                onClick={() => setEditingSite(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium mb-1">Website Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Website URL</label>
                <input
                  type="text"
                  required
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Industry</label>
                  <input
                    type="text"
                    value={editIndustry}
                    onChange={(e) => setEditIndustry(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as 'active' | 'paused')}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingSite(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Website Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold">Connect a New Website</h3>
              <button
                type="button"
                onClick={onCloseAddModal}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              A unique workspace site ID will be assigned to isolate your SEO audits, crawls, keywords, and integrations.
            </p>
            <form onSubmit={handleCreate} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium mb-1">Website Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme SaaS Marketing"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Website URL</label>
                <input
                  type="text"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Industry (optional)</label>
                <input
                  type="text"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="B2B SaaS, E-Commerce, Local Services"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onCloseAddModal}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting ? 'Connecting...' : 'Connect Website'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
