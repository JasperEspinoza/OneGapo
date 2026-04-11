import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettingsModal } from '../context/SettingsModalContext';
import OneGapoLogo from './OneGapoLogo';

const ICONS = {
    menu: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
    ),
    close: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    )
};

export default function Navbar() {
  const { currentUser, userClaims, logout } = useAuth();
  const { openSettings } = useSettingsModal();
  const navigate = useNavigate();
  const role = userClaims?.role;
  const permissions = Array.isArray(userClaims?.permissions) ? userClaims.permissions : [];
  const canAccessReports =
    role === 'admin' ||
    role === 'staff' ||
    permissions.some((permission) => ['view_reports', 'update_reports', 'close_reports', 'archive_reports'].includes(permission));
  const canAccessAdminWorkspace =
    role === 'admin' ||
    permissions.some((permission) => ['add_branches', 'add_roles', 'add_staffs'].includes(permission));
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login');
  };

  const handleOpenSettings = () => {
    setMenuOpen(false);
    openSettings();
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand" onClick={closeMenu}>
        <OneGapoLogo className="navbar-brand-logo" decorative />
        <span>OneGapo</span>
      </Link>

      {/* Desktop links */}
      <div className="navbar-desktop">
        {canAccessReports && (
          <Link to="/staff" className="navbar-link">Reports</Link>
        )}
        {canAccessAdminWorkspace && (
          <Link to="/admin" className="navbar-link">Admin</Link>
        )}
        <button type="button" onClick={handleOpenSettings} className="navbar-link">
          Settings
        </button>
        <button onClick={handleLogout} className="btn-outline btn-sm">
          Sign out
        </button>
      </div>

      {/* Mobile hamburger */}
      <button
        className="navbar-hamburger"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
      >
        <span className="navbar-icon">
          {menuOpen ? ICONS.close : ICONS.menu}
        </span>
      </button>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="navbar-mobile-menu">
          {canAccessReports && (
            <Link to="/staff" className="navbar-mobile-link" onClick={closeMenu}>
              Reports
            </Link>
          )}
          {canAccessAdminWorkspace && (
            <Link to="/admin" className="navbar-mobile-link" onClick={closeMenu}>
              Admin
            </Link>
          )}
          <button type="button" className="navbar-mobile-link" onClick={handleOpenSettings}>
            Settings
          </button>
          <button onClick={handleLogout} className="navbar-mobile-link navbar-mobile-signout">
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
