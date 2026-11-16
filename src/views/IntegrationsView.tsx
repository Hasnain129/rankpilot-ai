import React, { useState } from 'react';
import { ArrowRight, ExternalLink, Info, Layers, X } from 'lucide-react';
import { EmptyState, StatusText } from '../components/ui/DataState';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { IntegrationConfig, IntegrationProvider, NavSection, Website, WpConnection } from '../types';

interface IntegrationsViewProps {
  websites: Website[];
  integrations: IntegrationConfig[];
  wpConnections: WpConnection[];
  selectedWebsiteId: string;
  onSaveConfig: (input: {
    websiteId: string;
    provider: IntegrationProvider;
    status: 'not_connected' | 'configured';
    identifier?: string;
    notes?: string;
  }) => Promise<void>;
  onAddWebsitePrompt: () => void;
  onNavigate?: (section: NavSection) => void;
}

const CATALOG: Array<{
  provider: IntegrationProvider;
  name: string;
  category: string;
  description: string;
  identifierLabel: string;
  identifierPlaceholder: string;
  setupSteps: string[];
  docsUrl: string;
  targetSection?: NavSection;
  targetLabel?: string;
}> = [
  {
    provider: 'wordpress',
    name: 'WordPress & WooCommerce REST API',
    category: 'Live Catalog & SEO Sync',
    description: 'Import products, categories, posts, and pages, and push user-approved SEO meta titles, descriptions, and copy with rollback.',
    identifierLabel: 'WordPress Site URL',
    identifierPlaceholder: 'https://shop.example.com',
    setupSteps: [
      'Create a WordPress Application Password under Users → Profile.',
      'For WooCommerce stores, generate Read/Write REST API keys in WooCommerce → Settings → Advanced.',
      'Connect credentials inside the encrypted WordPress / Woo Sync module.',
    ],
    docsUrl: 'https://developer.wordpress.org/rest-api/',
    targetSection: 'wordpress-woo',
    targetLabel: 'Open WP/Woo Sync',
  },
  {
    provider: 'google_search_console',
    name: 'Google Search Console API',
    category: 'Verified Search Performance',
    description: 'Sync verified organic impressions, clicks, average CTR, keyword positions, and URL inspection status directly via Google OAuth.',
    identifierLabel: 'Search Console Property URL',
    identifierPlaceholder: 'sc-domain:example.com or https://example.com/',
    setupSteps: [
      'Authorize Google OAuth in the Search Console module (`webmasters.readonly` scope).',
      'Select your verified Search Console property.',
      'Sync queries, pages, date comparisons, and index coverage.',
    ],
    docsUrl: 'https://developers.google.com/webmaster-tools',
    targetSection: 'search-console',
    targetLabel: 'Open Search Console',
  },
  {
    provider: 'google_pagespeed',
    name: 'Google PageSpeed Insights API v5',
    category: 'Core Web Vitals',
    description: 'Run live Lighthouse performance, LCP, CLS, INP, TTFB, robots.txt, and sitemap diagnostics.',
    identifierLabel: 'Target Canonical URL',
    identifierPlaceholder: 'https://example.com',
    setupSteps: [
      'Works immediately via Google PageSpeed Insights v5 API.',
      'Optionally set GOOGLE_PAGESPEED_API_KEY in server environment variables for higher quota.',
      'Run audits directly in the Technical Monitor module.',
    ],
    docsUrl: 'https://developers.google.com/speed/docs/insights/v5/get-started',
    targetSection: 'technical-monitor',
    targetLabel: 'Open Technical Monitor',
  },
  {
    provider: 'woocommerce',
    name: 'WooCommerce Order & Catalog Sync',
    category: 'E-Commerce Storefront',
    description: 'Synchronize WooCommerce products and categories for AI on-page optimization and revenue tracking.',
    identifierLabel: 'WooCommerce Store URL',
    identifierPlaceholder: 'https://shop.example.com',
    setupSteps: [
      'Navigate to WooCommerce → Settings → Advanced → REST API and generate Read/Write keys.',
      'Use the WordPress / Woo Sync view to encrypt and store credentials.',
      'Review AI drafts in Optimization Center before applying changes.',
    ],
    docsUrl: 'https://woocommerce.github.io/woocommerce-rest-api-docs/',
    targetSection: 'wordpress-woo',
    targetLabel: 'Open WooCommerce Sync',
  },
  {
    provider: 'google_analytics_4',
    name: 'Google Analytics 4 API',
    category: 'Web & Audience Telemetry',
    description: 'Map your GA4 Property ID to pair RankPilot visitor tracking with existing property telemetry.',
    identifierLabel: 'GA4 Property ID',
    identifierPlaceholder: 'properties/123456789',
    setupSteps: [
      'Enable Google Analytics Data API v1 in Google Cloud Console.',
      'Grant Viewer access to your OAuth client on the GA4 property.',
      'Record your numeric GA4 Property ID below to map this website.',
    ],
    docsUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1',
  },
  {
    provider: 'shopify',
    name: 'Shopify',
    category: 'E-Commerce Order Sync',
    description: 'Record your Shopify store domain alongside RankPilot conversion tracking and manual/imported order workflows.',
    identifierLabel: 'Shopify Store Domain',
    identifierPlaceholder: 'your-store.myshopify.com',
    setupSteps: [
      'Create a Custom App in Shopify Admin with read_orders scope.',
      'Point Shopify orders/paid webhook to a custom ingest endpoint if needed.',
      'Save your .myshopify.com store domain below.',
    ],
    docsUrl: 'https://shopify.dev/docs/apps/webhooks',
  },
];

