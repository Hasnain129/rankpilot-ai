import React, { createContext, useContext, useEffect, useState } from 'react';
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
  isDemoMode: boolean;
  firestoreConnected: boolean;
  gscAccessToken: string | null;
  authRedirectError: FormattedAuthError | null;
  clearAuthRedirectError: () => void;
  connectGoogleSearchConsole: () => Promise<string>;
  clearGscToken: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithGoogleRedirect: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (name: string, companyName: string, email: string, password: string) => Promise<void>;
  sendResetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  reloadUser: () => Promise<boolean>;
  updateUserProfile: (displayName: string, companyName: string) => Promise<void>;
  logout: () => Promise<void>;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function makeAuthError(message: string, code?: string): FormattedAuthError {
  const err = new Error(message) as FormattedAuthError;
  if (code) err.code = code;
  return err;
}

function formatAuthError(err: unknown): FormattedAuthError {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: string }).code);
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'this domain';

    if (code === 'auth/unauthorized-domain') {
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
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return makeAuthError('Sign-in popup was closed before completion.', code);
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
    return makeAuthError(err instanceof Error ? err.message : 'Authentication failed.', code);
  }
  return err instanceof Error ? (err as FormattedAuthError) : makeAuthError('Authentication failed.');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [, setUserRefreshTick] = useState(0);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [firestoreConnected, setFirestoreConnected] = useState(true);
  // Stored strictly in memory (never localStorage/sessionStorage)
  const [gscAccessToken, setGscAccessToken] = useState<string | null>(null);
  const [authRedirectError, setAuthRedirectError] = useState<FormattedAuthError | null>(null);

  useEffect(() => {
    testFirestoreConnection().then(setFirestoreConnected);

    getRedirectResult(auth)
      .then((result) => {
        if (result) {
          const cred = GoogleAuthProvider.credentialFromResult(result);
          if (cred?.accessToken) {
            // Preserve token in memory if GSC scope was consented via redirect
            setGscAccessToken(cred.accessToken);
          }
          setIsDemoMode(false);
        }
      })
      .catch((err) => {
        setAuthRedirectError(formatAuthError(err));
      });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setIsDemoMode(false);
        const profilePath = `users/${firebaseUser.uid}`;
        try {
          const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
          } else {
            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: (firebaseUser.email || 'user@rankpilot.app').slice(0, 254),
              displayName: (firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Member').slice(0, 120),
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

  const signInWithGoogle = async () => {
    setAuthRedirectError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      setIsDemoMode(false);
    } catch (err) {
      const formatted = formatAuthError(err);
      // On standalone top-level deployments (e.g. mobile / Vercel with strict popup blocking), fall back cleanly to redirect
      if (
        formatted.code === 'auth/popup-blocked' &&
        typeof window !== 'undefined' &&
        window.top === window.self
      ) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      throw formatted;
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
      setIsDemoMode(false);
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
      setIsDemoMode(false);
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
    if (isDemoMode) {
      setProfile((prev) => ({
        uid: 'demo_user',
        email: 'demo@rankpilot.app',
        displayName: displayName.trim() || 'Demo Strategist',
        companyName: companyName.trim(),
        role: 'member',
        plan: 'free',
        ...prev,
      }));
      return;
    }
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
    if (isDemoMode) {
      setIsDemoMode(false);
      setProfile(null);
      return;
    }
    await signOut(auth);
  };

  const enterDemoMode = () => {
    setIsDemoMode(true);
    setGscAccessToken(null);
    setProfile({
      uid: 'demo_user',
      email: 'demo@rankpilot.app',
      displayName: 'Alex Mercer (Demo)',
      companyName: 'RankPilot Demo Workspace',
      role: 'member',
      plan: 'free',
    });
  };

  const exitDemoMode = () => {
    setIsDemoMode(false);
    setGscAccessToken(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authReady,
        isDemoMode,
        firestoreConnected,
        gscAccessToken,
        authRedirectError,
        clearAuthRedirectError: () => setAuthRedirectError(null),
        connectGoogleSearchConsole,
        clearGscToken,
        signInWithGoogle,
        signInWithGoogleRedirect,
        signInWithEmail,
        signUpWithEmail,
        sendResetPassword,
        resendVerification,
        reloadUser,
        updateUserProfile,
        logout,
        enterDemoMode,
        exitDemoMode,
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
