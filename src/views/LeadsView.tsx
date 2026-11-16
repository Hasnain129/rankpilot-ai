import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Receipt, Search, Trash2, X } from 'lucide-react';
import { EmptyState, StatusText, TableSkeleton } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { formatCurrency } from '../lib/analytics';
import { Lead, LeadSource, LeadStatus, Website } from '../types';

interface LeadsViewProps {
  websites: Website[];
  leads: Lead[];
  selectedWebsiteId: string;
  loading: boolean;
  onAddLead: (input: {
    websiteId: string;
    name: string;
    email: string;
    phone?: string;
    company?: string;
    leadSource: LeadSource;
    status: LeadStatus;
    estimatedValue: number;
    notes?: string;
  }) => Promise<string>;
  onUpdateLead: (id: string, updates: Partial<Lead>) => Promise<void>;
  onDeleteLead: (id: string) => Promise<void>;
  onConvertLeadToQuote: (lead: Lead) => void;
  onAddWebsitePrompt: () => void;
}

const LEAD_STATUSES: LeadStatus[] = ['New', 'Contacted', 'Qualified', 'Converted', 'Lost'];
const LEAD_SOURCES: LeadSource[] = [
  'Organic Search',
  'Direct',
  'Referral',
  'Paid Search',
  'Social',
  'Email',
  'Website Form',
];

function getLeadTone(status: LeadStatus): 'info' | 'warning' | 'success' | 'danger' | 'neutral' {
  if (status === 'Converted') return 'success';
  if (status === 'Qualified') return 'info';
  if (status === 'Contacted') return 'warning';
  if (status === 'Lost') return 'danger';
  return 'neutral';
}

export function LeadsView({
  websites,
  leads,
  selectedWebsiteId,
  loading,
  onAddLead,
  onUpdateLead,
  onDeleteLead,
  onConvertLeadToQuote,
  onAddWebsitePrompt,
}: LeadsViewProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [showModal, setShowModal] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);

  const [websiteId, setWebsiteId] = useState(
    selectedWebsiteId !== 'all' ? selectedWebsiteId : websites[0]?.id || ''
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [leadSource, setLeadSource] = useState<LeadSource>('Organic Search');
  const [status, setStatus] = useState<LeadStatus>('New');
  const [estimatedValue, setEstimatedValue] = useState('1500');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (selectedWebsiteId !== 'all' && l.websiteId !== selectedWebsiteId) return false;
      if (statusFilter !== 'All' && l.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          l.name.toLowerCase().includes(q) ||
          l.email.toLowerCase().includes(q) ||
          (l.company || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [leads, selectedWebsiteId, statusFilter, search]);

  const openCreateModal = () => {
    setEditingLeadId(null);
    setWebsiteId(selectedWebsiteId !== 'all' ? selectedWebsiteId : websites[0]?.id || '');
    setName('');
    setEmail('');
    setPhone('');
    setCompany('');
    setLeadSource('Organic Search');
    setStatus('New');
    setEstimatedValue('1500');
    setNotes('');
    setShowModal(true);
  };

  const openEditModal = (lead: Lead) => {
    setEditingLeadId(lead.id);
    setWebsiteId(lead.websiteId);
    setName(lead.name);
    setEmail(lead.email);
    setPhone(lead.phone || '');
    setCompany(lead.company || '');
    setLeadSource(lead.leadSource);
    setStatus(lead.status);
    setEstimatedValue(String(lead.estimatedValue));
    setNotes(lead.notes || '');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingLeadId) {
        await onUpdateLead(editingLeadId, {
          name,
          email,
          phone,
          company,
          leadSource,
          status,
          estimatedValue: Number(estimatedValue) || 0,
          notes,
        });
        toast({ title: 'Lead updated', description: name, variant: 'success' });
      } else {
        const targetSite = websiteId || websites[0]?.id;
        if (!targetSite) {
          toast({ title: 'Connect a website first', variant: 'error' });
          return;
        }
        await onAddLead({
          websiteId: targetSite,
          name,
          email,
          phone,
          company,
          leadSource,
          status,
          estimatedValue: Number(estimatedValue) || 0,
          notes,
        });
        toast({ title: 'Lead added', description: name, variant: 'success' });
      }
      setShowModal(false);
      setEditingLeadId(null);
    } catch (err) {
      toast({
        title: 'Could not save lead',
        description: err instanceof Error ? err.message : 'Validation failed.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (websites.length === 0) {
    return (
      <EmptyState
        title="Connect a website before logging leads"
        description="Every lead in RankPilot AI is attributed to a specific connected website and traffic source."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads..."
              className="w-56 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/70">
            {['All', ...LEAD_STATUSES].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700 whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add Lead</span>
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <TableSkeleton rows={5} />
        </div>
      ) : filteredLeads.length === 0 ? (
        <EmptyState
          title="No leads match your filters"
          description="Log inbound customer leads manually or track form submissions from your connected websites."
          actionLabel="Add First Lead"
          onAction={openCreateModal}
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium">Website</th>
                  <th className="px-4 py-2.5 font-medium">Lead Source</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Est. Value</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredLeads.map((lead) => {
                  const site = websites.find((w) => w.id === lead.websiteId);
                  return (
                    <tr key={lead.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100">{lead.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {lead.email}
                          {lead.phone ? ` · ${lead.phone}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {site?.domain || 'Unknown'}
                      </td>
                      <td className="px-4 py-3">
                        <div>{lead.leadSource}</div>
                        <div className="text-[11px] text-slate-400">
                          {lead.trackingSource === 'tracked' ? 'Tracked Event' : 'Manual Entry'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusText label={lead.status} tone={getLeadTone(lead.status)} />
                          <select
                            aria-label={`Change status for ${lead.name}`}
                            value={lead.status}
                            onChange={async (e) => {
                              const next = e.target.value as LeadStatus;
                              await onUpdateLead(lead.id, { status: next });
                              toast({ title: 'Lead status updated', description: `${lead.name} → ${next}`, variant: 'info' });
                            }}
                            className="rounded border border-slate-200 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-slate-700"
                          >
                            {LEAD_STATUSES.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium tabular-nums">
                        {formatCurrency(lead.estimatedValue)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onConvertLeadToQuote(lead)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                          >
                            <Receipt className="h-3 w-3" />
                            <span>Quote</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(lead)}
                            aria-label={`Edit ${lead.name}`}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await onDeleteLead(lead.id);
                              toast({ title: 'Lead removed', variant: 'info' });
                            }}
                            aria-label={`Delete ${lead.name}`}
                            className="rounded p-1 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base font-bold">
                {editingLeadId ? 'Edit Customer Lead' : 'Add Customer Lead'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Website</label>
                  <select
                    disabled={Boolean(editingLeadId)}
                    value={websiteId}
                    onChange={(e) => setWebsiteId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"
                  >
                    {websites.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Lead Source</label>
                  <select
                    value={leadSource}
                    onChange={(e) => setLeadSource(e.target.value as LeadSource)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                  >
                    {LEAD_SOURCES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Customer Name</label>
                  <input required type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Email</label>
                  <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Phone</label>
                  <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as LeadStatus)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Est. Value ($)</label>
                  <input type="number" min={0} step="any" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-800" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Company &amp; Notes</label>
                <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs mb-2 dark:border-slate-700 dark:bg-slate-800" />
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Qualification notes..." className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                  {submitting ? 'Saving...' : editingLeadId ? 'Update Lead' : 'Save Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
