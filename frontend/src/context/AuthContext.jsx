import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../config/firebase';
// NOTE: window.fetch is globally patched in main.jsx — bare /api/ paths work
// in both local dev (via Vite proxy) and production (rewritten to VITE_API_BASE_URL).

const AuthContext = createContext(null);

function normalizeRoleKey(value) {
  return String(value || '').trim().toLowerCase();
}


function mergeSessionProfile(tokenClaims = {}, sessionProfile = null) {
  const profile = sessionProfile?.profile || {};

  // The session profile is fetched live from Firestore on every auth state change,
  // so it reflects role removals immediately. Token claims can be up to 1 hour stale.
  // Profile fields take priority over token claims for role-sensitive fields.
  const hasProfile = profile && Object.keys(profile).length > 0;

  const role = hasProfile
    ? (normalizeRoleKey(profile.role) || normalizeRoleKey(tokenClaims.role) || '')
    : (normalizeRoleKey(tokenClaims.role) || '');

  const effectiveRole = role || normalizeRoleKey(tokenClaims.roleKey) || '';

  return {
    ...tokenClaims,
    ...(hasProfile ? profile : {}),
    role: effectiveRole,
    roleKey: effectiveRole,
    // Profile wins for branch/permission fields since they come from Firestore
    customRoleName: (hasProfile ? profile.customRoleName : null) ?? tokenClaims.customRoleName ?? null,
    branchId:       (hasProfile ? profile.branchId       : null) ?? tokenClaims.branchId       ?? null,
    location:       (hasProfile ? (profile.location || profile.branchName) : null) ?? tokenClaims.location ?? null,
    branchName:     (hasProfile ? (profile.branchName || profile.location) : null) ?? tokenClaims.branchName ?? null,
    entityType:     (hasProfile ? profile.entityType     : null) ?? tokenClaims.entityType     ?? null,
    permissions: Array.isArray(profile.permissions)
      ? profile.permissions
      : Array.isArray(tokenClaims.permissions) ? tokenClaims.permissions : [],
  };
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userClaims,  setUserClaims]  = useState(null);
  const [accountVerified, setAccountVerified] = useState(false);
  const [loading,     setLoading]     = useState(true);

  const fetchSessionProfile = async (user) => {
    const idToken = await user.getIdToken();
    const response = await fetch('/api/auth/verification-status', {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Could not load verification status.');
    }

    return response.json();
  };

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setCurrentUser(null);
      setUserClaims(null);
      setAccountVerified(false);
      setLoading(false);
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          const tokenResult = await user.getIdTokenResult(true);
          let verified = tokenResult.claims.verified === true;
          let sessionProfile = null;

          try {
            sessionProfile = await fetchSessionProfile(user);
            verified = sessionProfile?.verified === true;
          } catch {
            verified = tokenResult.claims.verified === true;
          }

          setCurrentUser(user);
          setUserClaims(mergeSessionProfile(tokenResult.claims, sessionProfile));
          setAccountVerified(verified);
        } else {
          setCurrentUser(null);
          setUserClaims(null);
          setAccountVerified(false);
        }
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const logout = async () => {
    // Sign out from Firebase first
    if (auth) {
      await signOut(auth);
    }

    // Clear all browser Cache Storage (PWA/service-worker caches)
    // This prevents stale role/permission data from persisting after sign-out.
    try {
      if (typeof caches !== 'undefined') {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }
    } catch {
      // Non-fatal — ignore in environments where Cache API is unavailable.
    }

    // Clear session and local storage so no cached user state lingers.
    try { sessionStorage.clear(); } catch { /* ignore */ }
    try { localStorage.clear(); } catch { /* ignore */ }
  };

  const refreshUser = async () => {
    if (!auth || !isFirebaseConfigured) return false;
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    const tokenResult = await auth.currentUser.getIdTokenResult(true);
    let verified = tokenResult.claims.verified === true;
    let sessionProfile = null;

    try {
      sessionProfile = await fetchSessionProfile(auth.currentUser);
      verified = sessionProfile?.verified === true;
    } catch {
      verified = tokenResult.claims.verified === true;
    }

    setCurrentUser(auth.currentUser);
    setUserClaims(mergeSessionProfile(tokenResult.claims, sessionProfile));
    setAccountVerified(verified);
    return verified;
  };

  return (
    <AuthContext.Provider value={{ currentUser, userClaims, accountVerified, loading, logout, refreshUser }}>
      {loading ? null : children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return context;
}
