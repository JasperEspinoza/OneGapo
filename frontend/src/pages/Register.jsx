import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
} from 'firebase/auth';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { auth } from '../config/firebase';
import { useAuth } from '../context/AuthContext';

function getErrorMessage(code) {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email address already exists.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password is too weak. Please choose a stronger password.';
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled. Please contact support.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    default:
      return `Registration failed (${code}). Please try again.`;
  }
}

export default function Register() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName]   = useState('');
  const [email,    setEmail]      = useState('');
  const [password, setPassword]   = useState('');
  const [confirm,  setConfirm]    = useState('');
  const [error,    setError]      = useState('');
  const [loading,  setLoading]    = useState(false);

  // Already signed in (and not in the middle of registering) → go to dashboard
  if (currentUser && !loading) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) return setError('Passwords do not match.');
    if (password.length < 8)  return setError('Password must be at least 8 characters.');

    setLoading(true);
    let newUser = null;

    try {
      // 1. Create Firebase Auth user
      const credential = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      newUser = credential.user;

      // 2. Set display name immediately
      await updateProfile(newUser, { displayName: fullName.trim() });

      // 3. Assign 'resident' custom claim via backend
      const idToken = await newUser.getIdToken();
      const res = await fetch('/api/auth/complete-registration', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not complete registration. Please try again.');
      }

      // 4. Force-refresh token so claims are available immediately
      await newUser.getIdTokenResult(true);

      // 5. Send email verification link
      await sendEmailVerification(newUser);

      navigate('/verify-email');
    } catch (err) {
      // If the backend call failed after user creation, delete the orphaned account
      if (newUser && !err.code) {
        await newUser.delete().catch(() => {});
      }
      setError(err.code ? getErrorMessage(err.code) : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <span className="auth-logo">G</span>
          <h1 className="auth-title">Create account</h1>
          <p className="auth-subtitle">Join OneGapo as a resident to report and track issues in your community</p>
        </div>

        {error && <div role="alert" className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div>
            <label htmlFor="fullName" className="form-label">Full name</label>
            <input
              id="fullName"
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="form-input"
              placeholder="Juan dela Cruz"
              disabled={loading}
            />
          </div>

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
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="form-input"
              placeholder="At least 8 characters"
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="confirm" className="form-label">Confirm password</label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="form-input"
              placeholder="Re-enter your password"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !fullName || !email || !password || !confirm}
            className="btn-primary"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Already have an account?{' '}
            <Link to="/login" className="auth-link">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
