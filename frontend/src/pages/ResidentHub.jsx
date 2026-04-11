import './ResidentHub.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettingsModal } from '../context/SettingsModalContext';
import ReportLocationMap from '../components/ReportLocationMap';
import AppModal from '../components/AppModal';

const REPORT_CATEGORIES = [
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'safety', label: 'Public Safety' },
  { value: 'sanitation', label: 'Sanitation' },
  { value: 'disaster', label: 'Disaster / Emergency' },
  { value: 'general', label: 'General Concern' },
];

const INITIAL_FORM = {
  title: '',
  description: '',
  category: 'general',
  latitude: '',
  longitude: '',
  address: '',
};

const RESIDENT_REPORTS_SYNC_INTERVAL_MS = 8000;

function formatReportDate(value) {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleString();
}

function normalizeStatus(status) {
  return String(status || 'submitted').replace('_', ' ');
}


function getMediaUrl(media) {
  if (!media || typeof media !== 'object') return '';
  return (
    media.url ||
    media.secureUrl ||
    media.secure_url ||
    media.uri ||
    media.downloadURL ||
    media.thumbnailUrl ||
    media.src ||
    ''
  );
}

function getReportApprovalImage(report) {
  if (String(report?.status || '').toLowerCase() !== 'resolved') return '';

  const resolutionPhotos = Array.isArray(report?.resolution?.photos)
    ? report.resolution.photos
    : [];
  const fromResolution = resolutionPhotos.map(getMediaUrl).find(Boolean);
  if (fromResolution) return fromResolution;

  const auditTrail = Array.isArray(report?.auditTrail) ? report.auditTrail : [];
  const latestResolvedEntry = auditTrail
    .slice()
    .sort((a, b) => new Date(b?.changedAt || 0) - new Date(a?.changedAt || 0))
    .find((entry) => String(entry?.toStatus || '').toLowerCase() === 'resolved');

  if (!latestResolvedEntry) return '';
  const auditPhotos = Array.isArray(latestResolvedEntry.resolutionPhotos)
    ? latestResolvedEntry.resolutionPhotos
    : [];

  return auditPhotos.map(getMediaUrl).find(Boolean) || '';
}

function getReportResolutionDetails(report) {
  const auditTrail = Array.isArray(report?.auditTrail) ? report.auditTrail : [];
  const latestResolvedEntry = auditTrail
    .slice()
    .sort((a, b) => new Date(b?.changedAt || 0) - new Date(a?.changedAt || 0))
    .find((entry) => String(entry?.toStatus || '').toLowerCase() === 'resolved');

  const resolvedAt =
    report?.resolution?.resolvedAt ||
    latestResolvedEntry?.changedAt ||
    report?.updatedAt ||
    '';

  const note =
    report?.resolution?.note ||
    latestResolvedEntry?.progressNote ||
    '';

  const resolvedByLocation =
    report?.resolution?.resolvedBy?.location ||
    latestResolvedEntry?.changedBy?.location ||
    report?.forwarding?.to?.branchName ||
    report?.location?.barangay ||
    '';

  return {
    resolvedAt,
    note,
    resolvedByLocation,
  };
}

