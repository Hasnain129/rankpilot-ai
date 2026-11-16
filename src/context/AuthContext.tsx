import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  testFirestoreConnection,
} from '../lib/firebase';
import { UserProfile } from '../types';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  authReady: boolean;
  isDemoMode: boolean;
  firestoreConnected: boolean;
  signInWithGoogle: () => Promise<void>;
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

function formatAuthError(err: unknown): Error {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: string }).code);
    if (code === 'auth/operation-not-allowed') {
      return new Error(
        'Email/Password sign-in is not yet enabled in Firebase Console (Authentication → Sign-in method). Use Google Sign-In or enable Email/Password in your Firebase Console.'
      );
    }
    if (code === 'auth/email-already-in-use') {
      return new Error('An account with this email already exists. Try signing in instead.');
    }
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return new Error('Invalid email or password.');
    }
    if (code === 'auth/weak-password') {
      return new Error('Password must be at least 6 characters.');
    }
    if (code === 'auth/popup-closed-by-user') {
      return new Error('Sign-in popup was closed before completion.');
    }
  }
  return err instanceof Error ? err : new Error('Authentication failed.');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [, setUserRefreshTick] = useState(0);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [firestoreConnected, setFirestoreConnected] = useState(true);

  useEffect(() => {
    testFirestoreConnection().then(setFirestoreConnected);

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
          // Fallback in-memory profile so UI remains usable while surfacing Firestore context if needed
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
      }
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setIsDemoMode(false);
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
    if (isDemoMode) {
      setIsDemoMode(false);
      setProfile(null);
      return;
    }
    await signOut(auth);
  };

  const enterDemoMode = () => {
    setIsDemoMode(true);
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
        signInWithGoogle,
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
