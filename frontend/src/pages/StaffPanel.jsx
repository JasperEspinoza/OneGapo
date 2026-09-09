import './AdminPanel.css';
import './StaffPanel.css';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useSettingsModal } from '../context/SettingsModalContext';
import ReportLocationMap from '../components/ReportLocationMap';
import AppModal from '../components/AppModal';
import InfoTooltip from '../components/InfoTooltip';
import OneGapoLogo from '../components/OneGapoLogo';
import { getSocketServerUrl } from '../config/runtime';

const PERMISSION_LABELS = {
  view_reports:         'View reports',
  update_reports:       'Update status',
  close_reports:        'Resolve reports',
  archive_reports:      'Archive reports',
};

const STATUS_OPTIONS = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'declined', label: 'Declined' },
];

const STAFF_STATUS_OPTIONS = STATUS_OPTIONS.filter((option) => option.value !== 'submitted');
const STAFF_STATUS_UPDATE_OPTIONS = STATUS_OPTIONS.filter(
  (option) => option.value !== 'submitted' && option.value !== 'in_review'
);

const REPORT_CLASSIFICATION_OPTIONS = [
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'safety', label: 'Public Safety' },
  { value: 'sanitation', label: 'Sanitation' },
  { value: 'disaster', label: 'Disaster / Emergency' },
  { value: 'general', label: 'General Concern' },
];

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'reports', label: 'Reports', icon: 'assignment' },
  { id: 'archive', label: 'Archive', icon: 'badge' },
  { id: 'team', label: 'Branch Staff', icon: 'groups' },
];

const MOBILE_SIDEBAR_MEDIA_QUERY = '(max-width: 767px)';

function formatDate(value) {
  if (!value) return 'Unknown date';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'Unknown date';
  return dt.toLocaleString();
}

function normalizeStatus(status) {
  const key = normalizeReportStatusKey(status);
  return key.replace(/_/g, ' ');
}

function normalizeReportStatusKey(status) {
  const key = String(status || 'submitted').trim().toLowerCase().replace(/\s+/g, '_');
  return key === 'rejected' ? 'declined' : key;
}

function getStatusClass(status) {
  const key = normalizeReportStatusKey(status);
  return `ss-status ss-status-${key}`;
}

function formatAuditEntry(entry) {
  const actorName = String(
    entry?.changedBy?.displayName ||
    entry?.changedBy?.fullName ||
    entry?.changedBy?.username ||
    entry?.changedBy?.email ||
    ''
  ).trim();
  const actorSuffix = actorName ? ` by ${actorName}` : '';

  if (entry?.type === 'archived') {
    return `Archived from ${normalizeStatus(entry.fromStatus)} on ${formatDate(entry.changedAt)}${actorSuffix}`;
  }

  if (entry?.type === 'forwarded') {
    return `Forwarded on ${formatDate(entry.changedAt)}${actorSuffix}`;
  }

  const fromStatus = normalizeStatus(entry?.fromStatus);
  const toStatus = normalizeStatus(entry?.toStatus);
  return `${fromStatus} -> ${toStatus} on ${formatDate(entry?.changedAt)}${actorSuffix}`;
}

function getReportPreviewImage(report) {
  if (!Array.isArray(report?.attachments)) return null;

  const imageAttachment = report.attachments.find((attachment) => {
    const src = String(
      attachment?.secureUrl ||
      attachment?.secure_url ||
      attachment?.url ||
      attachment?.uri ||
      attachment?.downloadURL ||
      attachment?.thumbnailUrl ||
      attachment?.src ||
      ''
    );
    const mime = String(
      attachment?.mimeType ||
      attachment?.mime_type ||
      attachment?.resourceType ||
      attachment?.resource_type ||
      ''
    ).toLowerCase();

    if (!src) return false;
    if (mime.includes('image')) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(src);
  });

  if (!imageAttachment) return null;

  return (
    imageAttachment.secureUrl ||
    imageAttachment.secure_url ||
    imageAttachment.url ||
    imageAttachment.uri ||
    imageAttachment.downloadURL ||
    imageAttachment.thumbnailUrl ||
    imageAttachment.src ||
    null
  );
}

function getReportMediaItems(report) {
  if (!Array.isArray(report?.attachments)) return [];

  return report.attachments
    .map((attachment, index) => {
      const src = String(
        attachment?.secureUrl ||
        attachment?.secure_url ||
        attachment?.url ||
        attachment?.uri ||
        attachment?.downloadURL ||
        attachment?.thumbnailUrl ||
        attachment?.src ||
        ''
      ).trim();
      if (!src) return null;

      const mime = String(
        attachment?.mimeType ||
        attachment?.mime_type ||
        attachment?.resourceType ||
        attachment?.resource_type ||
        ''
      ).toLowerCase();

      const isImage = mime.includes('image') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(src);
      const isVideo = mime.includes('video') || /\.(mp4|mov|webm|ogg|m4v)$/i.test(src);

      return {
        id: `${src}-${index}`,
        src,
        type: isImage ? 'image' : (isVideo ? 'video' : 'file'),
        alt: attachment?.originalName || report?.title || `Attachment ${index + 1}`,
      };
    })
    .filter(Boolean);
}

function getPersonDisplayName(person) {
  return (
    person?.fullName ||
    person?.displayName ||
    person?.username ||
    person?.email ||
    person?.name ||
    'Unknown'
  );
}

function getDuplicateLocationLabel(report) {
  const rawAddress = String(report?.location?.address || '').trim();
  if (rawAddress) {
    const parts = rawAddress
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length > 0) {
      return parts.slice(0, 2).join(', ');
    }
  }

  return String(report?.location?.barangay || '').trim();
}

function isEmergencyReport(report) {
  const category = String(report?.category || '').trim().toLowerCase();
  if (category === 'disaster' || category === 'safety') {
    return true;
  }

  const title = String(report?.title || '').trim().toLowerCase();
  const description = String(report?.description || '').trim().toLowerCase();
  return /(emergency|urgent|critical|high[\s-]?priority)/i.test(`${title} ${description}`);
}

