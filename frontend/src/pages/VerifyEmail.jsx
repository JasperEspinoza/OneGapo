import './VerifyEmail.css';
import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../config/firebase';
import { useAuth } from '../context/AuthContext';
// NOTE: window.fetch is globally patched in main.jsx to rewrite /api/* URLs,
// so bare /api/ paths work in both local dev (via Vite proxy) and production.

function getDestination(userClaims) {
  if (userClaims?.role === 'admin') return '/admin';
  if (userClaims?.role === 'staff') {
    const permissions = Array.isArray(userClaims?.permissions) ? userClaims.permissions : [];
    const hasAdminWorkspaceAccess = permissions.some((permission) =>
      ['add_branches', 'add_roles', 'add_staffs'].includes(permission)
    );
    return hasAdminWorkspaceAccess ? '/admin' : '/staff';
  }
  return '/';
}

export default function VerifyEmail() {
  const { currentUser, userClaims, accountVerified, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const token = new URLSearchParams(location.search).get('token');

  const [resending, setResending] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [resent,    setResent]    = useState(false);
  const [error,     setError]     = useState('');
  const [verifyingToken, setVerifyingToken] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState('');
  // lastProcessedTokenRef is the single source of truth for deduplication.
  // We do NOT use a `tokenProcessed` state variable — setting state inside an
  // effect causes the effect's dep-array to change, which triggers a cleanup
  // (active=false) while the fetch is still in-flight, permanently killing the
  // "Verifying your email…" spinner without ever calling navigate().
  const lastProcessedTokenRef = useRef('');

  // Effect 1: Process the verification token from the URL
  useEffect(() => {
    if (!token) return;
    // Ref-based guard prevents double-processing without causing a re-render
    // that would re-trigger this effect and abort the in-flight fetch.
    if (lastProcessedTokenRef.current === token) return;
    lastProcessedTokenRef.current = token;

    let active = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);

    const confirmVerification = async () => {
      setVerifyingToken(true);
      setError('');
      setVerificationMessage('');

      try {
        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ token }),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || 'Could not verify email.');
        }

        if (!active) return;

        const message = data.message || 'Email verified successfully.';
        setVerificationMessage(message);

        // refreshUser() does three things in sequence:
        //   1. Reloads the Firebase Auth user
        //   2. Force-refreshes the ID token (picks up the new verified=true claim)
        //   3. Re-fetches /api/auth/verification-status and sets accountVerified=true
        //      in AuthContext — BEFORE we navigate, preventing the redirect loop
        //      where RootRoute still sees accountVerified=false and sends the user
        //      straight back to /verify-email.
        let nowVerified = false;
        try {
          if (auth.currentUser) {
            nowVerified = await refreshUser();
          }
        } catch {
          // Non-fatal — navigate regardless; onAuthStateChanged will catch up.
        }

        if (!active) return;

        // Logged-in + verified → go directly to the app root (RootRoute routes
        // to /resident). Not logged in → login page with a success banner.
        if (auth.currentUser && nowVerified) {
          navigate('/', { replace: true });
        } else {
          navigate('/login', {
            replace: true,
            state: { verificationSuccess: message },
          });
        }
      } catch (err) {
        if (!active) return;
        if (err.name === 'AbortError') {
          setError('Verification timed out. Please try opening the link again or sign in and resend the email.');
        } else {
          setError(err.message || 'Could not verify email.');
        }
      } finally {
        window.clearTimeout(timeoutId);
        // Always clear the spinner — even if active is false, the component may
        // still be mounted (e.g. error branch). Worst case: benign no-op.
        setVerifyingToken(false);
      }
    };

    confirmVerification();

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
      // Reset the ref so React StrictMode's intentional second mount can
      // re-run the fetch. Without this, the ref blocks the second mount
      // after StrictMode's cleanup kills the first in-flight request,
      // leaving the UI permanently stuck on "Verifying your email…".
      lastProcessedTokenRef.current = '';
    };
  // token and navigate are stable references — this effect runs once per unique
  // token value. tokenProcessed was removed from deps (it was state, not a ref),
  // which was causing the cleanup to fire mid-fetch and abort the verification.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, navigate]);

  // Effect 2: Redirect privileged users (staff/admin) away from the verify page
  useEffect(() => {
    if (verifyingToken) return; // Don't interfere while verification is in-flight
    const isPrivileged = userClaims?.role === 'staff' || userClaims?.role === 'admin';
    if (!token && isPrivileged) {
      navigate(getDestination(userClaims), { replace: true });
    }
  }, [navigate, token, userClaims, verifyingToken]);

  // Effect 3: If already verified (and not staff/admin), redirect to login
  useEffect(() => {
    if (token || verifyingToken) return; // Don't interfere while token is present or verification in-flight
    const isPrivileged = userClaims?.role === 'staff' || userClaims?.role === 'admin';
    if (isPrivileged || !accountVerified) return;

    let active = true;
    const routeToLogin = async () => {
      await logout().catch(() => {});
      if (active) {
        navigate('/login', { replace: true });
      }
    };

    routeToLogin();

    return () => {
      active = false;
    };
  }, [accountVerified, logout, navigate, token, userClaims, verifyingToken]);

  const handleCheckNow = async () => {
    setError('');
    setVerificationMessage('');
    setCheckingStatus(true);

    try {
      const verified = await refreshUser();
      if (verified) {
        await logout().catch(() => {});
        navigate('/login', { replace: true });
        return;
      }

      setError('Your email is still unverified. Open your email link first, then try again.');
    } catch {
      setError('Could not check verification status right now. Please try again.');
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError('');
    setResent(false);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail = data.details ? ` (${data.details})` : '';
        throw new Error((data.error || 'Could not resend email. Please try again.') + detail);
      }

      setResent(true);
      setVerificationMessage(data.message || 'Verification email sent.');
    } catch (err) {
      setError(err.message || 'Could not resend email. Please try again.');
    } finally {
      setResending(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <span className="verify-email-icon material-symbols-outlined" aria-hidden="true">mark_email_read</span>
          <h1 className="auth-title">Verify your email</h1>
          {token ? (
            <p className="auth-subtitle">
              We&apos;re confirming your OneGapo verification link now.
            </p>
          ) : currentUser ? (
            <p className="auth-subtitle">
              We sent a verification link to{' '}
              <span className="verify-email-address">{currentUser.email}</span>.
              Click the link in that email to activate your account.
            </p>
          ) : (
            <p className="auth-subtitle">
              Open the verification link from your email, or sign in to request a new one.
            </p>
          )}
        </div>

        {error  && <div role="alert"  className="auth-error">{error}</div>}
        {resent && <div role="status" className="auth-success">Verification email resent successfully.</div>}
        {verificationMessage && <div role="status" className="auth-success">{verificationMessage}</div>}

        {verifyingToken && (
          <div role="status" className="auth-success">Verifying your email…</div>
        )}

        {currentUser ? (
          <div className="verify-email-actions">
            <button onClick={handleCheckNow} className="btn-primary">
              {checkingStatus ? 'Checking…' : 'I\'ve verified my email'}
            </button>
            <button
              onClick={handleResend}
              disabled={resending || accountVerified}
              className="btn-secondary"
            >
              {resending ? 'Sending…' : 'Resend verification email'}
            </button>
          </div>
        ) : (
          <div className="verify-email-actions">
            <Link to="/login" className="btn-primary" style={{ textAlign: 'center', textDecoration: 'none' }}>
              Sign in
            </Link>
            <Link to="/register" className="btn-secondary" style={{ textAlign: 'center', textDecoration: 'none' }}>
              Create account
            </Link>
          </div>
        )}

        {currentUser && (
          <div className="auth-footer">
            <p>
              Wrong account?{' '}
              <button onClick={handleLogout} className="auth-link bg-transparent border-0 p-0 cursor-pointer">
                Sign out
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
