import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { EmptyState, StatusText, TableSkeleton } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { formatCurrency } from '../lib/analytics';
import { Lead, Quote, QuoteStatus, Website } from '../types';

interface QuotesViewProps {
  websites: Website[];
  quotes: Quote[];
  selectedWebsiteId: string;
  loading: boolean;
  prefillLead?: Lead | null;
  onClearPrefillLead: () => void;
  onAddQuote: (input: {
    websiteId: string;
    leadId?: string;
    customerName: string;
    customerEmail: string;
    serviceOrProduct: string;
    amount: number;
    currency?: string;
    status: QuoteStatus;
    validUntil?: string;
    notes?: string;
  }) => Promise<string>;
  onUpdateQuote: (id: string, updates: Partial<Quote>) => Promise<void>;
  onAcceptQuote?: (quote: Quote) => Promise<void>;
  onDeleteQuote: (id: string) => Promise<void>;
  onConvertQuoteToOrder: (quote: Quote) => Promise<void>;
  onAddWebsitePrompt: () => void;
}

const QUOTE_STATUSES: QuoteStatus[] = ['Pending', 'Sent', 'Accepted', 'Rejected'];

function getQuoteTone(status: QuoteStatus): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'Accepted') return 'success';
  if (status === 'Rejected') return 'danger';
  if (status === 'Sent') return 'info';
  return 'warning';
}

