import './AdminPanel.css';
import './StaffPanel.css';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useSettingsModal } from '../context/SettingsModalContext';
import ReportLocationMap from '../components/ReportLocationMap';
import AppModal from '../components/AppModal';
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
  { value: 'in_review', label: 'In Review' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'rejected', label: 'Rejected' },
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
  { id: 'team', label: 'Branch Staff', icon: 'groups' },
];

function formatDate(value) {
  if (!value) return 'Unknown date';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'Unknown date';
  return dt.toLocaleString();
}

function normalizeStatus(status) {
  return String(status || 'submitted').replace(/_/g, ' ');
}

function getStatusClass(status) {
  const key = String(status || 'submitted').toLowerCase();
  return `ss-status ss-status-${key}`;
}

function formatAuditEntry(entry) {
  if (entry?.type === 'archived') {
    return `Archived from ${normalizeStatus(entry.fromStatus)} on ${formatDate(entry.changedAt)}`;
  }

  if (entry?.type === 'forwarded') {
    return `Forwarded on ${formatDate(entry.changedAt)}`;
  }

  const fromStatus = normalizeStatus(entry?.fromStatus);
  const toStatus = normalizeStatus(entry?.toStatus);
  return `${fromStatus} -> ${toStatus} on ${formatDate(entry?.changedAt)}`;
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

function isEmergencyNotification(notification) {
  const type = String(notification?.type || '').trim().toLowerCase();
  const priority = String(notification?.priority || '').trim().toLowerCase();
  const category = String(notification?.metadata?.alertCategory || '').trim().toLowerCase();
  const reportCategory = String(notification?.metadata?.reportCategory || '').trim().toLowerCase();
  const title = String(notification?.title || '').trim().toLowerCase();
  const message = String(notification?.message || '').trim().toLowerCase();

  if (priority === 'high' || category === 'emergency') {
    return true;
  }

  if (reportCategory === 'disaster' || reportCategory === 'safety') {
    return true;
  }

  if (/(emergency|urgent|high[\s-]?priority|critical)/i.test(`${title} ${message}`)) {
    return true;
  }

  return type.includes('emergency');
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

function playEmergencyAlertTone() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(980, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.33);

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 450);
  } catch {
    // Ignore audio API failures and keep UI alerts working.
  }
}

