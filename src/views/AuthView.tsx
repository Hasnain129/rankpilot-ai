import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  FileText,
  Gauge,
  Globe,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  Lock,
  Mail,
  Moon,
  Search,
  ShoppingBag,
  Sparkles,
  Sun,
  TrendingUp,
} from 'lucide-react';
import { FormattedAuthError, useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { firebaseConfigSummary } from '../lib/firebase';

const LANDING_FEATURES = [
  {
    title: 'SEO Dashboard',
    description: 'Track website SEO health and growth.',
    icon: LayoutDashboard,
  },
  {
    title: 'Website Audit',
    description: 'Find SEO errors and improvement opportunities.',
    icon: Globe,
  },
  {
    title: 'Keyword Research',
    description: 'Discover keywords, clusters and content gaps.',
    icon: Search,
  },
  {
    title: 'Google Rank Tracking',
    description: 'Monitor verified Google search rankings.',
    icon: TrendingUp,
  },
  {
    title: 'On-Page SEO',
    description: 'Optimize titles, descriptions and product pages.',
    icon: FileText,
  },
  {
    title: 'Technical SEO',
    description: 'Check PageSpeed, Core Web Vitals and crawlability.',
    icon: Gauge,
  },
  {
    title: 'AI SEO Recommendations',
    description: 'Get actionable AI-powered SEO suggestions.',
    icon: Lightbulb,
  },
  {
    title: 'SEO Reports',
    description: 'Review and share SEO performance insights.',
    icon: BarChart3,
  },
  {
    title: 'GSC & GA4 Integration',
    description: 'Connect Google search and analytics data.',
    icon: LineChart,
  },
  {
    title: 'WooCommerce SEO',
    description: 'Review and sync approved product SEO changes.',
    icon: ShoppingBag,
  },
] as const;

export function AuthView() {
  const {
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    sendResetPassword,
    authRedirectError,
    googleRedirectPending,
    clearAuthRedirectError,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();

  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (authRedirectError) {
      setErrorMsg(authRedirectError.message);
      setErrorCode(authRedirectError.code || null);
    }
  }, [authRedirectError]);

  const clearError = () => {
    setErrorMsg(null);
    setErrorCode(null);
    clearAuthRedirectError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
        toast({ title: 'Welcome back to RankPilot AI', variant: 'success' });
      } else if (mode === 'signup') {
        await signUpWithEmail(name, companyName, email, password);
        toast({
          title: 'Account created',
          description: 'A verification link has been sent to your email address.',
          variant: 'success',
        });
      } else {
        await sendResetPassword(email);
        toast({
          title: 'Password reset sent',
          description: 'Check your inbox for reset instructions.',
          variant: 'success',
        });
        setMode('login');
      }
    } catch (err) {
      const f = err as FormattedAuthError;
      setErrorMsg(f instanceof Error ? f.message : 'Authentication failed.');
      setErrorCode(f?.code || null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    if (submitting || googleRedirectPending) return;
    clearError();
    try {
      await signInWithGoogle();
    } catch (err) {
      const f = err as FormattedAuthError;
      setErrorMsg(f instanceof Error ? f.message : 'Google sign-in failed.');
      setErrorCode(f?.code || null);
    }
  };

  const isGooglePending = submitting || googleRedirectPending;
  const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col">
      <header className="flex items-center justify-between gap-8 border-b border-slate-200 bg-white px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="font-display text-base font-bold tracking-tight">RankPilot AI</span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 sm:py-12">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
          {/* Left Editorial Column */}
          <div className="lg:col-span-7 space-y-5">
            <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              RankPilot AI · Organic SEO Growth Platform
            </div>
            <h1 className="font-display text-4xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-5xl text-balance">
              Rank. Convert. Grow.
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-slate-600 dark:text-slate-300">
              Audit websites for technical and on-page issues, review keyword opportunities and Search Console performance, and manage WordPress and WooCommerce SEO updates from one workspace.
            </p>
          </div>

          {/* Right Auth Card */}
        <div className="lg:col-span-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-6">
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                {mode === 'login' && 'Sign in to your workspace'}
                {mode === 'signup' && 'Create your RankPilot account'}
                {mode === 'forgot' && 'Reset your password'}
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {mode === 'login' && 'Manage your connected websites, SEO audits, and Search Console metrics.'}
                {mode === 'signup' && 'Each account gets isolated multi-tenant Cloud Firestore storage.'}
                {mode === 'forgot' && 'Enter your email address to receive a password reset link.'}
              </p>
            </div>

            {mode !== 'forgot' && (
              <>
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={isGooglePending}
                  className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z" />
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z" />
                    <path fill="#FBBC05" d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z" />
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z" />
                  </svg>
                  <span>{googleRedirectPending ? 'Redirecting to Google...' : 'Continue with Google'}</span>
                </button>

                <div className="my-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                  <span className="text-[11px] font-medium text-slate-400">or with email</span>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                </div>
              </>
            )}

            {errorMsg && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 space-y-2 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                <div>{errorMsg}</div>
                {(errorCode === 'auth/unauthorized-domain' ||
                  errorCode === 'auth/unauthorized-continue-uri') && (
                  <div className="border-t border-red-200 pt-2 font-mono text-[11px] text-red-800 dark:border-red-900/50 dark:text-red-200 space-y-0.5">
                    <div>Domain to authorize: {currentHostname}</div>
                    <div>Firebase Project: {firebaseConfigSummary.projectId}</div>
                    <div>Auth Handler: {firebaseConfigSummary.authDomain}</div>
                  </div>
                )}
                {(errorCode === 'auth/redirect-cancelled-by-user' ||
                  errorCode === 'auth/redirect-operation-pending' ||
                  errorCode === 'auth/redirect-empty-result' ||
                  errorCode === 'auth/user-cancelled' ||
                  errorCode === 'auth/internal-error' ||
                  errorCode === 'auth/web-storage-unsupported' ||
                  errorCode === 'auth/operation-not-supported-in-this-environment') && (
                  <div className="border-t border-red-200 pt-2 font-mono text-[11px] text-red-800 dark:border-red-900/50 dark:text-red-200 space-y-0.5">
                    <div>Error Code: {errorCode}</div>
                    <div>Firebase Project: {firebaseConfigSummary.projectId}</div>
                    <div>Auth Handler: {firebaseConfigSummary.authDomain}</div>
                    {firebaseConfigSummary.oAuthClientId && (
                      <div className="truncate">OAuth Client: {firebaseConfigSummary.oAuthClientId}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {mode === 'signup' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Alex Mercer"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Company or Agency (optional)
                    </label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Northstar Digital"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              {mode !== 'forgot' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Password
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMsg(null);
                          setMode('forgot');
                        }}
                        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                <span>
                  {submitting
                    ? 'Please wait...'
                    : mode === 'login'
                    ? 'Sign In'
                    : mode === 'signup'
                    ? 'Create Account'
                    : 'Send Reset Link'}
                </span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <div className="mt-5 border-t border-slate-200 pt-4 text-center text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
              {mode === 'login' && (
                <>
                  New to RankPilot AI?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setMode('signup');
                    }}
                    className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Create an account
                  </button>
                </>
              )}
              {(mode === 'signup' || mode === 'forgot') && (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setMode('login');
                    }}
                    className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        </div>

        {/* Platform Capabilities Showcase */}
        <section
          aria-labelledby="platform-capabilities-heading"
          className="mt-10 border-t border-slate-200/80 pt-8 dark:border-slate-800/80"
        >
          <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <h2
              id="platform-capabilities-heading"
              className="font-display text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100"
            >
              Built-in SEO Workspace Capabilities
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Core tools available inside RankPilot AI after sign-in.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {LANDING_FEATURES.map(({ title, description, icon: Icon }) => (
              <article
                key={title}
                className="flex items-start gap-3.5 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-indigo-300 hover:bg-indigo-50/20 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700/80 dark:hover:bg-slate-900/80"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {title}
                  </h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {description}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
