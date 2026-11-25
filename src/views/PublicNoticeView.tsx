import React from 'react';
import { ArrowLeft, Moon, Sparkles, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export type PublicNoticeKind = 'privacy' | 'terms' | 'contact';

interface PublicNoticeViewProps {
  kind: PublicNoticeKind;
  isAuthenticated: boolean;
  onNavigate: (path: string) => void;
}

const NOTICE_CONTENT: Record<
  PublicNoticeKind,
  { title: string; summary: string; detail: string }
> = {
  privacy: {
    title: 'Privacy Policy',
    summary: 'Public Privacy Policy document has not been published yet.',
    detail:
      'This destination is reserved for the RankPilot AI Privacy Policy. No standalone policy document is configured at /privacy in the current application.',
  },
  terms: {
    title: 'Terms of Service',
    summary: 'Public Terms of Service document has not been published yet.',
    detail:
      'This destination is reserved for the RankPilot AI Terms of Service. No standalone legal terms document is configured at /terms in the current application.',
  },
  contact: {
    title: 'Contact',
    summary: 'Public contact details are not configured in this deployment.',
    detail:
      'This destination is reserved for RankPilot AI contact information. Please sign in to manage your workspace account settings or return to the homepage.',
  },
};

export function PublicNoticeView({
  kind,
  isAuthenticated,
  onNavigate,
}: PublicNoticeViewProps) {
  const { theme, toggleTheme } = useTheme();
  const copy = NOTICE_CONTENT[kind];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col">
      <header className="flex items-center justify-between gap-6 border-b border-slate-200 bg-white px-6 py-3 dark:border-slate-800 dark:bg-slate-900">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('/');
          }}
          className="flex items-center gap-2.5 whitespace-nowrap shrink-0"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="font-display text-base font-bold tracking-tight">RankPilot AI</span>
        </a>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => onNavigate(isAuthenticated ? '/dashboard' : '/login')}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 whitespace-nowrap"
          >
            {isAuthenticated ? 'Open Dashboard' : 'Log In'}
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 items-center px-6 py-12">
        <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            RankPilot AI · Unconfigured Public Page
          </p>
          <h1 className="mt-2 font-display text-2xl font-bold text-slate-950 dark:text-white">
            {copy.title}
          </h1>
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            {copy.summary}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            {copy.detail}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Home</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate(isAuthenticated ? '/dashboard' : '/login')}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              {isAuthenticated ? 'Go to Dashboard' : 'Go to Login'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
