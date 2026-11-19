import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Info,
  KeyRound,
  Loader2,
  Shield,
  ShoppingBag,
  Trash2,
  Wand2,
} from 'lucide-react';
import { EmptyState, ErrorBanner, StatusText } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/apiClient';
import { SyncLog, Website, WpConnection, WpEntity } from '../types';

interface WordPressViewProps {
  websites: Website[];
  wpConnections: WpConnection[];
  wpEntities: WpEntity[];
  syncLogs: SyncLog[];
  selectedWebsiteId: string;
  onAddWebsitePrompt: () => void;
  onOptimizeEntity: (entity: WpEntity) => void;
}

const WP_REST_META_SNIPPET = `<?php
// Optional: Add to your WordPress child theme functions.php to allow REST API read/write for Rank Math or Yoast SEO meta fields:
add_action('init', function() {
  $meta_keys = [
    'rank_math_title', 'rank_math_description', 'rank_math_focus_keyword',
    '_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_focuskw'
  ];
  foreach (['post', 'page', 'product'] as $pt) {
    foreach ($meta_keys as $key) {
      register_post_meta($pt, $key, [
        'show_in_rest' => true,
        'single' => true,
        'type' => 'string',
        'auth_callback' => function() { return current_user_can('edit_posts'); }
      ]);
    }
  }
});`;

