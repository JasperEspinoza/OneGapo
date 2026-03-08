import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { currentUser, userClaims } = useAuth();
  const role        = userClaims?.role;
  const displayName = currentUser?.displayName || currentUser?.email;

  return (
    <main className="dashboard-container">
      <div>
        <h1 className="dashboard-welcome">Welcome back, {displayName}!</h1>
        <div className="dashboard-meta">
          {role && <span className={`badge badge-${role}`}>{role}</span>}
          {userClaims?.location && (
            <>
              <span className="text-gray-300">·</span>
              <span>{userClaims.location}</span>
            </>
          )}
        </div>
      </div>

      <div className="dashboard-cards">
        {role === 'resident' && (
          <>
            <div className="dashboard-card">
              <p className="dashboard-card-title">Submit a Report</p>
              <p className="dashboard-card-body">
                Report an incident, infrastructure issue, or safety concern in your barangay.
              </p>
            </div>
            <div className="dashboard-card">
              <p className="dashboard-card-title">My Reports</p>
              <p className="dashboard-card-body">
                Track the status of reports you have previously submitted.
              </p>
            </div>
          </>
        )}

        {(role === 'staff' || role === 'admin') && (
          <div className="dashboard-card">
            <p className="dashboard-card-title">Manage Reports</p>
            <p className="dashboard-card-body">
              Review and act on incoming citizen reports for{' '}
              <strong>{userClaims?.location || 'your assigned area'}</strong>.
            </p>
          </div>
        )}

        {role === 'admin' && (
          <div className="dashboard-card">
            <p className="dashboard-card-title">User Management</p>
            <p className="dashboard-card-body">
              Provision new staff and admin accounts with barangay assignments.
            </p>
          </div>
        )}

        <div className="dashboard-card">
          <p className="dashboard-card-title">My Profile</p>
          <p className="dashboard-card-body">
            Update your display name and account settings.
          </p>
        </div>
      </div>
    </main>
  );
}