function notificationTimestamp(notification) {
  const value = notification?.createdAt;
  const ms = value ? new Date(value).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

export default function StaffPanel() {
  const { currentUser, userClaims, logout } = useAuth();
  const { openSettings } = useSettingsModal();
  const navigate = useNavigate();

  const isPrimaryAdmin = String(currentUser?.email || '').toLowerCase() === 'onegapo2026@gmail.com';
  const role = userClaims?.role;
  const permissions = Array.isArray(userClaims?.permissions) ? userClaims.permissions : [];
  const effectivePermissions = permissions;
  const location = userClaims?.location || 'Unassigned';

  const canViewReports = effectivePermissions.includes('view_reports') || effectivePermissions.includes('update_reports') || effectivePermissions.includes('close_reports') || effectivePermissions.includes('archive_reports');
  const canUpdateReports = effectivePermissions.includes('update_reports') || effectivePermissions.includes('close_reports');
  const canManageReportLifecycle = role === 'admin' || effectivePermissions.includes('archive_reports');
  const canManageStaff = effectivePermissions.includes('add_staffs');

  const [activeSection, setActiveSection] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobileSidebarViewport, setIsMobileSidebarViewport] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(MOBILE_SIDEBAR_MEDIA_QUERY).matches;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return window.localStorage.getItem('sp-sidebar-collapsed') === 'true';
  });
  const [searchQuery, setSearchQuery] = useState('');

  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [reportStatusFilter, setReportStatusFilter] = useState('all');
  const [reportClassificationFilter, setReportClassificationFilter] = useState('all');
  const [mapFocusReportId, setMapFocusReportId] = useState('');
  const [mapAutoRouteRequestKey, setMapAutoRouteRequestKey] = useState(0);
  const [updatingReportId, setUpdatingReportId] = useState('');
  const [reportActionError, setReportActionError] = useState('');
  const [reportActionSuccess, setReportActionSuccess] = useState('');
  const [selectedReport, setSelectedReport] = useState(null);
  const [expandedReportImage, setExpandedReportImage] = useState(null);
  const [resolveTargetReportId, setResolveTargetReportId] = useState('');
  const [resolveProgressNote, setResolveProgressNote] = useState('');
  const [resolvePhotos, setResolvePhotos] = useState([]);
  const [declineTargetReportId, setDeclineTargetReportId] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [selectedReportResponderUid, setSelectedReportResponderUid] = useState('');
  const [assigningResponderReportId, setAssigningResponderReportId] = useState('');
  const [forwardTargets, setForwardTargets] = useState([]);
  const [forwardTargetByReport, setForwardTargetByReport] = useState({});
  const [forwardingReportId, setForwardingReportId] = useState('');
  const [duplicatingReportId, setDuplicatingReportId] = useState('');
  const [revokingDuplicateReportId, setRevokingDuplicateReportId] = useState('');
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [duplicateTargetReportId, setDuplicateTargetReportId] = useState('');
  const [duplicateMotherReportId, setDuplicateMotherReportId] = useState('');
  const [duplicateModalError, setDuplicateModalError] = useState('');
  const [archivingReportId, setArchivingReportId] = useState('');
  const [deletingReportId, setDeletingReportId] = useState('');
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmDialogLoading, setConfirmDialogLoading] = useState(false);

  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState('');
  const autoInReviewAttemptedRef = useRef(new Set());

  const api = useCallback(async (url, options = {}) => {
    const idToken = await currentUser.getIdToken();
    const isFormDataBody = options.body instanceof FormData;
    return fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(isFormDataBody ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    });
  }, [currentUser]);

  // Team management
  const [branchStaff,   setBranchStaff]   = useState([]);
  const [staffLoading,  setStaffLoading]  = useState(false);
  const [staffError,    setStaffError]    = useState('');
  const [newEmail,      setNewEmail]      = useState('');
  const [creating,      setCreating]      = useState(false);
  const [createError,   setCreateError]   = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [roles,         setRoles]         = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');

  useEffect(() => {
    window.localStorage.setItem('sp-sidebar-collapsed', sidebarCollapsed ? 'true' : 'false');
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const mediaQuery = window.matchMedia(MOBILE_SIDEBAR_MEDIA_QUERY);
    const syncViewport = (event) => {
      setIsMobileSidebarViewport(event.matches);
    };

    setIsMobileSidebarViewport(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncViewport);
      return () => mediaQuery.removeEventListener('change', syncViewport);
    }

    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    if (isMobileSidebarViewport) return;
    setSidebarOpen(false);
  }, [isMobileSidebarViewport]);

  const handleSidebarRailToggle = useCallback(() => {
    if (isMobileSidebarViewport) {
      setSidebarOpen((prev) => !prev);
      return;
    }

    setSidebarCollapsed((prev) => !prev);
  }, [isMobileSidebarViewport]);

  const loadReports = useCallback(async ({ silent = false } = {}) => {
    if (!canViewReports) {
      setReports([]);
      return;
    }

    if (!silent) {
      setReportsLoading(true);
    }
    setReportsError('');
    try {
      const res = await api('/api/reports');
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || 'Failed to load reports.');
      setReports(Array.isArray(data)
        ? data.map((report) => ({
            ...report,
            status: normalizeReportStatusKey(report?.status),
          }))
        : []);
    } catch (err) {
      setReportsError(err.message || 'Failed to load reports.');
    } finally {
      if (!silent) {
        setReportsLoading(false);
      }
    }
  }, [api, canViewReports]);

  const loadBranchStaff = useCallback(async () => {
    if (!userClaims?.branchId) {
      setBranchStaff([]);
      return;
    }
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
  }, [api, canManageStaff, userClaims?.branchId]);

  const loadRoles = useCallback(async () => {
    if (!canManageStaff) {
      setRoles([]);
      return;
    }
    try {
      const res = await api('/api/admin/roles');
      const data = await res.json();
      if (res.ok) setRoles(data);
    } catch {
      // roles are optional, ignore errors
    }
  }, [api, canManageStaff]);

  const loadForwardTargets = useCallback(async () => {
    if (!canUpdateReports) return;
    try {
      const res = await api('/api/reports/forward-targets');
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || 'Failed to load forward targets.');
      setForwardTargets(Array.isArray(data) ? data : []);
    } catch {
      setForwardTargets([]);
    }
  }, [api, canUpdateReports]);

  const handleAssignResponder = useCallback(async (report, responderUid) => {
    const reportId = report?.id;
    if (!reportId || assigningResponderReportId === reportId) return;

    setAssigningResponderReportId(reportId);
    setReportActionError('');
    setReportActionSuccess('');
    try {
      const res = await api(`/api/reports/${reportId}/assignment`, {
        method: 'PATCH',
        body: JSON.stringify({ responderUid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update responder assignment.');

      setReports((prev) => prev.map((item) => (item.id === reportId ? { ...item, ...data.report } : item)));
      setSelectedReport((prev) => (prev?.id === reportId ? { ...prev, ...data.report } : prev));
      
      setReportActionSuccess('Responder assigned successfully!');
      
      // Auto clear success message after 3 seconds
      setTimeout(() => setReportActionSuccess(''), 3000);
    } catch (err) {
      setReportActionError(err.message || 'Failed to update responder assignment.');
    } finally {
      setAssigningResponderReportId('');
    }
  }, [api, assigningResponderReportId]);

  const openConfirmDialog = useCallback(({ title, message, confirmLabel = 'Confirm', confirmClassName = 'ap-btn-primary', onConfirm }) => {
    setConfirmDialog({ title, message, confirmLabel, confirmClassName, onConfirm });
  }, []);

  const closeConfirmDialog = useCallback(() => {
    if (confirmDialogLoading) return;
    setConfirmDialog(null);
  }, [confirmDialogLoading]);

  const handleConfirmDialogSubmit = useCallback(async () => {
    if (!confirmDialog?.onConfirm || confirmDialogLoading) return;
    setConfirmDialogLoading(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } finally {
      setConfirmDialogLoading(false);
    }
  }, [confirmDialog, confirmDialogLoading]);

  useEffect(() => {
    loadBranchStaff();
    loadRoles();
    loadForwardTargets();
  }, [loadBranchStaff, loadRoles, loadForwardTargets]);

  useEffect(() => {
    if (!currentUser || !canViewReports) {
      setNotifications([]);
      setNotifLoading(false);
      setNotifError('');
      return undefined;
    }

    let active = true;
    let socket;

    const connectRealtimeNotifications = async () => {
      setNotifLoading(true);
      setNotifError('');

      try {
        const idToken = await currentUser.getIdToken();
        if (!active) return;

        const socketUrl = getSocketServerUrl();
        if (!socketUrl) {
          setNotifLoading(false);
          setNotifError('Realtime notifications unavailable.');
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
          console.debug('[client][staff] socket connected', { socketId: socket.id });
          setNotifLoading(false);
          setNotifError('');
        });

        socket.on('notifications:data', (payload) => {
          if (!active) return;
          // eslint-disable-next-line no-console
          console.debug('[client][staff] notifications:data', { count: Array.isArray(payload) ? payload.length : 0 });
          setNotifications(Array.isArray(payload) ? payload : []);
          setNotifLoading(false);
          setNotifError('');
        });

        socket.on('reports:data', (payload) => {
          if (!active) return;
          // eslint-disable-next-line no-console
          console.debug('[client][staff] reports:data', { count: Array.isArray(payload) ? payload.length : 0 });
          setReports(Array.isArray(payload) ? payload : []);
          setReportsError('');
        });

        socket.on('reports:created', (report) => {
          if (!active) return;
          // eslint-disable-next-line no-console
          console.debug('[client][staff] reports:created', { id: report?.id });
          setReports((prev) => {
            if (!report || !report.id) return prev;
            // prevent duplicate
            if (prev.some((r) => r.id === report.id)) return prev;
            return [report, ...prev];
          });
        });

        socket.on('reports:modified', (report) => {
          if (!active) return;
          // eslint-disable-next-line no-console
          console.debug('[client][staff] reports:modified', { id: report?.id });
          setReports((prev) => {
            if (!report || !report.id) return prev;
            return prev.map((r) => (r.id === report.id ? { ...r, ...report } : r));
          });
        });

        socket.on('reports:deleted', ({ id } = {}) => {
          if (!active) return;
          // eslint-disable-next-line no-console
          console.debug('[client][staff] reports:deleted', { id });
          if (!id) return;
          setReports((prev) => prev.filter((r) => r.id !== id));
        });

        socket.on('reports:refresh', () => {
          if (!active) return;
          // eslint-disable-next-line no-console
          console.debug('[client][staff] reports:refresh');
          loadReports({ silent: true });
        });

        socket.on('connect_error', (err) => {
          if (!active) return;
          // eslint-disable-next-line no-console
          console.warn('[client][staff] socket connect_error', err && err.message ? err.message : err);
          setNotifLoading(false);
          setNotifError('Realtime notifications unavailable.');
        });

        socket.on('disconnect', (reason) => {
          if (!active) return;
          // eslint-disable-next-line no-console
          console.info('[client][staff] socket disconnected', { reason });
        });
      } catch {
        if (!active) return;
        setNotifLoading(false);
        setNotifError('Realtime notifications unavailable.');
      }
    };

    connectRealtimeNotifications();

    return () => {
      active = false;
      if (socket) {
        socket.disconnect();
      }
    };
  }, [canViewReports, currentUser]);

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => {
      if (item.id === 'reports') return canViewReports;
      if (item.id === 'archive') return canManageReportLifecycle;
      if (item.id === 'team') return canManageStaff;
      return true;
    }),
    [canManageStaff, canViewReports, canManageReportLifecycle]
  );

  useEffect(() => {
    const sectionExists = visibleNavItems.some((item) => item.id === activeSection);
    if (sectionExists) return;
    setActiveSection(visibleNavItems[0]?.id || 'overview');
  }, [activeSection, visibleNavItems]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (activeSection === 'reports') {
      loadReports();
    }
  }, [activeSection, loadReports]);

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

  const handleUpdateReportStatus = async (reportId, nextStatus, metadata = {}) => {
    const progressNote = String(metadata?.progressNote || '').trim();
    const resolutionPhotos = Array.isArray(metadata?.resolutionPhotos)
      ? metadata.resolutionPhotos.filter(Boolean)
      : [];

    setReportActionError('');
    setUpdatingReportId(reportId);
    try {
      let res;

      if (resolutionPhotos.length > 0) {
        const formData = new FormData();
        formData.append('status', nextStatus);
        if (progressNote) {
          formData.append('progressNote', progressNote);
        }
        resolutionPhotos.forEach((file) => {
          formData.append('resolutionPhotos', file);
        });

        res = await api(`/api/reports/${reportId}/status`, {
          method: 'PATCH',
          body: formData,
        });
      } else {
        const payload = {
          status: nextStatus,
          ...(progressNote ? { progressNote } : {}),
        };

        res = await api(`/api/reports/${reportId}/status`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }

      let data = await res.json().catch(() => ({}));

      // Older hosted API deployments used "rejected" instead of "declined".
      // Retry only when the API explicitly reports that legacy contract.
      const canRetryWithRejected = nextStatus === 'declined'
        && res.status === 400
        && String(data?.error || '').toLowerCase().includes('rejected');
      if (canRetryWithRejected) {
        res = await api(`/api/reports/${reportId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'rejected',
            ...(progressNote ? { progressNote } : {}),
          }),
        });
        data = await res.json().catch(() => ({}));
      }

      if (!res.ok) throw new Error(data.error || 'Failed to update report status.');

      const normalizedResponseReport = data?.report
        ? { ...data.report, status: normalizeReportStatusKey(data.report.status || nextStatus) }
        : null;

      setReports((prev) =>
        prev.map((report) =>
          report.id === reportId
            ? {
                ...report,
                ...(normalizedResponseReport || {}),
                status: normalizedResponseReport?.status || normalizeReportStatusKey(nextStatus),
                updatedAt: normalizedResponseReport?.updatedAt || new Date().toISOString(),
              }
            : report
        )
      );

      setSelectedReport((prev) => {
        if (!prev || prev.id !== reportId) return prev;
        return {
          ...prev,
          ...(normalizedResponseReport || {}),
          status: normalizedResponseReport?.status || normalizeReportStatusKey(nextStatus),
          updatedAt: normalizedResponseReport?.updatedAt || new Date().toISOString(),
        };
      });

      setResolveTargetReportId('');
      setResolveProgressNote('');
      setResolvePhotos([]);
      setDeclineTargetReportId('');
      setDeclineReason('');
      return true;
    } catch (err) {
      setReportActionError(err.message || 'Failed to update report status.');
      return false;
    } finally {
      setUpdatingReportId('');
    }
  };

  const handleRequestStatusUpdate = (reportId, nextStatus) => {
    if (nextStatus === 'resolved') {
      setReportActionError('');
      setResolveTargetReportId(reportId);
      setResolveProgressNote('');
      setResolvePhotos([]);
      return;
    }

    if (nextStatus === 'declined') {
      setReportActionError('');
      setDeclineTargetReportId(reportId);
      setDeclineReason('');
      return;
    }

    handleUpdateReportStatus(reportId, nextStatus);
  };

  const handleSubmitResolution = async (event) => {
    event.preventDefault();

    const note = resolveProgressNote.trim();
    if (!resolveTargetReportId) return;

    if (!note && resolvePhotos.length === 0) {
      setReportActionError('Progress notes or at least one resolution photo are required to resolve this report.');
      return;
    }

    await handleUpdateReportStatus(resolveTargetReportId, 'resolved', {
      progressNote: note,
      resolutionPhotos: resolvePhotos,
    });
  };

  const handleSubmitDecline = async (event) => {
    event.preventDefault();

    const note = declineReason.trim();
    if (!declineTargetReportId) return;

    if (!note) {
      setReportActionError('A justification is required when declining a report.');
      return;
    }

    await handleUpdateReportStatus(declineTargetReportId, 'declined', {
      progressNote: note,
    });
  };

  const handleForwardSelection = (reportId, branchId) => {
    setForwardTargetByReport((prev) => ({ ...prev, [reportId]: branchId }));
  };

  const handleForwardReport = async (report) => {
    const reportId = report?.id;
    const targetBranchId = String(forwardTargetByReport[reportId] || '').trim();
    if (!reportId || !targetBranchId) {
      setReportActionError('Select a destination branch before forwarding.');
      return;
    }

    setForwardingReportId(reportId);
    setReportActionError('');
    try {
      const res = await api(`/api/reports/${reportId}/forward`, {
        method: 'PATCH',
        body: JSON.stringify({ targetBranchId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to forward report.');

      setReports((prev) =>
        prev.map((item) => (item.id === reportId ? { ...item, ...(data?.report || {}) } : item))
      );
      setSelectedReport((prev) => {
        if (!prev || prev.id !== reportId) return prev;
        return { ...prev, ...(data?.report || {}) };
      });
    } catch (err) {
      setReportActionError(err.message || 'Failed to forward report.');
    } finally {
      setForwardingReportId('');
    }
  };

  const handleOpenDuplicateModal = (report) => {
    const reportId = String(report?.id || '').trim();
    if (!reportId) return;

    const isMotherReport = reports.some(
      (item) => String(item?.duplicateOfReportId || '').trim() === reportId
    );
    if (isMotherReport) {
      setReportActionError('This report is currently a mother report and cannot be marked as duplicate.');
      return;
    }

    const defaultMotherId = String(report?.duplicateOfReportId || '').trim()
      || String(
        reports.find((item) => (
          String(item?.id || '').trim()
          && String(item.id) !== reportId
          && !String(item?.duplicateOfReportId || '').trim()
        ))?.id || ''
      ).trim();

    setDuplicateTargetReportId(reportId);
    setDuplicateMotherReportId(defaultMotherId);
    setDuplicateModalError('');
    setDuplicateModalOpen(true);
  };

  const handleSubmitDuplicateLink = async () => {
    const reportId = String(duplicateTargetReportId || '').trim();
    const motherReportId = String(duplicateMotherReportId || '').trim();
    const isEligibleMotherSelection = duplicateMotherReportOptions.some(
      (report) => String(report?.id || '').trim() === motherReportId
    );

    if (!reportId) return;
    if (!motherReportId) {
      setDuplicateModalError('Select a mother report.');
      return;
    }

    if (!isEligibleMotherSelection) {
      setDuplicateModalError('Select an eligible mother report.');
      return;
    }

    if (motherReportId === reportId) {
      setDuplicateModalError('A report cannot be marked as a duplicate of itself.');
      return;
    }

    setDuplicateModalError('');
    setDuplicatingReportId(reportId);

    try {
      const res = await api(`/api/reports/${reportId}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ motherReportId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to mark report as duplicate.');

      setReports((prev) =>
        prev.map((item) => (item.id === reportId ? { ...item, ...(data?.report || {}) } : item))
      );
      setSelectedReport((prev) => {
        if (!prev || prev.id !== reportId) return prev;
        return { ...prev, ...(data?.report || {}) };
      });
      setDuplicateModalOpen(false);
      setDuplicateTargetReportId('');
      setDuplicateMotherReportId('');
    } catch (err) {
      setDuplicateModalError(err.message || 'Failed to mark report as duplicate.');
    } finally {
      setDuplicatingReportId('');
    }
  };

  const handleRevokeDuplicateLink = async (report, { skipConfirm = false } = {}) => {
    const reportId = String(report?.id || '').trim();
    if (!reportId) return;

    const isDuplicateChild = Boolean(String(report?.duplicateOfReportId || '').trim());
    if (!isDuplicateChild) {
      setReportActionError('This report is not marked as duplicate.');
      return;
    }

    const title = report?.title || 'this report';
    if (!skipConfirm) {
      openConfirmDialog({
        title: 'Revoke duplication',
        message: `Revoke duplication for "${title}"?`,
        confirmLabel: 'Revoke',
        confirmClassName: 'ap-btn-danger',
        onConfirm: () => handleRevokeDuplicateLink(report, { skipConfirm: true }),
      });
      return;
    }

    setReportActionError('');
    setRevokingDuplicateReportId(reportId);

    try {
      const res = await api(`/api/reports/${reportId}/duplicate`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to revoke duplication.');

      setReports((prev) =>
        prev.map((item) => {
          if (item.id !== reportId) return item;
          return {
            ...item,
            ...(data?.report || {}),
            duplicateOfReport: null,
            duplicateOfReportId: null,
            isDuplicateChild: false,
            duplicateSourceMissing: false,
          };
        })
      );
      setSelectedReport((prev) => {
        if (!prev || prev.id !== reportId) return prev;
        return {
          ...prev,
          ...(data?.report || {}),
          duplicateOfReport: null,
          duplicateOfReportId: null,
          isDuplicateChild: false,
          duplicateSourceMissing: false,
        };
      });
    } catch (err) {
      setReportActionError(err.message || 'Failed to revoke duplication.');
    } finally {
      setRevokingDuplicateReportId('');
    }
  };

  const handleArchiveReport = async (report, { skipConfirm = false } = {}) => {
    const reportId = String(report?.id || '').trim();
    if (!reportId) return;

    if (String(report?.status || '').toLowerCase() === 'archived') {
      setReportActionError('This report is already archived.');
      return;
    }

    const title = report?.title || 'this report';
    if (!skipConfirm) {
      openConfirmDialog({
        title: 'Archive report',
        message: `Archive "${title}"?`,
        confirmLabel: 'Archive',
        confirmClassName: 'ap-btn-danger',
        onConfirm: () => handleArchiveReport(report, { skipConfirm: true }),
      });
      return;
    }

    setReportActionError('');
    setArchivingReportId(reportId);

    try {
      const res = await api(`/api/reports/${reportId}/archive`, {
        method: 'PATCH',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to archive report.');

      setReports((prev) =>
        prev.map((item) => (item.id === reportId ? { ...item, ...(data?.report || {}) } : item))
      );
      setSelectedReport((prev) => {
        if (!prev || prev.id !== reportId) return prev;
        return { ...prev, ...(data?.report || {}) };
      });
    } catch (err) {
      setReportActionError(err.message || 'Failed to archive report.');
    } finally {
      setArchivingReportId('');
    }
  };

  const handleDeleteReport = async (report, { skipConfirm = false } = {}) => {
    const reportId = String(report?.id || '').trim();
    if (!reportId) return;

    const title = report?.title || 'this report';
    if (!skipConfirm) {
      openConfirmDialog({
        title: 'Delete report',
        message: `Permanently delete "${title}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        confirmClassName: 'ap-btn-danger',
        onConfirm: () => handleDeleteReport(report, { skipConfirm: true }),
      });
      return;
    }

    setReportActionError('');
    setDeletingReportId(reportId);

    try {
      const res = await api(`/api/reports/${reportId}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete report.');

      setReports((prev) => prev.filter((item) => item.id !== reportId));
      setSelectedReport((prev) => (prev?.id === reportId ? null : prev));
      setResolveTargetReportId((prev) => (prev === reportId ? '' : prev));
    } catch (err) {
      setReportActionError(err.message || 'Failed to delete report.');
    } finally {
      setDeletingReportId('');
    }
  };

  const handleOpenReport = (report) => {
    if (!report) return;
    setSelectedReport(report);
  };

  useEffect(() => {
    const reportId = String(selectedReport?.id || '').trim();
    const status = String(selectedReport?.status || '').trim().toLowerCase();

    if (!canViewReports || !reportId || status !== 'submitted') {
      return;
    }

    if (autoInReviewAttemptedRef.current.has(reportId)) {
      return;
    }

    autoInReviewAttemptedRef.current.add(reportId);

    handleUpdateReportStatus(reportId, 'in_review').then((didUpdate) => {
      if (!didUpdate) {
        autoInReviewAttemptedRef.current.delete(reportId);
      }
    });
  }, [selectedReport, canViewReports]);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((item) => !item?.isRead).length,
    [notifications]
  );

  const prioritizedNotifications = useMemo(() => {
    return notifications
      .filter((item) => !item?.isRead)
      .sort((a, b) => notificationTimestamp(b) - notificationTimestamp(a));
  }, [notifications]);

  const handleNotificationOpen = () => {
    setNotifOpen((prev) => !prev);
  };

  const handleMarkNotificationRead = async (notificationId) => {
    try {
      const res = await api(`/api/reports/notifications/${notificationId}/read`, {
        method: 'PATCH',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update notification.');
      const updated = data?.notification;
      if (!updated) return;

      setNotifications((prev) =>
        prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );
    } catch {
      // Keep dropdown responsive even if marking as read fails.
    }
  };

  const handleClearNotifications = async () => {
    const unreadIds = notifications
      .filter((item) => !item?.isRead)
      .map((item) => item.id)
      .filter(Boolean);

    if (unreadIds.length === 0) return;

    setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));

    await Promise.allSettled(
      unreadIds.map((notificationId) =>
        api(`/api/reports/notifications/${notificationId}/read`, {
          method: 'PATCH',
        })
      )
    );
  };

  const visibleReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return reports.filter((report) => {
      const isArchived = String(report?.status || '').toLowerCase() === 'archived';
      if (activeSection === 'archive' && !isArchived) return false;
      if (activeSection !== 'archive' && isArchived) return false;

      const statusMatches = reportStatusFilter === 'all'
        ? true
        : normalizeReportStatusKey(report?.status) === normalizeReportStatusKey(reportStatusFilter);
      if (!statusMatches) return false;

      const classificationMatches = reportClassificationFilter === 'all'
        ? true
        : String(report?.category || '').toLowerCase() === reportClassificationFilter;
      if (!classificationMatches) return false;

      if (!q) return true;

      const haystack = [
        report?.title,
        report?.description,
        report?.category,
        report?.location?.address,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');

      return haystack.includes(q);
    });
  }, [reports, reportStatusFilter, reportClassificationFilter, searchQuery, activeSection]);

  const reportMarkers = useMemo(() => {
    return visibleReports
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
        barangay: report?.location?.barangay || '',
        createdAt: report.createdAt,
        attachments: Array.isArray(report.attachments) ? report.attachments : [],
      }));
  }, [visibleReports]);

  const reportStats = useMemo(() => {
    const submitted = reports.filter((r) => normalizeReportStatusKey(r.status) === 'submitted').length;
    const inReview = reports.filter((r) => normalizeReportStatusKey(r.status) === 'in_review').length;
    const resolved = reports.filter((r) => normalizeReportStatusKey(r.status) === 'resolved').length;
    const declined = reports.filter((r) => normalizeReportStatusKey(r.status) === 'declined').length;
    return { submitted, inReview, resolved, declined };
  }, [reports]);

  const resolveTargetReport = useMemo(
    () => reports.find((report) => report.id === resolveTargetReportId) || null,
    [reports, resolveTargetReportId]
  );

  const declineTargetReport = useMemo(
    () => reports.find((report) => report.id === declineTargetReportId) || null,
    [reports, declineTargetReportId]
  );

  const selectedReportPreviewImage = selectedReport ? getReportPreviewImage(selectedReport) : null;
  const selectedReportMediaItems = useMemo(
    () => (selectedReport ? getReportMediaItems(selectedReport) : []),
    [selectedReport]
  );
  const duplicateTargetReport = useMemo(
    () => reports.find((report) => String(report?.id || '').trim() === duplicateTargetReportId) || null,
    [reports, duplicateTargetReportId]
  );
  const motherReportIds = useMemo(
    () => new Set(
      reports
        .map((report) => String(report?.duplicateOfReportId || '').trim())
        .filter(Boolean)
    ),
    [reports]
  );
  const duplicateMotherReportOptions = useMemo(
    () => reports.filter((report) => (
      String(report?.id || '').trim()
      && String(report.id) !== duplicateTargetReportId
      && !String(report?.duplicateOfReportId || '').trim()
    )),
    [reports, duplicateTargetReportId]
  );
  const duplicateSelectedMotherReport = useMemo(
    () => reports.find((report) => String(report?.id || '').trim() === String(duplicateMotherReportId || '').trim()) || null,
    [reports, duplicateMotherReportId]
  );
  const duplicateSelectedMotherPreviewImage = duplicateSelectedMotherReport
    ? getReportPreviewImage(duplicateSelectedMotherReport)
    : null;
  const selectedReportDuplicateChildren = useMemo(() => {
    const motherReportId = String(selectedReport?.id || '').trim();
    if (!motherReportId) {
      return [];
    }

    return reports
      .filter((report) => String(report?.duplicateOfReportId || '').trim() === motherReportId)
      .slice()
      .sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0));
  }, [reports, selectedReport?.id]);
  const selectedReportCanManageStatusAndForward = Boolean(
    selectedReport &&
    canUpdateReports &&
    !selectedReport?.isDuplicateChild &&
    String(selectedReport?.status || '').toLowerCase() !== 'archived'
  );
  const customRole = String(userClaims?.customRoleName || '').trim().toLowerCase();
  const isBranchMainAdmin = !isPrimaryAdmin && Boolean(userClaims?.branchId) && (
    permissions.includes('add_staffs') ||
    customRole === 'branch admin' ||
    customRole === 'main admin'
  );
  const canAssignResponders = false;

  const initials = (currentUser?.displayName || currentUser?.email || 'S')[0].toUpperCase();
  const displayName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Staff';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className={`ap-shell${sidebarCollapsed ? ' ap-shell-sidebar-collapsed' : ''}`}>
      {sidebarOpen ? <div className="ap-sidebar-overlay" onClick={() => setSidebarOpen(false)} /> : null}

      <aside className={`ap-sidebar${sidebarOpen ? ' ap-sidebar-mobile-open' : ''}`}>
        <div className="ap-sidebar-brand">
          <div className="ap-brand-icon"><OneGapoLogo className="ap-brand-logo onegapo-logo-force-dark" decorative /></div>
          <div className="ap-brand-copy">
            <div className="ap-brand-name">OneGapo</div>
            <div className="ap-brand-sub">Branch Staff Console</div>
          </div>
          <button
            type="button"
            className="ap-sidebar-rail-toggle"
            onClick={handleSidebarRailToggle}
            aria-label={isMobileSidebarViewport ? (sidebarOpen ? 'Close sidebar' : 'Open sidebar') : (sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar')}
          >
            <span className="material-symbols-outlined ap-hamburger-icon" aria-hidden="true">
              {isMobileSidebarViewport
                ? (sidebarOpen ? 'close' : 'menu')
                : (sidebarCollapsed ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left')}
            </span>
          </button>
        </div>

        <nav className="ap-nav">
          {visibleNavItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ap-nav-item${activeSection === item.id ? ' ap-nav-item-active' : ''}`}
              onClick={() => { setActiveSection(item.id); setSidebarOpen(false); }}
            >
              <span className="ap-nav-icon material-symbols-outlined" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="ap-sidebar-footer">
          <button type="button" className="ap-nav-item" onClick={() => { openSettings(); setSidebarOpen(false); }}>
            <span className="ap-nav-icon material-symbols-outlined" aria-hidden="true">settings</span>
            <span>Settings</span>
          </button>
          <button type="button" className="ap-nav-item ap-nav-signout" onClick={handleLogout}>
            <span className="ap-nav-icon material-symbols-outlined" aria-hidden="true">logout</span>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <div className="ap-main">
        <header className="ap-header">
          <div className="ap-header-left">
            <button
              type="button"
              className="ap-hamburger"
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            >
              <span className="material-symbols-outlined ap-hamburger-icon" aria-hidden="true">
                {sidebarOpen ? 'close' : 'menu'}
              </span>
            </button>
            <div className="ap-search-wrap">
              <span className="ap-search-icon material-symbols-outlined" aria-hidden="true">search</span>
              <input
                type="text"
                className="ap-search-input"
                placeholder="Search reports or location"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
          </div>
          <div className="ap-header-right">
            <div className="ap-notif-wrap">
              <button
                type="button"
                className="ap-notif-btn"
                title="Notifications"
                onClick={handleNotificationOpen}
                aria-label="Notifications"
              >
                <svg className="ss-notif-bell-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                  <path
                    d="M15 18H9M18 16V11C18 7.686 15.314 5 12 5C8.686 5 6 7.686 6 11V16L4 18V19H20V18L18 16ZM13.73 19C13.554 19.606 12.999 20 12.365 20H11.635C11.001 20 10.446 19.606 10.27 19"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {unreadNotificationsCount > 0 ? (
                  <span className="ap-notif-badge" aria-hidden="true">{unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}</span>
                ) : null}
              </button>
              {notifOpen ? (
                <div className="ap-notif-menu" role="menu" aria-label="Notifications list">
                  <div className="ap-notif-menu-header">
                    Notifications
                  </div>
                  {notifLoading ? <p className="ap-notif-empty">Loading…</p> : null}
                  {!notifLoading && notifError ? <p className="ap-notif-empty">{notifError}</p> : null}
                  {!notifLoading && !notifError && prioritizedNotifications.length === 0 ? (
                    <p className="ap-notif-empty">No notifications yet.</p>
                  ) : null}
                  {!notifLoading && !notifError
                    ? prioritizedNotifications.slice(0, 8).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`ap-notif-item${item.isRead ? '' : ' ap-notif-item-unread'}`}
                          onClick={() => handleMarkNotificationRead(item.id)}
                        >
                          <span className="ap-notif-item-title">{item.title || 'Notification'}</span>
                          <span className="ap-notif-item-message">{item.message || ''}</span>
                        </button>
                      ))
                    : null}
                  {!notifLoading && !notifError ? (
                    <div className="ap-notif-menu-footer">
                      <button
                        type="button"
                        className="ap-notif-clear-btn"
                        onClick={handleClearNotifications}
                        disabled={unreadNotificationsCount === 0}
                      >
                        Clear notifications
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="ap-header-user">
              <div className="ap-header-user-info">
                <div className="ap-header-user-name">{displayName}</div>
                <div className="ap-header-user-role">{location}</div>
              </div>
              <div className="ap-header-avatar">{initials}</div>
            </div>
          </div>
        </header>

        <div className="ap-content">
          {activeSection === 'overview' && (
            <section className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">Branch Overview</h2>
                  <p className="ap-section-sub">Assigned coverage and account permissions</p>
                </div>
              </div>

              <div className="ss-stat-grid">
                <article className="ap-stat-card">
                  <p className="ap-stat-label">Assigned Area</p>
                  <h3 className="ap-stat-value ss-stat-value">{location}</h3>
                  <p className="ap-stat-meta">{userClaims?.entityType || 'public'} branch</p>
                </article>
                <article className="ap-stat-card">
                  <p className="ap-stat-label">Reports in Scope</p>
                  <h3 className="ap-stat-value">{reportsLoading ? '…' : reports.length}</h3>
                  <p className="ap-stat-meta">Fetched from scoped API endpoint</p>
                </article>
                <article className="ap-stat-card">
                  <p className="ap-stat-label">Open Reports</p>
                  <h3 className="ap-stat-value">{reportsLoading ? '…' : reportStats.submitted + reportStats.inReview}</h3>
                  <p className="ap-stat-meta">Submitted and in review</p>
                </article>
                <article className="ap-stat-card">
                  <p className="ap-stat-label">Permissions</p>
                  <h3 className="ap-stat-value">{effectivePermissions.length}</h3>
                  <p className="ap-stat-meta">Tools enabled for your account</p>
                </article>
              </div>

              <div className="ap-card">
                <div className="ap-card-header">
                  <h3 className="ap-card-title">Your Access</h3>
                </div>
                {effectivePermissions.length > 0 ? (
                  <div className="ss-permissions-list">
                    {effectivePermissions.map((permission) => (
                      <span key={permission} className="staff-perm-badge">
                        {PERMISSION_LABELS[permission] || permission}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="ap-empty">No active permissions. Contact an administrator.</p>
                )}
              </div>
            </section>
          )}

          {(activeSection === 'reports' || activeSection === 'archive') && (
            <section className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">{activeSection === 'archive' ? 'Archived Reports' : 'Reports Workspace'}</h2>
                  <p className="ap-section-sub">
                    {activeSection === 'archive' 
                      ? 'View and manage archived reports.' 
                      : 'Map and inbox are restricted to your assigned jurisdiction.'}
                  </p>
                </div>
                <div className="ap-section-actions">
                  <button type="button" className="ap-btn-outline ap-btn-sm" onClick={loadReports} disabled={reportsLoading || !canViewReports}>
                    {reportsLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              </div>

              {!canViewReports ? (
                <div className="ap-card"><p className="ap-empty">Your account does not have report access.</p></div>
              ) : (
                <>
                  {activeSection === 'reports' && (
                    <div className="ap-card">
                      <div className="ap-card-header">
                        <h3 className="ap-card-title">{location}</h3>
                      </div>
                      {reportsError ? <div className="auth-error" role="alert">{reportsError}</div> : null}
                      <ReportLocationMap
                        markers={reportMarkers}
                        preferredBarangay={location}
                        helpText="Showing reports returned for your assigned branch/barangay coverage."
                        preserveViewOnRefresh
                        enableFullscreenBarangayFilter={false}
                        enableCategoryFilter
                        enableStatusFilter
                        enableHeatmapToggle
                        statusOptions={STAFF_STATUS_UPDATE_OPTIONS}
                        canUpdateStatus={canUpdateReports}
                        updatingStatusForId={updatingReportId}
                        onStatusChange={handleRequestStatusUpdate}
                        focusMarkerId={mapFocusReportId}
                        autoRouteRequestKey={mapAutoRouteRequestKey}
                      />
                    </div>
                  )}

                  <div className="ap-card">
                    <div className="ap-card-header">
                      <h3 className="ap-card-title">Reports Inbox</h3>
                      <div className="ss-controls-inline">
                        <label htmlFor="staff-status-filter" className="ss-control-label">Status <InfoTooltip label="Explain report status" text="Status shows the report workflow. Staff can move reports into progress, resolve them with notes or evidence, or decline them with a reason." /></label>
                        <select
                          id="staff-status-filter"
                          className="form-select ss-status-filter"
                          value={reportStatusFilter}
                          onChange={(event) => setReportStatusFilter(event.target.value)}
                        >
                          <option value="all">All statuses</option>
                          {STAFF_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>

                        <label htmlFor="staff-classification-filter" className="ss-control-label">Classification <InfoTooltip label="Explain report classification" text="Classification is the issue category used to organize reports and identify the responsible service area." /></label>
                        <select
                          id="staff-classification-filter"
                          className="form-select ss-status-filter"
                          value={reportClassificationFilter}
                          onChange={(event) => setReportClassificationFilter(event.target.value)}
                        >
                          <option value="all">All classifications</option>
                          {REPORT_CLASSIFICATION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {reportActionError ? <div className="auth-error" role="alert">{reportActionError}</div> : null}
                    {reportActionSuccess ? <div role="alert" style={{ padding: '0.75rem', marginBottom: '1rem', borderRadius: '4px', backgroundColor: 'var(--color-success-bg, #e6ffe6)', color: 'var(--color-success, #166534)', border: '1px solid var(--color-success-border, #bbf7d0)' }}>{reportActionSuccess}</div> : null}

                    {reportsLoading ? (
                      <p className="ap-loading">Loading reports…</p>
                    ) : visibleReports.length === 0 ? (
                      <p className="ap-empty">No reports found in your jurisdiction for the selected filters.</p>
                    ) : (
                      <div className="ss-report-list">
                        {visibleReports.map((report) => (
                          <article
                            key={report.id}
                            className={`ss-report-card ap-report-row-clickable${isEmergencyReport(report) ? ' ss-report-card-emergency' : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              handleOpenReport(report);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleOpenReport(report);
                              }
                            }}
                          >
                            <div className="ss-report-head">
                              <h3 className="ss-report-title">{report.title}</h3>
                              <div className="ss-report-badges">
                                <span className={getStatusClass(report.status)}>{normalizeStatus(report.status)}</span>
                                {report?.rating?.score ? (
                                  <span
                                    className="badge badge-success"
                                    title={`Resident rating: ${report.rating.score}/5`}
                                    style={{ fontWeight: 700 }}
                                  >
                                    {report.rating.score}/5 rating
                                  </span>
                                ) : null}
                                {report?.isDuplicateChild && report?.duplicateOfReport ? (
                                  <span
                                    className="badge badge-duplicate"
                                    title={`Duplicate of ${report.duplicateOfReport.title || report.duplicateOfReport.id}`}
                                  >
                                    Duplicated
                                  </span>
                                ) : null}
                                {report?.forwarding && (
                                  <span className="badge badge-forwarded" title={`Forwarded to ${report.forwarding.to.branchName}`}>
                                    Forwarded
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="ss-report-meta">
                              {formatDate(report.createdAt)}
                              {report?.location?.barangay ? ` • ${report.location.barangay}` : ''}
                            </p>
                            {report?.rating?.score ? (
                              <p className="ss-report-meta" style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                                Rating: {'★'.repeat(Number(report.rating.score))}{'☆'.repeat(5 - Number(report.rating.score))} {report.rating.score}/5
                              </p>
                            ) : (
                              <p className="ss-report-meta">Rating: No rating</p>
                            )}
                            <p className="ss-report-description">{report.description}</p>
                            {report?.location?.address ? <p className="ss-report-address">{report.location.address}</p> : null}

                            {canManageReportLifecycle ? (
                              <div className="ss-report-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                                <div className="ss-report-action-buttons">
                                  <InfoTooltip
                                    label="Explain report lifecycle actions"
                                    text={activeSection === 'archive'
                                      ? 'Unarchive returns the report to active workspaces. Delete permanently removes it and cannot be undone.'
                                      : 'Archive removes the report from active workspaces while keeping it available in the archive.'}
                                  />
                                  {activeSection !== 'archive' ? (
                                    <button
                                      type="button"
                                      className="ap-report-action-btn"
                                      onClick={() => handleArchiveReport(report)}
                                      disabled={archivingReportId === report.id || deletingReportId === report.id}
                                    >
                                      {archivingReportId === report.id ? 'Archiving…' : 'Archive'}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="ap-report-action-btn ap-report-action-btn-danger"
                                      onClick={() => handleDeleteReport(report)}
                                      disabled={deletingReportId === report.id}
                                    >
                                      {deletingReportId === report.id ? 'Deleting…' : 'Delete'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedReport && (
                    <AppModal
                      title={selectedReport.title || 'Report details'}
                      titleId="staff-report-details-title"
                      size="wide"
                      onClose={() => setSelectedReport(null)}
                    >
                      {reportActionError ? <div className="auth-error" role="alert" style={{ marginBottom: '1rem' }}>{reportActionError}</div> : null}
                      {reportActionSuccess ? <div role="alert" style={{ padding: '0.75rem', marginBottom: '1rem', borderRadius: '4px', backgroundColor: 'var(--color-success-bg, #e6ffe6)', color: 'var(--color-success, #166534)', border: '1px solid var(--color-success-border, #bbf7d0)' }}>{reportActionSuccess}</div> : null}
                      <div className="ap-report-details-grid">
                        <div className="ap-report-details-row"><span>Status</span><strong>{selectedReport.status || '—'}</strong></div>
                        {selectedReport?.isDuplicateChild && selectedReport?.duplicateOfReport ? (
                          <div className="ap-report-details-row">
                            <span>Duplication of</span>
                            <strong>{selectedReport.duplicateOfReport.title || selectedReport.duplicateOfReport.id}</strong>
                          </div>
                        ) : null}
                        <div className="ap-report-details-row"><span>Category</span><strong>{selectedReport.category || '—'}</strong></div>
                        <div className="ap-report-details-row"><span>Barangay</span><strong>{selectedReport?.location?.barangay || '—'}</strong></div>
                        <div className="ap-report-details-row"><span>Address</span><strong>{selectedReport?.location?.address || '—'}</strong></div>
                        <div className="ap-report-details-row"><span>Created</span><strong>{selectedReport.createdAt ? new Date(selectedReport.createdAt).toLocaleString() : '—'}</strong></div>
                        <div className="ap-report-details-row"><span>Updated</span><strong>{selectedReport.updatedAt ? new Date(selectedReport.updatedAt).toLocaleString() : '—'}</strong></div>
                      </div>

                      {selectedReport?.rating?.score ? (
                        <div className="ap-report-details-description">
                          <p className="form-label">Resident rating</p>
                          <div style={{ border: '1px solid var(--color-border)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-surface-muted)' }}>
                            <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
                              {'★'.repeat(Number(selectedReport.rating.score))}{'☆'.repeat(5 - Number(selectedReport.rating.score))} {selectedReport.rating.score}/5
                            </div>
                            <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                              {selectedReport.rating.comment || 'No additional comment provided.'}
                            </p>
                            {selectedReport.rating.ratedAt ? (
                              <p style={{ margin: '0.55rem 0 0', color: 'var(--color-text-soft)', fontSize: '0.8rem' }}>
                                Rated on {new Date(selectedReport.rating.ratedAt).toLocaleString()}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      <div className="ap-report-details-description">
                        <p className="form-label">Description</p>
                        <p>{selectedReport.description || '—'}</p>
                      </div>

                      {selectedReportDuplicateChildren.length > 0 ? (
                        <div className="ap-report-details-description">
                          <p className="form-label">
                            Duplicate reports ({selectedReportDuplicateChildren.length})
                          </p>
                          <div className="ss-duplicate-report-list">
                            {selectedReportDuplicateChildren.map((duplicateReport) => (
                              <div key={duplicateReport.id} className="ss-duplicate-report-item">
                                <div className="ss-duplicate-report-copy">
                                  <strong>{duplicateReport.title || duplicateReport.id || 'Untitled report'}</strong>
                                  <span>
                                    {formatDate(duplicateReport.createdAt)}
                                    {duplicateReport.category ? ` • ${duplicateReport.category}` : ''}
                                  </span>
                                </div>
                                <div className="ss-duplicate-report-actions">
                                  <span className={getStatusClass(duplicateReport.status)}>
                                    {normalizeStatus(duplicateReport.status)}
                                  </span>
                                  <button
                                    type="button"
                                    className="ap-btn-outline ap-btn-sm"
                                    onClick={() => handleOpenReport(duplicateReport)}
                                  >
                                    View
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="ap-report-details-description">
                        <p className="form-label">Audit trail</p>
                        {selectedReport?.forwarding && (
                          <div className="ss-report-forwarding-info">
                            <p className="ss-report-forwarding-title">Forwarding Information</p>
                            <div className="ss-report-forwarding-grid">
                              <div className="ss-report-forwarding-row">
                                <span className="ss-report-forwarding-label">From:</span>
                                <span>{selectedReport.forwarding.from.branchName || '—'}</span>
                              </div>
                              <div className="ss-report-forwarding-row">
                                <span className="ss-report-forwarding-label">To:</span>
                                <span>{selectedReport.forwarding.to.branchName || '—'}</span>
                              </div>
                              <div className="ss-report-forwarding-row">
                                <span className="ss-report-forwarding-label">Forwarded at:</span>
                                <span>{new Date(selectedReport.forwarding.forwardedAt).toLocaleString()}</span>
                              </div>
                              <div className="ss-report-forwarding-row">
                                <span className="ss-report-forwarding-label">Forwarded by:</span>
                                <span>{selectedReport.forwarding.forwardedBy.email}</span>
                              </div>
                            </div>
                          </div>
                        )}
                        {Array.isArray(selectedReport.auditTrail) && selectedReport.auditTrail.length > 0 ? (
                          <details className="ss-audit-dropdown">
                            <summary className="ss-audit-dropdown-trigger">
                              <span>Show audit logs</span>
                              <span className="material-symbols-outlined ss-audit-dropdown-arrow" aria-hidden="true">expand_more</span>
                            </summary>

                            <div className="ss-audit-dropdown-content">
                              <div className="ss-audit-trail">
                                {selectedReport.auditTrail
                                  .slice()
                                  .sort((a, b) => new Date(b.changedAt || 0) - new Date(a.changedAt || 0))
                                  .map((entry, index) => (
                                    <div key={`${entry.changedAt || 'audit'}-${index}`} className="ss-audit-entry">
                                      <div className="ss-audit-header">
                                        <span className="ss-audit-change">{formatAuditEntry(entry)}</span>
                                      </div>
                                      {entry?.progressNote && String(entry?.toStatus || '').toLowerCase() !== 'resolved' && (
                                        <div className="ss-audit-note">
                                          <span className="ss-audit-label">Note:</span>
                                          <span className="ss-audit-text">{entry.progressNote}</span>
                                        </div>
                                      )}
                                      {Array.isArray(entry?.resolutionPhotos) && entry.resolutionPhotos.length > 0 && (
                                        <div className="ss-audit-photos">
                                          <span className="ss-audit-label">{entry.resolutionPhotos.length} photo{entry.resolutionPhotos.length !== 1 ? 's' : ''} attached</span>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                              </div>
                            </div>
                          </details>
                        ) : (
                          <p className="ap-muted">No audit trail entries yet.</p>
                        )}
                      </div>

                      <div className="ap-report-details-media">
                        <p className="form-label">Media attachments</p>
                        {selectedReportMediaItems.length > 0 ? (
                          <div className="ap-report-media-list">
                            {selectedReportMediaItems.map((item) => (
                              <div key={item.id} className="ap-report-image-frame">
                                {item.type === 'video' ? (
                                  <video src={item.src} controls className="ap-report-modal-image" />
                                ) : (
                                  <img src={item.src} alt={item.alt} className="ap-report-modal-image" />
                                )}

                                <div className="ap-report-media-actions">
                                  {item.type === 'image' ? (
                                    <button
                                      type="button"
                                      className="ap-btn-outline ap-btn-sm ap-report-image-enlarge-btn"
                                      onClick={() => setExpandedReportImage({ src: item.src, alt: item.alt })}
                                    >
                                      Enlarge image
                                    </button>
                                  ) : null}
                                  <a
                                    href={item.src}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="ap-btn-outline ap-btn-sm ap-report-image-enlarge-btn"
                                  >
                                    Open file
                                  </a>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="ap-muted">No media attachment for this report.</p>
                        )}
                      </div>

                      <div className="ap-modal-actions-section">
                        {selectedReportCanManageStatusAndForward ? (
                          <div className="ap-modal-action-group">
                            <label htmlFor="modal-report-status" className="form-label">Update status <InfoTooltip label="Explain report status" text="Status shows the report workflow. Resolving requires a progress note or resolution evidence; declining requires a reason." /></label>
                            <select
                              id="modal-report-status"
                              className="form-select"
                              value={
                                STAFF_STATUS_UPDATE_OPTIONS.some((option) => option.value === selectedReport.status)
                                  ? selectedReport.status
                                  : ''
                              }
                              onChange={(event) => handleRequestStatusUpdate(selectedReport.id, event.target.value)}
                              disabled={updatingReportId === selectedReport.id}
                            >
                              <option value="" disabled>Select next status</option>
                              {STAFF_STATUS_UPDATE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                        
                        {selectedReportCanManageStatusAndForward && !selectedReport?.forwarding ? (
                          <div className="ap-modal-action-group">
                            <label htmlFor="modal-report-forward" className="form-label">Forward to <InfoTooltip label="Explain report forwarding" text="Forwarding moves this report to another branch and notifies its staff. A report can only be forwarded once." /></label>
                            <div className="ap-modal-action-row">
                              <select
                                id="modal-report-forward"
                                className="form-select"
                                value={forwardTargetByReport[selectedReport.id] || ''}
                                onChange={(event) => handleForwardSelection(selectedReport.id, event.target.value)}
                                disabled={forwardingReportId === selectedReport.id || forwardTargets.length === 0}
                              >
                                <option value="">Select destination branch</option>
                                {forwardTargets.map((branch) => (
                                  <option key={branch.id} value={branch.id}>
                                    {branch.name} ({branch.type})
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="ap-btn-outline ap-forward-icon-btn"
                                onClick={() => handleForwardReport(selectedReport)}
                                disabled={forwardingReportId === selectedReport.id || !forwardTargetByReport[selectedReport.id]}
                                aria-label={forwardingReportId === selectedReport.id ? 'Forwarding report' : 'Forward report'}
                                title={forwardingReportId === selectedReport.id ? 'Forwarding report' : 'Forward report'}
                              >
                                <span className="material-symbols-outlined" aria-hidden="true">
                                  {forwardingReportId === selectedReport.id ? 'hourglass_top' : 'forward_to_inbox'}
                                </span>
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {canAssignResponders ? (
                          <div className="ap-modal-action-group">
                            <label htmlFor="modal-report-responder" className="form-label">Assign responder <InfoTooltip label="Explain responder assignment" text="Assigning a responder places this report in that person's assigned queue." /></label>
                            {selectedReportResponderOptions.length > 0 ? (
                              <div className="ap-modal-action-row ap-modal-action-row-stackable">
                                <select
                                  id="modal-report-responder"
                                  className="form-select"
                                  value={selectedReportResponderUid}
                                  onChange={(event) => setSelectedReportResponderUid(event.target.value)}
                                  disabled={assigningResponderReportId === selectedReport.id}
                                >
                                  <option value="">Unassigned</option>
                                  {selectedReportResponderOptions.map((user) => (
                                    <option key={user.uid} value={user.uid}>
                                      {getPersonDisplayName(user)}
                                      {user.customRoleName ? ` (${user.customRoleName})` : user.roleKey === 'responder' ? ' (Responder)' : ''}
                                      {user.branchName ? ` • ${user.branchName}` : ''}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="ap-btn-outline"
                                  onClick={() => handleAssignResponder(selectedReport, '')}
                                  disabled={assigningResponderReportId === selectedReport.id || !selectedReportAssignedResponder}
                                >
                                  Clear
                                </button>
                                <button
                                  type="button"
                                  className="ap-btn-primary"
                                  onClick={() => handleAssignResponder(selectedReport, selectedReportResponderUid)}
                                  disabled={assigningResponderReportId === selectedReport.id || !selectedReportResponderUid}
                                >
                                  {assigningResponderReportId === selectedReport.id ? 'Saving…' : 'Save assignment'}
                                </button>
                              </div>
                            ) : (
                              <p className="ap-field-hint">No users with the Responder role are available in this branch.</p>
                            )}
                            <p className="ap-field-hint">Only users with the Responder role can be assigned here.</p>
                          </div>
                        ) : null}

                        {canUpdateReports && String(selectedReport?.status || '').toLowerCase() !== 'archived' ? (
                          <div className="ap-modal-action-group">
                            <div className="ap-modal-action-row">
                              {selectedReport?.isDuplicateChild ? (
                                <div className="ss-duplicate-status" role="status" aria-live="polite">
                                  <span className="ss-duplicate-status-label">Duplicate of</span>
                                  <strong className="ss-duplicate-status-value">
                                    {selectedReport?.duplicateOfReport?.title || selectedReport?.duplicateOfReport?.id || 'Unknown report'}
                                  </strong>
                                </div>
                              ) : !motherReportIds.has(String(selectedReport?.id || '').trim()) ? (
                                <button
                                  type="button"
                                  className="ap-btn-outline"
                                  onClick={() => handleOpenDuplicateModal(selectedReport)}
                                  disabled={duplicatingReportId === selectedReport.id || revokingDuplicateReportId === selectedReport.id}
                                >
                                  {duplicatingReportId === selectedReport.id ? 'Linking…' : 'Mark as duplicate'}
                                </button>
                              ) : null}
                              {selectedReport?.isDuplicateChild ? (
                                <button
                                  type="button"
                                  className="ap-btn-outline"
                                  onClick={() => handleRevokeDuplicateLink(selectedReport)}
                                  disabled={revokingDuplicateReportId === selectedReport.id || duplicatingReportId === selectedReport.id}
                                >
                                  {revokingDuplicateReportId === selectedReport.id ? 'Revoking…' : 'Revoke duplication'}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </AppModal>
                  )}

                  {confirmDialog ? (
                    <AppModal
                      title={confirmDialog.title || 'Confirm action'}
                      titleId="staff-confirm-dialog-title"
                      onClose={closeConfirmDialog}
                    >
                      <div className="ap-form">
                        <p>{confirmDialog.message}</p>
                        <div className="ap-modal-button-group">
                          <button
                            type="button"
                            className={confirmDialog.confirmClassName || 'ap-btn-primary'}
                            onClick={handleConfirmDialogSubmit}
                            disabled={confirmDialogLoading}
                          >
                            {confirmDialogLoading ? 'Processing...' : confirmDialog.confirmLabel || 'Confirm'}
                          </button>
                          <button
                            type="button"
                            className="ap-btn-outline"
                            onClick={closeConfirmDialog}
                            disabled={confirmDialogLoading}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </AppModal>
                  ) : null}

                  {expandedReportImage?.src ? (
                    <AppModal
                      title="Submitted image"
                      titleId="staff-expanded-report-image-title"
                      size="wide"
                      onClose={() => setExpandedReportImage(null)}
                    >
                      <div className="ap-report-image-modal-content">
                        <img
                          src={expandedReportImage.src}
                          alt={expandedReportImage.alt}
                          className="ap-report-modal-image ap-report-modal-image-large"
                        />
                      </div>
                    </AppModal>
                  ) : null}

                  {duplicateModalOpen && duplicateTargetReport ? (
                    <AppModal
                      title={`Mark as duplicate: ${duplicateTargetReport.title || duplicateTargetReport.id}`}
                      titleId="staff-duplicate-report-title"
                      onClose={() => {
                        if (duplicatingReportId === duplicateTargetReport.id) return;
                        setDuplicateModalOpen(false);
                        setDuplicateTargetReportId('');
                        setDuplicateMotherReportId('');
                        setDuplicateModalError('');
                      }}
                    >
                      <div className="ap-form">
                        {duplicateModalError ? <div className="auth-error" role="alert">{duplicateModalError}</div> : null}

                        <div>
                          <label htmlFor="duplicate-mother-select" className="form-label">Mother report <InfoTooltip label="Explain duplicate reports" text="The mother report is the original issue. Linked duplicate reports follow its status and resolution updates." /></label>
                          <select
                            id="duplicate-mother-select"
                            className="form-select"
                            value={duplicateMotherReportId}
                            onChange={(event) => {
                              setDuplicateMotherReportId(event.target.value);
                              if (duplicateModalError) setDuplicateModalError('');
                            }}
                            disabled={duplicatingReportId === duplicateTargetReport.id}
                          >
                            {duplicateMotherReportOptions.map((report) => (
                              <option key={report.id} value={report.id}>
                                {report.title || 'Untitled report'}
                                {getDuplicateLocationLabel(report)
                                  ? ` - ${getDuplicateLocationLabel(report)}`
                                  : ''}
                              </option>
                            ))}
                          </select>
                          {duplicateMotherReportOptions.length === 0 ? (
                            <p className="ap-muted">No eligible mother reports available.</p>
                          ) : null}
                        </div>

                        <div>
                          <label className="form-label">Report image</label>
                          {duplicateSelectedMotherPreviewImage ? (
                            <button
                              type="button"
                              className="ap-btn-outline"
                              onClick={() => setExpandedReportImage({
                                src: duplicateSelectedMotherPreviewImage,
                                alt: duplicateSelectedMotherReport?.title || 'Report attachment',
                              })}
                              disabled={duplicatingReportId === duplicateTargetReport.id}
                            >
                              View selected report image
                            </button>
                          ) : (
                            <p className="ap-muted">No image available for the selected report.</p>
                          )}
                        </div>

                        <div className="ap-modal-button-group">
                          <button
                            type="button"
                            className="ap-btn-primary"
                            onClick={handleSubmitDuplicateLink}
                            disabled={
                              duplicatingReportId === duplicateTargetReport.id
                              || !duplicateMotherReportId
                              || duplicateMotherReportOptions.length === 0
                            }
                          >
                            {duplicatingReportId === duplicateTargetReport.id ? 'Linking...' : 'Confirm duplicate'}
                          </button>
                          <button
                            type="button"
                            className="ap-btn-outline"
                            onClick={() => {
                              if (duplicatingReportId === duplicateTargetReport.id) return;
                              setDuplicateModalOpen(false);
                              setDuplicateTargetReportId('');
                              setDuplicateMotherReportId('');
                              setDuplicateModalError('');
                            }}
                            disabled={duplicatingReportId === duplicateTargetReport.id}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </AppModal>
                  ) : null}

                  {resolveTargetReport && (
                    <AppModal
                      title={`Resolve report: ${resolveTargetReport.title || resolveTargetReport.id}`}
                      titleId="staff-resolve-report-title"
                      size="wide"
                      onClose={() => {
                        if (updatingReportId === resolveTargetReport.id) return;
                        setResolveTargetReportId('');
                        setResolveProgressNote('');
                        setResolvePhotos([]);
                      }}
                    >
                      <form className="ap-form" onSubmit={handleSubmitResolution}>
                        <div>
                          <label htmlFor="resolve-progress-note" className="form-label">Progress notes <InfoTooltip label="Explain resolution notes" text="Describe the action taken and the outcome. A note or at least one resolution photo is required to resolve a report." /></label>
                          <textarea
                            id="resolve-progress-note"
                            className="form-input"
                            rows={4}
                            placeholder="Describe the action taken and resolution outcome."
                            value={resolveProgressNote}
                            onChange={(event) => setResolveProgressNote(event.target.value)}
                            disabled={updatingReportId === resolveTargetReport.id}
                          />
                        </div>

                        <div>
                          <label htmlFor="resolve-photos" className="form-label">Resolution photos (optional if notes are provided) <InfoTooltip label="Explain resolution photos" text="Add visual evidence of completed work. Photos are required when no progress note is provided." /></label>
                          <input
                            id="resolve-photos"
                            type="file"
                            accept="image/*"
                            multiple
                            className="form-input"
                            onChange={(event) => setResolvePhotos(Array.from(event.target.files || []))}
                            disabled={updatingReportId === resolveTargetReport.id}
                          />
                          {resolvePhotos.length > 0 ? (
                            <p className="ap-field-hint">{resolvePhotos.length} photo(s) selected.</p>
                          ) : null}
                        </div>

                        <div className="ap-modal-button-group">
                          <button
                            type="submit"
                            className="ap-btn-primary"
                            disabled={updatingReportId === resolveTargetReport.id}
                          >
                            {updatingReportId === resolveTargetReport.id ? 'Resolving...' : 'Mark as resolved'}
                          </button>
                          <button
                            type="button"
                            className="ap-btn-outline"
                            onClick={() => {
                              setResolveTargetReportId('');
                              setResolveProgressNote('');
                              setResolvePhotos([]);
                            }}
                            disabled={updatingReportId === resolveTargetReport.id}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </AppModal>
                  )}

                  {declineTargetReport && (
                    <AppModal
                      title={`Decline report: ${declineTargetReport.title || declineTargetReport.id}`}
                      titleId="staff-decline-report-title"
                      size="wide"
                      onClose={() => {
                        if (updatingReportId === declineTargetReport.id) return;
                        setDeclineTargetReportId('');
                        setDeclineReason('');
                      }}
                    >
                      <form className="ap-form" onSubmit={handleSubmitDecline}>
                        <div>
                          <label htmlFor="decline-reason-note" className="form-label">Decline reason</label>
                          <textarea
                            id="decline-reason-note"
                            className="form-input"
                            rows={4}
                            placeholder="Provide a required justification for declining this report."
                            value={declineReason}
                            onChange={(event) => setDeclineReason(event.target.value)}
                            disabled={updatingReportId === declineTargetReport.id}
                            required
                          />
                        </div>

                        <div className="ap-modal-button-group">
                          <button
                            type="submit"
                            className="ap-btn-danger"
                            disabled={updatingReportId === declineTargetReport.id}
                          >
                            {updatingReportId === declineTargetReport.id ? 'Declining...' : 'Decline report'}
                          </button>
                          <button
                            type="button"
                            className="ap-btn-outline"
                            onClick={() => {
                              setDeclineTargetReportId('');
                              setDeclineReason('');
                            }}
                            disabled={updatingReportId === declineTargetReport.id}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </AppModal>
                  )}
                </>
              )}
            </section>
          )}

          {activeSection === 'team' && (
            <section className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">Branch Staff</h2>
                  <p className="ap-section-sub">Manage only staff accounts under {location}.</p>
                </div>
              </div>

              {userClaims?.branchId ? (
                <>
                  <div className="ap-card">
                    <div className="ap-card-header">
                      <h3 className="ap-card-title">Create Staff Account</h3>
                    </div>
                    {createError ? <div className="auth-error" role="alert">{createError}</div> : null}
                    {createSuccess ? <div className="auth-success" role="status">{createSuccess}</div> : null}
                    <form onSubmit={handleCreateBranchStaff} className="staff-create-form">
                      <div>
                        <label htmlFor="branch-staff-email" className="form-label">Email address</label>
                        <input
                          id="branch-staff-email"
                          type="email"
                          required
                          value={newEmail}
                          onChange={(event) => setNewEmail(event.target.value)}
                          className="form-input"
                          placeholder="newstaff@onegapo.gov.ph"
                          disabled={creating}
                        />
                      </div>
                      {roles.length > 0 ? (
                        <div>
                          <label htmlFor="branch-staff-role" className="form-label">Assigned Role (optional)</label>
                          <select
                            id="branch-staff-role"
                            value={selectedRoleId}
                            onChange={(event) => setSelectedRoleId(event.target.value)}
                            className="form-select"
                            disabled={creating}
                          >
                            <option value="">No role</option>
                            {roles.map((role) => (
                              <option key={role.id} value={role.id}>{role.name}</option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                      <button type="submit" disabled={creating || !newEmail.trim()} className="ap-btn-primary ss-inline-btn">
                        {creating ? 'Creating…' : 'Create Staff Account'}
                      </button>
                    </form>
                  </div>

                  <div className="ap-card">
                    <div className="ap-card-header">
                      <h3 className="ap-card-title">Current Branch Team</h3>
                      <button type="button" className="ap-btn-outline ap-btn-sm" onClick={loadBranchStaff} disabled={staffLoading}>
                        {staffLoading ? 'Loading…' : 'Refresh'}
                      </button>
                    </div>
                    {staffError ? <div className="auth-error" role="alert">{staffError}</div> : null}

                    {staffLoading ? (
                      <p className="ap-loading">Loading…</p>
                    ) : branchStaff.length === 0 ? (
                      <p className="ap-empty">No staff in this branch yet.</p>
                    ) : (
                      <div className="ap-table-wrap">
                        <table className="ap-table">
                          <thead>
                            <tr>
                              <th>Email</th>
                              <th>Name</th>
                              <th>Assigned Role</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {branchStaff.map((member) => (
                              <tr key={member.uid}>
                                <td>{member.email}</td>
                                <td>{member.fullName || '—'}</td>
                                <td>{member.customRoleLabel || member.customRoleName || (member.roleKey === 'responder' ? 'Responder' : '—')}</td>
                                <td>{member.verified ? 'Verified' : 'Unverified'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="ap-card">
                  <p className="ap-empty">You are not assigned to a branch yet. Contact the admin team.</p>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
