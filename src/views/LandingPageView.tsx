import React, { useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  FileBarChart,
  Gauge,
  Globe,
  Lightbulb,
  LineChart,
  Menu,
  Moon,
  PieChart,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  Sun,
  Target,
  TrendingUp,
  UserCheck,
  Wand2,
  X,
} from 'lucide-react';
import {
  HeroDashboardPreview,
  InteractiveProductShowcase,
} from '../components/landing/ProductPreviews';
import { useTheme } from '../context/ThemeContext';

interface LandingPageViewProps {
  isAuthenticated: boolean;
  onNavigate: (path: string) => void;
}

const TRADITIONAL_SEO_PAIN = [
  'Multiple disconnected tools',
  'Manual keyword research',
  'Time-consuming technical checks',
  'Scattered performance reports',
  'Difficult optimization workflows',
] as const;

const RANKPILOT_ADVANTAGES = [
  'Centralized SEO dashboard',
  'AI-assisted keyword discovery',
  'Website and technical SEO audits',
  'Connected Google performance data',
  'Organized review and optimization workflow',
] as const;

const MAIN_FEATURES = [
  {
    code: 'A',
    title: 'Website SEO Audits',
    description: 'Find technical issues and discover opportunities to improve your website.',
    detail: 'Crawl website pages for missing metadata, heading hierarchy issues, broken links, and canonical gaps.',
    icon: Globe,
  },
  {
    code: 'B',
    title: 'AI Keyword Research',
    description: 'Discover relevant keywords, understand search intent, and plan smarter content.',
    detail: 'Build structured keyword groups, opportunity lists, and content plans in one workspace.',
    icon: Search,
  },
  {
    code: 'C',
    title: 'Google Rank Tracking',
    description: 'Monitor your verified Google Search Console positions and search performance.',
    detail: 'Track targeted queries alongside Search Console click, impression, and average position snapshots.',
    icon: Target,
  },
  {
    code: 'D',
    title: 'On-Page SEO Optimization',
    description: 'Improve page titles, descriptions, and product page SEO with AI-assisted recommendations.',
    detail: 'Compare original vs. suggested copy line-by-line before approving any draft.',
    icon: Wand2,
  },
  {
    code: 'E',
    title: 'Technical SEO & PageSpeed',
    description: 'Analyze website speed, Core Web Vitals, and crawlability.',
    detail: 'Run separate mobile and desktop PageSpeed Insights diagnostics with crawlability findings.',
    icon: Gauge,
  },
  {
    code: 'F',
    title: 'Competitor Content Analysis',
    description: 'Explore competitor page content and discover keyword and topic gaps.',
    detail: 'Analyze competitor URLs to surface uncovered topics and content angles for your site.',
    icon: TrendingUp,
  },
  {
    code: 'G',
    title: 'AI SEO Recommendations',
    description: 'Turn SEO findings into clear, actionable improvement plans.',
    detail: 'Prioritize open fixes across technical, content, and on-page workflows and track completion.',
    icon: Lightbulb,
  },
  {
    code: 'H',
    title: 'SEO Reports',
    description: 'Review website SEO findings and connected performance insights.',
    detail: 'Bring together audit health, technical metrics, and connected Google summaries in one place.',
    icon: FileBarChart,
  },
  {
    code: 'I',
    title: 'WordPress & WooCommerce SEO',
    description: 'Review, approve, and synchronize supported SEO changes.',
    detail: 'Connect your store or site credentials to sync approved title, meta, and product SEO drafts.',
    icon: ShoppingBag,
  },
  {
    code: 'J',
    title: 'GSC & GA4 Integrations',
    description: 'Connect verified Google Search Console and Analytics data.',
    detail: 'Authorize your own Google account to inspect Search Console queries and GA4 organic traffic.',
    icon: LineChart,
  },
] as const;

