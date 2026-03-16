import './StaffPanel.css';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

const PERMISSION_LABELS = {
  view_reports:         'View reports',
  update_reports:       'Update status',
  close_reports:        'Resolve reports',
  create_announcements: 'Post announcements',
};

export default function StaffPanel() {
  const { currentUser, userClaims } = useAuth();
  const isAdmin = userClaims?.role === 'admin';
  const permissions = Array.isArray(userClaims?.permissions) ? userClaims.permissions : [];
  const effectivePermissions = isAdmin ? Object.keys(PERMISSION_LABELS) : permissions;
  const location    = isAdmin ? 'All branches' : (userClaims?.location || 'Unassigned');

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

  // ── Branch staff management ─────────────────────────────
  const [branchStaff,   setBranchStaff]   = useState([]);
  const [staffLoading,  setStaffLoading]  = useState(false);
  const [staffError,    setStaffError]    = useState('');
  const [newEmail,      setNewEmail]      = useState('');
  const [creating,      setCreating]      = useState(false);
  const [createError,   setCreateError]   = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [roles,         setRoles]         = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');

  const loadBranchStaff = useCallback(async () => {
    if (!userClaims?.branchId) return;
    setStaffLoading(true);
    setStaffError('');
    try {
      const res = await api('/api/admin/branch-staff');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load branch staff.');
      setBranchStaff(data);
    } catch (err) {
      setStaffError(err.message);
    } finally {
      setStaffLoading(false);
    }
  }, [api, userClaims?.branchId]);

  const loadRoles = useCallback(async () => {
    try {
      const res = await api('/api/admin/roles');
      const data = await res.json();
      if (res.ok) setRoles(data);
    } catch {
      // roles are optional, ignore errors
    }
  }, [api]);

  useEffect(() => {
    loadBranchStaff();
    loadRoles();
  }, [loadBranchStaff, loadRoles]);

  const handleCreateBranchStaff = async (e) => {
    e.preventDefault();
    setCreateError('');
    setCreateSuccess('');
    setCreating(true);
    try {
      const res = await api('/api/admin/branch-staff', {
        method: 'POST',
        body: JSON.stringify({ email: newEmail.trim(), customRoleId: selectedRoleId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create staff.');
      setCreateSuccess(data.message || `Staff account created for ${data.email}. Verification and password setup emails sent via Brevo.`);
      setNewEmail('');
      setSelectedRoleId('');
      loadBranchStaff();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="app-page">
      <div className="staff-container app-page-inner">
        <header className="staff-page-header">
          <div>
            <h1 className="page-title">Reports</h1>
            <p className="staff-page-subtitle">
              Review your branch coverage, team access, and the reporting tools available to your account.
            </p>
          </div>
          <div className="staff-page-meta">
            <span className={`badge badge-${userClaims?.role}`}>{userClaims?.role || 'staff'}</span>
            <span className="staff-page-location">{location}</span>
          </div>
        </header>

      {/* Access summary card */}
      <div className="staff-access-card">
        <h2 className="staff-access-title">Your Access</h2>
        <div className="staff-access-rows">
          <div className="staff-access-row">
            <span className="staff-access-label">Assigned Area</span>
            <span className="staff-access-value">
              <span className="staff-area-name">{location}</span>
              {userClaims?.entityType && (
                <span className={`badge badge-entity-${userClaims.entityType} staff-entity-badge`}>
                  {userClaims.entityType}
                </span>
              )}
            </span>
          </div>

          <div className="staff-access-row">
            <span className="staff-access-label">Role</span>
            <span className="staff-access-value">
              <span className={`badge badge-${userClaims?.role}`}>{userClaims?.role}</span>
            </span>
          </div>

          <div className="staff-access-row">
            <span className="staff-access-label">Permissions</span>
            <span className="staff-access-value">
              {effectivePermissions.length > 0
                ? effectivePermissions.map((p) => (
                    <span key={p} className="staff-perm-badge">
                      {PERMISSION_LABELS[p] || p.replace(/_/g, ' ')}
                    </span>
                  ))
                : <span className="staff-empty-text">None assigned</span>
              }
            </span>
          </div>
        </div>
      </div>

      {/* Create staff within branch */}
      {userClaims?.branchId && (
        <div className="staff-access-card staff-section-card">
          <h2 className="staff-access-title">Add Staff to {userClaims?.location || 'Your Branch'}</h2>
          <p className="staff-help-text">
            Create a new staff account assigned to your branch. Verification and password setup emails are sent via Brevo.
          </p>
          {createError   && <div className="auth-error" role="alert">{createError}</div>}
          {createSuccess && <div className="auth-success" role="status">{createSuccess}</div>}
          <form onSubmit={handleCreateBranchStaff} className="staff-create-form">
            <div>
              <label htmlFor="branch-staff-email" className="form-label">Email address</label>
              <input
                id="branch-staff-email"
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="form-input"
                placeholder="newstaff@onegapo.gov.ph"
                disabled={creating}
              />
            </div>
            {roles.length > 0 && (
              <div>
                <label htmlFor="branch-staff-role" className="form-label">Assigned Role (optional)</label>
                <select
                  id="branch-staff-role"
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                  className="form-select"
                  disabled={creating}
                >
                  <option value="">— No role —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="submit"
              disabled={creating || !newEmail.trim()}
              className="btn-primary staff-submit-btn"
            >
              {creating ? 'Creating…' : 'Create Staff Account'}
            </button>
          </form>
        </div>
      )}

      {/* Branch staff list */}
      {userClaims?.branchId && (
        <div className="staff-access-card staff-section-card">
          <div className="staff-list-header">
            <h2 className="staff-access-title staff-list-title">Staff in Your Branch ({branchStaff.length})</h2>
            <button onClick={loadBranchStaff} disabled={staffLoading} className="btn-outline btn-sm staff-refresh-btn">
              {staffLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {staffError && <div className="auth-error" role="alert">{staffError}</div>}
          {staffLoading ? (
            <p className="staff-status-text">Loading…</p>
          ) : branchStaff.length === 0 ? (
            <p className="staff-status-text">No staff in this branch yet.</p>
          ) : (
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Assigned Role</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {branchStaff.map((s) => (
                    <tr key={s.uid}>
                      <td>{s.email}</td>
                      <td>{s.fullName || <span className="staff-missing-value">—</span>}</td>
                      <td>{s.customRoleName || <span className="staff-missing-value">—</span>}</td>
                      <td>
                        <span className={`badge ${s.verified ? 'badge-verified' : 'badge-unverified'}`}>
                          {s.verified ? 'Verified' : 'Unverified'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Feature area — gated by permissions */}
      <div className="staff-features">
        {(isAdmin || effectivePermissions.includes('view_reports') || effectivePermissions.includes('update_reports') || effectivePermissions.includes('close_reports')) && (
          <div className="staff-feature-card">
            <p className="staff-feature-title">Reports Inbox</p>
            <p className="staff-feature-body">
              Review and act on citizen reports submitted for your area.
            </p>
          </div>
        )}

        {userClaims?.branchId && (
          <div className="staff-feature-card">
            <p className="staff-feature-title">Branch Coverage</p>
            <p className="staff-feature-body">
              You are currently assigned to <strong>{location}</strong>, and any staff you create here will inherit that branch scope.
            </p>
          </div>
        )}

        {(isAdmin || effectivePermissions.includes('create_announcements')) && (
          <div className="staff-feature-card">
            <p className="staff-feature-title">Announcements</p>
            <p className="staff-feature-body">
              Broadcast updates and notices to residents in your coverage area.
            </p>
          </div>
        )}

        {!isAdmin && effectivePermissions.length === 0 && (
          <div className="staff-feature-card">
            <p className="staff-feature-title staff-feature-title-muted">No tools available</p>
            <p className="staff-feature-body">
              Your account has no active permissions. Please contact an administrator.
            </p>
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
