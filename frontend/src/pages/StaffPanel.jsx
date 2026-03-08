import { useAuth } from '../context/AuthContext';

const PERMISSION_LABELS = {
  view_reports:         'View reports',
  update_reports:       'Update status',
  close_reports:        'Resolve reports',
  create_announcements: 'Post announcements',
};

export default function StaffPanel() {
  const { userClaims } = useAuth();
  const permissions = Array.isArray(userClaims?.permissions) ? userClaims.permissions : [];
  const location    = userClaims?.location || 'Unassigned';

  return (
    <main className="staff-container">
      <h1 className="page-title">Staff Dashboard</h1>

      {/* Access summary card */}
      <div className="staff-access-card">
        <h2 className="staff-access-title">Your Access</h2>
        <div className="staff-access-rows">
          <div className="staff-access-row">
            <span className="staff-access-label">Assigned Area</span>
            <span className="staff-access-value">
              <span className="font-semibold">{location}</span>
              {userClaims?.entityType && (
                <span className={`badge badge-entity-${userClaims.entityType} ml-2`}>
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
              {permissions.length > 0
                ? permissions.map((p) => (
                    <span key={p} className="staff-perm-badge">
                      {PERMISSION_LABELS[p] || p.replace(/_/g, ' ')}
                    </span>
                  ))
                : <span className="text-gray-400 italic">None assigned</span>
              }
            </span>
          </div>
        </div>
      </div>

      {/* Feature area — gated by permissions */}
      <div className="staff-features">
        {(permissions.includes('view_reports') || permissions.includes('update_reports') || permissions.includes('close_reports')) && (
          <div className="dashboard-card">
            <p className="dashboard-card-title">Reports Inbox</p>
            <p className="dashboard-card-body">
              Review and act on citizen reports submitted for your area.
            </p>
          </div>
        )}

        {permissions.includes('create_announcements') && (
          <div className="dashboard-card">
            <p className="dashboard-card-title">Announcements</p>
            <p className="dashboard-card-body">
              Broadcast updates and notices to residents in your coverage area.
            </p>
          </div>
        )}

        {permissions.length === 0 && (
          <div className="dashboard-card">
            <p className="dashboard-card-title text-gray-400">No tools available</p>
            <p className="dashboard-card-body">
              Your account has no active permissions. Please contact an administrator.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
