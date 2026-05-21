import './Login.css';
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useNavigate, Navigate, Link, useLocation } from 'react-router-dom';
import { auth, firebaseConfigErrorMessage, isFirebaseConfigured } from '../config/firebase';
import { useAuth } from '../context/AuthContext';
import OneGapoLogo from '../components/OneGapoLogo';
// NOTE: window.fetch is globally patched in main.jsx — bare /api/ paths work in production.

const PRIMARY_ADMIN_EMAIL = 'onegapo2026@gmail.com';

function hasAdminWorkspaceAccess(role, permissions, email = '') {
  return (
    role === 'admin' ||
    String(email || '').toLowerCase() === PRIMARY_ADMIN_EMAIL ||
    permissions.some((permission) => ['add_branches', 'add_roles', 'add_staffs'].includes(permission))
  );
}

function getErrorMessage(code) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Invalid email or password.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact an administrator.';
    case 'auth/too-many-requests':
      return 'Too many failed sign-in attempts. Please try again later.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
}

export default function Login() {
  const { currentUser, userClaims, accountVerified } = useAuth();
  const navigate                    = useNavigate();
  const location                    = useLocation();
  const verificationSuccess         = location.state?.verificationSuccess || '';

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const currentPermissions = Array.isArray(userClaims?.permissions) ? userClaims.permissions : [];
  const currentHasAdminWorkspace = hasAdminWorkspaceAccess(
    userClaims?.role,
    currentPermissions,
    currentUser?.email
  );

  if (currentUser) {
    if (currentHasAdminWorkspace) return <Navigate to="/admin" replace />;
    if (userClaims?.role === 'staff') return <Navigate to="/staff" replace />;
    if (userClaims?.role === 'resident') {
      // Only bounce to /verify-email when we are certain accountVerified is
      // false. If the user just verified via email link, AuthContext may not
      // have caught up yet — we let them stay on the login page momentarily
      // so they can sign in and trigger a fresh onAuthStateChanged fetch.
      if (accountVerified === false && location.state?.verificationSuccess) {
        // Verification success state is present — trust it and let them proceed
        // rather than sending them back to the verify page.
        return <Navigate to="/resident" replace />;
      }
      if (!accountVerified) return <Navigate to="/verify-email" replace />;
    }
    return <Navigate to="/resident" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isFirebaseConfigured || !auth) {
      setError(firebaseConfigErrorMessage || 'Firebase is not configured for this deployment.');
      return;
    }
    setLoading(true);

    try {
      const credential  = await signInWithEmailAndPassword(auth, email.trim(), password);
      const tokenResult = await credential.user.getIdTokenResult();
      const role        = tokenResult.claims.role;
      const permissions = Array.isArray(tokenResult.claims.permissions) ? tokenResult.claims.permissions : [];
      const canAccessAdminWorkspace = hasAdminWorkspaceAccess(role, permissions, credential.user.email);

      if (canAccessAdminWorkspace) {
        navigate('/admin', { replace: true });
      } else if (role === 'staff') {
        navigate('/staff', { replace: true });
      } else {
        // For residents, check verification status before redirecting
        try {
          const idToken = await credential.user.getIdToken();
          const verifyRes = await fetch('/api/auth/verification-status', {
            headers: { Authorization: `Bearer ${idToken}` },
          });
          const verifyData = await verifyRes.json().catch(() => ({}));
          if (verifyData.verified === true) {
            navigate('/resident', { replace: true });
          } else {
            navigate('/verify-email', { replace: true });
          }
        } catch {
          // If status check fails, let AuthContext handle it on next page
          navigate('/resident', { replace: true });
        }
      }
    } catch (err) {
      setError(getErrorMessage(err.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <OneGapoLogo className="auth-logo" alt="OneGapo" />
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-subtitle">Sign in to OneGapo — Citizen Reporting Platform</p>
        </div>

        {verificationSuccess && (
          <div role="status" className="auth-success">{verificationSuccess}</div>
        )}
        {error && <div role="alert" className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div>
            <label htmlFor="email" className="form-label">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="form-input"
              placeholder="you@example.com"
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="password" className="form-label">Password</label>
            <div className="login-password-field">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="form-input login-password-input"
              placeholder="••••••••"
              disabled={loading}
            />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="login-password-toggle"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                disabled={loading}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          <div className="text-right">
            <Link to="/forgot-password" className="auth-link" style={{ fontSize: '0.75rem' }}>
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="btn-primary"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            New resident?{' '}
            <Link to="/register" className="auth-link">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
