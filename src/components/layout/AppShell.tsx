import React, { useState } from 'react';
import {
  Activity,
  BarChart3,
  FileText,
  Gauge,
  Globe,
  Layers,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Moon,
  Plus,
  Receipt,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  Store,
  Sun,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { NavSection, Website } from '../../types';

interface AppShellProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  websites: Website[];
  selectedWebsiteId: string;
  onSelectWebsite: (id: string) => void;
  onQuickAddWebsite: () => void;
  children: React.ReactNode;
}

const NAV_GROUPS: Array<{
  heading: string;
  items: Array<{ id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    heading: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    heading: 'SEO Growth Engine',
    items: [
      { id: 'websites', label: 'Websites', icon: Globe },
      { id: 'seo-analyzer', label: 'Site SEO Audit', icon: Search },
      { id: 'keyword-research', label: 'Keyword Strategy', icon: TrendingUp },
      { id: 'optimization-center', label: 'Optimization Center', icon: Wand2 },
      { id: 'wordpress-woo', label: 'WordPress & Woo', icon: Store },
      { id: 'search-console', label: 'Search Console', icon: LineChart },
      { id: 'rank-tracker', label: 'Rank Tracker', icon: Target },
      { id: 'technical-monitor', label: 'Technical Monitor', icon: Gauge },
      { id: 'content-studio', label: 'Content Studio', icon: FileText },
    ],
  },
  {
    heading: 'Traffic & Revenue',
    items: [
      { id: 'visitor-tracking', label: 'Visitor Tracking', icon: Activity },
      { id: 'leads', label: 'Leads', icon: Users },
      { id: 'quotes', label: 'Quotes', icon: Receipt },
      { id: 'orders', label: 'Orders', icon: ShoppingBag },
      { id: 'sales-analytics', label: 'Sales Analytics', icon: BarChart3 },
    ],
  },
  {
    heading: 'Platform',
    items: [
      { id: 'integrations', label: 'Integrations', icon: Layers },
      { id: 'profile', label: 'Profile & Settings', icon: Settings },
    ],
  },
];

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Executive & SEO Growth Dashboard',
  websites: 'Websites',
  'seo-analyzer': 'Complete SEO Site Audit',
  'keyword-research': 'AI Keyword Strategy & Mapping',
  'optimization-center': 'SEO Optimization Center',
  'wordpress-woo': 'WordPress & WooCommerce Sync',
  'search-console': 'Google Search Console',
  'rank-tracker': 'Google Rank Tracker',
  'technical-monitor': 'Technical & Core Web Vitals Monitor',
  'content-studio': 'AI Content Studio',
  'visitor-tracking': 'Visitor Tracking',
  leads: 'Lead Management',
  quotes: 'Quote Management',
  orders: 'Order Management',
  'sales-analytics': 'Sales Analytics',
  integrations: 'Integrations',
  profile: 'Profile & Settings',
};

export function AppShell({
  activeSection,
  onNavigate,
  websites,
  selectedWebsiteId,
  onSelectWebsite,
  onQuickAddWebsite,
  children,
}: AppShellProps) {
  const { user, profile, isDemoMode, logout, resendVerification, reloadUser, exitDemoMode } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [resending, setResending] = useState(false);

  const needsVerification = Boolean(user && !user.emailVerified && !isDemoMode);

  const handleResendVerification = async () => {
    setResending(true);
    try {
      await resendVerification();
      toast({
        title: 'Verification email sent',
        description: `Check ${user?.email} and click the verification link.`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Could not send email',
        description: err instanceof Error ? err.message : 'Try again shortly.',
        variant: 'error',
      });
    } finally {
      setResending(false);
    }
  };

  const handleCheckVerification = async () => {
    const verified = await reloadUser();
    if (verified) {
      toast({ title: 'Email verified', description: 'Your workspace writes are now enabled.', variant: 'success' });
    } else {
      toast({
        title: 'Not verified yet',
        description: 'Click the link in your inbox, then refresh again.',
        variant: 'info',
      });
    }
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      <div className="flex h-14 items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => {
            onNavigate('dashboard');
            setMobileOpen(false);
          }}
          className="flex items-center gap-2.5 text-left"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="font-display text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
              RankPilot AI
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
              Rank. Convert. Grow.
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-3 pt-3 pb-2">
        <label htmlFor="website-scope-select" className="block px-1 pb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          Workspace Scope
        </label>
        <select
          id="website-scope-select"
          value={selectedWebsiteId}
          onChange={(e) => onSelectWebsite(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="all">All Websites ({websites.length})</option>
          {websites.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.domain})
            </option>
          ))}
        </select>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-4" aria-label="Main Navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.heading}>
            <p className="px-2.5 pb-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
              {group.heading}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigate(item.id);
                      setMobileOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-3 space-y-2 dark:border-slate-800">
        {isDemoMode && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs dark:border-amber-900/60 dark:bg-amber-950/30">
            <p className="font-medium text-amber-800 dark:text-amber-300">Demo Mode Active</p>
            <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
              Sample data only. Sign in to run live crawls, AI, and APIs.
            </p>
            <button
              type="button"
              onClick={exitDemoMode}
              className="mt-2 w-full rounded-md bg-amber-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-amber-700"
            >
              Sign In with Account
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 px-1">
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Toggle light or dark mode"
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>

          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>{isDemoMode ? 'Exit' : 'Sign Out'}</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <aside className="hidden w-64 shrink-0 lg:block sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 w-64 max-w-[85vw] h-full">{sidebarContent}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="hidden sm:inline text-slate-400 dark:text-slate-500">Workspace</span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-700">/</span>
              <h1 className="truncate font-display font-semibold text-slate-900 dark:text-slate-100">
                {SECTION_TITLES[activeSection]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onQuickAddWebsite}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Website</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className="hidden sm:inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              <UserCheck className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span className="max-w-[140px] truncate">{profile?.displayName || user?.email || 'Account'}</span>
            </button>
          </div>
        </header>

        {needsVerification && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 sm:px-6 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
              <span>
                Verify your email (<strong>{user?.email}</strong>) to unlock Firestore writes &amp; live crawls. Or switch to Google Sign-In.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resending}
                  className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200"
                >
                  {resending ? 'Sending...' : 'Resend Link'}
                </button>
                <button
                  type="button"
                  onClick={handleCheckVerification}
                  className="rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700"
                >
                  Refresh Status
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
