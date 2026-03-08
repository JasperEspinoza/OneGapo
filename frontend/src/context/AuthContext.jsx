import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../config/firebase';

const AuthContext = createContext(null);

/**
 * AuthProvider
 *
 * Wraps the application and exposes the current Firebase user plus their
 * decoded Custom Claims (role, location) obtained from the ID token.
 *
 * Custom Claims are set server-side via the Admin SDK and are the authoritative
 * source of truth for RBAC — never rely solely on client-side state.
 *
 * Exposed context values:
 *   currentUser  — Firebase User object, or null when signed out
 *   userClaims   — Decoded token claims: { role, location, ... }, or null
 *   loading      — true while the initial auth state is being determined
 *   logout()     — Signs the current user out of Firebase
 */
export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userClaims,  setUserClaims]  = useState(null);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Force-refresh the ID token so we always read the latest custom claims
        // (important after the server updates claims on an existing session).
        const tokenResult = await user.getIdTokenResult(/* forceRefresh */ true);
        setCurrentUser(user);
        setUserClaims(tokenResult.claims);
      } else {
        setCurrentUser(null);
        setUserClaims(null);
      }
      setLoading(false);
    });

    // Clean up the listener on component unmount
    return unsubscribe;
  }, []);

  const logout = () => signOut(auth);

  /**
   * refreshUser — reloads the Firebase user object and force-refreshes the ID token
   * so the latest custom claims and emailVerified flag are reflected in context.
   * Call this after email verification or any server-side claim change.
   */
  const refreshUser = async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    const tokenResult = await auth.currentUser.getIdTokenResult(true);
    setCurrentUser(auth.currentUser);
    // Spread to always produce a new object reference, ensuring React re-renders.
    setUserClaims({ ...tokenResult.claims });
  };

  return (
    <AuthContext.Provider value={{ currentUser, userClaims, loading, logout, refreshUser }}>
      {/*
        Block rendering until the initial auth check completes to prevent
        a flash of unauthenticated / wrong-role content.
      */}
      {loading ? null : children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth — convenience hook for consuming the AuthContext.
 * Throws if used outside of <AuthProvider>.
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return context;
}
