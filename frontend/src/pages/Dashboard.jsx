import './Dashboard.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
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

const OLONGAPO_BOUNDS = {
  minLat: 14.73,
  maxLat: 14.92,
  minLng: 120.22,
  maxLng: 120.34,
};

function isWithinOlongapoBounds(lat, lng) {
  return (
    lat >= OLONGAPO_BOUNDS.minLat
    && lat <= OLONGAPO_BOUNDS.maxLat
    && lng >= OLONGAPO_BOUNDS.minLng
    && lng <= OLONGAPO_BOUNDS.maxLng
  );
}

function formatReportDate(value) {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleString();
}

function formatResidentStatusLabel(status) {
  const key = String(status || 'submitted').trim().toLowerCase().replace(/\s+/g, '_');
  if (key === 'declined') return 'Declined';
  return key.replace(/_/g, ' ');
}

export default function Dashboard() {
  const { currentUser, userClaims } = useAuth();
  const role        = userClaims?.role;
  const displayName = currentUser?.displayName || currentUser?.email;
  const isResident = role === 'resident';

  const [form, setForm] = useState(INITIAL_FORM);
  const [attachments, setAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [autoLocationAttempted, setAutoLocationAttempted] = useState(false);
  const [outsideOlongapoModalOpen, setOutsideOlongapoModalOpen] = useState(false);
  const composeSectionRef = useRef(null);

  const [myReports, setMyReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');

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

  const loadMyReports = useCallback(async () => {
    if (!isResident) return;

    setReportsLoading(true);
    setReportsError('');
    try {
      const response = await api('/api/reports/me');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load reports.');
      setMyReports(Array.isArray(data) ? data : []);
    } catch (err) {
      setReportsError(err.message);
    } finally {
      setReportsLoading(false);
    }
  }, [api, isResident]);

  useEffect(() => {
    loadMyReports();
  }, [loadMyReports]);

  const selectedLat = useMemo(() => {
    const value = Number(form.latitude);
    return Number.isFinite(value) ? value : null;
  }, [form.latitude]);

  const selectedLng = useMemo(() => {
    const value = Number(form.longitude);
    return Number.isFinite(value) ? value : null;
  }, [form.longitude]);

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
    if (!isResident || autoLocationAttempted) return;

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
        // Silent fallback: resident can still pick location manually on map.
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [isResident, autoLocationAttempted, handleMapPick]);

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
      if (!isWithinOlongapoBounds(lat, lng)) {
        setOutsideOlongapoModalOpen(true);
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
      await loadMyReports();
    } catch (err) {
      showSubmitFeedback('error', err.message || 'Unexpected error while submitting report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="app-page">
      <div className="dashboard-container app-page-inner">
        <div>
          <h1 className="dashboard-welcome page-title">Welcome back, {displayName}!</h1>
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
                  Include a pinned location on OpenStreetMap and upload image/video evidence.
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

        {isResident && (
          <section className="dashboard-card report-compose-card" ref={composeSectionRef}>
            <h2 className="dashboard-card-title">Create Report</h2>
            <p className="dashboard-card-body report-compose-body">
              Pin the exact location on the OpenStreetMap map, then attach media files to send to your barangay operators.
            </p>

            {submitError && <div className="dashboard-alert dashboard-alert-error">{submitError}</div>}
            {submitSuccess && <div className="dashboard-alert dashboard-alert-success">{submitSuccess}</div>}

            <form className="report-form" onSubmit={handleSubmitReport} noValidate>
              <div>
                <label className="form-label" htmlFor="report-title">Title</label>
                <input
                  id="report-title"
                  name="title"
                  className="form-input"
                  value={form.title}
                  onChange={handleInputChange}
                  placeholder="Broken streetlight near market"
                  required
                  minLength={5}
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="report-category">Category</label>
                <select
                  id="report-category"
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
                <label className="form-label" htmlFor="report-description">Description</label>
                <textarea
                  id="report-description"
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
              />

              <button
                type="button"
                className="btn-outline report-location-btn"
                onClick={handleUseCurrentLocation}
                disabled={submitting}
              >
                Use my current location
              </button>

              <div className="report-location-grid">
                <div>
                  <label className="form-label" htmlFor="report-latitude">Latitude</label>
                  <input
                    id="report-latitude"
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
                  <label className="form-label" htmlFor="report-longitude">Longitude</label>
                  <input
                    id="report-longitude"
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
                <label className="form-label" htmlFor="report-address">Address (optional)</label>
                <input
                  id="report-address"
                  name="address"
                  className="form-input"
                  value={form.address}
                  onChange={handleInputChange}
                  placeholder="Street / purok / landmark"
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="report-attachments">Images / Videos (optional)</label>
                <input
                  id="report-attachments"
                  type="file"
                  className="form-input"
                  accept="image/*,video/*"
                  multiple
                  onChange={handleAttachmentChange}
                  disabled={submitting}
                />
                {attachments.length > 0 && (
                  <ul className="report-files-list">
                    {attachments.map((file) => (
                      <li key={`${file.name}-${file.size}`}>{file.name}</li>
                    ))}
                  </ul>
                )}
              </div>

              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Submitting report...' : 'Submit report'}
              </button>
            </form>
          </section>
        )}

        {outsideOlongapoModalOpen ? (
          <AppModal
            title="Location Outside Olongapo City"
            titleId="outside-olongapo-dashboard-title"
            onClose={() => setOutsideOlongapoModalOpen(false)}
          >
            <div className="report-geo-modal-body">
              <p>
                This report location is outside Olongapo City and cannot be submitted.
                Please pin a location within Olongapo City to continue.
              </p>
              <button
                type="button"
                className="btn-primary report-geo-modal-btn"
                onClick={() => setOutsideOlongapoModalOpen(false)}
              >
                I understand
              </button>
            </div>
          </AppModal>
        ) : null}

        {isResident && (
          <section className="dashboard-card report-list-card">
            <div className="report-list-header">
              <h2 className="dashboard-card-title">My Submitted Reports</h2>
              <button type="button" className="btn-outline report-refresh-btn" onClick={loadMyReports} disabled={reportsLoading}>
                {reportsLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {reportsError && <div className="dashboard-alert dashboard-alert-error">{reportsError}</div>}

            {reportsLoading ? (
              <p className="dashboard-card-body">Loading reports...</p>
            ) : myReports.length === 0 ? (
              <p className="dashboard-card-body">No reports yet. Submit your first one above.</p>
            ) : (
              <div className="report-list-grid">
                {myReports.map((report) => (
                  <article key={report.id} className="report-item-card">
                    <div className="report-item-header">
                      <h3>{report.title}</h3>
                      <span className={`report-status report-status-${report.status || 'submitted'}`}>
                        {formatResidentStatusLabel(report.status)}
                      </span>
                    </div>
                    <p className="report-item-meta">{formatReportDate(report.createdAt)} • {report.category}</p>
                    <p className="report-item-description">{report.description}</p>
                    <p className="report-item-location">
                      {report?.location?.address || `${report?.location?.latitude}, ${report?.location?.longitude}`}
                    </p>
                    {Array.isArray(report.attachments) && report.attachments.length > 0 && (
                      <p className="report-item-media-count">{report.attachments.length} media file(s)</p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
