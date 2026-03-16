import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../config/firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userClaims,  setUserClaims]  = useState(null);
  const [accountVerified, setAccountVerified] = useState(false);
  const [loading,     setLoading]     = useState(true);

  const fetchVerificationStatus = async (user) => {
    const idToken = await user.getIdToken();
    const response = await fetch('/api/auth/verification-status', {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Could not load verification status.');
    }

    const data = await response.json();
    return data.verified === true;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          const tokenResult = await user.getIdTokenResult(true);
          let verified = tokenResult.claims.verified === true;

          try {
            verified = await fetchVerificationStatus(user);
          } catch {
            verified = tokenResult.claims.verified === true;
          }

          setCurrentUser(user);
          setUserClaims(tokenResult.claims);
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

  const logout = () => signOut(auth);

  const refreshUser = async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    const tokenResult = await auth.currentUser.getIdTokenResult(true);
    let verified = tokenResult.claims.verified === true;

    try {
      verified = await fetchVerificationStatus(auth.currentUser);
    } catch {
      verified = tokenResult.claims.verified === true;
    }

    setCurrentUser(auth.currentUser);
    setUserClaims({ ...tokenResult.claims });
    setAccountVerified(verified);
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
