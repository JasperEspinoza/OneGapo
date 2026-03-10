import './VerifyEmail.css';
import { useState, useEffect } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth } from '../config/firebase';
import { useAuth } from '../context/AuthContext';

export default function VerifyEmail() {
  const { currentUser, userClaims, refreshUser, logout } = useAuth();
  const navigate = useNavigate();

  const [resending, setResending] = useState(false);
  const [resent,    setResent]    = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    if (!currentUser) return;

    const isPrivileged = userClaims?.role === 'staff' || userClaims?.role === 'admin';
    if (isPrivileged || currentUser.emailVerified) {
      navigate('/', { replace: true });
      return;
    }

    const interval = setInterval(async () => {
      await refreshUser();
      if (auth.currentUser?.emailVerified) {
        clearInterval(interval);
        navigate('/', { replace: true });
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [currentUser, userClaims, navigate, refreshUser]);

  const handleCheckNow = async () => {
    await refreshUser();
    if (auth.currentUser?.emailVerified) {
      navigate('/', { replace: true });
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError('');
    setResent(false);
    try {
      await sendEmailVerification(auth.currentUser);
      setResent(true);
    } catch (err) {
      if (err.code === 'auth/too-many-requests') {
        setError('Too many requests. Please wait a few minutes before trying again.');
      } else {
        setError('Could not resend email. Please try again.');
      }
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
          <div className="verify-email-icon">📧</div>
          <h1 className="auth-title">Verify your email</h1>
          <p className="auth-subtitle">
            We sent a verification link to{' '}
            <span className="verify-email-address">{currentUser?.email}</span>.
            Click the link in that email to activate your account.
          </p>
        </div>

        {error  && <div role="alert"  className="auth-error">{error}</div>}
        {resent && <div role="status" className="auth-success">Verification email resent successfully.</div>}

        <div className="verify-email-actions">
          <button onClick={handleCheckNow} className="btn-primary">
            I&apos;ve verified my email
          </button>
          <button
            onClick={handleResend}
            disabled={resending}
            className="btn-secondary"
          >
            {resending ? 'Sending…' : 'Resend verification email'}
          </button>
        </div>

        <div className="auth-footer">
          <p>
            Wrong account?{' '}
            <button onClick={handleLogout} className="auth-link bg-transparent border-0 p-0 cursor-pointer">
              Sign out
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
