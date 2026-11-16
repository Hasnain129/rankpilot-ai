import React, { useMemo, useState } from 'react';
import { Info, Pencil, Plus, Trash2, X } from 'lucide-react';
import { EmptyState, StatusText, TableSkeleton } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { formatCurrency } from '../lib/analytics';
import { Order, OrderChannel, OrderEntrySource, OrderStatus, Website } from '../types';

interface OrdersViewProps {
  websites: Website[];
  orders: Order[];
  selectedWebsiteId: string;
  loading: boolean;
  onAddOrder: (input: {
    websiteId: string;
    orderNumber?: string;
    customerName: string;
    customerEmail: string;
    productOrService: string;
    amount: number;
    currency?: string;
    channel: OrderChannel;
    entrySource: OrderEntrySource;
    status: OrderStatus;
    orderDate: string;
  }) => Promise<string>;
  onUpdateOrder: (id: string, updates: Partial<Order>) => Promise<void>;
  onDeleteOrder: (id: string) => Promise<void>;
  onAddWebsitePrompt: () => void;
  onOpenIntegrations: () => void;
}

const ORDER_STATUSES: OrderStatus[] = ['Pending', 'Processing', 'Completed', 'Refunded'];
const ORDER_CHANNELS: OrderChannel[] = [
  'Organic Search',
  'Direct',
  'Referral',
  'Paid Search',
  'Social',
  'Manual Entry',
  'Shopify',
  'WooCommerce',
];

function getOrderTone(status: OrderStatus): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'Completed') return 'success';
  if (status === 'Refunded') return 'danger';
  if (status === 'Processing') return 'info';
  return 'warning';
}

