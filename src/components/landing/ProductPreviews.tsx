import React, { useState } from 'react';
import {
  CheckCircle2,
  FileBarChart,
  Gauge,
  Globe,
  LayoutDashboard,
  LineChart,
  Monitor,
  PieChart,
  Search,
  Smartphone,
  Sparkles,
  Target,
  TrendingUp,
  Wand2,
} from 'lucide-react';

type PreviewModuleId = 'dashboard' | 'keywords' | 'technical' | 'on-page';

const PREVIEW_TABS: Array<{
  id: PreviewModuleId;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'dashboard',
    label: 'SEO Dashboard',
    subtitle: 'Unified site health, Google telemetry, and workflow summary',
    icon: LayoutDashboard,
  },
  {
    id: 'keywords',
    label: 'Keyword Research',
    subtitle: 'Discovery, topic clusters, opportunities, and competitor gap tools',
    icon: TrendingUp,
  },
  {
    id: 'technical',
    label: 'Technical SEO',
    subtitle: 'Mobile and desktop PageSpeed Insights, CWV, and crawlability checks',
    icon: Gauge,
  },
  {
    id: 'on-page',
    label: 'On-Page SEO',
    subtitle: 'AI-assisted title, meta, and product draft review before syncing',
    icon: Wand2,
  },
];

