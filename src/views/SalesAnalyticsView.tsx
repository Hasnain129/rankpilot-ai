import React, { useMemo } from 'react';
import { HorizontalBarList } from '../components/charts/AnalyticsCharts';
import { EmptyState } from '../components/ui/DataState';
import { computeWorkspaceAnalytics, formatCurrency } from '../lib/analytics';
import { Lead, Order, Quote, VisitorEvent } from '../types';

interface SalesAnalyticsViewProps {
  visitorEvents: VisitorEvent[];
  leads: Lead[];
  quotes: Quote[];
  orders: Order[];
  selectedWebsiteId: string;
}

export function SalesAnalyticsView({
  visitorEvents,
  leads,
  quotes,
  orders,
  selectedWebsiteId,
}: SalesAnalyticsViewProps) {
  const base = useMemo(
    () =>
      computeWorkspaceAnalytics({
        websites: [],
        visitorEvents,
        leads,
        quotes,
        orders,
        seoAudits: [],
        selectedWebsiteId,
      }),
    [visitorEvents, leads, quotes, orders, selectedWebsiteId]
  );

  const analytics = useMemo(() => {
    const quotesAccepted = base.scopedQuotes.filter((q) => q.status === 'Accepted').length;

    const leadSourceMap = new Map<string, { leads: number; converted: number; estValue: number }>();
    base.scopedLeads.forEach((l) => {
      const curr = leadSourceMap.get(l.leadSource) || { leads: 0, converted: 0, estValue: 0 };
      curr.leads += 1;
      if (l.status === 'Converted') curr.converted += 1;
      curr.estValue += l.estimatedValue;
      leadSourceMap.set(l.leadSource, curr);
    });
    const leadSourcePerformance = Array.from(leadSourceMap.entries()).map(([source, data]) => ({
      source,
      ...data,
      rate: data.leads > 0 ? Math.round((data.converted / data.leads) * 100) : 0,
    }));

    const channelSalesMap = new Map<string, number>();
    base.validOrders.forEach((o) => {
      channelSalesMap.set(o.channel, (channelSalesMap.get(o.channel) || 0) + o.amount);
    });
    const salesByChannel = Array.from(channelSalesMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    return {
      leadsGenerated: base.scopedLeads.length,
      customersAcquired: base.totalCustomers,
      ordersReceived: base.validOrders.length,
      quotesRequested: base.scopedQuotes.length,
      quotesAccepted,
      totalRevenue: base.totalRevenue,
      trackedRevenue: base.trackedRevenue,
      manualOrImportedRevenue: base.manualOrImportedRevenue,
      conversionRate: base.visitorToLeadRate,
      leadSourcePerformance,
      salesByChannel,
    };
  }, [base]);

  if (
    analytics.leadsGenerated === 0 &&
    analytics.ordersReceived === 0 &&
    analytics.quotesRequested === 0
  ) {
    return (
      <EmptyState
        title="No sales or pipeline records yet"
        description="As leads, quotes, orders, and tracked conversions accumulate, channel revenue and source conversion rates will populate here."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        {[
          { label: 'Leads Generated', value: analytics.leadsGenerated.toLocaleString() },
          { label: 'Customers Acquired', value: analytics.customersAcquired.toLocaleString() },
          { label: 'Quotes Requested', value: analytics.quotesRequested.toLocaleString() },
          { label: 'Quotes Accepted', value: analytics.quotesAccepted.toLocaleString() },
          { label: 'Orders Received', value: analytics.ordersReceived.toLocaleString() },
          { label: 'Lead Conv. Rate', value: `${analytics.conversionRate.toFixed(1)}%` },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{item.label}</div>
            <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Net Revenue</div>
          <div className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatCurrency(analytics.totalRevenue)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Excludes refunded orders</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Tracked Conversion Revenue
          </div>
          <div className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatCurrency(analytics.trackedRevenue)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Attributed directly to visitor tracking script sessions
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-indigo-700 dark:text-indigo-400">
            Manual &amp; Imported Sales
          </div>
          <div className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatCurrency(analytics.manualOrImportedRevenue)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Manually entered orders or external store imports
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-display text-sm font-semibold mb-4">Sales by Marketing Channel</h2>
          <HorizontalBarList
            items={analytics.salesByChannel}
            formatValue={(v) => formatCurrency(v)}
            barColorClass="bg-emerald-600 dark:bg-emerald-500"
          />
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
            <h2 className="font-display text-sm font-semibold">Lead Source Performance</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Lead Source</th>
                  <th className="px-4 py-2.5 font-medium text-right">Leads</th>
                  <th className="px-4 py-2.5 font-medium text-right">Converted</th>
                  <th className="px-4 py-2.5 font-medium text-right">Win Rate</th>
                  <th className="px-4 py-2.5 font-medium text-right">Pipeline Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {analytics.leadSourcePerformance.map((row) => (
                  <tr key={row.source} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{row.source}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{row.leads}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{row.converted}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{row.rate}%</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                      {formatCurrency(row.estValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
