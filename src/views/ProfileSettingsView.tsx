import React, { useEffect, useState } from 'react';
import { KeyRound, Save, ShieldCheck } from 'lucide-react';
import { StatusText } from '../components/ui/DataState';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export function ProfileSettingsView() {
  const { user, profile, isDemoMode, updateUserProfile, sendResetPassword } = useAuth();
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [companyName, setCompanyName] = useState(profile?.companyName || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '');
      setCompanyName(profile.companyName || '');
    }
  }, [profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateUserProfile(displayName, companyName);
      toast({ title: 'Profile updated', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Unable to save profile.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user?.email) return;
    try {
      await sendResetPassword(user.email);
      toast({
        title: 'Password reset email sent',
        description: `Sent to ${user.email}`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Reset failed',
        description: err instanceof Error ? err.message : 'Could not send reset link.',
        variant: 'error',
      });
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-display text-base font-semibold">User Profile</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Manage your multi-tenant workspace identity and organization details.
        </p>

        <form onSubmit={handleSave} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Full Name</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Company / Agency Name</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Digital"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Email Address</label>
            <input
              type="email"
              disabled
              value={profile?.email || user?.email || ''}
              className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-800/50"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'Saving...' : 'Save Profile'}</span>
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-display text-sm font-semibold">Account Security &amp; Isolation</h3>
          </div>
          <StatusText
            label={isDemoMode ? 'Demo Workspace' : user?.emailVerified ? 'Verified Account' : 'Email Unverified'}
            tone={isDemoMode ? 'warning' : user?.emailVerified ? 'success' : 'danger'}
          />
        </div>
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          All websites, SEO audits, leads, quotes, and orders are strictly isolated by your Firebase UID (<code className="font-mono">{profile?.uid || 'demo_user'}</code>) via Cloud Firestore security rules.
        </p>

        {!isDemoMode && user?.providerData?.some((p) => p.providerId === 'password') && (
          <button
            type="button"
            onClick={handlePasswordReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>Send Password Reset Email</span>
          </button>
        )}
      </div>
    </div>
  );
}
