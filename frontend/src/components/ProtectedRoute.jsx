import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from './Navbar';

/**
 * ProtectedRoute
 *
 * Props:
 *   allowedRoles    {string[]} — role whitelist; omit to allow any authenticated user.
 *   requireVerified {boolean}  — if true (default), residents must have verified email.
 *                                Staff and admin always bypass this check.
 *   showNav         {boolean}  — if true (default), renders the top Navbar above the page.
 */
function ProtectedRoute({ allowedRoles, requireVerified = true, showNav = true }) {
  const { currentUser, userClaims, loading } = useAuth();

  if (loading) {
    return (
      <div className="screen-center">
        <span className="loading-text">Loading…</span>
      </div>
    );
  }

  // Not authenticated → login
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // Email verification: staff and admin are provisioned accounts — skip check.
  // Residents and new accounts without a role must verify before accessing the app.
  if (requireVerified) {
    const isPrivileged = userClaims?.role === 'staff' || userClaims?.role === 'admin';
    if (!isPrivileged && !currentUser.emailVerified) {
      return <Navigate to="/verify-email" replace />;
    }
  }

  // Role check
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
