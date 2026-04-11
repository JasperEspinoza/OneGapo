import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from './Navbar';

const PRIMARY_ADMIN_EMAIL = 'onegapo2026@gmail.com';

function ProtectedRoute({
  allowedRoles,
  allowedPermissionsAny,
  requireVerified = true,
  showNav = true,
  requirePrimaryAdmin = false,
}) {
  const { currentUser, userClaims, accountVerified, loading } = useAuth();
  const isPrimaryAdmin = currentUser?.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL;
  const userPermissions = Array.isArray(userClaims?.permissions) ? userClaims.permissions : [];

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
    const isPrivileged = userClaims?.role === 'staff' || userClaims?.role === 'admin' || isPrimaryAdmin;
    if (!isPrivileged && !accountVerified) {
      return <Navigate to="/verify-email" replace />;
    }
  }

  const allowPrimaryAdminAsAdmin = Boolean(
    allowedRoles &&
    allowedRoles.includes('admin') &&
    isPrimaryAdmin
  );

  if (allowedRoles && !allowedRoles.includes(userClaims?.role) && !allowPrimaryAdminAsAdmin) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (
    Array.isArray(allowedPermissionsAny) &&
    allowedPermissionsAny.length > 0 &&
    userClaims?.role !== 'admin' &&
    !isPrimaryAdmin
  ) {
    const hasAnyRequiredPermission = allowedPermissionsAny.some((permission) =>
      userPermissions.includes(permission)
    );

    if (!hasAnyRequiredPermission) {
      return <Navigate to="/unauthorized" replace />;
    }
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