export function IntegrationsView({
  websites,
  integrations,
  wpConnections,
  selectedWebsiteId,
  onSaveConfig,
  onAddWebsitePrompt,
  onNavigate,
}: IntegrationsViewProps) {
  const { gscAccessToken } = useAuth();
  const { toast } = useToast();
  const activeSite =
    (selectedWebsiteId !== 'all' ? websites.find((w) => w.id === selectedWebsiteId) : websites[0]) || null;

  const [editingItem, setEditingItem] = useState<(typeof CATALOG)[number] | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  if (!activeSite) {
    return (
      <EmptyState
        title="Connect a website to configure integrations"
        description="Integrations such as WordPress/WooCommerce, Google Search Console, PageSpeed Insights, GA4, and Shopify are configured per website."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  const wpConn = wpConnections.find((c) => c.websiteId === activeSite.id);

  const openModal = (item: (typeof CATALOG)[number]) => {
    const existing = integrations.find(
      (i) => i.websiteId === activeSite.id && i.provider === item.provider
    );
    setEditingItem(item);
    setIdentifier(existing?.identifier || '');
    setNotes(existing?.notes || '');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setSaving(true);
    try {
      const cleanId = identifier.trim();
      await onSaveConfig({
        websiteId: activeSite.id,
        provider: editingItem.provider,
        status: cleanId ? 'configured' : 'not_connected',
        identifier: cleanId,
        notes,
      });
      toast({
        title: `${editingItem.name} updated`,
        description: cleanId ? 'Configuration identifier saved to Firestore.' : 'Reset to Not Connected.',
        variant: 'success',
      });
      setEditingItem(null);
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unable to save configuration.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
        <div>
          Showing integration hubs for <strong>{activeSite.name}</strong> ({activeSite.domain}). Secret keys are encrypted server-side; Search Console uses live popup OAuth. RankPilot never displays simulated live integration metrics.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {CATALOG.map((item) => {
          const cfg = integrations.find(
            (i) => i.websiteId === activeSite.id && i.provider === item.provider
          );
          const isWpLive =
            (item.provider === 'wordpress' || item.provider === 'woocommerce') &&
            wpConn?.status === 'connected';
          const isGscLive = item.provider === 'google_search_console' && Boolean(gscAccessToken);
          const isConfigured = cfg?.status === 'configured';

          return (
            <div
              key={item.provider}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium text-slate-500">{item.category}</div>
                    <h3 className="mt-0.5 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {item.name}
                    </h3>
                  </div>
                  <StatusText
                    label={
                      isWpLive
                        ? 'Encrypted & Connected'
                        : isGscLive
                        ? 'OAuth Active'
                        : item.provider === 'google_pagespeed'
                        ? 'Live Ready'
                        : isConfigured
                        ? 'Identifier Saved'
                        : 'Not Connected'
                    }
                    tone={
                      isWpLive || isGscLive || item.provider === 'google_pagespeed'
                        ? 'success'
                        : isConfigured
                        ? 'info'
                        : 'neutral'
                    }
                  />
                </div>

                <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {item.description}
                </p>

                {isConfigured && cfg?.identifier && (
                  <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                    Identifier: {cfg.identifier}
                  </div>
                )}

                <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-500">Setup Checklist</div>
                  <ol className="space-y-1 text-xs text-slate-600 dark:text-slate-400 list-decimal pl-4">
                    {item.setupSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 pt-2">
                <a
                  href={item.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <span>API Docs</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
                <div className="flex items-center gap-2">
                  {item.targetSection && onNavigate && (
                    <button
                      type="button"
                      onClick={() => onNavigate(item.targetSection!)}
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      <span>{item.targetLabel}</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openModal(item)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>{isConfigured ? 'Edit Note' : 'Save Property ID'}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-base font-bold">{editingItem.name}</h3>
              <button type="button" onClick={() => setEditingItem(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Save your property or store identifier for <strong>{activeSite.domain}</strong>. Keep secret API keys in server-side environment variables or the WordPress vault.
            </p>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">{editingItem.identifierLabel}</label>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={editingItem.identifierPlaceholder}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Implementation Notes (optional)</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="OAuth project ID or webhook notes..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditingItem(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
