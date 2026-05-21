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

function normalizeCategoryKey(value) {
  return String(value || 'general').toLowerCase().trim() || 'general';
}

function getCategoryPillClass(category) {
  return `res-pill-cat-${normalizeCategoryKey(category)}`;
}

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

  const resolvedByName =
    report?.resolution?.resolvedBy?.displayName ||
    report?.resolution?.resolvedBy?.fullName ||
    latestResolvedEntry?.changedBy?.displayName ||
    latestResolvedEntry?.changedBy?.fullName ||
    '';

  return {
    resolvedAt,
    note,
    resolvedByLocation,
    resolvedByName,
  };
}

function getTicketActorLabel(entry) {
  const displayName = String(
    entry?.changedBy?.displayName ||
    entry?.changedBy?.fullName ||
    ''
  ).trim();
  if (displayName) return displayName;

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
    status: 'submitted',
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
        status: toStatus,
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
        status: toStatus || 'in_review',
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

export default function ResidentHub({ viewMode = 'resident' }) {
  const { currentUser, logout, userClaims } = useAuth();
  const navigate = useNavigate();
  const isResponder = false;

  const [activeTab, setActiveTab] = useState(isResponder ? 'reports' : 'home');

  const [form, setForm] = useState(INITIAL_FORM);
  const [attachments, setAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [autoLocationAttempted, setAutoLocationAttempted] = useState(false);
  const [outsideOlongapoModalOpen, setOutsideOlongapoModalOpen] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const [myReports, setMyReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [residentAlerts, setResidentAlerts] = useState([]);

  const [installPrompt, setInstallPrompt] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [activeApprovalReport, setActiveApprovalReport] = useState(null);
  const [activeTicketReport, setActiveTicketReport] = useState(null);
  const [ticketLogsExpanded, setTicketLogsExpanded] = useState(false);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false);
  const [cameraError, setCameraError] = useState('');

  // Responder resolve modal state
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolveTargetReport, setResolveTargetReport] = useState(null);
  const [resolveNote, setResolveNote] = useState('');
  const [resolvePhotos, setResolvePhotos] = useState([]);
  const [resolveError, setResolveError] = useState('');
  const [updatingResponderStatus, setUpdatingResponderStatus] = useState(false);
  const [responderStatusError, setResponderStatusError] = useState('');

  const composeSectionRef = useRef(null);
  const cameraCaptureInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const [focusIndicator, setFocusIndicator] = useState({ visible: false, left: 0, top: 0 });
  const dismissedAlertIdsRef = useRef(new Set());

  // Attempt to focus the camera at a normalized point (nx, ny) where 0..1 range
  const attemptFocusAtPoint = async (nx, ny) => {
    try {
      const stream = cameraStreamRef.current;
      if (!stream) return;
      const [track] = stream.getVideoTracks();
      if (!track || typeof track.applyConstraints !== 'function') return;

      const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
      const advanced = [];

      // Use pointsOfInterest if supported (normalized coordinates expected by some browsers)
      if (caps.pointsOfInterest !== undefined) {
        advanced.push({ pointsOfInterest: [{ x: nx, y: ny }] });
      }

      // Try to request a single-shot focus mode if available
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes('single-shot')) {
        advanced.push({ focusMode: 'single-shot' });
      }

      if (advanced.length === 0) {
        // No supported focus controls exposed by the browser/device
        return;
      }

      await track.applyConstraints({ advanced });
    } catch (err) {
      // Non-fatal: just log and continue. Many devices/browsers won't support these constraints.
      // eslint-disable-next-line no-console
      console.debug('Focus attempt failed or unsupported:', err && err.message ? err.message : err);
    }
  };

  const handleVideoFocus = (event) => {
    if (!videoRef.current) return;

    const rect = videoRef.current.getBoundingClientRect();
    const clientX = event.clientX ?? (event.touches && event.touches[0] && event.touches[0].clientX);
    const clientY = event.clientY ?? (event.touches && event.touches[0] && event.touches[0].clientY);
    if (typeof clientX !== 'number' || typeof clientY !== 'number') return;

    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

    // Show a temporary focus indicator (positioned in viewport coordinates)
    setFocusIndicator({ visible: true, left: clientX, top: clientY });
    window.setTimeout(() => setFocusIndicator((s) => ({ ...s, visible: false })), 700);

    // Try to focus the camera at the tapped point (best-effort)
    attemptFocusAtPoint(nx, ny);
  };

  useEffect(() => {
    if (!cameraModalOpen) return undefined;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousTouchAction = body.style.touchAction;

    body.style.overflow = 'hidden';
    body.style.touchAction = 'none';

    return () => {
      body.style.overflow = previousOverflow;
      body.style.touchAction = previousTouchAction;
    };
  }, [cameraModalOpen]);

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

  const [ticketImageIndex, setTicketImageIndex] = useState(0);

  // Responder: update assigned report status (in_progress or resolve flow)
  const handleResponderStatusUpdate = async ({ reportId, status, note = '', photos = [] }) => {
    setUpdatingResponderStatus(true);
    setResponderStatusError('');
    try {
      let res;
      if (photos.length > 0) {
        const formData = new FormData();
        formData.append('status', status);
        if (note) formData.append('progressNote', note);
        photos.forEach((file) => formData.append('resolutionPhotos', file));
        res = await api(`/api/reports/${reportId}/status`, { method: 'PATCH', body: formData });
      } else {
        const payload = { status, ...(note ? { progressNote: note } : {}) };
        res = await api(`/api/reports/${reportId}/status`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update report status.');

      // Patch local state
      const updatedReport = data?.report || {};
      setMyReports((prev) => prev.map((r) => (r.id === reportId ? { ...r, ...updatedReport } : r)));
      if (activeTicketReport?.id === reportId) {
        setActiveTicketReport((prev) => ({ ...prev, ...updatedReport }));
      }

      // Close resolve modal on success
      setResolveModalOpen(false);
      setResolveTargetReport(null);
      setResolveNote('');
      setResolvePhotos([]);
      setResolveError('');
    } catch (err) {
      setResponderStatusError(err.message || 'Failed to update status.');
    } finally {
      setUpdatingResponderStatus(false);
    }
  };

  const handleOpenResolveModal = (report) => {
    setResolveTargetReport(report);
    setResolveNote('');
    setResolvePhotos([]);
    setResolveError('');
    setResolveSuccess('');
    setResolveModalOpen(true);
  };

  const handleSubmitResolve = async (event) => {
    event.preventDefault();
    const note = resolveNote.trim();
    if (!note && resolvePhotos.length === 0) {
      setResolveError('Please provide a progress note or at least one resolution photo.');
      return;
    }
    await handleResponderStatusUpdate({
      reportId: resolveTargetReport.id,
      status: 'resolved',
      note,
      photos: resolvePhotos,
    });
  };

  const responderAssignedReports = useMemo(() => {
    if (!isResponder) return myReports;
    const currentUid = String(currentUser?.uid || '').trim();
    return myReports.filter((report) => {
      const assignedUid = String(report?.assignedResponder?.uid || '').trim();
      return Boolean(currentUid && assignedUid && assignedUid === currentUid);
    });
  }, [isResponder, myReports, currentUser?.uid]);

  const visibleReports = isResponder ? responderAssignedReports : myReports;

  useEffect(() => {
    setTicketImageIndex(0);
  }, [activeTicketReport]);

  const loadMyReports = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setReportsLoading(true);
      setReportsError('');
    }

    try {
      const response = await api(isResponder ? '/api/reports' : '/api/reports/me');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load reports.');
      const reportsData = Array.isArray(data) ? data : [];
      if (isResponder) {
        const currentUid = String(currentUser?.uid || '').trim();
        applyReportsSnapshot(
          reportsData.filter((report) => String(report?.assignedResponder?.uid || '').trim() === currentUid)
        );
      } else {
        applyReportsSnapshot(reportsData);
      }
    } catch (err) {
      if (!silent) {
        setReportsError(err.message || 'Unable to load reports.');
      }
    } finally {
      if (!silent) {
        setReportsLoading(false);
      }
    }
  }, [api, applyReportsSnapshot, isResponder, currentUser?.uid]);

  useEffect(() => {
    loadMyReports();
  }, [loadMyReports]);

  useEffect(() => {
    const lastSubmittedStr = localStorage.getItem('onegapo_last_report_at');
    if (!lastSubmittedStr) {
      setCooldownRemaining(0);
      return undefined;
    }

    const lastSubmittedAt = parseInt(lastSubmittedStr, 10);
    if (Number.isNaN(lastSubmittedAt)) {
      setCooldownRemaining(0);
      return undefined;
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastSubmittedAt;
      const remaining = 5 * 60 * 1000 - elapsed;
      if (remaining <= 0) {
        setCooldownRemaining(0);
        localStorage.removeItem('onegapo_last_report_at');
        clearInterval(interval);
      } else {
        setCooldownRemaining(Math.ceil(remaining / 1000));
      }
    }, 1000);

    // Initial check
    const initialElapsed = Date.now() - lastSubmittedAt;
    if (initialElapsed < 5 * 60 * 1000) {
      setCooldownRemaining(Math.ceil((5 * 60 * 1000 - initialElapsed) / 1000));
    } else {
      setCooldownRemaining(0);
      localStorage.removeItem('onegapo_last_report_at');
    }

    return () => clearInterval(interval);
  }, [submitSuccess]);

  useEffect(() => {
    if (isResponder) return undefined;
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

        socket.on('connect', () => {
          if (!active) return;
          // eslint-disable-next-line no-console
          console.debug('[client][resident] socket connected', { socketId: socket.id });
          setReportsLoading(false);
        });

        socket.on('reports:data', (payload) => {
          if (!active) return;
          // eslint-disable-next-line no-console
          console.debug('[client][resident] reports:data received', { count: Array.isArray(payload) ? payload.length : 0 });
          applyReportsSnapshot(Array.isArray(payload) ? payload : []);
          setReportsError('');
          setReportsLoading(false);
        });

        socket.on('reports:created', (report) => {
          if (!active) return;
          // only process if this belongs to the current user
          if (!report || String(report?.reporter?.uid || '') !== String(currentUser.uid)) return;
          // eslint-disable-next-line no-console
          console.debug('[client][resident] reports:created', { id: report.id });
          applyReportsSnapshot([...(Array.isArray(myReports) ? myReports : []), report]);
        });

        socket.on('reports:modified', (report) => {
          if (!active) return;
          if (!report || String(report?.reporter?.uid || '') !== String(currentUser.uid)) return;
          // eslint-disable-next-line no-console
          console.debug('[client][resident] reports:modified', { id: report.id });
          setMyReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, ...report } : r)));
        });

        socket.on('reports:deleted', ({ id } = {}) => {
          if (!active) return;
          if (!id) return;
          // eslint-disable-next-line no-console
          console.debug('[client][resident] reports:deleted', { id });
          setMyReports((prev) => prev.filter((r) => r.id !== id));
        });

        socket.on('connect_error', (err) => {
          if (!active) return;
          // eslint-disable-next-line no-console
          console.warn('[client][resident] socket connect_error', err && err.message ? err.message : err);
          // Fall back to HTTP fetch when socket connection is unavailable.
          loadMyReports({ silent: true });
        });

        socket.on('disconnect', (reason) => {
          if (!active) return;
          // eslint-disable-next-line no-console
          console.info('[client][resident] socket disconnected', { reason });
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
  }, [applyReportsSnapshot, currentUser, loadMyReports, isResponder]);

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
    () => visibleReports
      .filter((report) => String(report?.status || '').toLowerCase() !== 'archived')
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
    [visibleReports]
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

      const limited = unique.slice(0, 3);
      if (unique.length > 3) {
        showSubmitFeedback('error', 'You can attach up to 3 files per report. Extra files were ignored.');
      }
      return limited;
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

      // Add to attachments (max 3)
      setAttachments((prev) => {
        const unique = new Map(prev.map((f) => [`${f.name}-${f.size}`, f]));
        unique.set(`${file.name}-${file.size}`, file);
        const arr = Array.from(unique.values()).slice(0, 3);
        if (arr.length === 3 && prev.length === 3) {
          // already full; keep as-is
        }
        if (unique.size > 3) {
          showSubmitFeedback('error', 'You can attach up to 3 files per report. Extra photos were ignored.');
        }
        return arr;
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
      localStorage.setItem('onegapo_last_report_at', Date.now().toString());
      setForm(INITIAL_FORM);
      setAttachments([]);
      setActiveTab(isResponder ? 'reports' : 'home');
      await loadMyReports();
    } catch (err) {
      if (err.message && err.message.includes('5 minutes')) {
        const match = err.message.match(/(\d+)\s+second/);
        if (match && match[1]) {
          const remainingSecs = parseInt(match[1], 10);
          localStorage.setItem('onegapo_last_report_at', (Date.now() - (5 * 60 * 1000 - remainingSecs * 1000)).toString());
          setCooldownRemaining(remainingSecs);
        }
      }
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
    setLogoutConfirmOpen(false);
    setSigningOut(true);
    try {
      await logout();
    } finally {
      navigate('/login', { replace: true });
      setSigningOut(false);
    }
  };

  const handleRequestLogout = () => {
    if (signingOut) return;
    setLogoutConfirmOpen(true);
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
            <div className="resident-hero-card" onClick={() => setActiveTab(isResponder ? 'reports' : 'compose')}>
              <div className="resident-hero-content">
                <h2 className="resident-hero-title">{isResponder ? 'Assigned Reports' : 'Report an Issue'}</h2>
                <p className="resident-hero-desc">
                  {isResponder
                    ? 'Track and monitor reports assigned to your account.'
                    : 'Help keep our city clean and safe. Report an issue to the local government.'}
                </p>
                <span className="resident-hero-btn">
                  <span className="material-symbols-outlined" aria-hidden="true">{isResponder ? 'assignment' : 'edit_square'}</span>
                  {isResponder ? 'View Reports' : 'Submit Report'}
                </span>
              </div>
              <span className="material-symbols-outlined resident-hero-bg-icon" aria-hidden="true">{isResponder ? 'assignment' : 'report'}</span>
            </div>

            <div className="resident-summary-row">
              <article className="resident-summary-card">
                <p className="resident-summary-label">{isResponder ? 'Assigned Reports' : 'Total Reports'}</p>
                <p className="resident-summary-value">{visibleReports.length}</p>
              </article>
              <article className="resident-summary-card">
                <p className="resident-summary-label">Open Reports</p>
                <p className="resident-summary-value">
                  {visibleReports.filter((report) => report.status !== 'resolved').length}
                </p>
              </article>
            </div>

            <div className="resident-section">
              <div className="resident-card-header">
                <p className="resident-section-title">{isResponder ? 'My assigned reports' : 'My submitted reports'}</p>
                <button type="button" className="btn-outline btn-sm" onClick={loadMyReports} disabled={reportsLoading}>
                  {reportsLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              {reportsError ? <div className="dashboard-alert dashboard-alert-error">{reportsError}</div> : null}

              {reportsLoading ? (
                <p className="resident-muted">Loading your reports...</p>
              ) : visibleReports.length === 0 ? (
                <p className="resident-muted">{isResponder ? 'No reports are assigned to your account yet.' : 'No reports yet. Tap New Report to submit one.'}</p>
              ) : (
                <div className="resident-report-list">
                  {visibleReports.map((report) => {
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
                          <span className={`res-pill res-pill-cat ${getCategoryPillClass(report.category)}`}>
                            {report.category}
                          </span>
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

        {!isResponder && activeTab === 'compose' && (
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
                enableRouteControls={false}
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
                    style={{ display: 'none' }}
                    accept="image/*,video/*"
                    multiple
                    onChange={(event) => handleAttachmentChange(event, { append: true })}
                    disabled={submitting}
                  />

                  <input
                    id="resident-attachments-display"
                    type="text"
                    readOnly
                    className="form-input resident-attachments-display"
                    value={
                      attachments.length === 0
                        ? ''
                        : `${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
                    }
                    placeholder="No file chosen"
                    onClick={() => document.getElementById('resident-attachments').click()}
                    aria-label="Selected files"
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
                  multiple
                  onChange={(event) => handleAttachmentChange(event, { append: true })}
                  disabled={submitting}
                />
                <p className="resident-attachment-note">You can attach up to 3 files total.</p>
                {attachments.length > 0 ? (
                  <ul className="report-files-list">
                    {attachments.map((file) => (
                      <li key={`${file.name}-${file.size}`}>{file.name}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <button type="submit" className="btn-primary resident-submit-btn" disabled={submitting || cooldownRemaining > 0}>
                {submitting ? 'Submitting report...' : cooldownRemaining > 0 ? `Wait ${Math.floor(cooldownRemaining / 60)}m ${cooldownRemaining % 60}s` : 'Submit report'}
              </button>
            </form>
          </section>
        )}

        {isResponder && activeTab === 'reports' && (
          <section className="resident-card resident-map-card">
            <div className="resident-card-header">
              <p className="resident-card-title">Assigned Reports</p>
              <button type="button" className="btn-outline btn-sm" onClick={loadMyReports} disabled={reportsLoading}>
                {reportsLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {reportsError ? <div className="dashboard-alert dashboard-alert-error">{reportsError}</div> : null}
            {responderStatusError ? <div className="dashboard-alert dashboard-alert-error">{responderStatusError}</div> : null}

            {reportsLoading ? (
              <p className="resident-muted">Loading assigned reports...</p>
            ) : visibleReports.length === 0 ? (
              <p className="resident-muted">No reports are assigned to your account yet.</p>
            ) : (
              <div className="resident-report-list">
                {visibleReports.map((report) => (
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
                      <span className={`res-pill res-pill-cat ${getCategoryPillClass(report.category)}`}>
                        {report.category}
                      </span>
                    </div>
                    <p className="resident-report-title">{report.title}</p>
                    <p className="resident-report-desc">{report.description}</p>
                    <div className="resident-report-meta">
                      <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
                      {formatReportDate(report.createdAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'map' && (
          <section className="resident-card resident-map-card">
            <div className="resident-card-header">
                      <p className="resident-card-title">Map</p>
            </div>

            {reportsError ? <div className="dashboard-alert dashboard-alert-error">{reportsError}</div> : null}

            <ReportLocationMap
              markers={markers}
              helpText="Locations of reports submitted by residents."
              enableRouteControls={false}
            />
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

            <SettingsContent showLogout onLogout={handleRequestLogout} logoutLoading={signingOut} />
          </section>
        )}

        {logoutConfirmOpen ? (
          <AppModal
            title="Confirm logout"
            titleId="resident-logout-confirm-title"
            onClose={() => {
              if (!signingOut) setLogoutConfirmOpen(false);
            }}
          >
            <div className="app-confirm-modal-body">
              <p className="app-confirm-modal-text">Are you sure you want to log out?</p>
              <div className="app-confirm-modal-actions">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setLogoutConfirmOpen(false)}
                  disabled={signingOut}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleLogout}
                  disabled={signingOut}
                >
                  {signingOut ? 'Logging out...' : 'Log out'}
                </button>
              </div>
            </div>
          </AppModal>
        ) : null}

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
                      <span>Resolved on: </span>
                      <strong>{details.resolvedAt ? formatReportDate(details.resolvedAt) : 'Not available'}</strong>
                    </div>
                    <div className="resident-approval-modal-row">
                      <span>Resolved by: </span>
                      <strong>{details.resolvedByName || details.resolvedByLocation || 'Assigned branch'}</strong>
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

        {outsideOlongapoModalOpen ? (
          <AppModal
            title="Location Outside Olongapo City"
            titleId="outside-olongapo-resident-title"
            onClose={() => setOutsideOlongapoModalOpen(false)}
          >
            <div className="resident-geo-modal-body">
              <p>
                This report location is outside Olongapo City and cannot be submitted.
                Please pin a location within Olongapo City to continue.
              </p>
              <button
                type="button"
                className="btn-primary resident-geo-modal-btn"
                onClick={() => setOutsideOlongapoModalOpen(false)}
              >
                I understand
              </button>
            </div>
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
                        See Resolved Image
                      </button>
                    </div>
                  ) : null}

                  {/* Responder action buttons */}
                  {isResponder && !isResolved && String(activeTicketReport?.status || '').toLowerCase() !== 'rejected' ? (
                    <div className="resident-report-actions">
                      {String(activeTicketReport?.status || '').toLowerCase() !== 'in_progress' ? (
                        <button
                          type="button"
                          className="btn-outline"
                          disabled={updatingResponderStatus}
                          onClick={() => handleResponderStatusUpdate({
                            reportId: activeTicketReport.id,
                            status: 'in_progress',
                          })}
                        >
                          {updatingResponderStatus ? 'Updating…' : 'Mark In Progress'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={updatingResponderStatus}
                        onClick={() => handleOpenResolveModal(activeTicketReport)}
                      >
                        Resolve Report
                      </button>
                      {responderStatusError ? (
                        <p className="resident-muted" style={{ color: 'var(--color-danger, #e53e3e)', marginTop: '0.5rem' }}>
                          {responderStatusError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Attachment image viewer with prev/next when multiple photos */}
                  {(() => {
                    const attachmentsList = Array.isArray(activeTicketReport.attachments) ? activeTicketReport.attachments : [];
                    const imageUrls = attachmentsList
                      .map(getMediaUrl)
                      .filter(Boolean)
                      .filter((u) => /\.(png|jpe?g|gif|webp|bmp|svg)(?:\?|$)/i.test(u) || /^data:image\//i.test(u));

                    if (imageUrls.length === 0) return null;

                    const idx = Math.max(0, Math.min(ticketImageIndex, imageUrls.length - 1));

                    return (
                      <div className="resident-ticket-images">
                        <div className="resident-ticket-image-wrap">
                          {imageUrls.length > 1 && (
                            <button
                              type="button"
                              className="resident-image-nav resident-image-nav-left"
                              onClick={() => setTicketImageIndex((s) => (s - 1 + imageUrls.length) % imageUrls.length)}
                              aria-label="Previous image"
                            >
                              ‹
                            </button>
                          )}

                          <img
                            src={imageUrls[idx]}
                            alt={activeTicketReport.title || 'Report attachment'}
                            className="resident-ticket-image"
                          />

                          {imageUrls.length > 1 && (
                            <button
                              type="button"
                              className="resident-image-nav resident-image-nav-right"
                              onClick={() => setTicketImageIndex((s) => (s + 1) % imageUrls.length)}
                              aria-label="Next image"
                            >
                              ›
                            </button>
                          )}
                        </div>

                        {imageUrls.length > 1 && (
                          <div className="resident-ticket-image-counter">{idx + 1}/{imageUrls.length}</div>
                        )}
                      </div>
                    );
                  })()}

                  <button
                    type="button"
                    className="resident-ticket-logs-toggle"
                    onClick={() => setTicketLogsExpanded(!ticketLogsExpanded)}
                    aria-expanded={ticketLogsExpanded}
                    aria-label={`${ticketLogsExpanded ? 'Hide' : 'View'} update logs`}
                  >
                    <span className="resident-ticket-logs-toggle-label">
                      {ticketLogsExpanded ? 'Hide' : 'View'} logs
                    </span>
                    <span className={`resident-ticket-logs-toggle-icon ${ticketLogsExpanded ? 'expanded' : ''}`}>
                      ▼
                    </span>
                  </button>

                  <div 
                    className={`resident-ticket-timeline ${ticketLogsExpanded ? 'expanded' : ''}`} 
                    role="list"
                  >
                    {updates.map((update) => (
                      <article 
                        key={update.id} 
                        className={`resident-ticket-update resident-ticket-update-${update.status || 'submitted'}`}
                        role="listitem"
                      >
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


        {resolveModalOpen && resolveTargetReport ? (
          <AppModal
            title={`Resolve: ${resolveTargetReport.title || 'Report'}`}
            titleId="responder-resolve-modal-title"
            size="wide"
            onClose={() => {
              if (updatingResponderStatus) return;
              setResolveModalOpen(false);
              setResolveTargetReport(null);
              setResolveNote('');
              setResolvePhotos([]);
              setResolveError('');
            }}
          >
            <form onSubmit={handleSubmitResolve} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {resolveError ? <div className="dashboard-alert dashboard-alert-error">{resolveError}</div> : null}

              <div>
                <label className="form-label" htmlFor="responder-resolve-note">Resolution Notes</label>
                <textarea
                  id="responder-resolve-note"
                  className="form-input report-textarea"
                  rows={4}
                  placeholder="Describe what action was taken to resolve this report."
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                  disabled={updatingResponderStatus}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="responder-resolve-photos">
                  Resolution Photo(s) <span style={{ fontWeight: 400, opacity: 0.7 }}>(required if no notes)</span>
                </label>
                <input
                  id="responder-resolve-photos"
                  type="file"
                  accept="image/*"
                  multiple
                  className="form-input"
                  onChange={(e) => setResolvePhotos(Array.from(e.target.files || []))}
                  disabled={updatingResponderStatus}
                />
                {resolvePhotos.length > 0 ? (
                  <p className="resident-muted" style={{ marginTop: '0.25rem' }}>{resolvePhotos.length} photo(s) selected.</p>
                ) : null}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button type="submit" className="btn-primary" disabled={updatingResponderStatus}>
                  {updatingResponderStatus ? 'Submitting…' : 'Submit Resolution'}
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  disabled={updatingResponderStatus}
                  onClick={() => {
                    setResolveModalOpen(false);
                    setResolveTargetReport(null);
                    setResolveNote('');
                    setResolvePhotos([]);
                    setResolveError('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </AppModal>
        ) : null}

        {cameraModalOpen && (
          <div className="resident-fullscreen-camera-overlay" role="dialog" aria-modal="true" aria-label="Camera capture">
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
                    onClick={handleVideoFocus}
                    onTouchEnd={handleVideoFocus}
                    aria-label="Camera preview"
                  />
                  {/* Focus indicator (fixed positioned so it aligns with pointer) */}
                  {focusIndicator.visible && (
                    <div
                      aria-hidden="true"
                      style={{
                        position: 'fixed',
                        left: focusIndicator.left,
                        top: focusIndicator.top,
                        transform: 'translate(-50%, -50%)',
                        width: 72,
                        height: 72,
                        borderRadius: '50%',
                        border: '2px solid rgba(255,255,255,0.95)',
                        boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
                        pointerEvents: 'none',
                        transition: 'opacity 220ms ease',
                        zIndex: 9999,
                      }}
                    />
                  )}
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
        {!isResponder ? (
          <button
            type="button"
            className={`resident-tab ${activeTab === 'compose' ? 'resident-tab-active' : ''}`}
            onClick={() => setActiveTab('compose')}
            aria-label="Create report"
          >
            <span className="material-symbols-outlined resident-tab-icon" aria-hidden="true">edit_square</span>
            <span>Report</span>
          </button>
        ) : (
          <button
            type="button"
            className={`resident-tab ${activeTab === 'reports' ? 'resident-tab-active' : ''}`}
            onClick={() => setActiveTab('reports')}
            aria-label="Assigned reports"
          >
            <span className="material-symbols-outlined resident-tab-icon" aria-hidden="true">assignment</span>
            <span>Reports</span>
          </button>
        )}
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
