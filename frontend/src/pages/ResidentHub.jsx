import './ResidentHub.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettingsModal } from '../context/SettingsModalContext';
import ReportLocationMap from '../components/ReportLocationMap';

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

  const [installPrompt, setInstallPrompt] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  const composeSectionRef = useRef(null);

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
      setMyReports(Array.isArray(data) ? data : []);
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

  return (
    <main className="resident-shell">
      <header className="resident-topbar">
        <div>
          <p className="resident-brand">OneGapo</p>
          <p className="resident-sub">Resident reporting</p>
        </div>
        <div className="resident-topbar-actions">
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
                  {myReports.map((report) => (
                    <article key={report.id} className="resident-report-item">
                      <div className="resident-report-head">
                        <p className="resident-report-title">{report.title}</p>
                        <span className={`report-status report-status-${report.status || 'submitted'}`}>
                          {normalizeStatus(report.status)}
                        </span>
                      </div>
                      <p className="resident-report-meta">{formatReportDate(report.createdAt)} • {report.category}</p>
                      <p className="resident-report-desc">{report.description}</p>
                    </article>
                  ))}
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

              <button type="button" className="btn-outline resident-location-btn" onClick={handleUseCurrentLocation}>
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
      </section>

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
