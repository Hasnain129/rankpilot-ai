import { Lead, Order, Quote, SeoAudit, VisitorEvent, Website } from '../types';

export function getTimestampMs(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'object' && val !== null && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string') return Date.parse(val) || 0;
  return 0;
}

export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatCurrency(amount: number): string {
  return `$${Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function computeWorkspaceAnalytics(params: {
  websites: Website[];
  visitorEvents: VisitorEvent[];
  leads: Lead[];
  quotes: Quote[];
  orders: Order[];
  seoAudits: SeoAudit[];
  selectedWebsiteId: string;
}) {
  const { websites, visitorEvents, leads, quotes, orders, seoAudits, selectedWebsiteId } = params;
  const bySite = <T extends { websiteId?: string }>(items: T[]) =>
    selectedWebsiteId === 'all' ? items : items.filter((i) => i.websiteId === selectedWebsiteId);

  const scopedWebsites =
    selectedWebsiteId === 'all' ? websites : websites.filter((w) => w.id === selectedWebsiteId);
  const scopedEvents = bySite(visitorEvents);
  const scopedLeads = bySite(leads);
  const scopedQuotes = bySite(quotes);
  const scopedOrders = bySite(orders);
  const scopedAudits = bySite(seoAudits);

  const uniqueVisitors = new Set(scopedEvents.map((e) => e.visitorId)).size;
  const uniqueSessions = new Set(scopedEvents.map((e) => e.sessionId)).size;
  const pageviews = scopedEvents.filter((e) => e.eventType === 'pageview').length;
  const trackedConversionEvents = scopedEvents.filter((e) => e.eventType !== 'pageview').length;

  const validOrders = scopedOrders.filter((o) => o.status !== 'Refunded');
  const totalRevenue = validOrders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
  const trackedRevenue = validOrders
    .filter((o) => o.entrySource === 'tracked_conversion')
    .reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
  const manualOrImportedRevenue = totalRevenue - trackedRevenue;

  const totalCustomers = new Set([
    ...scopedLeads.filter((l) => l.status === 'Converted').map((l) => l.email.trim().toLowerCase()),
    ...validOrders.map((o) => o.customerEmail.trim().toLowerCase()),
  ]).size;

  // Consistent visitor-to-lead conversion rate across Dashboard and Sales Analytics
  const visitorToLeadRate =
    uniqueVisitors > 0 ? Math.min(100, (scopedLeads.length / uniqueVisitors) * 100) : 0;

  // Tracked session conversion rate (tracked conversion goals / unique sessions)
  const sessionConversionRate =
    uniqueSessions > 0 ? Math.min(100, (trackedConversionEvents / uniqueSessions) * 100) : 0;

  const scannedWebsites = scopedWebsites.filter((w) => w.seoScore > 0);
  const avgSeoScore =
    scannedWebsites.length > 0
      ? Math.round(scannedWebsites.reduce((s, w) => s + w.seoScore, 0) / scannedWebsites.length)
      : 0;

  return {
    scopedWebsites,
    scopedEvents,
    scopedLeads,
    scopedQuotes,
    scopedOrders,
    scopedAudits,
    validOrders,
    uniqueVisitors,
    uniqueSessions,
    pageviews,
    trackedConversionEvents,
    totalCustomers,
    totalRevenue,
    trackedRevenue,
    manualOrImportedRevenue,
    visitorToLeadRate,
    sessionConversionRate,
    avgSeoScore,
  };
}
