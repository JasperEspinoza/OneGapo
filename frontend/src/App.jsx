import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

import Login          from './pages/Login';
import Register       from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import VerifyEmail    from './pages/VerifyEmail';
import Dashboard      from './pages/Dashboard';
import Profile        from './pages/Profile';
import StaffPanel     from './pages/StaffPanel';
import AdminPanel     from './pages/AdminPanel';

const Unauthorized = () => (
  <div className="screen-center">
    <div className="unauthorized-content">
      <h1 className="unauthorized-title">403 — Unauthorized</h1>
      <p className="unauthorized-body">You do not have permission to view this page.</p>
    </div>
  </div>
);

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          {/* ── Public ────────────────────────────────────────────── */}
          <Route path="/login"           element={<Login />} />
          <Route path="/register"        element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/unauthorized"    element={<Unauthorized />} />

          {/* ── Authenticated, email verification NOT enforced ── */}
          {/* Resident lands here after signup; staff/admin auto-redirected away */}
          <Route element={<ProtectedRoute requireVerified={false} showNav={false} />}>
            <Route path="/verify-email" element={<VerifyEmail />} />
          </Route>

          {/* ── Any authenticated + verified user ────────────── */}
          <Route element={<ProtectedRoute />}>
            <Route path="/"        element={<Dashboard />} />
            <Route path="/profile" element={<Profile />} />
          </Route>

          {/* ── Staff + Admin ─────────────────────────────────── */}
          <Route element={<ProtectedRoute allowedRoles={['staff', 'admin']} />}>
            <Route path="/staff" element={<StaffPanel />} />
          </Route>

          {/* ── Admin only ────────────────────────────────────── */}
          <Route element={<ProtectedRoute allowedRoles={['admin']} showNav={false} />}>
            <Route path="/admin" element={<AdminPanel />} />
          </Route>

          {/* ── Catch-all ───────────────────────────────────────── */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
