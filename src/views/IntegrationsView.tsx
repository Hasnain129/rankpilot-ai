import React, { useState } from 'react';
import { ExternalLink, Info, Layers, X } from 'lucide-react';
import { EmptyState, StatusText } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { IntegrationConfig, IntegrationProvider, Website } from '../types';

interface IntegrationsViewProps {
  websites: Website[];
  integrations: IntegrationConfig[];
  selectedWebsiteId: string;
  onSaveConfig: (input: {
    websiteId: string;
    provider: IntegrationProvider;
    status: 'not_connected' | 'configured';
    identifier?: string;
    notes?: string;
  }) => Promise<void>;
  onAddWebsitePrompt: () => void;
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
}> = [
  {
    provider: 'google_search_console',
    name: 'Google Search Console API',
    category: 'Verified Search Performance',
    description: 'Sync verified organic impressions, clicks, average CTR, and keyword positions directly from Google.',
    identifierLabel: 'Search Console Property URL',
    identifierPlaceholder: 'sc-domain:example.com or https://example.com/',
    setupSteps: [
      'Enable the Google Search Console API in Google Cloud Console.',
      'Configure OAuth 2.0 Web Client with scope https://www.googleapis.com/auth/webmasters.readonly.',
      'Verify domain ownership in Search Console and enter your property identifier below.',
    ],
    docsUrl: 'https://developers.google.com/webmaster-tools',
  },
  {
    provider: 'google_analytics_4',
    name: 'Google Analytics 4 API',
    category: 'Web & Audience Telemetry',
    description: 'Cross-reference RankPilot visitor tracking with GA4 Data API engagement and ecommerce conversions.',
    identifierLabel: 'GA4 Property ID',
    identifierPlaceholder: 'properties/123456789',
    setupSteps: [
      'Enable Google Analytics Data API v1 in Google Cloud Console.',
      'Grant Viewer access to your service account or OAuth client on the GA4 property.',
      'Store your numeric GA4 Property ID below to map this website.',
    ],
    docsUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1',
  },
  {
    provider: 'google_pagespeed',
    name: 'Google PageSpeed Insights API',
    category: 'Core Web Vitals',
    description: 'Run Lighthouse performance, LCP, CLS, and INP diagnostics alongside RankPilot technical crawls.',
    identifierLabel: 'Target Canonical URL',
    identifierPlaceholder: 'https://example.com',
    setupSteps: [
      'Enable PageSpeed Insights API in Google Cloud Console.',
      'Optionally set GOOGLE_PAGESPEED_API_KEY in server environment variables for higher quota.',
      'Save your canonical homepage URL below for Lighthouse checks.',
    ],
    docsUrl: 'https://developers.google.com/speed/docs/insights/v5/get-started',
  },
  {
    provider: 'shopify',
    name: 'Shopify',
    category: 'E-Commerce Order Sync',
    description: 'Automatically ingest Shopify orders/create webhooks into RankPilot Order Management and revenue attribution.',
    identifierLabel: 'Shopify Store Domain',
    identifierPlaceholder: 'your-store.myshopify.com',
    setupSteps: [
      'Create a Custom App in Shopify Admin with read_orders scope.',
      'Point Shopify orders/paid webhook to your backend endpoint with HMAC verification.',
      'Record your .myshopify.com store domain below.',
    ],
    docsUrl: 'https://shopify.dev/docs/apps/webhooks',
  },
  {
    provider: 'woocommerce',
    name: 'WooCommerce',
    category: 'E-Commerce Order Sync',
    description: 'Connect WordPress WooCommerce REST API or Order Created webhooks to track checkout revenue.',
    identifierLabel: 'WooCommerce Store URL',
    identifierPlaceholder: 'https://shop.example.com',
    setupSteps: [
      'Navigate to WooCommerce → Settings → Advanced → REST API and generate Read keys.',
      'Configure an Order Created webhook pointing to your RankPilot ingest route.',
      'Save your WooCommerce store base URL below.',
    ],
    docsUrl: 'https://woocommerce.github.io/woocommerce-rest-api-docs/',
  },
];

export function IntegrationsView({
  websites,
  integrations,
  selectedWebsiteId,
  onSaveConfig,
  onAddWebsitePrompt,
}: IntegrationsViewProps) {
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
        description="Integrations such as Google Search Console, GA4, PageSpeed Insights, Shopify, and WooCommerce are configured per website."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

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
          Showing integration configuration for <strong>{activeSite.name}</strong> ({activeSite.domain}). External OAuth tokens and live API sync require configuring credentials in your cloud project; RankPilot never displays simulated live integration metrics.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {CATALOG.map((item) => {
          const cfg = integrations.find(
            (i) => i.websiteId === activeSite.id && i.provider === item.provider
          );
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
                    label={isConfigured ? 'Configured (Pending OAuth)' : 'Not Connected'}
                    tone={isConfigured ? 'info' : 'neutral'}
                  />
                </div>

                <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {item.description}
                </p>

                {isConfigured && cfg?.identifier && (
                  <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                    Property / Store: {cfg.identifier}
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

              <div className="mt-5 flex items-center justify-between gap-2 pt-2">
                <a
                  href={item.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <span>API Docs</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  type="button"
                  onClick={() => openModal(item)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>{isConfigured ? 'Edit Config' : 'Setup Integration'}</span>
                </button>
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
              Save your property or store identifier for <strong>{activeSite.domain}</strong>. Keep secret API keys in server-side environment variables only.
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
