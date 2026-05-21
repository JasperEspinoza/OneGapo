import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OneGapoLogo from '../components/OneGapoLogo';
import AppModal from '../components/AppModal';
import './ResponderPanel.css';

function getStatusLabel(status) {
  if (!status) return '—';
  const mapping = {
    submitted: 'Submitted',
    in_progress: 'In Progress',
    in_review: 'In Review',
    resolved: 'Resolved',
    rejected: 'Rejected',
    archived: 'Archived',
  };
  return mapping[status.toLowerCase()] || status;
}

function getStatusClass(status) {
  if (!status) return 'badge';
  const st = status.toLowerCase();
  if (st === 'resolved') return 'badge badge-success';
  if (st === 'rejected' || st === 'archived') return 'badge badge-danger';
  if (st === 'in_progress' || st === 'in_review') return 'badge badge-warning';
  return 'badge badge-info';
}

function getCategoryLabel(cat) {
  if (!cat) return '—';
  const mapping = {
    infrastructure: 'Infrastructure',
    safety: 'Public Safety',
    sanitation: 'Sanitation',
    disaster: 'Disaster / Emergency',
    general: 'General Concern'
  };
  return mapping[cat.toLowerCase()] || cat;
}

export default function ResponderPanel() {
  const { currentUser, logout, userClaims } = useAuth();
  const navigate = useNavigate();

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedReport, setSelectedReport] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState('');
  
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolutionPhotos, setResolutionPhotos] = useState([]);

  const api = useCallback(async (url, options = {}) => {
    const token = await currentUser?.getIdToken?.();
    const headers = { ...options.headers };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return fetch(url, { ...options, headers });
  }, [currentUser]);

  const loadReports = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api('/api/reports');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load reports');
      
      // The backend should only return reports assigned to the responder and not archived
      // as per our previous updates to reportController.js
      setReports(data.reports || []);
    } catch (err) {
      setError(err.message || 'Error loading reports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleStatusUpdate = async (status) => {
    if (!selectedReport) return;
    const reportId = selectedReport.id;
    
    if (status === 'resolved' && resolutionPhotos.length === 0) {
      setStatusError('A resolution photo is required to resolve a report.');
      return;
    }

    setUpdatingStatus(true);
    setStatusError('');

    try {
      let res;
      if (status === 'resolved' && resolutionPhotos.length > 0) {
        const formData = new FormData();
        formData.append('status', status);
        if (resolutionNote) formData.append('progressNote', resolutionNote);
        resolutionPhotos.forEach((file) => formData.append('resolutionPhotos', file));
        res = await api(`/api/reports/${reportId}/status`, { method: 'PATCH', body: formData });
      } else {
        const payload = { status, ...(resolutionNote ? { progressNote: resolutionNote } : {}) };
        res = await api(`/api/reports/${reportId}/status`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update report status.');

      const updatedReport = data?.report || {};
      setReports((prev) => prev.map((r) => (r.id === reportId ? { ...r, ...updatedReport } : r)));
      setSelectedReport((prev) => ({ ...prev, ...updatedReport }));
      
      if (status === 'resolved') {
        setSelectedReport(null); // Close modal on resolve
      }
      
      setResolutionNote('');
      setResolutionPhotos([]);
    } catch (err) {
      setStatusError(err.message || 'Failed to update report status.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handlePhotoChange = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setResolutionPhotos(files);
  };

  const activeReports = reports.filter(r => r.status !== 'resolved' && r.status !== 'rejected');
  const pastReports = reports.filter(r => r.status === 'resolved' || r.status === 'rejected');

  return (
    <div className="responder-shell">
      <header className="responder-topbar">
        <div className="responder-brand-wrap">
          <OneGapoLogo className="responder-brand-logo" />
          <h1 className="responder-brand">Responder Panel</h1>
        </div>
        <div className="responder-user-info">
          <span className="responder-user-name">{currentUser?.displayName || currentUser?.email}</span>
          <button type="button" className="ap-btn-outline ap-btn-sm" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <main className="responder-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 className="responder-section-title" style={{ margin: 0 }}>Assigned Reports</h2>
          <button type="button" className="ap-btn-outline ap-btn-sm" onClick={loadReports} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error ? <div className="auth-error" role="alert" style={{ marginBottom: '1rem' }}>{error}</div> : null}

        {loading ? (
          <p>Loading reports...</p>
        ) : activeReports.length === 0 ? (
          <p>No active reports assigned to you.</p>
        ) : (
          <div className="responder-report-list">
            {activeReports.map((report) => (
              <article 
                key={report.id} 
                className="responder-report-card" 
                onClick={() => {
                  setSelectedReport(report);
                  setResolutionNote('');
                  setResolutionPhotos([]);
                  setStatusError('');
                }}
              >
                <div className="responder-report-head">
                  <h3 className="responder-report-title">{report.title}</h3>
                  <div className="responder-report-badges">
                    <span className={getStatusClass(report.status)}>{getStatusLabel(report.status)}</span>
                  </div>
                </div>
                <p className="responder-report-desc">{report.description}</p>
                <div className="responder-report-meta">
                  <span className="material-symbols-outlined">location_on</span>
                  <span>{report?.location?.address || 'Location unlisted'}</span>
                </div>
                <div className="responder-report-meta">
                  <span className="material-symbols-outlined">schedule</span>
                  <span>{report.createdAt ? new Date(report.createdAt).toLocaleString() : '—'}</span>
                </div>
              </article>
            ))}
          </div>
        )}

        {pastReports.length > 0 && (
          <>
            <h2 className="responder-section-title" style={{ marginTop: '3rem' }}>Past Assignments</h2>
            <div className="responder-report-list">
              {pastReports.map((report) => (
                <article 
                  key={report.id} 
                  className="responder-report-card" 
                  onClick={() => setSelectedReport(report)}
                >
                  <div className="responder-report-head">
                    <h3 className="responder-report-title">{report.title}</h3>
                    <div className="responder-report-badges">
                      <span className={getStatusClass(report.status)}>{getStatusLabel(report.status)}</span>
                    </div>
                  </div>
                  <p className="responder-report-desc">{report.description}</p>
                  <div className="responder-report-meta">
                    <span className="material-symbols-outlined">schedule</span>
                    <span>{report.createdAt ? new Date(report.createdAt).toLocaleString() : '—'}</span>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </main>

      {selectedReport && (
        <AppModal
          title={selectedReport.title || 'Report Details'}
          titleId="responder-report-modal-title"
          size="wide"
          onClose={() => setSelectedReport(null)}
        >
          <div className="responder-details-grid">
            <div className="responder-details-row"><span>Status</span><strong>{getStatusLabel(selectedReport.status)}</strong></div>
            <div className="responder-details-row"><span>Category</span><strong>{getCategoryLabel(selectedReport.category)}</strong></div>
            <div className="responder-details-row"><span>Address</span><strong>{selectedReport?.location?.address || '—'}</strong></div>
            <div className="responder-details-row"><span>Created</span><strong>{selectedReport.createdAt ? new Date(selectedReport.createdAt).toLocaleString() : '—'}</strong></div>
          </div>

          <div className="responder-details-description">
            <p className="form-label" style={{ marginBottom: '0.5rem' }}>Description</p>
            <p>{selectedReport.description || '—'}</p>
          </div>

          {selectedReport.status !== 'resolved' && selectedReport.status !== 'rejected' && (
            <div className="responder-status-update">
              <p className="form-label">Update Status</p>
              
              {statusError ? <div className="auth-error" style={{ marginBottom: '1rem' }}>{statusError}</div> : null}
              
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="resolution-note" className="form-label" style={{ fontSize: '0.875rem' }}>Resolution Note (Optional)</label>
                <textarea
                  id="resolution-note"
                  className="form-input"
                  rows={2}
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="Add details about the resolution or progress..."
                  disabled={updatingStatus}
                />
              </div>

              <div className="responder-photo-upload" style={{ marginBottom: '1.5rem' }}>
                <label htmlFor="resolution-photo" className="form-label" style={{ fontSize: '0.875rem' }}>
                  Resolution Photo <span style={{ color: 'var(--color-danger)' }}>*Required to Resolve</span>
                </label>
                <input
                  id="resolution-photo"
                  type="file"
                  accept="image/jpeg, image/png, image/webp"
                  multiple
                  onChange={handlePhotoChange}
                  className="form-input"
                  disabled={updatingStatus}
                />
                {resolutionPhotos.length > 0 && (
                  <div className="responder-photo-preview">
                    {resolutionPhotos.map((f, i) => (
                      <span key={i} className="badge">{f.name}</span>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                {selectedReport.status !== 'in_progress' && (
                  <button
                    type="button"
                    className="ap-btn-outline"
                    onClick={() => handleStatusUpdate('in_progress')}
                    disabled={updatingStatus}
                  >
                    Mark as In Progress
                  </button>
                )}
                <button
                  type="button"
                  className="ap-btn"
                  onClick={() => handleStatusUpdate('resolved')}
                  disabled={updatingStatus || resolutionPhotos.length === 0}
                >
                  {updatingStatus ? 'Saving...' : 'Resolve Report'}
                </button>
              </div>
            </div>
          )}

        </AppModal>
      )}
    </div>
  );
}
