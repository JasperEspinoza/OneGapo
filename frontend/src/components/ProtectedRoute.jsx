import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from './Navbar';

const PRIMARY_ADMIN_EMAIL = 'onegapo2026@gmail.com';

function ProtectedRoute({ allowedRoles, requireVerified = true, showNav = true, requirePrimaryAdmin = false }) {
  const { currentUser, userClaims, accountVerified, loading } = useAuth();

  if (loading) {
    return (
      <div className="screen-center">
        <span className="loading-text">Loading…</span>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  if (requireVerified) {
    const isPrivileged = userClaims?.role === 'staff' || userClaims?.role === 'admin';
    if (!isPrivileged && !accountVerified) {
      return <Navigate to="/verify-email" replace />;
    }
  }

  if (allowedRoles && !allowedRoles.includes(userClaims?.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requirePrimaryAdmin && currentUser?.email?.toLowerCase() !== PRIMARY_ADMIN_EMAIL) {
    return <Navigate to="/unauthorized" replace />;
  }

  return (
    <>
      {showNav && <Navbar />}
      <Outlet />
    </>
  );
}

export default ProtectedRoute;