export default function StaffPanel() {
  const { currentUser, userClaims, logout } = useAuth();
  const { openSettings } = useSettingsModal();
  const navigate = useNavigate();

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
  const [dismissedEmergencyBannerId, setDismissedEmergencyBannerId] = useState('');
  const [updatingReportId, setUpdatingReportId] = useState('');
  const [reportActionError, setReportActionError] = useState('');
  const [selectedReport, setSelectedReport] = useState(null);
  const [expandedReportImage, setExpandedReportImage] = useState(null);
  const [resolveTargetReportId, setResolveTargetReportId] = useState('');
  const [resolveProgressNote, setResolveProgressNote] = useState('');
  const [resolvePhotos, setResolvePhotos] = useState([]);
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
  const [emergencyAlert, setEmergencyAlert] = useState(null);
  const seenEmergencyIdsRef = useRef(new Set());
  const emergencyAlertDismissRef = useRef(0);
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
      setReports(Array.isArray(data) ? data : []);
    } catch (err) {
      setReportsError(err.message || 'Failed to load reports.');
    } finally {
      if (!silent) {
        setReportsLoading(false);
      }
    }
  }, [api, canViewReports]);

  const loadBranchStaff = useCallback(async () => {
    if (!canManageStaff) {
      setBranchStaff([]);
      return;
    }
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
          setNotifLoading(false);
          setNotifError('');
        });

        socket.on('notifications:data', (payload) => {
          if (!active) return;
          setNotifications(Array.isArray(payload) ? payload : []);
          setNotifLoading(false);
          setNotifError('');
        });

        socket.on('reports:data', (payload) => {
          if (!active) return;
          setReports(Array.isArray(payload) ? payload : []);
          setReportsError('');
        });

        socket.on('connect_error', () => {
          if (!active) return;
          setNotifLoading(false);
          setNotifError('Realtime notifications unavailable.');
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
      if (item.id === 'team') return canManageStaff;
      return true;
    }),
    [canManageStaff, canViewReports]
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

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update report status.');

      setReports((prev) =>
        prev.map((report) =>
          report.id === reportId
            ? {
                ...report,
                ...(data?.report || {}),
                status: data?.report?.status || nextStatus,
                updatedAt: data?.report?.updatedAt || new Date().toISOString(),
              }
            : report
        )
      );

      setSelectedReport((prev) => {
        if (!prev || prev.id !== reportId) return prev;
        return {
          ...prev,
          ...(data?.report || {}),
          status: data?.report?.status || nextStatus,
          updatedAt: data?.report?.updatedAt || new Date().toISOString(),
        };
      });

      setResolveTargetReportId('');
      setResolveProgressNote('');
      setResolvePhotos([]);
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

  const unreadEmergencyCount = useMemo(
    () => notifications.filter((item) => !item?.isRead && isEmergencyNotification(item)).length,
    [notifications]
  );

  const unreadEmergencyNotifications = useMemo(
    () => notifications.filter((item) => !item?.isRead && isEmergencyNotification(item)),
    [notifications]
  );

  const latestUnreadEmergency = useMemo(
    () => unreadEmergencyNotifications
      .slice()
      .sort((a, b) => notificationTimestamp(b) - notificationTimestamp(a))[0] || null,
    [unreadEmergencyNotifications]
  );

  const emergencyAlertArea = latestUnreadEmergency?.metadata?.alertArea || latestUnreadEmergency?.metadata?.coverage || location;

  const prioritizedNotifications = useMemo(() => {
    return notifications.filter((item) => !item?.isRead).sort((a, b) => {
      const aEmergency = isEmergencyNotification(a);
      const bEmergency = isEmergencyNotification(b);

      if (aEmergency !== bEmergency) return bEmergency ? 1 : -1;
      return notificationTimestamp(b) - notificationTimestamp(a);
    });
  }, [notifications]);

  const emergencyNotifications = useMemo(
    () => prioritizedNotifications.filter((item) => isEmergencyNotification(item)),
    [prioritizedNotifications]
  );

  const regularNotifications = useMemo(
    () => prioritizedNotifications.filter((item) => !isEmergencyNotification(item)),
    [prioritizedNotifications]
  );

  useEffect(() => {
    const unreadEmergency = notifications
      .filter((item) => !item?.isRead && isEmergencyNotification(item))
      .sort((a, b) => notificationTimestamp(b) - notificationTimestamp(a));

    if (unreadEmergency.length === 0) {
      return;
    }

    const latest = unreadEmergency[0];
    if (!latest?.id || seenEmergencyIdsRef.current.has(latest.id)) {
      return;
    }

    seenEmergencyIdsRef.current.add(latest.id);
    setNotifOpen(true);
    setEmergencyAlert({
      id: latest.id,
      title: latest.title || 'Emergency escalation',
      message: latest.message || 'A new high-priority report requires immediate attention.',
    });

    playEmergencyAlertTone();
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([120, 80, 120]);
    }

    if (emergencyAlertDismissRef.current) {
      window.clearTimeout(emergencyAlertDismissRef.current);
    }

    emergencyAlertDismissRef.current = window.setTimeout(() => {
      setEmergencyAlert(null);
      emergencyAlertDismissRef.current = 0;
    }, 9000);
  }, [notifications]);

  useEffect(() => {
    return () => {
      if (emergencyAlertDismissRef.current) {
        window.clearTimeout(emergencyAlertDismissRef.current);
      }
    };
  }, []);

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
      const statusMatches = reportStatusFilter === 'all' ? true : String(report?.status || '').toLowerCase() === reportStatusFilter;
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
  }, [reports, reportStatusFilter, reportClassificationFilter, searchQuery]);

  const reportMarkers = useMemo(() => {
    return visibleReports
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

  const emergencyReports = useMemo(
    () => reports.filter((report) => isEmergencyReport(report)),
    [reports]
  );

  const latestEmergencyReport = useMemo(
    () => emergencyReports
      .slice()
      .sort((a, b) => notificationTimestamp(b) - notificationTimestamp(a))[0] || null,
    [emergencyReports]
  );

  const emergencyReportArea = latestEmergencyReport?.location?.barangay
    || latestEmergencyReport?.location?.address
    || latestUnreadEmergency?.metadata?.alertArea
    || latestUnreadEmergency?.metadata?.coverage
    || location;

  const currentEmergencyBannerId = String(
    latestEmergencyReport?.id
      || latestUnreadEmergency?.id
      || emergencyAlert?.id
      || 'emergency-fallback'
  );

  const shouldShowEmergencyBanner = Boolean(
    latestEmergencyReport || latestUnreadEmergency || emergencyAlert
  ) && dismissedEmergencyBannerId !== currentEmergencyBannerId;

  const handleEmergencyBannerClick = useCallback(() => {
    const notificationReportId = String(latestUnreadEmergency?.metadata?.reportId || '').trim();
    const targetReport = latestEmergencyReport
      || (notificationReportId ? reports.find((report) => String(report?.id || '') === notificationReportId) : null)
      || null;

    setActiveSection('reports');
    setSidebarOpen(false);
    setReportStatusFilter('all');
    setReportClassificationFilter('all');
    setSearchQuery('');

    if (!targetReport?.id) return;

    const targetReportId = String(targetReport.id);
    setMapFocusReportId(targetReportId);
    setMapAutoRouteRequestKey((prev) => prev + 1);
  }, [latestEmergencyReport, latestUnreadEmergency?.metadata?.reportId, reports]);

  const reportStats = useMemo(() => {
    const submitted = reports.filter((r) => r.status === 'submitted').length;
    const inReview = reports.filter((r) => r.status === 'in_review').length;
    const resolved = reports.filter((r) => r.status === 'resolved').length;
    const rejected = reports.filter((r) => r.status === 'rejected').length;
    return { submitted, inReview, resolved, rejected };
  }, [reports]);

  const resolveTargetReport = useMemo(
    () => reports.find((report) => report.id === resolveTargetReportId) || null,
    [reports, resolveTargetReportId]
  );

  const selectedReportPreviewImage = selectedReport ? getReportPreviewImage(selectedReport) : null;
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
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span className="material-symbols-outlined ap-hamburger-icon" aria-hidden="true">
              {sidebarCollapsed ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left'}
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
              aria-label="Toggle sidebar"
            >
              <span className="material-symbols-outlined ap-hamburger-icon" aria-hidden="true">menu</span>
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
                className={`ap-notif-btn${unreadEmergencyCount > 0 ? ' ss-notif-btn-emergency' : ''}`}
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
                    {unreadEmergencyCount > 0 ? (
                      <span className="ss-notif-header-emergency">{unreadEmergencyCount} emergency</span>
                    ) : null}
                  </div>
                  {notifLoading ? <p className="ap-notif-empty">Loading…</p> : null}
                  {!notifLoading && notifError ? <p className="ap-notif-empty">{notifError}</p> : null}
                  {!notifLoading && !notifError && prioritizedNotifications.length === 0 ? (
                    <p className="ap-notif-empty">No notifications yet.</p>
                  ) : null}
                  {!notifLoading && !notifError && emergencyNotifications.length > 0 ? (
                    <div className="ss-notif-section-label">Emergency alerts</div>
                  ) : null}
                  {!notifLoading && !notifError
                    ? emergencyNotifications.slice(0, 4).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`ap-notif-item${item.isRead ? '' : ' ap-notif-item-unread'} ss-notif-item-emergency`}
                          onClick={() => handleMarkNotificationRead(item.id)}
                        >
                          <span className="ss-notif-emergency-tag">Emergency</span>
                          <span className="ap-notif-item-title">{item.title || 'Notification'}</span>
                          <span className="ap-notif-item-message">{item.message || ''}</span>
                        </button>
                      ))
                    : null}
                  {!notifLoading && !notifError && regularNotifications.length > 0 ? (
                    <div className="ss-notif-section-label">Other notifications</div>
                  ) : null}
                  {!notifLoading && !notifError
                    ? regularNotifications
                      .slice(0, Math.max(0, 8 - Math.min(4, emergencyNotifications.length)))
                      .map((item) => (
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
          {shouldShowEmergencyBanner ? (
            <div
              className="ss-emergency-alert"
              role="button"
              tabIndex={0}
              aria-label="Open emergency report on map"
              onClick={handleEmergencyBannerClick}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleEmergencyBannerClick();
                }
              }}
            >
              <span className="material-symbols-outlined ss-emergency-alert-icon" aria-hidden="true">warning</span>
              <div className="ss-emergency-alert-copy">
                <div className="ss-emergency-alert-title-row">
                  <strong className="ss-emergency-alert-title">
                    {(latestEmergencyReport?.title || latestUnreadEmergency?.title || emergencyAlert?.title || 'Emergency alert')}
                  </strong>
                  <span className="ss-emergency-alert-pill">Urgent</span>
                </div>
                <p className="ss-emergency-alert-message"> 
                  {latestEmergencyReport
                    ? `A ${String(latestEmergencyReport.category || 'disaster')} report requires immediate attention.`
                    : latestUnreadEmergency?.message || emergencyAlert?.message || 'A high-priority report requires immediate attention.'}
                </p>
              </div>
              <button
                type="button"
                className="ss-emergency-alert-dismiss"
                onClick={(event) => {
                  event.stopPropagation();
                  setDismissedEmergencyBannerId(currentEmergencyBannerId);
                  setEmergencyAlert(null);
                }}
                aria-label="Dismiss emergency alert"
              >
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </div>
          ) : null}

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

          {activeSection === 'reports' && (
            <section className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">Reports Workspace</h2>
                  <p className="ap-section-sub">Map and inbox are restricted to your assigned jurisdiction.</p>
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
                      enableHeatmapToggle
                      statusOptions={STAFF_STATUS_UPDATE_OPTIONS}
                      canUpdateStatus={canUpdateReports}
                      updatingStatusForId={updatingReportId}
                      onStatusChange={handleRequestStatusUpdate}
                      focusMarkerId={mapFocusReportId}
                      autoRouteRequestKey={mapAutoRouteRequestKey}
                    />
                  </div>

                  <div className="ap-card">
                    <div className="ap-card-header">
                      <h3 className="ap-card-title">Reports Inbox</h3>
                      <div className="ss-controls-inline">
                        <label htmlFor="staff-status-filter" className="ss-control-label">Status</label>
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

                        <label htmlFor="staff-classification-filter" className="ss-control-label">Classification</label>
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
                            <p className="ss-report-description">{report.description}</p>
                            {report?.location?.address ? <p className="ss-report-address">{report.location.address}</p> : null}

                            {canManageReportLifecycle ? (
                              <div className="ss-report-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                                <div className="ss-report-action-buttons">
                                  {canManageReportLifecycle ? (
                                    <button
                                      type="button"
                                      className="ap-report-action-btn"
                                      onClick={() => handleArchiveReport(report)}
                                      disabled={archivingReportId === report.id || deletingReportId === report.id || String(report?.status || '').toLowerCase() === 'archived'}
                                    >
                                      {archivingReportId === report.id
                                        ? 'Archiving…'
                                        : String(report?.status || '').toLowerCase() === 'archived'
                                          ? 'Archived'
                                          : 'Archive'}
                                    </button>
                                  ) : null}

                                  {canManageReportLifecycle ? (
                                    <button
                                      type="button"
                                      className="ap-report-action-btn ap-report-action-btn-danger"
                                      onClick={() => handleDeleteReport(report)}
                                      disabled={deletingReportId === report.id || archivingReportId === report.id}
                                    >
                                      {deletingReportId === report.id ? 'Deleting…' : 'Delete'}
                                    </button>
                                  ) : null}
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
                        <p className="form-label">Image</p>
                        {selectedReportPreviewImage ? (
                          <div className="ap-report-image-frame">
                            <img
                              src={selectedReportPreviewImage}
                              alt={selectedReport.title || 'Report attachment'}
                              className="ap-report-modal-image"
                            />
                            <div className="ap-report-media-actions">
                              <button
                                type="button"
                                className="ap-btn-outline ap-btn-sm ap-report-image-enlarge-btn"
                                onClick={() => setExpandedReportImage({
                                  src: selectedReportPreviewImage,
                                  alt: selectedReport.title || 'Report attachment',
                                })}
                              >
                                Enlarge image
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="ap-muted">No image attachment for this report.</p>
                        )}
                      </div>

                      <div className="ap-modal-actions-section">
                        {selectedReportCanManageStatusAndForward ? (
                          <div className="ap-modal-action-group">
                            <label htmlFor="modal-report-status" className="form-label">Update status</label>
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
                            <label htmlFor="modal-report-forward" className="form-label">Forward to</label>
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
                          <label htmlFor="duplicate-mother-select" className="form-label">Mother report</label>
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
                          <label htmlFor="resolve-progress-note" className="form-label">Progress notes</label>
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
                          <label htmlFor="resolve-photos" className="form-label">Resolution photos (optional if notes are provided)</label>
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
                                <td>{member.customRoleName || '—'}</td>
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