export function WordPressView({
  websites,
  wpConnections,
  wpEntities,
  syncLogs,
  selectedWebsiteId,
  onAddWebsitePrompt,
  onOptimizeEntity,
}: WordPressViewProps) {
  const { toast } = useToast();

  const defaultSite =
    (selectedWebsiteId !== 'all' ? websites.find((w) => w.id === selectedWebsiteId) : websites[0]) ||
    null;

  const [siteId, setSiteId] = useState(defaultSite?.id || '');
  const [siteUrl, setSiteUrl] = useState(defaultSite?.url || '');
  const [wpUsername, setWpUsername] = useState('');
  const [wpAppPassword, setWpAppPassword] = useState('');
  const [wcConsumerKey, setWcConsumerKey] = useState('');
  const [wcConsumerSecret, setWcConsumerSecret] = useState('');

  const [connecting, setConnecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'product' | 'category' | 'post' | 'page'>('all');
  const [showSnippet, setShowSnippet] = useState(false);

  const activeSite = websites.find((w) => w.id === siteId) || websites[0] || null;
  const activeConn = activeSite
    ? wpConnections.find((c) => c.websiteId === activeSite.id)
    : undefined;

  useEffect(() => {
    if (selectedWebsiteId !== 'all') {
      const site = websites.find((w) => w.id === selectedWebsiteId);
      if (site) {
        setSiteId(site.id);
        setSiteUrl(site.url);
      }
    } else if (!siteId && websites[0]) {
      setSiteId(websites[0].id);
      setSiteUrl(websites[0].url);
    }
  }, [selectedWebsiteId, websites, siteId]);

  useEffect(() => {
    if (activeConn) {
      setSiteUrl(activeConn.siteUrl || activeSite?.url || '');
      setWpUsername(activeConn.wpUsername || '');
    } else if (activeSite) {
      setSiteUrl(activeSite.url);
    }
  }, [activeConn, activeSite]);

  const scopedEntities = useMemo(() => {
    if (!activeSite) return [];
    const base = wpEntities.filter((e) => e.websiteId === activeSite.id);
    if (typeFilter === 'all') return base;
    return base.filter((e) => e.entityType === typeFilter);
  }, [wpEntities, activeSite, typeFilter]);

  const scopedLogs = useMemo(() => {
    if (!activeSite) return [];
    return syncLogs
      .filter(
        (l) =>
          l.websiteId === activeSite.id &&
          (l.channel === 'wordpress' || l.channel === 'woocommerce')
      )
      .slice(0, 12);
  }, [syncLogs, activeSite]);

  if (!activeSite) {
    return (
      <EmptyState
        title="Add a website to connect WordPress & WooCommerce"
        description="Connect your store with WordPress Application Passwords and WooCommerce REST keys to import products, categories, posts, and SEO metadata."
        actionLabel="Add Website"
        onAction={onAddWebsitePrompt}
      />
    );
  }

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setConnecting(true);
    try {
      const data = await apiFetch<{ message: string }>('/api/wordpress/connect', {
        method: 'POST',
        body: JSON.stringify({
          websiteId: activeSite.id,
          siteUrl: siteUrl.trim(),
          wpUsername: wpUsername.trim(),
          wpAppPassword: wpAppPassword.trim(),
          wcConsumerKey: wcConsumerKey.trim(),
          wcConsumerSecret: wcConsumerSecret.trim(),
        }),
      });

      // Clear secret credentials from frontend memory immediately
      setWpAppPassword('');
      setWcConsumerKey('');
      setWcConsumerSecret('');
      toast({
        title: 'WordPress & WooCommerce connected',
        description: data.message,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to connect WordPress site.';
      setError(msg);
      toast({ title: 'Connection error', description: msg, variant: 'error' });
    } finally {
      setConnecting(false);
    }
  };

  const handleImportCatalog = async () => {
    setError(null);
    setImporting(true);
    try {
      const data = await apiFetch<{ importedCount: number; warnings?: string[]; seoPlugin: string }>(
        '/api/wordpress/import',
        {
          method: 'POST',
          body: JSON.stringify({ websiteId: activeSite.id }),
        }
      );
      toast({
        title: `Imported ${data.importedCount} item(s)`,
        description:
          (data.warnings?.length ?? 0) > 0
            ? `${data.warnings?.[0] ?? ''}`
            : `Detected SEO plugin: ${data.seoPlugin}`,
        variant: (data.warnings?.length ?? 0) > 0 ? 'info' : 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Catalog import failed.';
      setError(msg);
      toast({ title: 'Import failed', description: msg, variant: 'error' });
    } finally {
      setImporting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await apiFetch<{ ok: boolean }>(`/api/wordpress/disconnect?websiteId=${encodeURIComponent(activeSite.id)}`, {
        method: 'DELETE',
      });
      toast({ title: 'Credentials removed from vault', variant: 'info' });
    } catch (err) {
      toast({
        title: 'Disconnect failed',
        description: err instanceof Error ? err.message : 'Error removing connection.',
        variant: 'error',
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const pluginLabel =
    activeConn?.seoPlugin === 'rank_math'
      ? 'Rank Math SEO'
      : activeConn?.seoPlugin === 'yoast'
      ? 'Yoast SEO'
      : 'Core WP / WC';

  return (
    <div className="space-y-6">
      {/* Top Connection & Security Card */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleConnect}
          className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-semibold">WordPress &amp; WooCommerce Credentials</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Credentials are encrypted server-side (AES-256-GCM) and never exposed back to the browser.
              </p>
            </div>
            {activeConn && (
              <StatusText
                label={activeConn.status === 'connected' ? `Connected · ${pluginLabel}` : activeConn.status}
                tone={activeConn.status === 'connected' ? 'success' : 'warning'}
              />
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Workspace Website</label>
              <select
                value={activeSite.id}
                onChange={(e) => {
                  const s = websites.find((w) => w.id === e.target.value);
                  setSiteId(e.target.value);
                  if (s) setSiteUrl(s.url);
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              >
                {websites.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.domain})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">WordPress Site URL</label>
              <input
                type="url"
                required
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://store.example.com"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                WordPress Username
              </label>
              <input
                type="text"
                value={wpUsername}
                onChange={(e) => setWpUsername(e.target.value)}
                placeholder="admin or seo_editor"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                WP Application Password {activeConn?.hasWpAppPassword ? '(Saved — leave blank to keep)' : ''}
              </label>
              <input
                type="password"
                value={wpAppPassword}
                onChange={(e) => setWpAppPassword(e.target.value)}
                placeholder={activeConn?.hasWpAppPassword ? '••••••••••••' : 'xxxx xxxx xxxx xxxx'}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                WooCommerce Consumer Key {activeConn?.hasWcKeys ? '(Saved — leave blank to keep)' : ''}
              </label>
              <input
                type="password"
                value={wcConsumerKey}
                onChange={(e) => setWcConsumerKey(e.target.value)}
                placeholder={activeConn?.hasWcKeys ? 'ck_••••••••••••' : 'ck_...'}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                WooCommerce Consumer Secret {activeConn?.hasWcKeys ? '(Saved — leave blank to keep)' : ''}
              </label>
              <input
                type="password"
                value={wcConsumerSecret}
                onChange={(e) => setWcConsumerSecret(e.target.value)}
                placeholder={activeConn?.hasWcKeys ? 'cs_••••••••••••' : 'cs_...'}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <button
              type="submit"
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              <span>{connecting ? 'Verifying REST Access...' : 'Verify & Save Encrypted'}</span>
            </button>

            <div className="flex items-center gap-2">
              {activeConn && (
                <>
                  <button
                    type="button"
                    onClick={handleImportCatalog}
                    disabled={importing}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    <span>{importing ? 'Importing Catalog...' : 'Import Products & Pages'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Disconnect</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </form>

        {/* Connection Status & SEO Plugin Meta Notice */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-display text-sm font-semibold">Minimum Permission &amp; Plugin Guide</h3>
          </div>
          <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400 list-disc pl-4">
            <li>
              <strong>WordPress:</strong> Create a dedicated Editor/SEO user and generate an <em>Application Password</em> under Users → Profile.
            </li>
            <li>
              <strong>WooCommerce:</strong> Generate REST API keys under WooCommerce → Settings → Advanced with <strong>Read/Write</strong> scope (for approved product/category updates).
            </li>
            <li>
              <strong>Rank Math &amp; Yoast SEO:</strong> WordPress blocks custom post meta writes via REST unless registered. Expand the snippet below if meta titles/descriptions do not sync.
            </li>
          </ul>

          {activeConn?.syncMessage && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
              <div className="font-semibold">Latest Status</div>
              <div className="mt-0.5">{activeConn.syncMessage}</div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowSnippet((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            <Info className="h-3.5 w-3.5" />
            <span>{showSnippet ? 'Hide WordPress Meta PHP Snippet' : 'Show Rank Math / Yoast REST PHP Snippet'}</span>
          </button>

          {showSnippet && (
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-[10px] leading-relaxed text-slate-100">
              {WP_REST_META_SNIPPET}
            </pre>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Imported Catalog Table */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-display text-sm font-semibold">
              Imported Catalog &amp; Content ({scopedEntities.length})
            </h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'product', 'category', 'post', 'page'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  typeFilter === t
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {t === 'all' ? 'All' : `${t.charAt(0).toUpperCase()}${t.slice(1)}s`}
              </button>
            ))}
          </div>
        </div>

        {scopedEntities.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No catalog items imported yet. Verify your WordPress/WooCommerce connection above and click &ldquo;Import Products &amp; Pages&rdquo;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Item / Title</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">SEO Meta</th>
                  <th className="px-4 py-2.5 font-medium">Focus Keyword</th>
                  <th className="px-4 py-2.5 font-medium text-right">Missing Alts</th>
                  <th className="px-4 py-2.5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {scopedEntities.map((item) => {
                  const hasMeta = Boolean(item.seoTitle || item.seoDescription);
                  return (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 max-w-xs">
                        <div className="truncate font-medium text-slate-900 dark:text-slate-100">
                          {item.title}
                        </div>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 truncate font-mono text-[11px] text-slate-500 hover:text-indigo-600"
                        >
                          <span className="truncate max-w-[230px]">{item.url}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      </td>
                      <td className="px-4 py-3 uppercase font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {item.entityType} #{item.remoteId}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText
                          label={hasMeta ? 'Meta Set' : 'Missing Meta'}
                          tone={hasMeta ? 'success' : 'warning'}
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {item.focusKeyword || '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        <span className={item.missingAltCount > 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-500'}>
                          {item.missingAltCount}/{item.imagesCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onOptimizeEntity(item)}
                          className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
                        >
                          <Wand2 className="h-3 w-3" />
                          <span>Optimize</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sync Logs */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h3 className="font-display text-xs font-semibold">Synchronization Logs ({scopedLogs.length})</h3>
        </div>
        {scopedLogs.length === 0 ? (
          <div className="p-5 text-center text-xs text-slate-500">No WordPress sync events recorded yet.</div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {scopedLogs.map((log) => (
              <div key={log.id} className="flex items-start justify-between gap-3 px-5 py-3 text-xs">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="font-medium text-slate-900 dark:text-slate-100">{log.action}</span>
                    <StatusText
                      label={log.status}
                      tone={log.status === 'success' ? 'success' : log.status === 'error' ? 'danger' : 'warning'}
                    />
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{log.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
