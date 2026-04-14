import './VerifyEmail.css';
import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../config/firebase';
import { useAuth } from '../context/AuthContext';

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
  const [resent,    setResent]    = useState(false);
  const [error,     setError]     = useState('');
  const [verifyingToken, setVerifyingToken] = useState(false);
  const [tokenProcessed, setTokenProcessed] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState('');
  const lastProcessedTokenRef = useRef('');

  useEffect(() => {
    if (!token || tokenProcessed) return;
    if (lastProcessedTokenRef.current === token) return;
    lastProcessedTokenRef.current = token;

    let active = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);

    const confirmVerification = async () => {
      setTokenProcessed(true);
      setVerifyingToken(true);
      setError('');
      setVerificationMessage('');

      try {
        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
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
        navigate('/verify-email', { replace: true });

        if (currentUser && currentUser.uid === data.uid) {
          refreshUser().catch(() => {});
        }
      } catch (err) {
        if (!active) return;
        if (err.name === 'AbortError') {
          setError('Verification timed out. Please try opening the link again or sign in and resend the email.');
        } else {
          setError(err.message || 'Could not verify email.');
        }
        navigate('/verify-email', { replace: true });
      } finally {
        window.clearTimeout(timeoutId);
        if (active) {
          setVerifyingToken(false);
        }
      }
    };

    confirmVerification();

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [token, tokenProcessed, currentUser, navigate, refreshUser]);

  useEffect(() => {
    const isPrivileged = userClaims?.role === 'staff' || userClaims?.role === 'admin';
    if ((isPrivileged || accountVerified) && !token) {
      navigate(getDestination(userClaims), { replace: true });
    }
  }, [accountVerified, navigate, token, userClaims]);

  const handleCheckNow = async () => {
    setError('');
    await refreshUser();
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
              I&apos;ve verified my email
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