function getTicketActorLabel(entry) {
  const location = String(entry?.changedBy?.location || '').trim();
  if (location) return `${location} Branch`;
  const role = String(entry?.changedBy?.role || '').trim();
  if (role) return `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
  const email = String(entry?.changedBy?.email || '').trim();
  if (email) return email;
  return 'Staff update';
}

function buildResidentTicketUpdates(report) {
  const updates = [];

  updates.push({
    id: `ticket-submitted-${report?.id || 'report'}`,
    title: 'Ticket submitted',
    timestamp: report?.createdAt || report?.updatedAt || '',
    detail: String(report?.description || '').trim(),
    actor: 'Resident',
  });

  const auditTrail = Array.isArray(report?.auditTrail) ? report.auditTrail : [];

  auditTrail.forEach((entry, index) => {
    const timestamp = String(entry?.changedAt || '').trim();
    const fromStatus = String(entry?.fromStatus || '').trim().toLowerCase();
    const toStatus = String(entry?.toStatus || '').trim().toLowerCase();
    const entryType = String(entry?.type || '').trim().toLowerCase();
    const note = String(entry?.progressNote || '').trim();

    if (toStatus) {
      const statusTitle = `Status changed to ${normalizeStatus(toStatus)}`;
      const fragments = [];
      if (fromStatus && fromStatus !== toStatus) {
        fragments.push(`From ${normalizeStatus(fromStatus)}.`);
      }
      if (note) {
        fragments.push(note);
      }

      updates.push({
        id: `ticket-status-${report?.id || 'report'}-${index}`,
        title: statusTitle,
        timestamp,
        detail: fragments.join(' ').trim(),
        actor: getTicketActorLabel(entry),
      });
      return;
    }

    if (entryType === 'forwarded') {
      const targetBranch = String(entry?.forwarding?.to?.branchName || '').trim();
      const forwardedDetail = [
        targetBranch ? `Forwarded to ${targetBranch} Branch.` : '',
        note,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();

      updates.push({
        id: `ticket-forwarded-${report?.id || 'report'}-${index}`,
        title: 'Ticket forwarded',
        timestamp,
        detail: forwardedDetail,
        actor: getTicketActorLabel(entry),
      });
      return;
    }

  });

  return updates
    .slice()
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
}

export default function ResidentHub() {
  const { currentUser, logout } = useAuth();
  const { openSettings } = useSettingsModal();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('home');

  const [form, setForm] = useState(INITIAL_FORM);
  const [attachments, setAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [autoLocationAttempted, setAutoLocationAttempted] = useState(false);

  const [myReports, setMyReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [residentAlerts, setResidentAlerts] = useState([]);
  const [residentToasts, setResidentToasts] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);

  const [installPrompt, setInstallPrompt] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const [activeApprovalReport, setActiveApprovalReport] = useState(null);
  const [activeTicketReport, setActiveTicketReport] = useState(null);

  const composeSectionRef = useRef(null);
  const notifWrapRef = useRef(null);
  const previousReportStatusesRef = useRef(new Map());
  const reportsStatusPrimedRef = useRef(false);

  const unreadAlertCount = useMemo(
    () => residentAlerts.filter((alert) => !alert.read).length,
    [residentAlerts]
  );

  const api = useCallback(async (url, options = {}) => {
    const idToken = await currentUser.getIdToken();
    return fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(options.headers || {}),
      },
    });
  }, [currentUser]);

  const loadMyReports = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setReportsLoading(true);
      setReportsError('');
    }

    try {
      const response = await api('/api/reports/me');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load reports.');

      const nextReports = Array.isArray(data) ? data : [];
      const nextStatuses = new Map();
      const nextAlerts = [];

      nextReports.forEach((report) => {
        const reportId = String(report?.id || '').trim();
        if (!reportId) return;

        const status = String(report?.status || 'submitted').trim().toLowerCase();
        nextStatuses.set(reportId, status);

        if (!reportsStatusPrimedRef.current) return;

        const previousStatus = previousReportStatusesRef.current.get(reportId);
        if (!previousStatus || previousStatus === status) return;

        const auditTrail = Array.isArray(report?.auditTrail) ? report.auditTrail : [];
        const matchedEntry = auditTrail
          .slice()
          .sort((a, b) => new Date(b?.changedAt || 0) - new Date(a?.changedAt || 0))
          .find((entry) => String(entry?.toStatus || '').trim().toLowerCase() === status);

        const changedAt =
          matchedEntry?.changedAt ||
          report?.updatedAt ||
          new Date().toISOString();

        nextAlerts.push({
          id: `${reportId}-${status}-${changedAt}`,
          reportId,
          reportTitle: report?.title || 'Untitled report',
          fromStatus: previousStatus,
          toStatus: status,
          changedAt,
        });
      });

      setMyReports(nextReports);

      if (nextAlerts.length > 0) {
        const alertsWithState = nextAlerts.map((alert) => ({
          ...alert,
          read: notifOpen,
        }));

        setResidentAlerts((prev) => {
          const existingIds = new Set(prev.map((alert) => alert.id));
          const uniqueIncoming = alertsWithState.filter((alert) => !existingIds.has(alert.id));
          return [...uniqueIncoming, ...prev].slice(0, 30);
        });

        setResidentToasts((prev) => {
          const existingIds = new Set(prev.map((toast) => toast.id));
          const uniqueIncoming = alertsWithState.filter((alert) => !existingIds.has(alert.id));
          return [...uniqueIncoming, ...prev].slice(0, 4);
        });
      }

      previousReportStatusesRef.current = nextStatuses;
      reportsStatusPrimedRef.current = true;
    } catch (err) {
      if (!silent) {
        setReportsError(err.message || 'Unable to load reports.');
      }
    } finally {
      if (!silent) {
        setReportsLoading(false);
      }
    }
  }, [api]);

  useEffect(() => {
    loadMyReports();
  }, [loadMyReports]);

  useEffect(() => {
    if (activeTab !== 'home' && activeTab !== 'map') return undefined;

    const syncReports = () => {
      if (document.visibilityState !== 'visible') return;
      loadMyReports({ silent: true });
    };

    const intervalId = window.setInterval(syncReports, RESIDENT_REPORTS_SYNC_INTERVAL_MS);
    const handleFocus = () => syncReports();
    const handleVisibilityChange = () => syncReports();

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeTab, loadMyReports]);

  useEffect(() => {
    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
  }, []);

  useEffect(() => {
    if (!notifOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!notifWrapRef.current?.contains(event.target)) {
        setNotifOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [notifOpen]);

  useEffect(() => {
    if (!notifOpen) return;
    setResidentAlerts((prev) => prev.map((alert) => ({ ...alert, read: true })));
  }, [notifOpen]);

  useEffect(() => {
    if (residentToasts.length === 0) return undefined;

    const timeoutId = window.setTimeout(() => {
      setResidentToasts((prev) => prev.slice(0, -1));
    }, 5500);

    return () => window.clearTimeout(timeoutId);
  }, [residentToasts]);

  const selectedLat = useMemo(() => {
    const value = Number(form.latitude);
    return Number.isFinite(value) ? value : null;
  }, [form.latitude]);

  const selectedLng = useMemo(() => {
    const value = Number(form.longitude);
    return Number.isFinite(value) ? value : null;
  }, [form.longitude]);

  const markers = useMemo(
    () => myReports
      .filter((report) => Number.isFinite(Number(report?.location?.latitude)) && Number.isFinite(Number(report?.location?.longitude)))
      .map((report) => ({
        id: report.id,
        lat: Number(report.location.latitude),
        lng: Number(report.location.longitude),
        title: report.title,
        description: report.description,
        status: report.status,
        category: report.category,
        address: report?.location?.address || '',
        createdAt: report.createdAt,
        attachments: Array.isArray(report.attachments) ? report.attachments : [],
      })),
    [myReports]
  );

  const handleMapPick = useCallback(async ({ lat, lng }) => {
    setForm((prev) => ({
      ...prev,
      latitude: lat.toFixed(6),
      longitude: lng.toFixed(6),
    }));

    try {
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
      );
      if (!geoRes.ok) return;
      const geoData = await geoRes.json();
      if (geoData?.display_name) {
        setForm((prev) => ({ ...prev, address: geoData.display_name }));
      }
    } catch {
      // Reverse geocoding is best-effort only.
    }
  }, []);

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setSubmitError('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        handleMapPick({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        setSubmitError('Could not get your current location. Please select on the map.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    if (autoLocationAttempted) return;

    setAutoLocationAttempted(true);

    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        handleMapPick({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        // Silent fallback: resident can still pin manually on map.
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [autoLocationAttempted, handleMapPick]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAttachmentChange = (event) => {
    const files = Array.from(event.target.files || []);
    setAttachments(files.slice(0, 6));
  };

  const showSubmitFeedback = useCallback((type, message) => {
    if (type === 'error') {
      setSubmitSuccess('');
      setSubmitError(message);
    } else {
      setSubmitError('');
      setSubmitSuccess(message);
    }

    requestAnimationFrame(() => {
      composeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const handleSubmitReport = async (event) => {
    event.preventDefault();
    setSubmitError('');
    setSubmitSuccess('');
    setSubmitting(true);

    try {
      const title = form.title.trim();
      const description = form.description.trim();
      const lat = Number(form.latitude);
      const lng = Number(form.longitude);

      if (!title || title.length < 5) {
        showSubmitFeedback('error', 'Title must be at least 5 characters.');
        return;
      }
      if (!description || description.length < 20) {
        showSubmitFeedback('error', 'Description must be at least 20 characters.');
        return;
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        showSubmitFeedback('error', 'Please pin a valid location on the map before submitting.');
        return;
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        showSubmitFeedback('error', 'Latitude/Longitude values are out of range.');
        return;
      }

      const payload = new FormData();
      payload.append('title', title);
      payload.append('description', description);
      payload.append('category', form.category);
      payload.append('latitude', form.latitude);
      payload.append('longitude', form.longitude);
      payload.append('address', form.address.trim());

      attachments.forEach((file) => {
        payload.append('attachments', file);
      });

      const response = await api('/api/reports', {
        method: 'POST',
        body: payload,
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Your session expired. Please log in again and resubmit your report.');
        }
        throw new Error(data.error || `Failed to submit report (HTTP ${response.status}).`);
      }

      showSubmitFeedback('success', data.message || 'Report submitted successfully.');
      setForm(INITIAL_FORM);
      setAttachments([]);
      setActiveTab('home');
      await loadMyReports();
    } catch (err) {
      showSubmitFeedback('error', err.message || 'Unexpected error while submitting report.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const handleLogout = async () => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      navigate('/login', { replace: true });
      setSigningOut(false);
    }
  };

  const dismissResidentAlert = (alertId) => {
    setResidentAlerts((prev) => prev.filter((alert) => alert.id !== alertId));
    setResidentToasts((prev) => prev.filter((alert) => alert.id !== alertId));
  };

  const openAlertTicket = (alert) => {
    const report = myReports.find((item) => item.id === alert.reportId);
    if (report) {
      setActiveTicketReport(report);
    }

    setResidentAlerts((prev) => prev.map((item) => (
      item.id === alert.id ? { ...item, read: true } : item
    )));
    setNotifOpen(false);
  };

  return (
    <main className="resident-shell">
      <header className="resident-topbar">
        <div>
          <p className="resident-brand">OneGapo</p>
          <p className="resident-sub">Resident reporting</p>
        </div>
        <div className="resident-topbar-actions">
          <div className="resident-notif-wrap" ref={notifWrapRef}>
            <button
              type="button"
              className="btn-outline resident-notif-btn"
              onClick={() => setNotifOpen((prev) => !prev)}
              aria-label="Notifications"
              aria-expanded={notifOpen}
              aria-haspopup="menu"
            >
              <span className="material-symbols-outlined resident-notif-icon" aria-hidden="true">notifications</span>
              {unreadAlertCount > 0 ? (
                <span className="resident-notif-badge" aria-label={`${unreadAlertCount} unread notifications`}>
                  {unreadAlertCount > 9 ? '9+' : unreadAlertCount}
                </span>
              ) : null}
            </button>

            {notifOpen ? (
              <div className="resident-notif-menu" role="menu" aria-label="Resident notifications">
                <div className="resident-notif-menu-header">
                  <p className="resident-card-title">Notifications</p>
                  {residentAlerts.length > 0 ? (
                    <button
                      type="button"
                      className="btn-outline resident-alert-clear"
                      onClick={() => {
                        setResidentAlerts([]);
                        setResidentToasts([]);
                      }}
                    >
                      Clear all
                    </button>
                  ) : null}
                </div>

                <div className="resident-notif-menu-list">
                  {residentAlerts.length === 0 ? (
                    <p className="resident-notif-empty">No notification updates yet.</p>
                  ) : (
                    residentAlerts.map((alert) => (
                      <button
                        key={alert.id}
                        type="button"
                        className={`resident-notif-item ${alert.read ? '' : 'resident-notif-item-unread'}`}
                        onClick={() => openAlertTicket(alert)}
                        role="menuitem"
                      >
                        <span className="resident-notif-item-title">{alert.reportTitle}</span>
                        <span className="resident-notif-item-meta">
                          {normalizeStatus(alert.fromStatus)} → {normalizeStatus(alert.toStatus)}
                        </span>
                        <span className="resident-notif-item-time">{formatReportDate(alert.changedAt)}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {installPrompt ? (
            <button type="button" className="btn-outline resident-install" onClick={handleInstallApp}>
              Install app
            </button>
          ) : null}
        </div>
      </header>

      <section className="resident-body">
        {activeTab === 'home' && (
          <div className="resident-section resident-section-gap">
            {residentAlerts.length > 0 ? (
              <div className="resident-card resident-alerts-card" role="status" aria-live="polite">
                <div className="resident-card-header">
                  <p className="resident-card-title">Recent ticket alerts</p>
                  <button
                    type="button"
                    className="btn-outline resident-alert-clear"
                    onClick={() => {
                      setResidentAlerts([]);
                      setResidentToasts([]);
                    }}
                  >
                    Clear all
                  </button>
                </div>

                <div className="resident-alert-list">
                  {residentAlerts.map((alert) => (
                    <article key={alert.id} className="resident-alert-item">
                      <div className="resident-alert-copy">
                        <p className="resident-alert-title">{alert.reportTitle}</p>
                        <p className="resident-alert-meta">
                          {normalizeStatus(alert.fromStatus)} → {normalizeStatus(alert.toStatus)} • {formatReportDate(alert.changedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-outline resident-alert-dismiss"
                        onClick={() => dismissResidentAlert(alert.id)}
                        aria-label={`Dismiss alert for ${alert.reportTitle}`}
                      >
                        Dismiss
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="resident-summary-row">
              <article className="resident-summary-card">
                <p className="resident-summary-label">Total reports</p>
                <p className="resident-summary-value">{myReports.length}</p>
              </article>
              <article className="resident-summary-card">
                <p className="resident-summary-label">Open reports</p>
                <p className="resident-summary-value">
                  {myReports.filter((report) => report.status !== 'resolved').length}
                </p>
              </article>
            </div>

            <div className="resident-card">
              <div className="resident-card-header">
                <p className="resident-card-title">My submitted reports</p>
                <button type="button" className="btn-outline" onClick={loadMyReports} disabled={reportsLoading}>
                  {reportsLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              {reportsError ? <div className="dashboard-alert dashboard-alert-error">{reportsError}</div> : null}

              {reportsLoading ? (
                <p className="resident-muted">Loading your reports...</p>
              ) : myReports.length === 0 ? (
                <p className="resident-muted">No reports yet. Tap New Report to submit one.</p>
              ) : (
                <div className="resident-report-list">
                  {myReports.map((report) => {
                    const approvalImage = getReportApprovalImage(report);

                    return (
                      <article key={report.id} className="resident-report-item">
                        <div className="resident-report-head">
                          <p className="resident-report-title">{report.title}</p>
                          <span className={`report-status report-status-${report.status || 'submitted'}`}>
                            {normalizeStatus(report.status)}
                          </span>
                        </div>
                        <p className="resident-report-meta">{formatReportDate(report.createdAt)} • {report.category}</p>
                        <p className="resident-report-desc">{report.description}</p>
                        <div className="resident-report-actions">
                          <button
                            type="button"
                            className="btn-outline resident-report-action-btn"
                            onClick={() => setActiveTicketReport(report)}
                          >
                            View ticket
                          </button>
                          {approvalImage ? (
                            <button
                              type="button"
                              className="btn-outline resident-approval-btn"
                              onClick={() => setActiveApprovalReport(report)}
                            >
                              See image
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'compose' && (
          <section className="resident-card resident-compose" ref={composeSectionRef}>
            <p className="resident-card-title">New report</p>
            <p className="resident-muted">Pin the exact location and include details so staff can act quickly.</p>

            {submitError && <div className="dashboard-alert dashboard-alert-error">{submitError}</div>}
            {submitSuccess && <div className="dashboard-alert dashboard-alert-success">{submitSuccess}</div>}

            <form className="report-form" onSubmit={handleSubmitReport} noValidate>
              <div>
                <label className="form-label" htmlFor="resident-report-title">Title</label>
                <input
                  id="resident-report-title"
                  name="title"
                  className="form-input"
                  value={form.title}
                  onChange={handleInputChange}
                  placeholder="e.g. Broken streetlight near market"
                  required
                  minLength={5}
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="resident-report-category">Category</label>
                <select
                  id="resident-report-category"
                  name="category"
                  className="form-select"
                  value={form.category}
                  onChange={handleInputChange}
                  disabled={submitting}
                >
                  {REPORT_CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>{category.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label" htmlFor="resident-report-description">Description</label>
                <textarea
                  id="resident-report-description"
                  name="description"
                  className="form-input report-textarea"
                  value={form.description}
                  onChange={handleInputChange}
                  placeholder="Describe what happened, landmarks, and urgency."
                  required
                  minLength={20}
                  disabled={submitting}
                />
              </div>

              <ReportLocationMap
                lat={selectedLat}
                lng={selectedLng}
                onPick={handleMapPick}
                helpText="Tap the map to pin location."
              />

              <button
                type="button"
                className="btn-outline resident-location-btn"
                onClick={handleUseCurrentLocation}
                disabled={submitting}
              >
                Use current location
              </button>

              <div className="report-location-grid">
                <div>
                  <label className="form-label" htmlFor="resident-latitude">Latitude</label>
                  <input
                    id="resident-latitude"
                    name="latitude"
                    type="number"
                    step="0.000001"
                    className="form-input"
                    value={form.latitude}
                    onChange={handleInputChange}
                    required
                    disabled={submitting}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="resident-longitude">Longitude</label>
                  <input
                    id="resident-longitude"
                    name="longitude"
                    type="number"
                    step="0.000001"
                    className="form-input"
                    value={form.longitude}
                    onChange={handleInputChange}
                    required
                    disabled={submitting}
                  />
                </div>
              </div>

              <div>
                <label className="form-label" htmlFor="resident-address">Address (optional)</label>
                <input
                  id="resident-address"
                  name="address"
                  className="form-input"
                  value={form.address}
                  onChange={handleInputChange}
                  placeholder="Street / purok / landmark"
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="resident-attachments">Images / Videos (optional)</label>
                <input
                  id="resident-attachments"
                  type="file"
                  className="form-input"
                  accept="image/*,video/*"
                  multiple
                  onChange={handleAttachmentChange}
                  disabled={submitting}
                />
                {attachments.length > 0 ? (
                  <ul className="report-files-list">
                    {attachments.map((file) => (
                      <li key={`${file.name}-${file.size}`}>{file.name}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Submitting report...' : 'Submit report'}
              </button>
            </form>
          </section>
        )}

        {activeTab === 'map' && (
          <section className="resident-card resident-map-card">
            <div className="resident-card-header">
              <p className="resident-card-title">My reports map</p>
              <button type="button" className="btn-outline" onClick={loadMyReports} disabled={reportsLoading}>
                {reportsLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {reportsError ? <div className="dashboard-alert dashboard-alert-error">{reportsError}</div> : null}

            <ReportLocationMap
              markers={markers}
              helpText="Locations of reports you submitted."
            />

            {myReports.length === 0 ? (
              <p className="resident-muted">Your submitted report pins will appear here.</p>
            ) : null}
          </section>
        )}

        {activeTab === 'settings' && (
          <section className="resident-card resident-settings-card">
            <div className="resident-card-header">
              <p className="resident-card-title">Settings</p>
            </div>

            <p className="resident-muted">
              Manage your account details, profile information, password, and appearance.
            </p>

            <div className="resident-settings-account">
              <p className="resident-settings-account-name">{currentUser.displayName || 'Resident account'}</p>
              <p className="resident-settings-account-email">{currentUser.email}</p>
            </div>

            <button
              type="button"
              className="btn-outline resident-settings-action"
              onClick={openSettings}
            >
              Open account customization
            </button>

            <button
              type="button"
              className="btn-outline resident-logout"
              onClick={handleLogout}
              disabled={signingOut}
            >
              {signingOut ? 'Logging out...' : 'Log out'}
            </button>
          </section>
        )}

        {activeApprovalReport ? (
          <AppModal
            title={activeApprovalReport.title || 'Resolved report'}
            titleId="resident-approval-image-title"
            size="wide"
            onClose={() => setActiveApprovalReport(null)}
          >
            {(() => {
              const approvalImage = getReportApprovalImage(activeApprovalReport);
              const details = getReportResolutionDetails(activeApprovalReport);

              return (
                <div className="resident-approval-modal-content">
                  <div className="resident-approval-modal-meta">
                    <div className="resident-approval-modal-row">
                      <span>Resolved on</span>
                      <strong>{details.resolvedAt ? formatReportDate(details.resolvedAt) : 'Not available'}</strong>
                    </div>
                    <div className="resident-approval-modal-row">
                      <span>Resolved by</span>
                      <strong>{details.resolvedByLocation || 'Assigned branch'} Branch</strong>
                    </div>
                    <div className="resident-approval-modal-row resident-approval-modal-note-row">
                      <span>Resolution note</span>
                      <p>{details.note || 'No note provided.'}</p>
                    </div>
                  </div>

                  {approvalImage ? (
                    <img
                      src={approvalImage}
                      alt={`Approval evidence for ${activeApprovalReport.title || 'resolved report'}`}
                      className="resident-approval-modal-image"
                    />
                  ) : (
                    <p className="resident-muted">No resolution image available for this report.</p>
                  )}
                </div>
              );
            })()}
          </AppModal>
        ) : null}

        {activeTicketReport ? (
          <AppModal
            title={activeTicketReport.title || 'Ticket details'}
            titleId="resident-ticket-modal-title"
            size="wide"
            onClose={() => setActiveTicketReport(null)}
          >
            {(() => {
              const updates = buildResidentTicketUpdates(activeTicketReport);

              return (
                <div className="resident-ticket-modal-content">
                  <div className="resident-ticket-modal-summary">
                    <span className={`report-status report-status-${activeTicketReport.status || 'submitted'}`}>
                      {normalizeStatus(activeTicketReport.status)}
                    </span>
                    <p className="resident-ticket-modal-meta">
                      Last updated {formatReportDate(activeTicketReport.updatedAt || activeTicketReport.createdAt)}
                    </p>
                  </div>

                  <div className="resident-ticket-timeline" role="list">
                    {updates.map((update) => (
                      <article key={update.id} className="resident-ticket-update" role="listitem">
                        <p className="resident-ticket-update-title">{update.title}</p>
                        <p className="resident-ticket-update-meta">
                          {formatReportDate(update.timestamp)} • {update.actor}
                        </p>
                        {update.detail ? (
                          <p className="resident-ticket-update-detail">{update.detail}</p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </div>
              );
            })()}
          </AppModal>
        ) : null}
      </section>

      {residentToasts.length > 0 ? (
        <div className="resident-toast-stack" role="status" aria-live="polite" aria-atomic="false">
          {residentToasts.map((toast) => (
            <article key={toast.id} className="resident-toast">
              <div className="resident-toast-copy">
                <p className="resident-toast-title">{toast.reportTitle}</p>
                <p className="resident-toast-message">
                  {normalizeStatus(toast.fromStatus)} → {normalizeStatus(toast.toStatus)}
                </p>
                <p className="resident-toast-time">{formatReportDate(toast.changedAt)}</p>
              </div>
              <div className="resident-toast-actions">
                <button
                  type="button"
                  className="btn-outline resident-toast-view"
                  onClick={() => openAlertTicket(toast)}
                >
                  View
                </button>
                <button
                  type="button"
                  className="btn-outline resident-toast-dismiss"
                  onClick={() => dismissResidentAlert(toast.id)}
                  aria-label={`Dismiss notification for ${toast.reportTitle}`}
                >
                  Dismiss
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <nav className="resident-bottom-nav" aria-label="Resident navigation">
        <button
          type="button"
          className={`resident-tab ${activeTab === 'home' ? 'resident-tab-active' : ''}`}
          onClick={() => setActiveTab('home')}
          aria-label="Home"
        >
          <span className="material-symbols-outlined resident-tab-icon" aria-hidden="true">home</span>
        </button>
        <button
          type="button"
          className={`resident-tab ${activeTab === 'compose' ? 'resident-tab-active' : ''}`}
          onClick={() => setActiveTab('compose')}
          aria-label="Create report"
        >
          <span className="material-symbols-outlined resident-tab-icon" aria-hidden="true">edit_square</span>
        </button>
        <button
          type="button"
          className={`resident-tab ${activeTab === 'map' ? 'resident-tab-active' : ''}`}
          onClick={() => setActiveTab('map')}
          aria-label="Map"
        >
          <span className="material-symbols-outlined resident-tab-icon" aria-hidden="true">map</span>
        </button>
        <button
          type="button"
          className={`resident-tab ${activeTab === 'settings' ? 'resident-tab-active' : ''}`}
          onClick={() => setActiveTab('settings')}
          aria-label="Settings"
        >
          <span className="material-symbols-outlined resident-tab-icon" aria-hidden="true">settings</span>
        </button>
      </nav>
    </main>
  );
}