export function OrdersView({
  websites,
  orders,
  selectedWebsiteId,
  loading,
  onAddOrder,
  onUpdateOrder,
  onDeleteOrder,
  onAddWebsitePrompt,
  onOpenIntegrations,
}: OrdersViewProps) {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [showModal, setShowModal] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  const [websiteId, setWebsiteId] = useState(websites[0]?.id || '');
  const [orderNumber, setOrderNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [productOrService, setProductOrService] = useState('');
  const [amount, setAmount] = useState('950');
  const [channel, setChannel] = useState<OrderChannel>('Manual Entry');
  const [entrySource, setEntrySource] = useState<OrderEntrySource>('manual_entry');
  const [status, setStatus] = useState<OrderStatus>('Completed');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (selectedWebsiteId !== 'all' && o.websiteId !== selectedWebsiteId) return false;
      if (statusFilter !== 'All' && o.status !== statusFilter) return false;
      return true;
    });
  }, [orders, selectedWebsiteId, statusFilter]);

  const totalRevenue = useMemo(
    () => filteredOrders.filter((o) => o.status !== 'Refunded').reduce((s, o) => s + o.amount, 0),
    [filteredOrders]
  );

  const openCreateModal = () => {
    setEditingOrderId(null);
    setWebsiteId(selectedWebsiteId !== 'all' ? selectedWebsiteId : websites[0]?.id || '');
    setOrderNumber('');
    setCustomerName('');
    setCustomerEmail('');
    setProductOrService('');
    setAmount('950');
    setChannel('Manual Entry');
    setEntrySource('manual_entry');
    setStatus('Completed');
    setOrderDate(new Date().toISOString().slice(0, 10));
    setShowModal(true);
  };

  const openEditModal = (ord: Order) => {
    setEditingOrderId(ord.id);
    setWebsiteId(ord.websiteId);
    setOrderNumber(ord.orderNumber);
    setCustomerName(ord.customerName);
    setCustomerEmail(ord.customerEmail);
    setProductOrService(ord.productOrService);
    setAmount(String(ord.amount));
    setChannel(ord.channel);
    setEntrySource(ord.entrySource);
    setStatus(ord.status);
    setOrderDate(ord.orderDate);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingOrderId) {
        await onUpdateOrder(editingOrderId, {
          orderNumber,
          customerName,
          customerEmail,
          productOrService,
          amount: Number(amount) || 0,
          channel,
          status,
          orderDate,
        });
        toast({ title: 'Order updated', description: `${orderNumber} · ${formatCurrency(Number(amount))}`, variant: 'success' });
      } else {
        const targetSite = websiteId || websites[0]?.id;
        if (!targetSite) return;
        await onAddOrder({
          websiteId: targetSite,
          orderNumber: orderNumber.trim() || undefined,
          customerName,
          customerEmail,
          productOrService,
          amount: Number(amount) || 0,
          currency: 'USD',
          channel,
          entrySource,
          status,
          orderDate,
        });
        toast({ title: 'Order recorded', description: `${customerName} · ${formatCurrency(Number(amount))}`, variant: 'success' });
      }
      setShowModal(false);
      setEditingOrderId(null);
    } catch (err) {
      toast({
        title: 'Order save failed',
        description: err instanceof Error ? err.message : 'Check fields.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (websites.length === 0) {
    return (
      <EmptyState
        title="Connect a website to track orders & revenue"
        description="Log manual sales or tracked website conversions, and prepare Shopify & WooCommerce store sync."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <Info className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <span>
            Orders support manual entry and tracked conversions today, with webhook adapters ready for Shopify &amp; WooCommerce.
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenIntegrations}
          className="font-medium text-indigo-600 hover:underline dark:text-indigo-400 whitespace-nowrap"
        >
          Configure Store Sync
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/70">
            {['All', ...ORDER_STATUSES].map((st) => (
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
          <span className="text-xs text-slate-500 tabular-nums">
            Net Revenue: <strong className="text-slate-900 dark:text-slate-100">{formatCurrency(totalRevenue)}</strong>
          </span>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add Order</span>
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <TableSkeleton rows={4} />
        </div>
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          title="No orders logged yet"
          description="Record manual customer orders or convert accepted quotes into revenue records."
          actionLabel="Log First Order"
          onAction={openCreateModal}
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Order ID</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium">Product / Service</th>
                  <th className="px-4 py-2.5 font-medium">Attribution</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Order Value</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredOrders.map((ord) => {
                  const isRefunded = ord.status === 'Refunded';
                  return (
                    <tr key={ord.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <div className="font-mono font-medium text-slate-900 dark:text-slate-100">{ord.orderNumber}</div>
                        <div className="font-mono text-[11px] text-slate-400 tabular-nums">{ord.orderDate}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{ord.customerName}</div>
                        <div className="text-[11px] text-slate-500">{ord.customerEmail}</div>
                      </td>
                      <td className="px-4 py-3">{ord.productOrService}</td>
                      <td className="px-4 py-3">
                        <div>{ord.channel}</div>
                        <div className="text-[11px] text-slate-400">
                          {ord.entrySource === 'tracked_conversion'
                            ? 'Tracked Conversion'
                            : ord.entrySource === 'manual_entry'
                            ? 'Manual Entry'
                            : ord.entrySource}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusText label={ord.status} tone={getOrderTone(ord.status)} />
                          {!isRefunded && (
                            <select
                              aria-label={`Change order status for ${ord.orderNumber}`}
                              value={ord.status}
                              onChange={async (e) => {
                                const next = e.target.value as OrderStatus;
                                await onUpdateOrder(ord.id, { status: next });
                                toast({ title: 'Order updated', description: `${ord.orderNumber} → ${next}`, variant: 'info' });
                              }}
                              className="rounded border border-slate-200 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-slate-700"
                            >
                              {ORDER_STATUSES.map((st) => (
                                <option key={st} value={st}>{st}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                        {formatCurrency(ord.amount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {!isRefunded && (
                            <button
                              type="button"
                              onClick={() => openEditModal(ord)}
                              aria-label={`Edit ${ord.orderNumber}`}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              await onDeleteOrder(ord.id);
                              toast({ title: 'Order removed', variant: 'info' });
                            }}
                            aria-label={`Delete ${ord.orderNumber}`}
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
                {editingOrderId ? 'Edit Order' : 'Record Customer Order'}
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
                    disabled={Boolean(editingOrderId)}
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
                  <label className="block text-xs font-medium mb-1">Order Number (optional)</label>
                  <input type="text" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="Auto-generated if blank" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-800" />
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
                <label className="block text-xs font-medium mb-1">Product or Service</label>
                <input required type="text" value={productOrService} onChange={(e) => setProductOrService(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Order Value ($)</label>
                  <input required type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Order Date</label>
                  <input required type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800">
                    {ORDER_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Marketing Channel</label>
                  <select value={channel} onChange={(e) => setChannel(e.target.value as OrderChannel)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800">
                    {ORDER_CHANNELS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Attribution Source</label>
                  <select
                    disabled={Boolean(editingOrderId)}
                    value={entrySource}
                    onChange={(e) => setEntrySource(e.target.value as OrderEntrySource)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="manual_entry">Manual Entry</option>
                    <option value="tracked_conversion">Tracked Conversion</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                  {submitting ? 'Saving...' : editingOrderId ? 'Update Order' : 'Save Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
