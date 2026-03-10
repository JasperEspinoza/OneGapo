import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from './Navbar';

function ProtectedRoute({ allowedRoles, requireVerified = true, showNav = true }) {
  const { currentUser, userClaims, loading } = useAuth();

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
    if (!isPrivileged && !currentUser.emailVerified) {
      return <Navigate to="/verify-email" replace />;
    }
  }

  if (allowedRoles && !allowedRoles.includes(userClaims?.role)) {
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
