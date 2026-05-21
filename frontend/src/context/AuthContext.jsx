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

  const roleKey = normalizeRoleKey(tokenClaims.role || profile.role);
  const customRoleKey = normalizeRoleKey(tokenClaims.customRoleName || profile.customRoleName);
  let effectiveRole = roleKey || customRoleKey || '';
  
  if (roleKey === 'responder' || customRoleKey === 'responder') {
    effectiveRole = 'responder';
  }

  return {
    ...tokenClaims,
    ...(profile || {}),
    role: effectiveRole || tokenClaims.role || profile.role || '',
    customRoleName: tokenClaims.customRoleName || profile.customRoleName || null,
    branchId: tokenClaims.branchId || profile.branchId || null,
    location: tokenClaims.location || profile.location || profile.branchName || null,
    branchName: tokenClaims.branchName || profile.branchName || profile.location || null,
    entityType: tokenClaims.entityType || profile.entityType || null,
    permissions: Array.isArray(tokenClaims.permissions) ? tokenClaims.permissions : Array.isArray(profile.permissions) ? profile.permissions : [],
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

  const logout = () => (auth ? signOut(auth) : Promise.resolve());

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
