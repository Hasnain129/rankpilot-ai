import React, { useMemo, useState } from 'react';
import { Activity, Copy, Play, Terminal } from 'lucide-react';
import { HorizontalBarList } from '../components/charts/AnalyticsCharts';
import { EmptyState, StatusText } from '../components/ui/DataState';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { VisitorEvent, Website } from '../types';

interface VisitorTrackingViewProps {
  websites: Website[];
  visitorEvents: VisitorEvent[];
  selectedWebsiteId: string;
  onAddDemoEvent: (evt: Omit<VisitorEvent, 'id' | 'ownerId' | 'createdAt'>) => void;
  onAddWebsitePrompt: () => void;
}

export function VisitorTrackingView({
  websites,
  visitorEvents,
  selectedWebsiteId,
  onAddDemoEvent,
  onAddWebsitePrompt,
}: VisitorTrackingViewProps) {
  const { isDemoMode } = useAuth();
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);

  const activeSite =
    (selectedWebsiteId !== 'all' ? websites.find((w) => w.id === selectedWebsiteId) : websites[0]) || null;

  const scopedEvents = useMemo(
    () =>
      selectedWebsiteId === 'all'
        ? visitorEvents
        : visitorEvents.filter((e) => e.websiteId === selectedWebsiteId),
    [visitorEvents, selectedWebsiteId]
  );

  const stats = useMemo(() => {
    const uniqueVisitors = new Set(scopedEvents.map((e) => e.visitorId)).size;
    const uniqueSessions = new Set(scopedEvents.map((e) => e.sessionId)).size;
    const pageviews = scopedEvents.filter((e) => e.eventType === 'pageview').length;
    const conversions = scopedEvents.filter((e) => e.eventType !== 'pageview').length;

    const landingPagesMap = new Map<string, number>();
    const sourceMap = new Map<string, number>();

    scopedEvents.forEach((ev) => {
      landingPagesMap.set(ev.path, (landingPagesMap.get(ev.path) || 0) + 1);
      sourceMap.set(ev.trafficSource, (sourceMap.get(ev.trafficSource) || 0) + 1);
    });

    const topPages = Array.from(landingPagesMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const topSources = Array.from(sourceMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    return { uniqueVisitors, uniqueSessions, pageviews, conversions, topPages, topSources };
  }, [scopedEvents]);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-app.vercel.app';
  const snippet = activeSite
    ? `<script src="${origin}/track.js" data-tracking-id="${activeSite.trackingId}" async></script>`
    : '';

  const conversionSnippet = `// Trigger on lead form submit, quote request, or checkout success
window.rankpilot?.trackConversion('lead_submit', 500);`;

  const handleSendTestEvent = async () => {
    if (!activeSite) return;
    setTesting(true);
    try {
      const samplePaths = ['/pricing', '/features', '/blog/seo-guide', '/request-quote'];
      const sampleSources = ['Organic Search', 'Direct', 'Referral', 'Paid Search'];
      const chosenPath = samplePaths[Math.floor(Math.random() * samplePaths.length)];
      const chosenSource = sampleSources[Math.floor(Math.random() * sampleSources.length)];
      const isConv = chosenPath === '/request-quote';

      if (isDemoMode) {
        onAddDemoEvent({
          websiteId: activeSite.id,
          trackingId: activeSite.trackingId,
          visitorId: `v_${Math.random().toString(36).slice(2, 8)}`,
          sessionId: `s_${Math.random().toString(36).slice(2, 8)}`,
          eventType: isConv ? 'quote_request' : 'pageview',
          path: chosenPath,
          referrer: 'https://google.com',
          trafficSource: chosenSource,
          utmSource: chosenSource === 'Paid Search' ? 'google' : '',
          utmMedium: chosenSource === 'Paid Search' ? 'cpc' : '',
          utmCampaign: chosenSource === 'Paid Search' ? 'brand_search' : '',
          deviceType: 'desktop',
          conversionValue: isConv ? 1500 : 0,
        });
        toast({ title: 'Demo tracking event recorded', description: `${chosenPath} (${chosenSource})`, variant: 'success' });
        return;
      }

      const res = await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingId: activeSite.trackingId,
          visitorId: `v_test_${Math.random().toString(36).slice(2, 8)}`,
          sessionId: `s_test_${Math.random().toString(36).slice(2, 8)}`,
          eventType: isConv ? 'quote_request' : 'pageview',
          path: chosenPath,
          referrer: 'https://google.com',
          trafficSource: chosenSource,
          utmSource: chosenSource === 'Paid Search' ? 'google' : '',
          utmMedium: chosenSource === 'Paid Search' ? 'cpc' : '',
          utmCampaign: chosenSource === 'Paid Search' ? 'test_campaign' : '',
          deviceType: 'desktop',
          conversionValue: isConv ? 1500 : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tracking endpoint failed.');
      toast({
        title: 'Live tracking event ingested',
        description: `Stored ${isConv ? 'quote_request' : 'pageview'} on ${chosenPath} in Firestore.`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Tracking test failed',
        description: err instanceof Error ? err.message : 'Unable to reach /api/track.',
        variant: 'error',
      });
    } finally {
      setTesting(false);
    }
  };

  if (websites.length === 0) {
    return (
      <EmptyState
        title="Connect a website to generate your tracking script"
        description="Each website receives a unique tracking ID and a lightweight JavaScript snippet for tracking visitors, UTMs, referrers, and conversions."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Install Snippet Card */}
      {activeSite && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-semibold">
                Tracking Script · {activeSite.name} ({activeSite.domain})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Paste inside your website&apos;s <code className="font-mono">&lt;head&gt;</code> tag. Tracking ID:{' '}
                <span className="font-mono font-medium text-slate-800 dark:text-slate-200">{activeSite.trackingId}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSendTestEvent}
                disabled={testing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Play className="h-3.5 w-3.5 text-emerald-600" />
                <span>{testing ? 'Sending...' : 'Send Test Event'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(snippet);
                  toast({ title: 'Tracking snippet copied', variant: 'success' });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>Copy Script</span>
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <Terminal className="h-3.5 w-3.5" />
                <span>HTML Head Snippet (Auto-tracks Pageviews, Referrers, UTMs & Sessions)</span>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-xs text-emerald-400 dark:border-slate-800">
                {snippet}
              </pre>
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <Activity className="h-3.5 w-3.5" />
                <span>Conversion Event API (Lead Forms, Quotes, Purchases)</span>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-xs text-slate-200 dark:border-slate-800">
                {conversionSnippet}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Telemetry Counters */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Unique Visitors', value: stats.uniqueVisitors },
          { label: 'Total Sessions', value: stats.uniqueSessions },
          { label: 'Page Views', value: stats.pageviews },
          { label: 'Conversion Events', value: stats.conversions },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">{card.label}</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">{card.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Landing Pages & Traffic Sources */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="font-display text-sm font-semibold mb-4">Top Landing Pages</h3>
          <HorizontalBarList items={stats.topPages} />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="font-display text-sm font-semibold mb-4">Traffic Sources</h3>
          <HorizontalBarList items={stats.topSources} barColorClass="bg-emerald-600 dark:bg-emerald-500" />
        </div>
      </div>

      {/* Raw Event Stream */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <h3 className="font-display text-sm font-semibold">Recent Visitor Events</h3>
        </div>
        {scopedEvents.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No events captured yet. Click &ldquo;Send Test Event&rdquo; above or install the script on your website.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Event</th>
                  <th className="px-4 py-2.5 font-medium">Path</th>
                  <th className="px-4 py-2.5 font-medium">Traffic Source</th>
                  <th className="px-4 py-2.5 font-medium">UTM</th>
                  <th className="px-4 py-2.5 font-medium">Device</th>
                  <th className="px-4 py-2.5 font-medium text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {scopedEvents.slice(0, 20).map((ev) => (
                  <tr key={ev.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5">
                      <StatusText
                        label={ev.eventType}
                        tone={ev.eventType === 'pageview' ? 'info' : 'success'}
                      />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px]">{ev.path}</td>
                    <td className="px-4 py-2.5">{ev.trafficSource}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {ev.utmCampaign ? `${ev.utmSource || ''}/${ev.utmCampaign}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 capitalize">{ev.deviceType}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {ev.conversionValue > 0 ? `$${ev.conversionValue.toLocaleString()}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
