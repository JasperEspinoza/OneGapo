import './ResidentHub.css';
import './Profile.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import ReportLocationMap from '../components/ReportLocationMap';
import AppModal from '../components/AppModal';
import OneGapoLogo from '../components/OneGapoLogo';
import SettingsContent from '../components/SettingsContent';
import { getSocketServerUrl } from '../config/runtime';

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

function buildResidentNotificationEvents(reports = []) {
  const events = [];

  reports.forEach((report) => {
    const reportId = String(report?.id || '').trim();
    if (!reportId) return;

    const reportTitle = String(report?.title || '').trim() || 'Untitled report';
    const auditTrail = Array.isArray(report?.auditTrail) ? report.auditTrail : [];

    auditTrail.forEach((entry, index) => {
      const toStatus = String(entry?.toStatus || '').trim().toLowerCase();
      if (!toStatus) return;

      const changedAt = entry?.changedAt || report?.updatedAt || report?.createdAt || '';
      if (!changedAt) return;

      const fromStatus = String(entry?.fromStatus || '').trim().toLowerCase() || 'submitted';

      events.push({
        id: `${reportId}-${toStatus}-${changedAt}-${index}`,
        reportId,
        reportTitle,
        fromStatus,
        toStatus,
        changedAt,
      });
    });
  });

  return events
    .slice()
    .sort((a, b) => new Date(b.changedAt || 0) - new Date(a.changedAt || 0))
    .slice(0, 30);
}

