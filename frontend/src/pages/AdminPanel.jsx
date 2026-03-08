import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const PERMISSION_OPTIONS = [
  { value: 'view_reports',         label: 'View reports' },
  { value: 'update_reports',       label: 'Update report status' },
  { value: 'close_reports',        label: 'Close / resolve reports' },
  { value: 'create_announcements', label: 'Post announcements' },
];

const ICONS = {
  dashboard: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
  ),
  branches: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3z"/></svg>
  ),
  accounts: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zM8 6V4h4v2H8z"/></svg>
  ),
  users: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
  ),
  analytics: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M7.5 21H2V7h5.5v14zm7.25-10h-5.5v10h5.5V11zm7.25 8h-5.5v2h5.5v-2zM22 4v17h-5.5V4H22z"/></svg>
  ),
  location_city: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z"/></svg>
  ),
  report: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
  ),
  settings: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 25
    " fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L5.09 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
  ),
  logout: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
  ),
  close: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22" style={{minWidth: '22px'}}><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
  ),
  menu: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22" style={{minWidth: '22px'}}><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
  ),
  search: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18" style={{minWidth: '18px'}}><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
  ),
  notifications: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22" style={{minWidth: '22px'}}><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/></svg>
  ),
  badge: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M17 3h-1v2h1V3zm0 4h-1v2h1V7zm0 4h-1v2h1v-2zM7 7h2v2H7V7zm8 10H9v-2h6v2zm-2-4H7v-2h6v2zm-6 4H5v-2h2v2zm6-12h-2V3h-2v2H9V3H7v2H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H5V7h14v12z"/></svg>
  ),
  domain: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>
  ),
  map: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="40" height="40" style={{minWidth: '40px'}}><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>
  ),
  people: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
  ),
  admin_panel_settings: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M17 11c.34 0 .67.04 1 .09V6.27L10.5 3 3 6.27v4.91c0 4.54 3.2 8.79 7.5 9.82.55-.13 1.08-.32 1.6-.55-.69-.98-1.1-2.17-1.1-3.45 0-3.31 2.69-6 6-6z"/><path d="M17 13c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 1.38c.62 0 1.12.51 1.12 1.12s-.51 1.12-1.12 1.12-1.12-.51-1.12-1.12.51-1.12 1.12-1.12zm0 5.37c-1.38 0-2.61-.7-3.33-1.76.02-.02.43-.88 3.33-.88s3.31.86 3.33.88c-.72 1.06-1.95 1.76-3.33 1.76z"/></svg>
  ),
};

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard',  icon: 'dashboard' },
  { id: 'branches',  label: 'Branches',   icon: 'branches' },
  { id: 'accounts',  label: 'Staff',      icon: 'accounts' },
  { id: 'users',     label: 'Users',      icon: 'users' },
  { id: 'analytics', label: 'Analytics',  icon: 'analytics' },
];