export function HeroDashboardPreview() {
  return (
    <div className="relative rounded-2xl border border-slate-200/90 bg-white shadow-xl shadow-indigo-950/5 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40 overflow-hidden">
      {/* Subtle browser chrome */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/90 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-950/70">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>
        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          RankPilot AI · Workspace Overview
        </div>
        <div className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
          Workspace Preview
        </div>
      </div>

      {/* App Shell layout preview */}
      <div className="grid grid-cols-1 md:grid-cols-12">
        {/* Mini sidebar */}
        <div className="hidden md:flex md:col-span-4 flex-col border-r border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="flex items-center gap-2 pb-3 mb-2 border-b border-slate-200 dark:border-slate-800">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-white">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <span className="font-display text-xs font-bold text-slate-900 dark:text-slate-100">
              RankPilot AI
            </span>
          </div>

          <div className="mb-3 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            Scope: All Connected Sites
          </div>

          <div className="space-y-1 text-[11px]">
            {[
              { label: 'SEO Dashboard', icon: LayoutDashboard, active: true },
              { label: 'Website Audit', icon: Search, active: false },
              { label: 'Keyword Research', icon: TrendingUp, active: false },
              { label: 'Google Rank Tracking', icon: Target, active: false },
              { label: 'On-Page SEO', icon: Wand2, active: false },
              { label: 'Technical SEO', icon: Gauge, active: false },
              { label: 'AI SEO Recommendations', icon: Sparkles, active: false },
              { label: 'SEO Reports', icon: FileBarChart, active: false },
            ].map(({ label, icon: Icon, active }) => (
              <div
                key={label}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 font-medium ${
                  active
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Workspace main canvas */}
        <div className="md:col-span-8 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Workspace / SEO Dashboard
              </div>
              <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Centralized SEO Command Center
              </div>
            </div>
            <div className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white">
              Add Website
            </div>
          </div>

          {/* Real module status tiles (no fabricated customer telemetry) */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <Globe className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Website Audit</span>
              </div>
              <div className="mt-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                Crawl &amp; Issue Diagnostics
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Metadata, headings, canonicals &amp; links
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <LineChart className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>GSC &amp; GA4 Telemetry</span>
              </div>
              <div className="mt-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                Verified Google Data
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Authorized per connected property
              </div>
            </div>
          </div>

          {/* Workflow queue representation */}
          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200">
              <span>Optimization &amp; Audit Workflow</span>
              <span className="font-normal text-slate-400">Structured Review</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 text-[11px]">
              {[
                {
                  module: 'AI Keyword Research',
                  detail: 'Discovery, topic clusters & competitor gaps',
                  state: 'Ready',
                },
                {
                  module: 'Technical SEO & PageSpeed',
                  detail: 'Mobile & desktop Core Web Vitals snapshots',
                  state: 'On Demand',
                },
                {
                  module: 'On-Page & WooCommerce Sync',
                  detail: 'Review title & description diffs before publishing',
                  state: 'Draft Review',
                },
              ].map((row) => (
                <div key={row.module} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {row.module}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 truncate">{row.detail}</div>
                  </div>
                  <span className="shrink-0 font-medium text-indigo-600 dark:text-indigo-400">
                    {row.state}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InteractiveProductShowcase() {
  const [activeTab, setActiveTab] = useState<PreviewModuleId>('dashboard');

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
      {/* Interactive module selector bar */}
      <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6 dark:border-slate-800 dark:bg-slate-950/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Workspace preview modules">
            {PREVIEW_TABS.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    selected
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Example Interface · Connect your site for live results
          </span>
        </div>
      </div>

      {/* Preview content area */}
      <div className="p-5 sm:p-7">
        {activeTab === 'dashboard' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  SEO Dashboard
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Monitor site audit scores, open AI recommendations, tracked keywords, and connected Google data per site or across all properties.
                </p>
              </div>
              <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                Multi-site Scope Filter
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: 'Site Health Audit', value: 'Live Crawl Check', note: 'Issues grouped by severity', icon: Globe },
                { label: 'Google Search Console', value: 'Verified Property', note: 'Clicks, impressions & queries', icon: LineChart },
                { label: 'Google Analytics 4', value: 'Connected Channel View', note: 'Organic sessions & conversions', icon: PieChart },
                { label: 'On-Page Workflow', value: 'Approval Queue', note: 'Drafts reviewed before sync', icon: CheckCircle2 },
              ].map(({ label, value, note, icon: Icon }) => (
                <div
                  key={label}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/50"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>{label}</span>
                    <Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="mt-2 font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    {value}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{note}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'keywords' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Keyword Research
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Structured 6-tab workflow powered by Gemini AI and optional keyword provider connections.
                </p>
              </div>
              <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                CSV Export &amp; Page Assignment
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-3 dark:border-slate-800">
              {[
                'Discovery & Metrics',
                'Clusters & Content',
                'Opportunity Analysis',
                'WooCommerce & Page Map',
                'Competitor URLs',
                'Data Providers',
              ].map((t, i) => (
                <span
                  key={t}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    i === 0
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {t}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Search Intent &amp; Topic Clusters
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Organizes keyword ideas into informational, commercial, and transactional topic groups.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Competitor URL Gap Scan
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Extracts headings and topics from competitor URLs to surface uncovered keyword angles.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Send to On-Page or Rank Tracker
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Assign chosen keywords directly to crawled pages or WordPress/WooCommerce items.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'technical' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Technical SEO &amp; PageSpeed
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Run separate Mobile and Desktop Google PageSpeed Insights checks alongside crawlability diagnostics.
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs dark:border-slate-700 dark:bg-slate-800">
                <span className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 font-medium text-indigo-600 shadow-xs dark:bg-slate-900 dark:text-indigo-400">
                  <Smartphone className="h-3.5 w-3.5" />
                  Mobile
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-500 dark:text-slate-400">
                  <Monitor className="h-3.5 w-3.5" />
                  Desktop
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { metric: 'LCP', full: 'Largest Contentful Paint', desc: 'Loading speed threshold' },
                { metric: 'CLS', full: 'Cumulative Layout Shift', desc: 'Visual stability check' },
                { metric: 'INP / TBT', full: 'Interactivity & Blocking', desc: 'Main-thread responsiveness' },
                { metric: 'Crawl & Meta', full: 'Canonicals & Noindex', desc: 'Robots, redirects & HTTPS' },
              ].map((item) => (
                <div
                  key={item.metric}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-950/50"
                >
                  <div className="font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                    {item.metric}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {item.full}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {item.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'on-page' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  On-Page SEO Optimization
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Generate AI-assisted metadata suggestions, compare before/after diffs per field, and approve drafts before syncing.
                </p>
              </div>
              <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                Human Approval Required Before Sync
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Current Snapshot (Example Field Structure)
                </div>
                <div className="mt-2 space-y-2 text-xs">
                  <div>
                    <span className="font-medium text-slate-700 dark:text-slate-300">SEO Title:</span>{' '}
                    <span className="text-slate-500 dark:text-slate-400">Original page or product title</span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-700 dark:text-slate-300">Meta Description:</span>{' '}
                    <span className="text-slate-500 dark:text-slate-400">Existing excerpt or missing tag</span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/20">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-indigo-700 dark:text-indigo-300">
                    Optimized Draft Review
                  </span>
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">
                    Approve · Reject · Edit
                  </span>
                </div>
                <div className="mt-2 space-y-2 text-xs">
                  <div>
                    <span className="font-medium text-slate-800 dark:text-slate-200">Focus Keyword:</span>{' '}
                    <span className="text-slate-600 dark:text-slate-300">Targeted search phrase &amp; headings</span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-800 dark:text-slate-200">WordPress / WooCommerce:</span>{' '}
                    <span className="text-slate-600 dark:text-slate-300">Sync only approved drafts to connected store</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
