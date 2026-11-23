import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  OperationType,
  auth,
  db,
  firebaseConfigSummary,
  googleProvider,
  handleFirestoreError,
  testFirestoreConnection,
} from '../lib/firebase';
import { UserProfile } from '../types';

export interface FormattedAuthError extends Error {
  code?: string;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  authReady: boolean;
  firestoreConnected: boolean;
  gscAccessToken: string | null;
  ga4AccessToken: string | null;
  authRedirectError: FormattedAuthError | null;
  clearAuthRedirectError: () => void;
  connectGoogleSearchConsole: () => Promise<string>;
  clearGscToken: () => void;
  connectGoogleAnalytics4: () => Promise<string>;
  clearGa4Token: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithGoogleRedirect: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (name: string, companyName: string, email: string, password: string) => Promise<void>;
  sendResetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  reloadUser: () => Promise<boolean>;
  updateUserProfile: (displayName: string, companyName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function makeAuthError(message: string, code?: string): FormattedAuthError {
  const err = new Error(message) as FormattedAuthError;
  if (code) err.code = code;
  return err;
}

function extractFirebaseCustomDetail(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const rec = err as Record<string, unknown>;
  const custom = (rec.customData && typeof rec.customData === 'object' ? rec.customData : null) as
    | Record<string, unknown>
    | null;
  const tokenResp = (
    custom?._tokenResponse && typeof custom._tokenResponse === 'object'
      ? custom._tokenResponse
      : null
  ) as Record<string, unknown> | null;

  const detail =
    (typeof tokenResp?.errorMessage === 'string' && tokenResp.errorMessage) ||
    (typeof custom?.message === 'string' && custom.message) ||
    '';
  return detail.trim();
}

function formatOAuthUrlError(): FormattedAuthError | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const oauthError = params.get('error') || hashParams.get('error');
  if (!oauthError) return null;

  const desc = params.get('error_description') || hashParams.get('error_description') || '';
  if (oauthError === 'org_internal') {
    return makeAuthError(
      `Google OAuth blocked this account (org_internal): OAuth Consent Screen in project "${firebaseConfigSummary.projectId}" is restricted to Internal Workspace users. Change User Type to External and Publish App (or add the Gmail account under Test users) in Google Cloud Console.`,
      'auth/user-cancelled'
    );
  }
  if (oauthError === 'access_denied') {
    return makeAuthError(
      `Google OAuth denied sign-in (access_denied)${desc ? `: ${desc}` : ''}. If signing in with a personal @gmail.com account, verify OAuth Consent Screen in Google Cloud project "${firebaseConfigSummary.projectId}" is set to External and Published (or add the email to Test users).`,
      'auth/user-cancelled'
    );
  }
  return makeAuthError(
    `Google OAuth returned error "${oauthError}"${desc ? `: ${desc}` : ''}.`,
    'auth/internal-error'
  );
}

function formatAuthError(err: unknown): FormattedAuthError {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: string }).code);
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    const customDetail = extractFirebaseCustomDetail(err);

    if (code === 'auth/unauthorized-domain' || code === 'auth/unauthorized-continue-uri') {
      return makeAuthError(
        `Domain "${hostname}" is not authorized in Firebase project "${firebaseConfigSummary.projectId}". Add "${hostname}" under Firebase Console → Authentication → Settings → Authorized domains.`,
        code
      );
    }
    if (code === 'auth/operation-not-allowed') {
      return makeAuthError(
        `This sign-in provider is disabled in Firebase project "${firebaseConfigSummary.projectId}" (Authentication → Sign-in method). Enable Google or Email/Password in Firebase Console.`,
        code
      );
    }
    if (code === 'auth/popup-blocked') {
      return makeAuthError(
        'Browser blocked the Google sign-in popup window. Allow popups for this site or use Redirect Sign-In below.',
        code
      );
    }
    if (code === 'auth/cancelled-popup-request') {
      return makeAuthError(
        'A Google sign-in popup is already open or was interrupted by another click. Complete or close the open popup and try again.',
        code
      );
    }
    if (code === 'auth/popup-closed-by-user') {
      return makeAuthError(
        `Google sign-in did not complete before the popup closed${customDetail ? ` (${customDetail})` : ''}. If Google displayed an access or verification block (Error 403: access_denied or org_internal) for a personal @gmail.com account, update the OAuth Consent Screen in Google Cloud project "${firebaseConfigSummary.projectId}" to External + Published (or add that email under Test users).`,
        code
      );
    }
    if (code === 'auth/user-cancelled') {
      return makeAuthError(
        `Google OAuth sign-in was denied or cancelled${customDetail ? ` (${customDetail})` : ''}. Verify OAuth Consent Screen access (External / Published or Test users) in Google Cloud project "${firebaseConfigSummary.projectId}".`,
        code
      );
    }
    if (code === 'auth/web-storage-unsupported') {
      return makeAuthError(
        'Browser third-party cookies or storage needed for the Firebase Auth popup are blocked. Allow storage for firebaseapp.com or open the app in a standalone tab.',
        code
      );
    }
    if (code === 'auth/user-disabled') {
      return makeAuthError('This user account has been disabled in Firebase Authentication.', code);
    }
    if (code === 'auth/account-exists-with-different-credential') {
      return makeAuthError(
        'An account with this email already exists using a different sign-in method. Sign in with your original method first.',
        code
      );
    }
    if (code === 'auth/email-already-in-use') {
      return makeAuthError('An account with this email already exists. Try signing in instead.', code);
    }
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return makeAuthError('Invalid email or password.', code);
    }
    if (code === 'auth/invalid-email') {
      return makeAuthError('Please enter a valid email address.', code);
    }
    if (code === 'auth/weak-password') {
      return makeAuthError('Password must be at least 6 characters.', code);
    }
    if (code === 'auth/too-many-requests') {
      return makeAuthError('Too many failed sign-in attempts. Please wait a few minutes and try again.', code);
    }
    if (code === 'auth/network-request-failed') {
      return makeAuthError('Network error while contacting Firebase Authentication. Check your connection and try again.', code);
    }
    if (code === 'auth/invalid-api-key' || code === 'auth/app-not-authorized') {
      return makeAuthError(
        `Firebase API key or application authorization failed for project "${firebaseConfigSummary.projectId}". Check API key restrictions in Google Cloud Console.`,
        code
      );
    }
    if (code === 'auth/internal-error') {
      return makeAuthError(
        `Firebase Authentication encountered an OAuth configuration error${customDetail ? `: ${customDetail}` : ''}. Check Google Sign-In provider and OAuth Consent Screen settings in project "${firebaseConfigSummary.projectId}".`,
        code
      );
    }
    return makeAuthError(
      customDetail || (err instanceof Error ? err.message : 'Authentication failed.'),
      code
    );
  }
  return err instanceof Error ? (err as FormattedAuthError) : makeAuthError('Authentication failed.');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [, setUserRefreshTick] = useState(0);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [firestoreConnected, setFirestoreConnected] = useState(true);
  // Stored strictly in memory (never localStorage/sessionStorage)
  const [gscAccessToken, setGscAccessToken] = useState<string | null>(null);
  const [ga4AccessToken, setGa4AccessToken] = useState<string | null>(null);
  const [authRedirectError, setAuthRedirectError] = useState<FormattedAuthError | null>(null);
  const googleAuthInFlightRef = useRef(false);

  useEffect(() => {
    testFirestoreConnection().then(setFirestoreConnected);

    const urlOAuthErr = formatOAuthUrlError();
    if (urlOAuthErr) {
      setAuthRedirectError(urlOAuthErr);
    }

    getRedirectResult(auth)
      .then((result) => {
        if (result) {
          const cred = GoogleAuthProvider.credentialFromResult(result);
          if (cred?.accessToken) {
            setGscAccessToken(cred.accessToken);
          }
        }
      })
      .catch((err) => {
        setAuthRedirectError(formatAuthError(err));
      });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const profilePath = `users/${firebaseUser.uid}`;
        try {
          const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
          } else {
            const resolvedDisplayName = (
              firebaseUser.displayName?.trim() ||
              firebaseUser.email?.split('@')[0] ||
              'Member'
            ).slice(0, 120);
            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: (firebaseUser.email || 'user@rankpilot.app').slice(0, 254),
              displayName: resolvedDisplayName,
              companyName: '',
              role: 'member',
              plan: 'free',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
            setProfile(newProfile);
          }
        } catch (err) {
          console.error('Failed loading user profile:', err);
          setProfile({
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || 'Account User',
            companyName: '',
            role: 'member',
            plan: 'free',
          });
          if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
            handleFirestoreError(err, OperationType.GET, profilePath);
          }
        }
      } else {
        setProfile(null);
        setGscAccessToken(null);
        setGa4AccessToken(null);
      }
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  const connectGoogleSearchConsole = async (): Promise<string> => {
    if (!auth.currentUser) {
      throw new Error('Sign in with RankPilot first before connecting Google Search Console.');
    }
    const gscProvider = new GoogleAuthProvider();
    gscProvider.addScope('https://www.googleapis.com/auth/webmasters.readonly');
    gscProvider.setCustomParameters({ prompt: 'consent select_account' });
    try {
      const hasGoogleLinked = auth.currentUser.providerData.some(
        (p) => p.providerId === 'google.com'
      );
      const result = hasGoogleLinked
        ? await reauthenticateWithPopup(auth.currentUser, gscProvider)
        : await signInWithPopup(auth, gscProvider);
      const cred = GoogleAuthProvider.credentialFromResult(result);
      const token = cred?.accessToken;
      if (!token) {
        throw new Error(
          'Google OAuth did not return a Search Console access token. Ensure Google Search Console scope consent was granted.'
        );
      }
      setGscAccessToken(token);
      return token;
    } catch (err) {
      throw formatAuthError(err);
    }
  };

  const clearGscToken = () => setGscAccessToken(null);

  const connectGoogleAnalytics4 = async (): Promise<string> => {
    if (!auth.currentUser) {
      throw new Error('Sign in with RankPilot first before connecting Google Analytics 4.');
    }
    const ga4Provider = new GoogleAuthProvider();
    ga4Provider.addScope('https://www.googleapis.com/auth/analytics.readonly');
    ga4Provider.setCustomParameters({ prompt: 'consent select_account' });
    try {
      const hasGoogleLinked = auth.currentUser.providerData.some(
        (p) => p.providerId === 'google.com'
      );
      const result = hasGoogleLinked
        ? await reauthenticateWithPopup(auth.currentUser, ga4Provider)
        : await signInWithPopup(auth, ga4Provider);
      const cred = GoogleAuthProvider.credentialFromResult(result);
      const token = cred?.accessToken;
      if (!token) {
        throw new Error(
          'Google OAuth did not return an Analytics access token. Ensure Google Analytics read-only consent was granted.'
        );
      }
      setGa4AccessToken(token);
      return token;
    } catch (err) {
      throw formatAuthError(err);
    }
  };

  const clearGa4Token = () => setGa4AccessToken(null);

  const signInWithGoogle = async () => {
    if (googleAuthInFlightRef.current) return;
    googleAuthInFlightRef.current = true;
    setAuthRedirectError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const formatted = formatAuthError(err);
      if (
        formatted.code === 'auth/popup-blocked' &&
        typeof window !== 'undefined' &&
        window.top === window.self
      ) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      throw formatted;
    } finally {
      googleAuthInFlightRef.current = false;
    }
  };

  const signInWithGoogleRedirect = async () => {
    setAuthRedirectError(null);
    try {
      await signInWithRedirect(auth, googleProvider);
    } catch (err) {
      throw formatAuthError(err);
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      throw formatAuthError(err);
    }
  };

  const signUpWithEmail = async (name: string, companyName: string, email: string, password: string) => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const cleanName = name.trim().slice(0, 120) || 'Member';
      await updateProfile(cred.user, { displayName: cleanName });
      const newProfile: UserProfile = {
        uid: cred.user.uid,
        email: email.trim().slice(0, 254),
        displayName: cleanName,
        companyName: companyName.trim().slice(0, 120),
        role: 'member',
        plan: 'free',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      try {
        await setDoc(doc(db, 'users', cred.user.uid), newProfile);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${cred.user.uid}`);
      }
      await sendEmailVerification(cred.user).catch(() => {});
      setProfile(newProfile);
    } catch (err) {
      throw formatAuthError(err);
    }
  };

  const sendResetPassword = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      throw formatAuthError(err);
    }
  };

  const resendVerification = async () => {
    if (!auth.currentUser) throw new Error('Not signed in.');
    await sendEmailVerification(auth.currentUser);
  };

  const reloadUser = async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    setUser(auth.currentUser);
    setUserRefreshTick((t) => t + 1);
    return Boolean(auth.currentUser.emailVerified);
  };

  const updateUserProfile = async (displayName: string, companyName: string) => {
    if (!auth.currentUser) throw new Error('Not authenticated.');
    const cleanName = displayName.trim().slice(0, 120);
    const cleanCompany = companyName.trim().slice(0, 120);
    await updateProfile(auth.currentUser, { displayName: cleanName });
    const path = `users/${auth.currentUser.uid}`;
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        displayName: cleanName,
        companyName: cleanCompany,
        email: (auth.currentUser.email || '').slice(0, 254),
        updatedAt: serverTimestamp(),
      });
      setProfile((prev) => (prev ? { ...prev, displayName: cleanName, companyName: cleanCompany } : prev));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const logout = async () => {
    setGscAccessToken(null);
    setGa4AccessToken(null);
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authReady,
        firestoreConnected,
        gscAccessToken,
        ga4AccessToken,
        authRedirectError,
        clearAuthRedirectError: () => setAuthRedirectError(null),
        connectGoogleSearchConsole,
        clearGscToken,
        connectGoogleAnalytics4,
        clearGa4Token,
        signInWithGoogle,
        signInWithGoogleRedirect,
        signInWithEmail,
        signUpWithEmail,
        sendResetPassword,
        resendVerification,
        reloadUser,
        updateUserProfile,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