export default function AdminPanel() {
  const { currentUser, userClaims, logout } = useAuth();
  const navigate = useNavigate();

  const api = useCallback(async (url, options = {}) => {
    const idToken = await currentUser.getIdToken();
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...options.headers,
      },
    });
  }, [currentUser]);

  const [activeSection, setActiveSection] = useState('dashboard');
  const [searchQuery,   setSearchQuery]   = useState('');

  // ── Branches state ──────────────────────────────────────
  const [branches,       setBranches]       = useState([]);
  const [branchLoading,  setBranchLoading]  = useState(false);
  const [branchError,    setBranchError]    = useState('');
  const [branchSuccess,  setBranchSuccess]  = useState('');
  const [newBranchName,  setNewBranchName]  = useState('');
  const [newBranchType,  setNewBranchType]  = useState('barangay');
  const [creatingBranch, setCreatingBranch] = useState(false);

  // ── Staff account state ─────────────────────────────────
  const [staffEmail,    setStaffEmail]    = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffRole,     setStaffRole]     = useState('staff');
  const [staffBranchId, setStaffBranchId] = useState('');
  const [staffPerms,    setStaffPerms]    = useState([]);
  const [staffLoading,  setStaffLoading]  = useState(false);
  const [staffError,    setStaffError]    = useState('');
  const [staffSuccess,  setStaffSuccess]  = useState('');

  // ── Edit-staff state ────────────────────────────────────
  const [editingUser,  setEditingUser]  = useState(null);
  const [editRole,     setEditRole]     = useState('staff');
  const [editBranchId, setEditBranchId] = useState('');
  const [editPerms,    setEditPerms]    = useState([]);
  const [editLoading,  setEditLoading]  = useState(false);
  const [editError,    setEditError]    = useState('');
  const [editSuccess,  setEditSuccess]  = useState('');

  // ── Users state ─────────────────────────────────────────
  const [users,        setUsers]        = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError,   setUsersError]   = useState('');

  // ── UI state ────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadBranches = useCallback(async () => {
    setBranchLoading(true);
    setBranchError('');
    try {
      const res  = await api('/api/admin/branches');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load branches.');
      setBranches(data);
    } catch (err) {
      setBranchError(err.message);
    } finally {
      setBranchLoading(false);
    }
  }, [api]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const res  = await api('/api/admin/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load users.');
      setUsers(data);
    } catch (err) {
      setUsersError(err.message);
    } finally {
      setUsersLoading(false);
    }
  }, [api]);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  useEffect(() => {
    if (['dashboard', 'accounts', 'users', 'analytics'].includes(activeSection)) loadUsers();
  }, [activeSection, loadUsers]);

  const stats = useMemo(() => ({
    totalBranches:      branches.length,
    totalBarangays:     branches.filter((b) => b.type === 'barangay').length,
    totalBranchOffices: branches.filter((b) => b.type === 'branch').length,
    totalUsers:         users.length,
    totalStaff:         users.filter((u) => u.role === 'staff').length,
    totalAdmins:        users.filter((u) => u.role === 'admin').length,
    totalResidents:     users.filter((u) => u.role === 'resident').length,
  }), [branches, users]);

  // ── Handlers ────────────────────────────────────────────
  const handleCreateBranch = async (e) => {
    e.preventDefault();
    setBranchError('');
    setBranchSuccess('');
    setCreatingBranch(true);
    try {
      const res  = await api('/api/admin/branches', {
        method: 'POST',
        body: JSON.stringify({ name: newBranchName.trim(), type: newBranchType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create branch.');
      setBranchSuccess(`"${data.name}" created successfully.`);
      setNewBranchName('');
      setNewBranchType('barangay');
      setBranches((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      setBranchError(err.message);
    } finally {
      setCreatingBranch(false);
    }
  };

  const handleDeleteBranch = async (branch) => {
    if (!window.confirm(`Delete "${branch.name}"? Staff assigned here will retain their current claims until re-provisioned.`)) return;
    setBranchError('');
    try {
      const res = await api(`/api/admin/branches/${branch.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to delete branch.');
      }
      setBranches((prev) => prev.filter((b) => b.id !== branch.id));
    } catch (err) {
      setBranchError(err.message);
    }
  };

  const togglePerm     = (p) => setStaffPerms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  const toggleEditPerm = (p) => setEditPerms ((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);

  const handleEditStart = (user) => {
    setEditingUser(user);
    setEditRole(user.role);
    setEditBranchId(user.branchId || '');
    setEditPerms(user.permissions || []);
    setEditError('');
    setEditSuccess('');
  };

  const handleEditCancel = () => setEditingUser(null);

  const handleUpdateStaff = async (e) => {
    e.preventDefault();
    setEditError('');
    setEditSuccess('');
    setEditLoading(true);
    try {
      const res  = await api(`/api/admin/users/${editingUser.uid}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: editRole, branchId: editBranchId, permissions: editPerms }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update account.');
      const branch = branches.find((b) => b.id === editBranchId);
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === editingUser.uid
            ? { ...u, role: editRole, branchId: editBranchId, branchName: branch?.name || u.branchName, entityType: branch?.type || u.entityType, permissions: editPerms }
            : u
        )
      );
      setEditingUser(null);
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteUser = async (user) => {
    if (!window.confirm(`Permanently delete account for ${user.email}? This cannot be undone.`)) return;
    setUsersError('');
    try {
      const res = await api(`/api/admin/users/${user.uid}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to delete user.');
      }
      setUsers((prev) => prev.filter((u) => u.uid !== user.uid));
      if (editingUser?.uid === user.uid) setEditingUser(null);
    } catch (err) {
      setUsersError(err.message);
    }
  };

  const handleCreateStaff = async (e) => {
    e.preventDefault();
    setStaffError('');
    setStaffSuccess('');
    setStaffLoading(true);
    try {
      const res  = await api('/api/admin/create-staff', {
        method: 'POST',
        body: JSON.stringify({ email: staffEmail.trim(), password: staffPassword, role: staffRole, branchId: staffBranchId, permissions: staffPerms }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create account.');
      setStaffSuccess(`Account created for ${data.email} — ${data.role} at ${data.location}.`);
      setStaffEmail('');
      setStaffPassword('');
      setStaffRole('staff');
      setStaffBranchId('');
      setStaffPerms([]);
    } catch (err) {
      setStaffError(err.message);
    } finally {
      setStaffLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Search filtering
  const filteredUsers = useMemo(() => {
    if (!searchQuery) return users;
    const q = searchQuery.toLowerCase();
    return users.filter((u) =>
      u.email?.toLowerCase().includes(q) ||
      u.fullName?.toLowerCase().includes(q) ||
      u.role?.toLowerCase().includes(q)
    );
  }, [users, searchQuery]);

  const filteredBranches = useMemo(() => {
    if (!searchQuery) return branches;
    const q = searchQuery.toLowerCase();
    return branches.filter((b) => b.name?.toLowerCase().includes(q));
  }, [branches, searchQuery]);

  const initials    = (currentUser?.displayName || currentUser?.email || 'A')[0].toUpperCase();
  const displayName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Admin';
  const displayRole = userClaims?.role === 'admin' ? 'Chief Administrator' : (userClaims?.role || 'Staff');

  return (
    <div className="ap-shell">

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="ap-sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ════════════════════════════════════════
          SIDEBAR
      ════════════════════════════════════════ */}
      <aside className={`ap-sidebar${sidebarOpen ? ' ap-sidebar-mobile-open' : ''}`}>
        <div className="ap-sidebar-brand">
          <div className="ap-brand-icon">
            {ICONS.location_city}
          </div>
          <div>
            <div className="ap-brand-name">OneGapo</div>
            <div className="ap-brand-sub">City Admin Panel</div>
          </div>
        </div>

        <nav className="ap-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`ap-nav-item${activeSection === item.id ? ' ap-nav-item-active' : ''}`}
              onClick={() => { setActiveSection(item.id); setSidebarOpen(false); }}
            >
              <span className="ap-nav-icon">{ICONS[item.icon]}</span>
              <span>{item.label}</span>
            </button>
          ))}
          <Link to="/staff" className="ap-nav-item" onClick={() => setSidebarOpen(false)}>
            <span className="ap-nav-icon">{ICONS.report}</span>
            <span>Reports</span>
          </Link>
        </nav>

        <div className="ap-sidebar-footer">
          <Link to="/profile" className="ap-nav-item" onClick={() => setSidebarOpen(false)}>
            <span className="ap-nav-icon">{ICONS.settings}</span>
            <span>Settings</span>
          </Link>
          <button className="ap-nav-item ap-nav-signout" onClick={handleLogout}>
            <span className="ap-nav-icon">{ICONS.logout}</span>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* ════════════════════════════════════════
          MAIN AREA
      ════════════════════════════════════════ */}
      <div className="ap-main">

        {/* Sticky header */}
        <header className="ap-header">
          <div className="ap-header-left">
            <button
              className="ap-hamburger"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label="Toggle sidebar"
            >
              <span className="ap-hamburger-icon">{sidebarOpen ? ICONS.close : ICONS.menu}</span>
            </button>
            <div className="ap-search-wrap">
              <span className="ap-search-icon">{ICONS.search}</span>
              <input
                className="ap-search-input"
                type="text"
                placeholder="Search branches, users or areas…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="ap-header-right">
            <button className="ap-notif-btn" title="Notifications">
              {ICONS.notifications}
            </button>
            <div className="ap-header-divider" />
            <div className="ap-header-user">
              <div className="ap-header-user-info">
                <div className="ap-header-user-name">{displayName}</div>
                <div className="ap-header-user-role">{displayRole}</div>
              </div>
              <div className="ap-header-avatar">{initials}</div>
            </div>
          </div>
        </header>

        {/* Scrollable content */}
        <div className="ap-content">

          {/* ══════════════════════════════════════
              DASHBOARD
          ══════════════════════════════════════ */}
          {activeSection === 'dashboard' && (
            <div className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">City Overview</h2>
                  <p className="ap-section-sub">Real-time status of civic management and infrastructure</p>
                </div>
                <div className="ap-section-actions">
                  <button className="ap-btn-outline ap-btn-icon-left" onClick={() => setActiveSection('accounts')}>
                    {ICONS.accounts}
                    Manage Staff
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="ap-stats-grid">
                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-blue">
                      {ICONS.users}
                    </div>
                    <span className="ap-stat-badge ap-stat-badge-green">{stats.totalResidents} residents</span>
                  </div>
                  <p className="ap-stat-label">Total Users</p>
                  <h3 className="ap-stat-value">{usersLoading ? '…' : stats.totalUsers}</h3>
                  <p className="ap-stat-meta">{stats.totalStaff} staff · {stats.totalAdmins} admin{stats.totalAdmins !== 1 ? 's' : ''}</p>
                </div>

                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-amber">
                      {ICONS.branches}
                    </div>
                    <span className="ap-stat-badge ap-stat-badge-amber">{stats.totalBranchOffices} offices</span>
                  </div>
                  <p className="ap-stat-label">Total Branches</p>
                  <h3 className="ap-stat-value">{branchLoading ? '…' : stats.totalBranches}</h3>
                  <p className="ap-stat-meta">{stats.totalBarangays} barangay{stats.totalBarangays !== 1 ? 's' : ''}</p>
                </div>

                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-emerald">
                      {ICONS.badge}
                    </div>
                    <span className="ap-stat-badge ap-stat-badge-green">Active</span>
                  </div>
                  <p className="ap-stat-label">Staff Accounts</p>
                  <h3 className="ap-stat-value">{usersLoading ? '…' : stats.totalStaff}</h3>
                  <p className="ap-stat-meta">Across all branches</p>
                </div>

                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-purple">
                      {ICONS.domain}
                    </div>
                    <span className="ap-stat-badge ap-stat-badge-purple">{stats.totalBarangays} barangays</span>
                  </div>
                  <p className="ap-stat-label">Coverage</p>
                  <h3 className="ap-stat-value">{branchLoading ? '…' : stats.totalBranches}</h3>
                  <p className="ap-stat-meta">Olongapo City locations</p>
                </div>
              </div>

              {/* Heatmap */}
              <div className="ap-card">
                <div className="ap-card-header">
                  <div>
                    <h3 className="ap-card-title">Incident Heatmap</h3>
                    <p className="ap-card-sub">Geographic distribution of reported incidents in Olongapo City</p>
                  </div>
                  <div className="ap-heatmap-legend">
                    <span className="ap-legend-item">
                      <span className="ap-legend-dot ap-legend-red" /> High Density
                    </span>
                    <span className="ap-legend-item">
                      <span className="ap-legend-dot ap-legend-blue" /> Low Density
                    </span>
                  </div>
                </div>
                <div className="ap-heatmap">
                  <div className="ap-heatmap-placeholder">
                    <span className="ap-heatmap-icon">{ICONS.map}</span>
                    <p>Connect a reports API to populate live incident data</p>
                  </div>
                  <div className="ap-blob ap-blob-red-lg"  style={{ top: '25%',  left: '33%' }} />
                  <div className="ap-blob ap-blob-red-md"  style={{ top: '50%',  left: '50%' }} />
                  <div className="ap-blob ap-blob-blue-md" style={{ bottom: '25%', right: '25%' }} />
                  <div className="ap-pin ap-pin-red"  style={{ top: '25%',  left: '33%' }} />
                  <div className="ap-pin ap-pin-red"  style={{ top: '52%',  left: '48%' }} />
                  <div className="ap-pin ap-pin-blue" style={{ bottom: '25%', right: '25%' }} />
                  <div className="ap-heatmap-status">
                    <div className="ap-heatmap-status-row">
                      <span>Subic Bay Area</span>
                      <span className="ap-status-clear">Clear</span>
                    </div>
                    <div className="ap-heatmap-status-row">
                      <span>Barretto</span>
                      <span className="ap-status-moderate">Moderate</span>
                    </div>
                    <div className="ap-heatmap-status-row">
                      <span>Gordon Heights</span>
                      <span className="ap-status-high">High Risk</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent activity */}
              <div className="ap-card">
                <div className="ap-card-header">
                  <h3 className="ap-card-title">Recent Activity</h3>
                  <button className="ap-btn-outline ap-btn-sm" onClick={() => setActiveSection('users')}>
                    View all
                  </button>
                </div>
                {usersLoading ? (
                  <p className="ap-loading">Loading…</p>
                ) : users.length === 0 ? (
                  <p className="ap-empty">No users yet.</p>
                ) : (
                  <div className="ap-table-wrap">
                    <table className="ap-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Location / Branch</th>
                          <th>Role</th>
                          <th>Entity Type</th>
                          <th>Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.slice(0, 6).map((u) => (
                          <tr key={u.uid}>
                            <td>
                              <div className="ap-table-user">
                                <div className="ap-table-user-icon">
                                  {(u.fullName || u.email || '?')[0].toUpperCase()}
                                </div>
                                <span className="ap-table-user-name">{u.fullName || u.email}</span>
                              </div>
                            </td>
                            <td>{u.branchName || <span className="ap-muted">—</span>}</td>
                            <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                            <td>
                              {u.entityType
                                ? <span className={`badge badge-entity-${u.entityType}`}>{u.entityType}</span>
                                : <span className="ap-muted">—</span>}
                            </td>
                            <td className="ap-muted">{u.email}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Quick actions */}
              <div className="ap-card">
                <h3 className="ap-card-title">Quick Actions</h3>
                <div className="ap-quick-grid">
                  <button className="ap-quick-card" onClick={() => setActiveSection('branches')}>
                    <span className="ap-quick-icon">{ICONS.branches}</span>
                    <p className="ap-quick-title">Manage Branches</p>
                    <p className="ap-quick-body">{stats.totalBranches} location{stats.totalBranches !== 1 ? 's' : ''} registered</p>
                  </button>
                  <button className="ap-quick-card" onClick={() => setActiveSection('accounts')}>
                    <span className="ap-quick-icon">{ICONS.accounts}</span>
                    <p className="ap-quick-title">Create Staff Account</p>
                    <p className="ap-quick-body">Provision a new staff or admin account</p>
                  </button>
                  <button className="ap-quick-card" onClick={() => setActiveSection('users')}>
                    <span className="ap-quick-icon">{ICONS.users}</span>
                    <p className="ap-quick-title">View All Users</p>
                    <p className="ap-quick-body">{stats.totalUsers} registered user{stats.totalUsers !== 1 ? 's' : ''}</p>
                  </button>
                  <Link to="/staff" className="ap-quick-card">
                    <span className="ap-quick-icon">{ICONS.report}</span>
                    <p className="ap-quick-title">Reports Inbox</p>
                    <p className="ap-quick-body">Review and act on incoming citizen reports</p>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════
              BRANCHES
          ══════════════════════════════════════ */}
          {activeSection === 'branches' && (
            <div className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">Branches &amp; Barangays</h2>
                  <p className="ap-section-sub">Manage city branch offices and barangay locations</p>
                </div>
              </div>

              <div className="ap-card">
                <h3 className="ap-card-title">Add New Location</h3>
                {branchError   && <div role="alert"  className="auth-error">{branchError}</div>}
                {branchSuccess && <div role="status" className="auth-success">{branchSuccess}</div>}
                <form onSubmit={handleCreateBranch} className="ap-form" noValidate>
                  <div className="ap-form-row">
                    <div style={{ flex: '1' }}>
                      <label htmlFor="branch-name" className="form-label">Name</label>
                      <input
                        id="branch-name"
                        type="text"
                        required
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        className="form-input"
                        placeholder="e.g. Barangay Poblacion"
                        disabled={creatingBranch}
                      />
                    </div>
                    <div>
                      <label htmlFor="branch-type" className="form-label">Type</label>
                      <select
                        id="branch-type"
                        value={newBranchType}
                        onChange={(e) => setNewBranchType(e.target.value)}
                        className="form-select"
                        disabled={creatingBranch}
                      >
                        <option value="barangay">Barangay</option>
                        <option value="branch">Branch Office</option>
                      </select>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={creatingBranch || !newBranchName.trim()}
                    className="ap-btn-primary"
                  >
                    {creatingBranch ? 'Creating…' : 'Create Location'}
                  </button>
                </form>
              </div>

              <div className="ap-card">
                <div className="ap-card-header">
                  <h3 className="ap-card-title">All Locations ({branches.length})</h3>
                  <button onClick={loadBranches} disabled={branchLoading} className="ap-btn-outline ap-btn-sm">
                    {branchLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
                {branchLoading ? (
                  <p className="ap-loading">Loading…</p>
                ) : filteredBranches.length === 0 ? (
                  <p className="ap-empty">{searchQuery ? 'No matching branches.' : 'No branches yet.'}</p>
                ) : (
                  <div className="ap-table-wrap">
                    <table className="ap-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Staff Assigned</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBranches.map((b) => {
                          const count = users.filter((u) => u.branchId === b.id).length;
                          return (
                            <tr key={b.id}>
                              <td>{b.name}</td>
                              <td><span className={`badge badge-entity-${b.type}`}>{b.type}</span></td>
                              <td>{count > 0 ? count : <span className="ap-muted">None</span>}</td>
                              <td className="ap-table-actions">
                                <button onClick={() => handleDeleteBranch(b)} className="ap-btn-danger ap-btn-sm">
                                  Delete
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════
              STAFF ACCOUNTS
          ══════════════════════════════════════ */}
          {activeSection === 'accounts' && (
            <div className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">Staff Accounts</h2>
                  <p className="ap-section-sub">Provision and manage staff and admin accounts</p>
                </div>
              </div>

              <div className="ap-card">
                <h3 className="ap-card-title">Create Staff / Admin Account</h3>
                <p className="ap-card-desc">
                  Staff and admin accounts are provisioned here — there is no public sign-up.
                  Each account is tagged to a branch and carries granular permissions.
                </p>
                {staffError   && <div role="alert"  className="auth-error">{staffError}</div>}
                {staffSuccess && <div role="status" className="auth-success">{staffSuccess}</div>}
                <form onSubmit={handleCreateStaff} className="ap-form" noValidate>
                  <div className="ap-form-row">
                    <div style={{ flex: '1' }}>
                      <label htmlFor="adm-email" className="form-label">Email address</label>
                      <input
                        id="adm-email"
                        type="email"
                        required
                        value={staffEmail}
                        onChange={(e) => setStaffEmail(e.target.value)}
                        className="form-input"
                        placeholder="staff@onegapo.gov.ph"
                        disabled={staffLoading}
                      />
                    </div>
                    <div style={{ flex: '1' }}>
                      <label htmlFor="adm-password" className="form-label">Temporary password</label>
                      <input
                        id="adm-password"
                        type="password"
                        required
                        minLength={8}
                        value={staffPassword}
                        onChange={(e) => setStaffPassword(e.target.value)}
                        className="form-input"
                        placeholder="At least 8 characters"
                        disabled={staffLoading}
                      />
                    </div>
                  </div>
                  <div className="ap-form-row">
                    <div>
                      <label htmlFor="adm-role" className="form-label">Role</label>
                      <select
                        id="adm-role"
                        value={staffRole}
                        onChange={(e) => setStaffRole(e.target.value)}
                        className="form-select"
                        disabled={staffLoading}
                      >
                        <option value="staff">Staff</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <div style={{ flex: '1' }}>
                      <label htmlFor="adm-branch" className="form-label">Assigned branch</label>
                      <select
                        id="adm-branch"
                        value={staffBranchId}
                        onChange={(e) => setStaffBranchId(e.target.value)}
                        className="form-select"
                        required
                        disabled={staffLoading || branches.length === 0}
                      >
                        <option value="">— Select a branch —</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name} ({b.type})</option>
                        ))}
                      </select>
                      {branches.length === 0 && (
                        <p className="ap-field-hint">Create a branch first in the Branches tab.</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="form-label" style={{ marginBottom: '0.5rem' }}>Permissions</p>
                    <div className="ap-perms-grid">
                      {PERMISSION_OPTIONS.map((opt) => (
                        <label key={opt.value} className="ap-perm-item">
                          <input
                            type="checkbox"
                            checked={staffPerms.includes(opt.value)}
                            onChange={() => togglePerm(opt.value)}
                            disabled={staffLoading}
                            className="ap-perm-check"
                          />
                          <span>{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={staffLoading || !staffEmail || !staffPassword || !staffBranchId}
                    className="ap-btn-primary"
                  >
                    {staffLoading ? 'Creating account…' : 'Create account'}
                  </button>
                </form>
              </div>

              {editingUser && (
                <div className="ap-card ap-card-editing">
                  <div className="ap-card-header">
                    <h3 className="ap-card-title">Edit Account — {editingUser.email}</h3>
                    <button onClick={handleEditCancel} className="ap-btn-outline ap-btn-sm">Cancel</button>
                  </div>
                  {editError   && <div role="alert"  className="auth-error">{editError}</div>}
                  {editSuccess && <div role="status" className="auth-success">{editSuccess}</div>}
                  <form onSubmit={handleUpdateStaff} className="ap-form" noValidate>
                    <div className="ap-form-row">
                      <div>
                        <label htmlFor="edit-role" className="form-label">Role</label>
                        <select
                          id="edit-role"
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value)}
                          className="form-select"
                          disabled={editLoading}
                        >
                          <option value="staff">Staff</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div style={{ flex: '1' }}>
                        <label htmlFor="edit-branch" className="form-label">Assigned branch</label>
                        <select
                          id="edit-branch"
                          value={editBranchId}
                          onChange={(e) => setEditBranchId(e.target.value)}
                          className="form-select"
                          required
                          disabled={editLoading || branches.length === 0}
                        >
                          <option value="">— Select a branch —</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>{b.name} ({b.type})</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <p className="form-label" style={{ marginBottom: '0.5rem' }}>Permissions</p>
                      <div className="ap-perms-grid">
                        {PERMISSION_OPTIONS.map((opt) => (
                          <label key={opt.value} className="ap-perm-item">
                            <input
                              type="checkbox"
                              checked={editPerms.includes(opt.value)}
                              onChange={() => toggleEditPerm(opt.value)}
                              disabled={editLoading}
                              className="ap-perm-check"
                            />
                            <span>{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <button
                        type="submit"
                        disabled={editLoading || !editBranchId}
                        className="ap-btn-primary"
                        style={{ width: 'auto', padding: '0.5rem 1.25rem' }}
                      >
                        {editLoading ? 'Saving…' : 'Save changes'}
                      </button>
                      <button type="button" onClick={handleEditCancel} className="ap-btn-outline">Cancel</button>
                    </div>
                  </form>
                </div>
              )}

              <div className="ap-card">
                <div className="ap-card-header">
                  <h3 className="ap-card-title">Existing Staff &amp; Admins</h3>
                  <button onClick={loadUsers} disabled={usersLoading} className="ap-btn-outline ap-btn-sm">
                    {usersLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
                {(() => {
                  const staffList = users.filter((u) => u.role === 'staff' || u.role === 'admin');
                  if (usersLoading) return <p className="ap-loading">Loading…</p>;
                  if (staffList.length === 0) return <p className="ap-empty">No staff or admin accounts yet.</p>;
                  return (
                    <div className="ap-table-wrap">
                      <table className="ap-table">
                        <thead>
                          <tr>
                            <th>Email</th>
                            <th>Role</th>
                            <th>Branch / Location</th>
                            <th>Permissions</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {staffList.map((u) => (
                            <tr key={u.uid}>
                              <td>{u.email}</td>
                              <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                              <td>
                                {u.branchName
                                  ? <>{u.branchName} {u.entityType && <span className={`badge badge-entity-${u.entityType} ml-1`}>{u.entityType}</span>}</>
                                  : <span className="ap-muted">—</span>}
                              </td>
                              <td>
                                {u.permissions?.length
                                  ? u.permissions.map((p) => (
                                      <span key={p} className="ap-perm-badge">{p.replace(/_/g, ' ')}</span>
                                    ))
                                  : <span className="ap-muted">—</span>}
                              </td>
                              <td className="ap-table-actions">
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                  <button onClick={() => handleEditStart(u)} className="ap-btn-outline ap-btn-sm">Edit</button>
                                  <button onClick={() => handleDeleteUser(u)} className="ap-btn-danger ap-btn-sm">Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════
              ALL USERS
          ══════════════════════════════════════ */}
          {activeSection === 'users' && (
            <div className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">All Users</h2>
                  <p className="ap-section-sub">
                    {stats.totalUsers} registered user{stats.totalUsers !== 1 ? 's' : ''} — residents, staff, and admins
                  </p>
                </div>
                <button onClick={loadUsers} disabled={usersLoading} className="ap-btn-outline ap-btn-sm">
                  {usersLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>

              {usersError && <div role="alert" className="auth-error">{usersError}</div>}

              <div className="ap-card">
                {usersLoading ? (
                  <p className="ap-loading">Loading…</p>
                ) : filteredUsers.length === 0 ? (
                  <p className="ap-empty">{searchQuery ? 'No matching users.' : 'No users found.'}</p>
                ) : (
                  <div className="ap-table-wrap">
                    <table className="ap-table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Full name</th>
                          <th>Role</th>
                          <th>Branch</th>
                          <th>Permissions</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((u) => (
                          <tr key={u.uid}>
                            <td>{u.email}</td>
                            <td>{u.fullName || <span className="ap-muted">—</span>}</td>
                            <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                            <td>
                              {u.branchName
                                ? <>{u.branchName} {u.entityType && <span className={`badge badge-entity-${u.entityType} ml-1`}>{u.entityType}</span>}</>
                                : <span className="ap-muted">—</span>}
                            </td>
                            <td>
                              {u.permissions?.length
                                ? u.permissions.map((p) => (
                                    <span key={p} className="ap-perm-badge">{p.replace(/_/g, ' ')}</span>
                                  ))
                                : <span className="ap-muted">—</span>}
                            </td>
                            <td className="ap-table-actions">
                              {u.role !== 'admin' && (
                                <button onClick={() => handleDeleteUser(u)} className="ap-btn-danger ap-btn-sm">
                                  Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════
              ANALYTICS
          ══════════════════════════════════════ */}
          {activeSection === 'analytics' && (
            <div className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">Analytics</h2>
                  <p className="ap-section-sub">System-wide statistics and breakdowns</p>
                </div>
              </div>

              <div className="ap-stats-grid">
                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-blue">
                      {ICONS.people}
                    </div>
                  </div>
                  <p className="ap-stat-label">Total Residents</p>
                  <h3 className="ap-stat-value">{stats.totalResidents}</h3>
                  <p className="ap-stat-meta">Registered citizens</p>
                </div>

                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-purple">
                      {ICONS.badge}
                    </div>
                  </div>
                  <p className="ap-stat-label">Staff Members</p>
                  <h3 className="ap-stat-value">{stats.totalStaff}</h3>
                  <p className="ap-stat-meta">Active personnel</p>
                </div>

                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-amber">
                      {ICONS.admin_panel_settings}
                    </div>
                  </div>
                  <p className="ap-stat-label">Administrators</p>
                  <h3 className="ap-stat-value">{stats.totalAdmins}</h3>
                  <p className="ap-stat-meta">System admins</p>
                </div>

                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-emerald">
                      {ICONS.branches}
                    </div>
                  </div>
                  <p className="ap-stat-label">Locations</p>
                  <h3 className="ap-stat-value">{stats.totalBranches}</h3>
                  <p className="ap-stat-meta">{stats.totalBarangays} barangays · {stats.totalBranchOffices} offices</p>
                </div>
              </div>

              <div className="ap-card">
                <h3 className="ap-card-title">Branch Breakdown</h3>
                {branchLoading ? (
                  <p className="ap-loading">Loading…</p>
                ) : branches.length === 0 ? (
                  <p className="ap-empty">No branches to display.</p>
                ) : (
                  <div className="ap-table-wrap">
                    <table className="ap-table">
                      <thead>
                        <tr>
                          <th>Branch / Barangay</th>
                          <th>Type</th>
                          <th>Staff Assigned</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map((b) => {
                          const count = users.filter((u) => u.branchId === b.id).length;
                          return (
                            <tr key={b.id}>
                              <td>{b.name}</td>
                              <td><span className={`badge badge-entity-${b.type}`}>{b.type}</span></td>
                              <td>{count > 0 ? count : <span className="ap-muted">None</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>{/* end ap-content */}

        <footer className="ap-footer">
          © {new Date().getFullYear()} OneGapo City Management System. All rights reserved. Olongapo City Admin Office.
        </footer>
      </div>{/* end ap-main */}
    </div>
  );
}