const WORKFLOW_STEPS = [
  {
    step: 'Step 1',
    title: 'Add Your Website',
    description: 'Connect or register your website inside your workspace.',
    previewLabel: 'Workspace Scope · Domain Added',
    previewHint: 'Register one or multiple websites under isolated workspace storage.',
    icon: Globe,
  },
  {
    step: 'Step 2',
    title: 'Analyze & Discover',
    description: 'Run audits, explore keywords, and review available Google data.',
    previewLabel: 'Crawl · Keywords · GSC / GA4',
    previewHint: 'Inspect technical issues, keyword opportunities, and connected Google snapshots.',
    icon: Search,
  },
  {
    step: 'Step 3',
    title: 'Optimize & Grow',
    description: 'Review SEO recommendations, optimize pages, and monitor progress.',
    previewLabel: 'Draft Diff · Approve · Track',
    previewHint: 'Approve tailored on-page improvements and follow your SEO priorities over time.',
    icon: Sparkles,
  },
] as const;

const AUDIENCES = [
  {
    title: 'SEO Professionals',
    description:
      'Consolidate live website crawls, PageSpeed checks, Search Console query analysis, and on-page draft reviews into a focused daily workspace.',
    icon: UserCheck,
  },
  {
    title: 'Digital Marketing Agencies',
    description:
      'Scope audits, keyword projects, and SEO recommendations cleanly per client website without juggling separate spreadsheets.',
    icon: Briefcase,
  },
  {
    title: 'E-commerce Store Owners',
    description:
      'Map keywords to WooCommerce product and category pages, review AI-assisted metadata drafts, and sync approved updates safely.',
    icon: Store,
  },
  {
    title: 'Business Owners',
    description:
      'Understand technical issues, search performance, and prioritized SEO actions clearly without needing deep developer tooling.',
    icon: Building2,
  },
] as const;

const INTEGRATIONS = [
  {
    name: 'Google Search Console',
    summary: 'Authorize your Google account to view verified search queries, clicks, impressions, and average positions.',
    icon: LineChart,
  },
  {
    name: 'Google Analytics 4',
    summary: 'Connect your GA4 property to review organic sessions, traffic channels, and conversion activity.',
    icon: PieChart,
  },
  {
    name: 'Google PageSpeed Insights',
    summary: 'Check mobile and desktop performance scores and Core Web Vitals for live pages.',
    icon: Gauge,
  },
  {
    name: 'WordPress',
    summary: 'Connect your WordPress site credentials to fetch pages/posts and push approved SEO metadata.',
    icon: Globe,
  },
  {
    name: 'WooCommerce',
    summary: 'Target product and category pages with keyword mapping and reviewed on-page SEO updates.',
    icon: ShoppingBag,
  },
  {
    name: 'Google Gemini AI',
    summary: 'Generates structured keyword ideas, topic clusters, on-page suggestions, and prioritized SEO recommendations.',
    icon: Sparkles,
  },
] as const;

const FAQS = [
  {
    question: 'What is RankPilot AI?',
    answer:
      'RankPilot AI is a web-based SEO workspace that brings website crawling and audits, AI-assisted keyword research, technical PageSpeed diagnostics, on-page draft reviews, and connected Google Search Console and GA4 views into one application.',
  },
  {
    question: 'Can I analyze multiple websites?',
    answer:
      'Yes. You can register multiple websites inside your workspace and switch the Workspace Scope selector between a single property and all connected websites.',
  },
  {
    question: 'Does RankPilot AI connect to Google Search Console?',
    answer:
      'Yes. Signed-in users can authorize their own Google account with read-only Search Console access to pull verified queries, clicks, impressions, and URL performance for their verified properties.',
  },
  {
    question: 'Can it optimize WooCommerce product pages?',
    answer:
      'Yes. When you connect a WordPress and WooCommerce site with your store credentials, you can map keywords to products and categories, generate on-page SEO drafts, and sync approved changes.',
  },
  {
    question: 'Does RankPilot AI provide actual Google ranking data?',
    answer:
      'Verified ranking and search performance data comes from your connected Google Search Console property. RankPilot AI does not fabricate Google rankings when Search Console is disconnected.',
  },
  {
    question: 'Can I review SEO recommendations before applying changes?',
    answer:
      'Yes. On-page SEO suggestions are saved as drafts showing original vs. proposed fields so you can edit, approve, or reject every change before syncing to WordPress or WooCommerce.',
  },
  {
    question: 'Do I need technical SEO experience?',
    answer:
      'No. Audits, technical PageSpeed checks, and AI SEO recommendations summarize findings into plain-language priorities so both marketers and business owners can review and act on them.',
  },
] as const;

