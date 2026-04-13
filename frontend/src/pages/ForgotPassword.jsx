import './ForgotPassword.css';
import { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { auth, firebaseConfigErrorMessage, isFirebaseConfigured } from '../config/firebase';

export default function ForgotPassword() {
  const [email,   setEmail]   = useState('');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedEmail = email.trim();

    if (!isFirebaseConfigured || !auth) {
      setError(firebaseConfigErrorMessage || 'Firebase is not configured for this deployment.');
      return;
    }

    setError('');
    setSuccess(false);
    setLoading(true);
    setSubmittedEmail(trimmedEmail);

    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setSuccess(true);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        setSuccess(true);
      } else if (err.code === 'auth/invalid-email') {
        setError('Enter a valid email address.');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Too many requests. Please wait a few minutes and try again.');
      } else {
        setError('Could not send reset email. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-title">Reset password</h1>
          <p className="auth-subtitle">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        {error && <div role="alert" className="auth-error">{error}</div>}

        {success ? (
          <div role="status" className="auth-success">
            If an account exists for <strong>{submittedEmail}</strong>, a password
            reset link should arrive shortly. Check your inbox and spam folder.
          </div>
        ) : (
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

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="btn-primary"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="auth-footer">
          <p><Link to="/login" className="auth-link">← Back to sign in</Link></p>
        </div>
      </div>
    </div>
  );
}
