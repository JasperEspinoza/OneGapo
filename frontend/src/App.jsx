import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

import Login          from './pages/Login';
import Register       from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import VerifyEmail    from './pages/VerifyEmail';
import Dashboard      from './pages/Dashboard';
import StaffPanel     from './pages/StaffPanel';
import AdminPanel     from './pages/AdminPanel';
import ResidentHub    from './pages/ResidentHub';
import { useAuth } from './context/AuthContext';
import { SettingsModalProvider } from './context/SettingsModalContext';

const Unauthorized = () => (
  <div className="screen-center">
    <div className="unauthorized-content">
      <h1 className="unauthorized-title">403 — Unauthorized</h1>
      <p className="unauthorized-body">You do not have permission to view this page.</p>
    </div>
  </div>
);

const HomeRoute = () => {
  const { userClaims } = useAuth();

  if (userClaims?.role === 'resident') {
    return <Navigate to="/resident" replace />;
  }

  return <Dashboard />;
};

function App() {
  return (
    <Router future={{ v7_relativeSplatPath: true }}>
      <AuthProvider>
        <SettingsModalProvider>
          <Routes>
            {/* ── Public ────────────────────────────────────────────── */}
            <Route path="/login"           element={<Login />} />
            <Route path="/register"        element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/verify-email"    element={<VerifyEmail />} />
            <Route path="/unauthorized"    element={<Unauthorized />} />

            {/* ── Any authenticated + verified user ────────────── */}
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<HomeRoute />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['resident']} showNav={false} />}>
              <Route path="/resident" element={<ResidentHub />} />
            </Route>

            {/* ── Staff + Admin ─────────────────────────────────── */}
            <Route element={<ProtectedRoute allowedRoles={['staff']} showNav={false} />}>
              <Route path="/staff" element={<StaffPanel />} />
            </Route>

            {/* ── Admin only ────────────────────────────────────── */}
            <Route element={<ProtectedRoute allowedRoles={['admin']} requirePrimaryAdmin={true} showNav={false} />}>
              <Route path="/admin" element={<AdminPanel />} />
            </Route>

            {/* ── Catch-all ───────────────────────────────────────── */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </SettingsModalProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