export function LandingPageView({ isAuthenticated, onNavigate }: LandingPageViewProps) {
  const { theme, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  const handlePrimaryCta = () => {
    setMobileMenuOpen(false);
    onNavigate(isAuthenticated ? '/dashboard' : '/signup');
  };

  const handleLoginNav = () => {
    setMobileMenuOpen(false);
    onNavigate(isAuthenticated ? '/dashboard' : '/login');
  };

  const handleAnchorClick = () => {
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col">
      {/* Sticky Navigation Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-xs">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-display text-base font-bold tracking-tight text-slate-950 dark:text-white">
              RankPilot AI
            </span>
          </a>

          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300" aria-label="Homepage sections">
            <a href="#features" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors whitespace-nowrap shrink-0">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#integrations" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors whitespace-nowrap shrink-0">
              Integrations
            </a>
            <a href="#who-its-for" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors whitespace-nowrap shrink-0">
              Who It&apos;s For
            </a>
            <a href="#faqs" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors whitespace-nowrap shrink-0">
              FAQs
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <div className="hidden sm:flex items-center gap-2.5">
              {!isAuthenticated && (
                <a
                  href="/login"
                  onClick={(e) => {
                    e.preventDefault();
                    handleLoginNav();
                  }}
                  className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-slate-900 dark:hover:text-white whitespace-nowrap shrink-0"
                >
                  Log In
                </a>
              )}
              <button
                type="button"
                onClick={handlePrimaryCta}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-xs transition-opacity hover:opacity-95 whitespace-nowrap shrink-0"
              >
                <span>{isAuthenticated ? 'Open Dashboard' : 'Get Started'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 lg:hidden dark:border-slate-800 dark:text-slate-200"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile navigation drawer */}
        {mobileMenuOpen && (
          <div className="border-t border-slate-200 bg-white px-4 py-4 lg:hidden dark:border-slate-800 dark:bg-slate-950">
            <nav className="flex flex-col space-y-2 text-sm font-medium" aria-label="Mobile navigation">
              <a href="#features" onClick={handleAnchorClick} className="rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900">
                Features
              </a>
              <a href="#how-it-works" onClick={handleAnchorClick} className="rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900">
                How It Works
              </a>
              <a href="#integrations" onClick={handleAnchorClick} className="rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900">
                Integrations
              </a>
              <a href="#who-its-for" onClick={handleAnchorClick} className="rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900">
                Who It&apos;s For
              </a>
              <a href="#faqs" onClick={handleAnchorClick} className="rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900">
                FAQs
              </a>
              <div className="flex flex-col gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                {!isAuthenticated && (
                  <button
                    type="button"
                    onClick={handleLoginNav}
                    className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-800 dark:border-slate-700 dark:text-slate-100"
                  >
                    Log In
                  </button>
                )}
                <button
                  type="button"
                  onClick={handlePrimaryCta}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white"
                >
                  <span>{isAuthenticated ? 'Open Dashboard' : 'Get Started'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

      <main id="top" className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden border-b border-slate-200/70 bg-gradient-to-b from-indigo-50/70 via-white to-white dark:border-slate-800/70 dark:from-indigo-950/25 dark:via-slate-950 dark:to-slate-950">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.14),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.18),transparent_70%)]" />
          <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                Your AI-Powered SEO Workspace
              </p>
              <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl dark:text-white text-balance">
                Rank Higher. Grow Smarter.
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
                Audit your website, discover keyword opportunities, track Google search performance, and optimize your pages — all in one powerful SEO workspace.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
                <button
                  type="button"
                  onClick={handlePrimaryCta}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-600/20 transition-all hover:opacity-95 whitespace-nowrap"
                >
                  <span>{isAuthenticated ? 'Open Dashboard' : 'Get Started'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <a
                  href="#features"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <span>Explore Features</span>
                </a>
              </div>
            </div>

            <div className="mx-auto mt-12 max-w-5xl">
              <HeroDashboardPreview />
            </div>
          </div>
        </section>

        {/* Problem vs Solution Section */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold tracking-wide text-indigo-600 dark:text-indigo-400">
              A Cleaner Way to Run SEO
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl dark:text-white text-balance">
              SEO Shouldn&apos;t Be So Complicated.
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Traditional SEO */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900/60">
              <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                Traditional SEO
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Fragmented workflows slow down technical fixes and content updates.
              </p>
              <ul className="mt-6 space-y-3.5">
                {TRADITIONAL_SEO_PAIN.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* With RankPilot AI */}
            <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/70 via-white to-violet-50/60 p-6 sm:p-8 dark:border-indigo-900/70 dark:from-indigo-950/35 dark:via-slate-900 dark:to-violet-950/25">
              <h3 className="font-display text-lg font-bold text-slate-950 dark:text-white">
                With RankPilot AI
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Bring audits, keywords, Google data, and draft reviews into one organized workspace.
              </p>
              <ul className="mt-6 space-y-3.5">
                {RANKPILOT_ADVANTAGES.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm font-medium text-slate-800 dark:text-slate-100">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Main Features Showcase */}
        <section
          id="features"
          className="border-y border-slate-200/80 bg-slate-50/60 py-16 sm:py-20 dark:border-slate-800/80 dark:bg-slate-900/30"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                Complete SEO Platform
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl dark:text-white text-balance">
                Everything Needed to Audit, Plan, and Optimize
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                Built around real RankPilot AI workflows. Optional external data sources such as Google Search Console, GA4, and WordPress/WooCommerce connect per user account.
              </p>
            </div>

            {/* Highlighted two-column workflow spotlights */}
            <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/70 dark:text-indigo-400">
                    <Globe className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
                      Crawl Diagnostics &amp; PageSpeed Checks
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Website SEO Audits · Technical SEO &amp; PageSpeed
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-xs space-y-2 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex items-center justify-between font-medium text-slate-700 dark:text-slate-200">
                    <span>Multi-Page Crawl Summary</span>
                    <span className="text-indigo-600 dark:text-indigo-400">Mobile &amp; Desktop PSI</span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                    Inspect titles, meta descriptions, H1 headings, canonical tags, redirect chains, broken links, and Core Web Vitals snapshots side by side.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/70 dark:text-indigo-400">
                    <Wand2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
                      Keyword Strategy to Approved On-Page Sync
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      AI Keyword Research · On-Page SEO · WooCommerce Sync
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-xs space-y-2 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex items-center justify-between font-medium text-slate-700 dark:text-slate-200">
                    <span>Draft Approval Diff</span>
                    <span className="text-indigo-600 dark:text-indigo-400">Human Review First</span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                    Send researched keywords directly into On-Page SEO drafts, compare proposed vs. current copy, and sync approved updates to connected stores.
                  </p>
                </div>
              </div>
            </div>

            {/* All 10 Core Capabilities */}
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {MAIN_FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article
                    key={feature.title}
                    className="rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700/80"
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                          {feature.title}
                        </h3>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-slate-700 dark:text-slate-200">
                          {feature.description}
                        </p>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                          {feature.detail}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* How RankPilot AI Works */}
        <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              Simple Three-Step Workflow
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl dark:text-white text-balance">
              How RankPilot AI Works
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            {WORKFLOW_STEPS.map((item) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.step}
                  className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                      {item.step}
                    </span>
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                  </div>
                  <h3 className="mt-4 font-display text-lg font-bold text-slate-950 dark:text-white">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    {item.description}
                  </p>
                  <div className="mt-5 rounded-xl border border-slate-200/90 bg-slate-50/80 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/60">
                    <div className="font-medium text-slate-800 dark:text-slate-200">
                      {item.previewLabel}
                    </div>
                    <div className="mt-1 text-slate-500 dark:text-slate-400">
                      {item.previewHint}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Real Product Preview */}
        <section
          id="product-preview"
          className="border-y border-slate-200/80 bg-slate-50/60 py-16 sm:py-20 dark:border-slate-800/80 dark:bg-slate-900/30"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                Inside the Workspace
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl dark:text-white text-balance">
                Explore Key RankPilot AI Modules
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                Switch between core views to see how audits, keyword workflows, PageSpeed diagnostics, and on-page review diffs fit together.
              </p>
            </div>

            <div className="mt-10">
              <InteractiveProductShowcase />
            </div>
          </div>
        </section>

        {/* Who Is RankPilot AI For? */}
        <section id="who-its-for" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              Built for Modern Teams
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl dark:text-white text-balance">
              Who Is RankPilot AI For?
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {AUDIENCES.map((audience) => {
              const Icon = audience.icon;
              return (
                <article
                  key={audience.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 font-display text-base font-bold text-slate-950 dark:text-white">
                    {audience.title}
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {audience.description}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        {/* Integrations Section */}
        <section
          id="integrations"
          className="border-y border-slate-200/80 bg-slate-50/60 py-16 sm:py-20 dark:border-slate-800/80 dark:bg-slate-900/30"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                Supported Ecosystem
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl dark:text-white text-balance">
                Connect Your Google Data &amp; Publishing Tools
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                Integrations remain optional and under your control. Individual users connect and authorize their own Google properties or WordPress and WooCommerce credentials inside the workspace.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {INTEGRATIONS.map((integration) => {
                const Icon = integration.icon;
                return (
                  <article
                    key={integration.name}
                    className="flex items-start gap-3.5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                        {integration.name}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        {integration.summary}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* Frequently Asked Questions */}
        <section id="faqs" className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="text-center">
            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              Questions &amp; Answers
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl dark:text-white">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {FAQS.map((faq, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div key={faq.question} className="px-5 py-4 sm:px-6">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between gap-4 text-left"
                  >
                    <span className="font-display text-sm font-semibold text-slate-950 sm:text-base dark:text-slate-100">
                      {faq.question}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 dark:text-slate-400 ${
                        isOpen ? 'rotate-180 text-indigo-600 dark:text-indigo-400' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="mt-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {faq.answer}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Final Call to Action */}
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 px-6 py-12 text-center text-white shadow-lg sm:px-12 sm:py-16">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl text-balance">
              Ready to Take Control of Your SEO?
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-indigo-100 sm:text-base">
              Bring your SEO audits, keyword research, Google performance data, and optimization workflows together.
            </p>
            <div className="mt-7 flex justify-center">
              <button
                type="button"
                onClick={handlePrimaryCta}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50 whitespace-nowrap"
              >
                <span>{isAuthenticated ? 'Open Dashboard' : 'Get Started with RankPilot AI'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <span className="font-display text-sm font-bold text-slate-950 dark:text-white">
              RankPilot AI
            </span>
          </div>

          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-medium text-slate-600 dark:text-slate-400" aria-label="Footer navigation">
            <a href="#features" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
              How It Works
            </a>
            <a
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                handleLoginNav();
              }}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              Login
            </a>
            <a
              href="/privacy"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/privacy');
              }}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              Privacy Policy
            </a>
            <a
              href="/terms"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/terms');
              }}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              Terms of Service
            </a>
            <a
              href="/contact"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/contact');
              }}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
