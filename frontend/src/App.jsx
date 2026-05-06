import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import PageTransition from './components/PageTransition';

import Login          from './pages/Login';
import Register       from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import VerifyEmail    from './pages/VerifyEmail';
import Dashboard      from './pages/Dashboard';
import StaffPanel     from './pages/StaffPanel';
import AdminPanel     from './pages/AdminPanel';
import ResidentHub    from './pages/ResidentHub';
import LandingPage    from './pages/LandingPage';
import { useAuth } from './context/AuthContext';
import { SettingsModalProvider } from './context/SettingsModalContext';
import PwaInstallPrompt from './components/PwaInstallPrompt';
import ThemeInitializer from './components/ThemeInitializer';

const Unauthorized = () => (
  <div className="screen-center">
    <div className="unauthorized-content">
      <h1 className="unauthorized-title">403 — Unauthorized</h1>
      <p className="unauthorized-body">You do not have permission to view this page.</p>
    </div>
  </div>
);

const ADMIN_WORKSPACE_PERMISSIONS = ['add_branches', 'add_roles', 'add_staffs'];
const REPORT_WORKSPACE_PERMISSIONS = ['view_reports', 'update_reports', 'close_reports', 'archive_reports'];

const HomeRoute = () => {
  const { userClaims } = useAuth();
  const role = userClaims?.role;
  const permissions = Array.isArray(userClaims?.permissions) ? userClaims.permissions : [];
  const canAccessAdminWorkspace =
    role === 'admin' ||
    permissions.some((permission) => ADMIN_WORKSPACE_PERMISSIONS.includes(permission));
  const canAccessReportWorkspace =
    role === 'admin' ||
    role === 'staff' ||
    permissions.some((permission) => REPORT_WORKSPACE_PERMISSIONS.includes(permission));

  if (role === 'resident') {
    return <Navigate to="/resident" replace />;
  }

  if (canAccessAdminWorkspace) {
    return <Navigate to="/admin" replace />;
  }

  if (canAccessReportWorkspace) {
    return <Navigate to="/staff" replace />;
  }

  return <Dashboard />;
};

const RootRoute = () => {
  const { currentUser, userClaims, accountVerified, loading } = useAuth();
  const role = userClaims?.role;
  const permissions = Array.isArray(userClaims?.permissions) ? userClaims.permissions : [];
  const canAccessAdminWorkspace =
    role === 'admin' || permissions.some((permission) => ADMIN_WORKSPACE_PERMISSIONS.includes(permission));
  const canAccessReportWorkspace =
    role === 'admin' ||
    role === 'staff' ||
    permissions.some((permission) => REPORT_WORKSPACE_PERMISSIONS.includes(permission));

  if (loading) {
    return (
      <div className="screen-center">
        <span className="loading-text">Loading…</span>
      </div>
    );
  }

  if (!currentUser) {
    return <LandingPage />;
  }

  if (role === 'resident') {
    if (!accountVerified) {
      return <Navigate to="/verify-email" replace />;
    }

    return <Navigate to="/resident" replace />;
  }

  if (canAccessAdminWorkspace) {
    return <Navigate to="/admin" replace />;
  }

  if (canAccessReportWorkspace) {
    return <Navigate to="/staff" replace />;
  }

  return <Dashboard />;
};

function App() {
  return (
    <Router future={{ v7_relativeSplatPath: true }}>
      <AuthProvider>
        <ThemeInitializer />
        <SettingsModalProvider>
          <PageTransition>
            <Routes>
              {/* ── Public ────────────────────────────────────────────── */}
              <Route path="/" element={<RootRoute />} />
              <Route path="/login"           element={<Login />} />
              <Route path="/register"        element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/verify-email"    element={<VerifyEmail />} />
              <Route path="/unauthorized"    element={<Unauthorized />} />

              {/* ── Any authenticated + verified user ────────────── */}
              <Route element={<ProtectedRoute />}>
                <Route path="/home" element={<HomeRoute />} />
              </Route>

              <Route element={<ProtectedRoute allowedRoles={['resident']} showNav={false} />}>
                <Route path="/resident" element={<ResidentHub />} />
              </Route>

              {/* ── Staff + Admin ─────────────────────────────────── */}
              <Route
                element={(
                  <ProtectedRoute
                    allowedRoles={['staff', 'admin']}
                    allowedPermissionsAny={REPORT_WORKSPACE_PERMISSIONS}
                    showNav={false}
                  />
                )}
              >
                <Route path="/staff" element={<StaffPanel />} />
              </Route>

              {/* ── Admin only ────────────────────────────────────── */}
              <Route
                element={(
                  <ProtectedRoute
                    allowedRoles={['admin', 'staff']}
                    allowedPermissionsAny={[...ADMIN_WORKSPACE_PERMISSIONS, ...REPORT_WORKSPACE_PERMISSIONS]}
                    showNav={false}
                  />
                )}
              >
                <Route path="/admin" element={<AdminPanel />} />
              </Route>

              {/* ── Catch-all ───────────────────────────────────────── */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PageTransition>
          <PwaInstallPrompt />
        </SettingsModalProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