export function QuotesView({
  websites,
  quotes,
  selectedWebsiteId,
  loading,
  prefillLead,
  onClearPrefillLead,
  onAddQuote,
  onUpdateQuote,
  onAcceptQuote,
  onDeleteQuote,
  onConvertQuoteToOrder,
  onAddWebsitePrompt,
}: QuotesViewProps) {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [showModal, setShowModal] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);

  const [websiteId, setWebsiteId] = useState(websites[0]?.id || '');
  const [leadId, setLeadId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [serviceOrProduct, setServiceOrProduct] = useState('');
  const [amount, setAmount] = useState('2500');
  const [status, setStatus] = useState<QuoteStatus>('Pending');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (prefillLead) {
      setEditingQuoteId(null);
      setWebsiteId(prefillLead.websiteId);
      setLeadId(prefillLead.id);
      setCustomerName(prefillLead.name);
      setCustomerEmail(prefillLead.email);
      setAmount(String(prefillLead.estimatedValue || 1500));
      setServiceOrProduct('');
      setStatus('Sent');
      setValidUntil('');
      setNotes('');
      setShowModal(true);
      onClearPrefillLead();
    }
  }, [prefillLead, onClearPrefillLead]);

  const filteredQuotes = useMemo(() => {
    return quotes.filter((q) => {
      if (selectedWebsiteId !== 'all' && q.websiteId !== selectedWebsiteId) return false;
      if (statusFilter !== 'All' && q.status !== statusFilter) return false;
      return true;
    });
  }, [quotes, selectedWebsiteId, statusFilter]);

  const summary = useMemo(() => {
    const total = filteredQuotes.reduce((s, q) => s + q.amount, 0);
    const accepted = filteredQuotes.filter((q) => q.status === 'Accepted').reduce((s, q) => s + q.amount, 0);
    return { total, accepted };
  }, [filteredQuotes]);

  const openCreateModal = () => {
    setEditingQuoteId(null);
    setWebsiteId(selectedWebsiteId !== 'all' ? selectedWebsiteId : websites[0]?.id || '');
    setLeadId('');
    setCustomerName('');
    setCustomerEmail('');
    setServiceOrProduct('');
    setAmount('2500');
    setStatus('Pending');
    setValidUntil('');
    setNotes('');
    setShowModal(true);
  };

  const openEditModal = (q: Quote) => {
    setEditingQuoteId(q.id);
    setWebsiteId(q.websiteId);
    setLeadId(q.leadId || '');
    setCustomerName(q.customerName);
    setCustomerEmail(q.customerEmail);
    setServiceOrProduct(q.serviceOrProduct);
    setAmount(String(q.amount));
    setStatus(q.status);
    setValidUntil(q.validUntil || '');
    setNotes(q.notes || '');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingQuoteId) {
        await onUpdateQuote(editingQuoteId, {
          customerName,
          customerEmail,
          serviceOrProduct,
          amount: Number(amount) || 0,
          status,
          validUntil,
          notes,
        });
        toast({ title: 'Quote updated', description: `${customerName} · ${formatCurrency(Number(amount))}`, variant: 'success' });
      } else {
        const targetSite = websiteId || websites[0]?.id;
        if (!targetSite) return;
        await onAddQuote({
          websiteId: targetSite,
          leadId,
          customerName,
          customerEmail,
          serviceOrProduct,
          amount: Number(amount) || 0,
          currency: 'USD',
          status,
          validUntil,
          notes,
        });
        toast({ title: 'Quote created', description: `${customerName} · ${formatCurrency(Number(amount))}`, variant: 'success' });
      }
      setShowModal(false);
      setEditingQuoteId(null);
    } catch (err) {
      toast({
        title: 'Quote save failed',
        description: err instanceof Error ? err.message : 'Check fields and permissions.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (websites.length === 0) {
    return (
      <EmptyState
        title="Connect a website to manage quotes"
        description="Track customer quote requests, proposal values, and accepted vs. rejected outcomes per website."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/70">
            {['All', ...QUOTE_STATUSES].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            Quoted: <strong className="text-slate-900 dark:text-slate-100">{formatCurrency(summary.total)}</strong> · Accepted:{' '}
            <strong className="text-emerald-700 dark:text-emerald-400">{formatCurrency(summary.accepted)}</strong>
          </div>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New Quote</span>
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <TableSkeleton rows={4} />
        </div>
      ) : filteredQuotes.length === 0 ? (
        <EmptyState
          title="No quotes recorded yet"
          description="Log incoming quote requests or generate proposals directly from qualified leads."
          actionLabel="Create First Quote"
          onAction={openCreateModal}
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium">Requested Service / Product</th>
                  <th className="px-4 py-2.5 font-medium">Website</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredQuotes.map((q) => {
                  const site = websites.find((w) => w.id === q.websiteId);
                  const isTerminal = q.status === 'Accepted' || q.status === 'Rejected';
                  return (
                    <tr key={q.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100">{q.customerName}</div>
                        <div className="text-[11px] text-slate-500">{q.customerEmail}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-800 dark:text-slate-200">{q.serviceOrProduct}</div>
                        {q.validUntil && (
                          <div className="text-[11px] text-slate-400">Valid until {q.validUntil}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{site?.domain || 'Unknown'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusText label={q.status} tone={getQuoteTone(q.status)} />
                          {!isTerminal && (
                            <select
                              aria-label={`Update quote status for ${q.customerName}`}
                              value={q.status}
                              onChange={async (e) => {
                                const next = e.target.value as QuoteStatus;
                                if (next === 'Accepted' && onAcceptQuote) {
                                  await onAcceptQuote(q);
                                } else {
                                  await onUpdateQuote(q.id, { status: next });
                                }
                                toast({ title: 'Quote updated', description: `${q.customerName} → ${next}`, variant: 'info' });
                              }}
                              className="rounded border border-slate-200 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-slate-700"
                            >
                              {QUOTE_STATUSES.map((st) => (
                                <option key={st} value={st}>{st}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                        {formatCurrency(q.amount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {q.status === 'Accepted' && (
                            <button
                              type="button"
                              onClick={async () => {
                                await onConvertQuoteToOrder(q);
                              }}
                              className="inline-flex items-center gap-1 rounded border border-emerald-300 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                            >
                              <ShoppingBag className="h-3 w-3" />
                              <span>Create Order</span>
                            </button>
                          )}
                          {!isTerminal && (
                            <button
                              type="button"
                              onClick={() => openEditModal(q)}
                              aria-label={`Edit quote for ${q.customerName}`}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              await onDeleteQuote(q.id);
                              toast({ title: 'Quote deleted', variant: 'info' });
                            }}
                            aria-label="Delete quote"
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
                {editingQuoteId ? 'Edit Quote' : 'Create Quote'}
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
                    disabled={Boolean(editingQuoteId)}
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
                  <label className="block text-xs font-medium mb-1">Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value as QuoteStatus)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800">
                    {QUOTE_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Customer Name</label>
                  <input required type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Customer Email</label>
                  <input required type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Requested Service or Product</label>
                <input required type="text" value={serviceOrProduct} onChange={(e) => setServiceOrProduct(e.target.value)} placeholder="Enterprise Annual Package" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Quote Amount ($)</label>
                  <input required type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Valid Until</label>
                  <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Notes</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                  {submitting ? 'Saving...' : editingQuoteId ? 'Update Quote' : 'Save Quote'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