export default function ResidentHub() {
  const { currentUser, logout } = useAuth();
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

  const [installPrompt, setInstallPrompt] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const [activeApprovalReport, setActiveApprovalReport] = useState(null);
  const [activeTicketReport, setActiveTicketReport] = useState(null);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const composeSectionRef = useRef(null);
  const cameraCaptureInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const dismissedAlertIdsRef = useRef(new Set());

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

  const applyReportsSnapshot = useCallback((incomingReports) => {
    const nextReports = Array.isArray(incomingReports) ? incomingReports : [];
    const nextAlerts = buildResidentNotificationEvents(nextReports)
      .filter((alert) => !dismissedAlertIdsRef.current.has(alert.id));

    setMyReports(nextReports);

    setResidentAlerts((prev) => {
      const readById = new Map(prev.map((alert) => [alert.id, Boolean(alert.read)]));
      return nextAlerts.map((alert) => ({
        ...alert,
        read: readById.get(alert.id) === true,
      }));
    });
  }, []);

  const loadMyReports = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setReportsLoading(true);
      setReportsError('');
    }

    try {
      const response = await api('/api/reports/me');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load reports.');
      applyReportsSnapshot(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!silent) {
        setReportsError(err.message || 'Unable to load reports.');
      }
    } finally {
      if (!silent) {
        setReportsLoading(false);
      }
    }
  }, [api, applyReportsSnapshot]);

  useEffect(() => {
    loadMyReports();
  }, [loadMyReports]);

  useEffect(() => {
    if (!currentUser) {
      return undefined;
    }

    let active = true;
    let socket;

    const connectRealtimeReports = async () => {
      try {
        const idToken = await currentUser.getIdToken();
        if (!active) return;

        const socketUrl = getSocketServerUrl();
        if (!socketUrl) {
          loadMyReports({ silent: true });
          return;
        }

        socket = io(socketUrl, {
          path: '/socket.io',
          transports: ['websocket', 'polling'],
          auth: { token: idToken },
        });

        socket.on('reports:data', (payload) => {
          if (!active) return;
          applyReportsSnapshot(Array.isArray(payload) ? payload : []);
          setReportsError('');
          setReportsLoading(false);
        });

        socket.on('connect_error', () => {
          if (!active) return;
          // Fall back to HTTP fetch when socket connection is unavailable.
          loadMyReports({ silent: true });
        });
      } catch {
        if (!active) return;
        loadMyReports({ silent: true });
      }
    };

    connectRealtimeReports();

    return () => {
      active = false;
      if (socket) {
        socket.disconnect();
      }
    };
  }, [applyReportsSnapshot, currentUser, loadMyReports]);

  useEffect(() => {
    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
  }, []);

  useEffect(() => {
    if (activeTab !== 'notifications') return;
    setResidentAlerts((prev) => prev.map((alert) => ({ ...alert, read: true })));
  }, [activeTab]);

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

  const handleAttachmentChange = (event, { append = false } = {}) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setAttachments((prev) => {
      const base = append ? prev : [];
      const merged = [...base, ...files];
      const unique = [];
      const seen = new Set();

      merged.forEach((file) => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(file);
        }
      });

      return unique.slice(0, 6);
    });

    event.target.value = '';
  };

  const handleOpenCameraCapture = async () => {
    setCameraError('');
    setCameraPermissionDenied(false);
    setCameraModalOpen(true);
    
    // Request camera access
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      
      cameraStreamRef.current = stream;
      
      // Set video stream once it's mounted
      requestAnimationFrame(() => {
        if (videoRef.current && stream) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch((error) => {
            console.error('Error playing video:', error);
            setCameraError('Failed to start camera playback.');
          });
        }
      });
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        setCameraPermissionDenied(true);
        setCameraError('Camera permission denied. Please enable it in your device settings.');
      } else if (error.name === 'NotFoundError') {
        setCameraError('No camera device found on this device.');
      } else {
        setCameraError(`Camera error: ${error.message}`);
      }
      setCameraModalOpen(false);
    }
  };

  const handleCameraCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    // Set canvas to video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current video frame to canvas
    context.drawImage(video, 0, 0);

    // Convert canvas to blob and create file
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraError('Failed to capture image.');
        return;
      }

      const timestamp = new Date().getTime();
      const file = new File([blob], `camera-${timestamp}.jpg`, { type: 'image/jpeg' });

      // Add to attachments
      setAttachments((prev) => {
        const unique = new Map(prev.map((f) => [`${f.name}-${f.size}`, f]));
        unique.set(`${file.name}-${file.size}`, file);
        return unique.size > 6 ? Array.from(unique.values()).slice(0, 6) : Array.from(unique.values());
      });

      // Close modal and cleanup
      handleCloseCameraModal();
    }, 'image/jpeg', 0.9);
  };

  const handleCloseCameraModal = () => {
    // Stop all camera tracks
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraModalOpen(false);
    setCameraError('');
    setCameraPermissionDenied(false);
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
        showSubmitFeedback('error', 'Selected map location is out of range.');
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
    dismissedAlertIdsRef.current.add(alertId);
    setResidentAlerts((prev) => prev.filter((alert) => alert.id !== alertId));
  };

  const clearResidentAlerts = () => {
    residentAlerts.forEach((alert) => dismissedAlertIdsRef.current.add(alert.id));
    setResidentAlerts([]);
  };

  const openAlertTicket = (alert) => {
    const report = myReports.find((item) => item.id === alert.reportId);
    if (report) {
      setActiveTicketReport(report);
    }

    setResidentAlerts((prev) => prev.map((item) => (
      item.id === alert.id ? { ...item, read: true } : item
    )));
    setActiveTab('home');
  };

  return (
    <main className="resident-shell">
      <header className="resident-topbar">
        <div className="resident-topbar-brand">
          <div className="resident-brand-wrap">
            <OneGapoLogo className="resident-brand-logo" decorative />
            <p className="resident-brand">OneGapo</p>
          </div>
        </div>
        <div className="resident-topbar-actions">
          <button
            type="button"
            className="btn-outline resident-notif-btn"
            onClick={() => setActiveTab('notifications')}
            aria-label="Notifications"
            aria-pressed={activeTab === 'notifications'}
          >
            <span
              className={`material-symbols-outlined resident-notif-icon ${unreadAlertCount > 0 ? 'resident-notif-icon-unread' : ''}`}
              aria-hidden="true"
            >
              notifications
            </span>
            {unreadAlertCount > 0 ? (
              <span className="resident-notif-badge" aria-label={`${unreadAlertCount} unread notifications`}>
                {unreadAlertCount > 9 ? '9+' : unreadAlertCount}
              </span>
            ) : null}
          </button>

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
            <div className="resident-hero-card" onClick={() => setActiveTab('compose')}>
              <div className="resident-hero-content">
                <h2 className="resident-hero-title">Report an Issue</h2>
                <p className="resident-hero-desc">Help keep our city clean and safe. Report an issue to the local government.</p>
                <span className="resident-hero-btn">
                  <span className="material-symbols-outlined" aria-hidden="true">edit_square</span>
                  Submit Report
                </span>
              </div>
              <span className="material-symbols-outlined resident-hero-bg-icon" aria-hidden="true">report</span>
            </div>

            <div className="resident-summary-row">
              <article className="resident-summary-card">
                <p className="resident-summary-label">Total Reports</p>
                <p className="resident-summary-value">{myReports.length}</p>
              </article>
              <article className="resident-summary-card">
                <p className="resident-summary-label">Open Reports</p>
                <p className="resident-summary-value">
                  {myReports.filter((report) => report.status !== 'resolved').length}
                </p>
              </article>
            </div>

            <div className="resident-section">
              <div className="resident-card-header">
                <p className="resident-section-title">My submitted reports</p>
                <button type="button" className="btn-outline btn-sm" onClick={loadMyReports} disabled={reportsLoading}>
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
                    return (
                      <button
                        key={report.id}
                        type="button"
                        className="resident-report-item"
                        onClick={() => setActiveTicketReport(report)}
                      >
                        <div className="resident-report-pills">
                          <span className={`res-pill report-status-${report.status || 'submitted'}`}>
                            {normalizeStatus(report.status)}
                          </span>
                          <span className="res-pill res-pill-cat">{report.category}</span>
                        </div>
                        <p className="resident-report-title">{report.title}</p>
                        <p className="resident-report-desc">{report.description}</p>
                        <div className="resident-report-meta">
                          <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
                          {formatReportDate(report.createdAt)}
                        </div>
                      </button>
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
                <div className="resident-media-actions">
                  <input
                    id="resident-attachments"
                    type="file"
                    className="form-input resident-attachments-input"
                    accept="image/*,video/*"
                    multiple
                    onChange={(event) => handleAttachmentChange(event)}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    className="resident-media-btn resident-media-btn-file"
                    onClick={() => document.getElementById('resident-attachments').click()}
                    disabled={submitting}
                    aria-label="Select files"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">image</span>
                  </button>
                  <button
                    type="button"
                    className="resident-media-btn resident-media-btn-camera"
                    onClick={handleOpenCameraCapture}
                    disabled={submitting}
                    aria-label="Take photo"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">photo_camera</span>
                  </button>
                </div>
                <input
                  id="resident-camera-capture"
                  ref={cameraCaptureInputRef}
                  type="file"
                  className="resident-camera-input"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => handleAttachmentChange(event, { append: true })}
                  disabled={submitting}
                />
                <p className="resident-attachment-note">You can attach up to 6 files total.</p>
                {attachments.length > 0 ? (
                  <ul className="report-files-list">
                    {attachments.map((file) => (
                      <li key={`${file.name}-${file.size}`}>{file.name}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <button type="submit" className="btn-primary resident-submit-btn" disabled={submitting}>
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

            <SettingsContent showLogout onLogout={handleLogout} logoutLoading={signingOut} />
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
              const approvalImage = getReportApprovalImage(activeTicketReport);
              const isResolved = String(activeTicketReport?.status || '').toLowerCase() === 'resolved';

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

                  {isResolved && approvalImage ? (
                    <div className="resident-report-actions">
                      <button
                        type="button"
                        className="btn-outline resident-approval-btn"
                        onClick={() => setActiveApprovalReport(activeTicketReport)}
                      >
                        See image
                      </button>
                    </div>
                  ) : null}

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

        {cameraModalOpen && (
          <div className="resident-fullscreen-camera-overlay">
            <div className="resident-camera-fullscreen-container">
              <button
                type="button"
                className="resident-camera-close-btn"
                onClick={handleCloseCameraModal}
                aria-label="Close camera"
              >
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>

              {cameraPermissionDenied || cameraError ? (
                <div className="resident-camera-error-fullscreen">
                  <p className="resident-camera-error-message">{cameraError}</p>
                  {cameraPermissionDenied && (
                    <p className="resident-camera-error-hint">
                      Please enable camera access in your device settings and try again.
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleCloseCameraModal}
                  >
                    Close
                  </button>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    className="resident-camera-video-fullscreen"
                    playsInline
                  />
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                  <div className="resident-camera-actions-fullscreen">
                    <button
                      type="button"
                      className="resident-camera-capture-btn"
                      onClick={handleCameraCapture}
                      aria-label="Capture photo"
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">radio_button_checked</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'notifications' && (
          <section className="resident-notifications-page">
            <div className="resident-notifications-header">
              <h2 className="resident-notifications-title">Notifications</h2>
              {residentAlerts.length > 0 ? (
                <button
                  type="button"
                  className="btn-outline resident-alerts-clear-btn"
                  onClick={clearResidentAlerts}
                >
                  Clear all
                </button>
              ) : null}
            </div>

            {residentAlerts.length === 0 ? (
              <p className="resident-notifications-empty">No notification updates yet.</p>
            ) : (
              <div className="resident-notifications-list">
                {residentAlerts.map((alert) => (
                  <button
                    key={alert.id}
                    type="button"
                    className={`resident-notification-item ${alert.read ? '' : 'resident-notification-item-unread'}`}
                    onClick={() => openAlertTicket(alert)}
                  >
                    <span
                      className={`resident-notification-icon material-symbols-outlined ${alert.read ? '' : 'resident-notification-icon-unread'}`}
                      aria-hidden="true"
                    >
                      {String(alert.toStatus || '').toLowerCase() === 'resolved' ? 'check_circle' : 'notifications'}
                    </span>

                    <div className="resident-notification-content">
                      <div className="resident-notification-item-header">
                        <span className="resident-notification-item-title">{alert.reportTitle}</span>
                        {!alert.read && <span className="resident-notification-item-dot" />}
                      </div>

                      <div className="resident-notification-row">
                        <span className="resident-notification-item-meta">
                          {normalizeStatus(alert.fromStatus)} → {normalizeStatus(alert.toStatus)}
                        </span>
                        <span className="resident-notification-item-time">{formatReportDate(alert.changedAt)}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
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
          <span>Home</span>
        </button>
        <button
          type="button"
          className={`resident-tab ${activeTab === 'compose' ? 'resident-tab-active' : ''}`}
          onClick={() => setActiveTab('compose')}
          aria-label="Create report"
        >
          <span className="material-symbols-outlined resident-tab-icon" aria-hidden="true">edit_square</span>
          <span>Report</span>
        </button>
        <button
          type="button"
          className={`resident-tab ${activeTab === 'map' ? 'resident-tab-active' : ''}`}
          onClick={() => setActiveTab('map')}
          aria-label="Map"
        >
          <span className="material-symbols-outlined resident-tab-icon" aria-hidden="true">map</span>
          <span>Map</span>
        </button>
        <button
          type="button"
          className={`resident-tab ${activeTab === 'settings' ? 'resident-tab-active' : ''}`}
          onClick={() => setActiveTab('settings')}
          aria-label="Settings"
        >
          <span className="material-symbols-outlined resident-tab-icon" aria-hidden="true">settings</span>
          <span>Settings</span>
        </button>
      </nav>
    </main>
  );
}
