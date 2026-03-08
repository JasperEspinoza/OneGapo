import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { auth } from '../config/firebase';
import { useAuth } from '../context/AuthContext';

/**
 * Maps Firebase Auth error codes to user-friendly messages.
 * Deliberately vague for auth/invalid-credential to avoid user enumeration.
 */
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
  const { currentUser, userClaims } = useAuth();
  const navigate                    = useNavigate();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // Already signed in — redirect away from login page based on role
  if (currentUser) {
    if (userClaims?.role === 'admin') return <Navigate to="/admin" replace />;
    if (userClaims?.role === 'staff') return <Navigate to="/staff" replace />;
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const credential  = await signInWithEmailAndPassword(auth, email.trim(), password);
      const tokenResult = await credential.user.getIdTokenResult();
      const role        = tokenResult.claims.role;
      if (role === 'admin')  navigate('/admin', { replace: true });
      else if (role === 'staff') navigate('/staff', { replace: true });
      else navigate('/', { replace: true });
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
          <span className="auth-logo">G</span>
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-subtitle">Sign in to OneGapo — Citizen Reporting Platform</p>
        </div>

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
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="form-input"
              placeholder="••••••••"
              disabled={loading}
            />
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
