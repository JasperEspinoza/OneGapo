import './AdminPanel.css';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppModal from '../components/AppModal';
import ReportLocationMap from '../components/ReportLocationMap';
import { useAuth } from '../context/AuthContext';
import { useSettingsModal } from '../context/SettingsModalContext';

const PERMISSION_OPTIONS = [
  { value: 'view_reports',         label: 'View reports' },
  { value: 'update_reports',       label: 'Update report status' },
  { value: 'close_reports',        label: 'Close / resolve reports' },
  { value: 'archive_reports',      label: 'Archive reports' },
  { value: 'create_announcements', label: 'Post announcements' },
  { value: 'add_branches',         label: 'Add branches' },
  { value: 'add_roles',            label: 'Add roles' },
  { value: 'add_staffs',           label: 'Add staffs' },
];

const ICONS = {
  dashboard: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
  ),
  branches: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3z"/></svg>
  ),
  accounts: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zM8 6V4h4v2H8z"/></svg>
  ),
  users: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
  ),
  analytics: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M7.5 21H2V7h5.5v14zm7.25-10h-5.5v10h5.5V11zm7.25 8h-5.5v2h5.5v-2zM22 4v17h-5.5V4H22z"/></svg>
  ),
  location_city: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z"/></svg>
  ),
  report: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
  ),
  settings: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 25
    " fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L5.09 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
  ),
  logout: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
  ),
  close: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22" style={{minWidth: '22px'}}><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
  ),
  menu: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22" style={{minWidth: '22px'}}><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
  ),
  chevron_left: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22" style={{minWidth: '22px'}}><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
  ),
  chevron_right: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22" style={{minWidth: '22px'}}><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
  ),
  search: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18" style={{minWidth: '18px'}}><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
  ),
  notifications: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22" style={{minWidth: '22px'}}><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/></svg>
  ),
  badge: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M17 3h-1v2h1V3zm0 4h-1v2h1V7zm0 4h-1v2h1v-2zM7 7h2v2H7V7zm8 10H9v-2h6v2zm-2-4H7v-2h6v2zm-6 4H5v-2h2v2zm6-12h-2V3h-2v2H9V3H7v2H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H5V7h14v12z"/></svg>
  ),
  domain: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>
  ),
  map: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="40" height="40" style={{minWidth: '40px'}}><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>
  ),
  people: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
  ),
  admin_panel_settings: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{minWidth: '20px'}}><path d="M17 11c.34 0 .67.04 1 .09V6.27L10.5 3 3 6.27v4.91c0 4.54 3.2 8.79 7.5 9.82.55-.13 1.08-.32 1.6-.55-.69-.98-1.1-2.17-1.1-3.45 0-3.31 2.69-6 6-6z"/><path d="M17 13c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 1.38c.62 0 1.12.51 1.12 1.12s-.51 1.12-1.12 1.12-1.12-.51-1.12-1.12.51-1.12 1.12-1.12zm0 5.37c-1.38 0-2.61-.7-3.33-1.76.02-.02.43-.88 3.33-.88s3.31.86 3.33.88c-.72 1.06-1.95 1.76-3.33 1.76z"/></svg>
  ),
};

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard',  icon: 'dashboard' },
  { id: 'reports',   label: 'Reports',    icon: 'report' },
  { id: 'branches',  label: 'Branches',   icon: 'branches' },
  { id: 'roles',     label: 'Roles',      icon: 'admin_panel_settings' },
  { id: 'accounts',  label: 'Staff',      icon: 'accounts' },
  { id: 'users',     label: 'Users',      icon: 'users' },
  { id: 'analytics', label: 'Analytics',  icon: 'analytics' },
];

const REPORT_CATEGORY_META = {
  infrastructure: { label: 'Infrastructure', color: '#f59e0b' },
  safety: { label: 'Public Safety', color: '#ef4444' },
  sanitation: { label: 'Sanitation', color: '#0ea5e9' },
  disaster: { label: 'Disaster / Emergency', color: '#dc2626' },
  general: { label: 'General Concern', color: '#14b8a6' },
};

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

function getReporterDisplayName(report, usersByUid) {
  const reporter = report?.reporter || {};
  const reporterUid = reporter.uid || reporter.userId || reporter.user_id || reporter.sub || '';
  const matchedUser = reporterUid ? usersByUid.get(reporterUid) : null;

  const reporterUsername = String(
    reporter.username || reporter.displayName || reporter.fullName || ''
  ).trim();
  if (reporterUsername) return reporterUsername;

  const matchedUsername = String(
    matchedUser?.username || matchedUser?.displayName || matchedUser?.fullName || ''
  ).trim();
  if (matchedUsername) return matchedUsername;

  return String(reporter.email || matchedUser?.email || '').trim() || '—';
}

function getReportCategoryLabel(category) {
  const key = String(category || '').toLowerCase();
  const knownLabel = REPORT_CATEGORY_META[key]?.label;
  if (knownLabel) return knownLabel;

  const normalized = key.replace(/[_-]+/g, ' ').trim();
  if (!normalized) return 'Uncategorized';
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toTitleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const OLONGAPO_BARANGAYS = [
  'Asinan',
  'Bajac-Bajac',
  'Barretto',
  'East Bajac-Bajac',
  'East Tapinac',
  'Gordon Heights',
  'Kalaklan',
  'Mabayuan',
  'New Cabalan',
  'New Ilalim',
  'New Kababae',
  'New Kalalake',
  'Old Cabalan',
  'Pag-asa',
  'Santa Rita',
  'West Bajac-Bajac',
  'West Tapinac',
];

const BARANGAY_BY_NORMALIZED = new Map(
  OLONGAPO_BARANGAYS.map((name) => [
    String(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    name,
  ])
);

function normalizeBarangayToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getKnownBarangayName(value) {
  const normalized = normalizeBarangayToken(value);
  if (!normalized) return '';

  const exact = BARANGAY_BY_NORMALIZED.get(normalized);
  if (exact) return exact;

  const partial = OLONGAPO_BARANGAYS.find((name) => {
    const known = normalizeBarangayToken(name);
    return normalized.includes(known);
  });

  return partial || '';
}

function extractBarangayFromReport(report) {
  const directBarangay = String(
    report?.location?.barangay || report?.barangay || ''
  ).trim();

  if (directBarangay) {
    const cleaned = directBarangay.replace(/^(?:brgy\.?|barangay)\s+/i, '').trim();
    return getKnownBarangayName(cleaned) || toTitleCase(cleaned);
  }

  const address = String(report?.location?.address || '').trim();
  if (!address) return '';

  const fromPrefixMatch = address.match(/(?:^|,|\s)(?:brgy\.?|barangay)\s+([^,;]+)/i);
  if (fromPrefixMatch?.[1]) {
    const cleaned = fromPrefixMatch[1].trim();
    return getKnownBarangayName(cleaned) || toTitleCase(cleaned);
  }

  const addressSegments = address
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of addressSegments) {
    const cleaned = segment
      .replace(/\b(city of olongapo|olongapo city|olongapo|zambales|philippines)\b/gi, '')
      .replace(/^(?:brgy\.?|barangay)\s+/i, '')
      .trim();

    const known = getKnownBarangayName(cleaned);
    if (known) return known;
  }

  const knownFromWholeAddress = getKnownBarangayName(address);
  if (knownFromWholeAddress) return knownFromWholeAddress;

  return '';
}

export default function AdminPanel() {
  const { currentUser, userClaims, logout } = useAuth();
  const { openSettings } = useSettingsModal();
  const navigate = useNavigate();

  const api = useCallback(async (url, options = {}) => {
    const idToken = await currentUser.getIdToken();
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...options.headers,
      },
    });
  }, [currentUser]);

  const [activeSection, setActiveSection] = useState('dashboard');
  const [searchQuery,   setSearchQuery]   = useState('');

  // ── Branches state ──────────────────────────────────────
  const [branches,       setBranches]       = useState([]);
  const [branchLoading,  setBranchLoading]  = useState(false);
  const [branchError,    setBranchError]    = useState('');
  const [branchSuccess,  setBranchSuccess]  = useState('');
  const [newBranchName,  setNewBranchName]  = useState('');
  const [newBranchType,  setNewBranchType]  = useState('public');
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchStaffEmail, setBranchStaffEmail] = useState('');

  // ── Branch edit state ───────────────────────────────────
  const [editingBranch,    setEditingBranch]    = useState(null);
  const [editBranchName,   setEditBranchName]   = useState('');
  const [editBranchType,   setEditBranchType]   = useState('public');
  const [editBranchLoading, setEditBranchLoading] = useState(false);
  const [editBranchError,  setEditBranchError]  = useState('');

  // ── Staff account state ─────────────────────────────────
  const [staffEmail,    setStaffEmail]    = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffRole,     setStaffRole]     = useState('staff');
  const [staffBranchId, setStaffBranchId] = useState('');
  const [staffCustomRoleId, setStaffCustomRoleId] = useState('');
  const [staffLoading,  setStaffLoading]  = useState(false);
  const [staffError,    setStaffError]    = useState('');
  const [staffSuccess,  setStaffSuccess]  = useState('');

  // ── Roles state ─────────────────────────────────────────
  const [roles,           setRoles]           = useState([]);
  const [rolesLoading,    setRolesLoading]    = useState(false);
  const [rolesError,      setRolesError]      = useState('');
  const [rolesSuccess,    setRolesSuccess]    = useState('');
  const [newRoleName,     setNewRoleName]     = useState('');
  const [newRolePerms,    setNewRolePerms]    = useState([]);
  const [creatingRole,    setCreatingRole]    = useState(false);
  const [editingRole,     setEditingRole]     = useState(null);
  const [editRoleName,    setEditRoleName]    = useState('');
  const [editRolePerms,   setEditRolePerms]   = useState([]);
  const [editRoleLoading, setEditRoleLoading] = useState(false);
  const [editRoleError,   setEditRoleError]   = useState('');

  // ── Edit-staff state ────────────────────────────────────
  const [editingUser,  setEditingUser]  = useState(null);
  const [editRole,     setEditRole]     = useState('staff');
  const [editBranchId, setEditBranchId] = useState('');
  const [editCustomRoleId, setEditCustomRoleId] = useState('');
  const [editLoading,  setEditLoading]  = useState(false);
  const [editError,    setEditError]    = useState('');
  const [editSuccess,  setEditSuccess]  = useState('');

  // ── Users state ─────────────────────────────────────────
  const [users,        setUsers]        = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError,   setUsersError]   = useState('');
  const [resendingVerificationUid, setResendingVerificationUid] = useState(null);

  // ── Reports state ───────────────────────────────────────
  const [reports,        setReports]        = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError,   setReportsError]   = useState('');
  const [reportActionError, setReportActionError] = useState('');
  const [archivingReportId, setArchivingReportId] = useState('');
  const [deletingReportId, setDeletingReportId] = useState('');
  const [selectedReport, setSelectedReport] = useState(null);
  const reportsPollingRef = useRef(false);

  // Notifications state
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState('');

  // ── Users filter state ───────────────────────────────────
  const [filterRole,   setFilterRole]   = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [reportTypeFilter, setReportTypeFilter] = useState('all');
  const [reportBarangayFilter, setReportBarangayFilter] = useState('all');

  // ── UI state ────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('ap-sidebar-collapsed') === 'true';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('ap-sidebar-collapsed', sidebarCollapsed ? 'true' : 'false');
  }, [sidebarCollapsed]);

  const loadBranches = useCallback(async () => {
    setBranchLoading(true);
    setBranchError('');
    try {
      const res  = await api('/api/admin/branches');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load branches.');
      setBranches(data);
    } catch (err) {
      setBranchError(err.message);
    } finally {
      setBranchLoading(false);
    }
  }, [api]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const res  = await api('/api/admin/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load users.');
      setUsers(data);
    } catch (err) {
      setUsersError(err.message);
    } finally {
      setUsersLoading(false);
    }
  }, [api]);

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    setRolesError('');
    try {
      const res  = await api('/api/admin/roles');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load roles.');
      setRoles(data);
    } catch (err) {
      setRolesError(err.message);
    } finally {
      setRolesLoading(false);
    }
  }, [api]);

  const loadReports = useCallback(async (options = {}) => {
    const { silent = false } = options;

    if (!silent) {
      setReportsLoading(true);
      setReportsError('');
    }

    try {
      const res = await api('/api/reports');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load reports.');
      setReports(Array.isArray(data) ? data : []);
    } catch (err) {
      setReportsError(err.message);
    } finally {
      if (!silent) {
        setReportsLoading(false);
      }
    }
  }, [api]);

  const loadNotifications = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setNotifLoading(true);
      setNotifError('');
    }

    try {
      const res = await api('/api/reports/notifications');
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || 'Failed to load notifications.');
      setNotifications(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!silent) {
        setNotifError(err.message || 'Failed to load notifications.');
      }
    } finally {
      if (!silent) {
        setNotifLoading(false);
      }
    }
  }, [api]);

  useEffect(() => { loadBranches(); loadRoles(); loadNotifications(); }, [loadBranches, loadRoles, loadNotifications]);

  useEffect(() => {
    if (['dashboard', 'accounts', 'users', 'analytics', 'branches'].includes(activeSection)) loadUsers();
    if (['roles', 'accounts'].includes(activeSection)) loadRoles();
    if (['dashboard', 'reports'].includes(activeSection)) loadReports();
  }, [activeSection, loadUsers, loadRoles, loadReports]);

  useEffect(() => {
    if (activeSection !== 'dashboard') return undefined;

    const pollReports = async () => {
      if (reportsPollingRef.current) return;

      reportsPollingRef.current = true;
      try {
        await loadReports({ silent: true });
      } finally {
        reportsPollingRef.current = false;
      }
    };

    const intervalId = window.setInterval(pollReports, 8000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pollReports();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      reportsPollingRef.current = false;
    };
  }, [activeSection, loadReports]);

  useEffect(() => {
    const syncNotifications = () => {
      if (document.visibilityState !== 'visible') return;
      loadNotifications({ silent: true });
    };

    const intervalId = window.setInterval(syncNotifications, 8000);
    const handleFocus = () => syncNotifications();
    const handleVisibilityChange = () => syncNotifications();

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadNotifications]);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((item) => !item?.isRead).length,
    [notifications]
  );

  const handleNotificationOpen = async () => {
    const nextOpen = !notifOpen;
    setNotifOpen(nextOpen);
    if (nextOpen) {
      await loadNotifications();
    }
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
      // Do not block admin workflow for notification read failures.
    }
  };

  const stats = useMemo(() => ({
    totalBranches:      branches.length,
    totalPublic:        branches.filter((b) => b.type === 'public').length,
    totalPrivate:       branches.filter((b) => b.type === 'private').length,
    totalUsers:         users.length,
    totalStaff:         users.filter((u) => u.role === 'staff').length,
    totalAdmins:        users.filter((u) => u.role === 'admin').length,
    totalResidents:     users.filter((u) => u.role === 'resident').length,
  }), [branches, users]);

  const reportOperators = useMemo(
    () => users.filter((u) => u.role === 'staff' || u.role === 'admin'),
    [users]
  );

  const reportEnabledUsers = useMemo(
    () => reportOperators.filter((u) => u.role === 'admin' || (u.permissions || []).some((perm) => perm.includes('reports'))),
    [reportOperators]
  );

  const announcementPublishers = useMemo(
    () => reportOperators.filter((u) => u.role === 'admin' || (u.permissions || []).includes('create_announcements')),
    [reportOperators]
  );

  const residentReportMarkers = useMemo(
    () => reports
      .filter((report) => report?.reporter?.role === 'resident')
      .map((report) => ({
        id: report.id,
        lat: Number(report?.location?.latitude),
        lng: Number(report?.location?.longitude),
        category: String(report?.category || 'general').toLowerCase(),
        color: (REPORT_CATEGORY_META[String(report?.category || 'general').toLowerCase()] || REPORT_CATEGORY_META.general).color,
        title: report.title,
        description: report.description,
        status: report.status,
        address: report?.location?.address || '',
        createdAt: report.createdAt,
        attachments: Array.isArray(report.attachments) ? report.attachments : [],
      }))
      .filter((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng)),
    [reports]
  );

  const residentLegendItems = useMemo(
    () => Object.entries(REPORT_CATEGORY_META).map(([value, meta]) => ({
      value,
      label: meta.label,
      color: meta.color,
      count: residentReportMarkers.filter((marker) => marker.category === value).length,
    })),
    [residentReportMarkers]
  );

  const reportTypeOptions = useMemo(() => {
    const knownTypes = Object.keys(REPORT_CATEGORY_META);
    const reportTypes = Array.from(
      new Set(
        reports
          .map((report) => String(report?.category || 'general').toLowerCase().trim())
          .filter(Boolean)
      )
    );

    const extraTypes = reportTypes.filter((value) => !knownTypes.includes(value));

    const knownTypeOptions = knownTypes.map((value) => ({
      value,
      label: getReportCategoryLabel(value),
    }));

    const extraTypeOptions = extraTypes
      .map((value) => ({
        value,
        label: getReportCategoryLabel(value),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [...knownTypeOptions, ...extraTypeOptions];
  }, [reports]);

  const reportBarangayOptions = useMemo(() => {
    return Array.from(
      new Set(
        reports
          .map((report) => extractBarangayFromReport(report))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter((report) => {
      const matchesType =
        reportTypeFilter === 'all'
          ? true
          : String(report?.category || 'general').toLowerCase() === reportTypeFilter;

      const matchesBarangay =
        reportBarangayFilter === 'all'
          ? true
          : extractBarangayFromReport(report) === reportBarangayFilter;

      return matchesType && matchesBarangay;
    });
  }, [reports, reportTypeFilter, reportBarangayFilter]);

  // ── Handlers ────────────────────────────────────────────
  const handleCreateBranch = async (e) => {
    e.preventDefault();
    setBranchError('');
    setBranchSuccess('');
    setCreatingBranch(true);
    try {
      const res  = await api('/api/admin/branches', {
        method: 'POST',
        body: JSON.stringify({ name: newBranchName.trim(), type: newBranchType, staffEmail: branchStaffEmail.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create branch.');
      let msg = `"${data.name}" created successfully.`;
      if (data.staffCreated) {
        msg += ` Staff account created for ${data.staffCreated.email}. Verification and password setup emails were sent via Brevo.`;
      }
      setBranchSuccess(msg);
      setNewBranchName('');
      setNewBranchType('public');
      setBranchStaffEmail('');
      setBranches((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      // Reload users to reflect branch assignments
      loadUsers();
    } catch (err) {
      setBranchError(err.message);
    } finally {
      setCreatingBranch(false);
    }
  };

  const handleDeleteBranch = async (branch) => {
    if (!window.confirm(`Delete "${branch.name}"? Staff assigned here will retain their current claims until re-provisioned.`)) return;
    setBranchError('');
    try {
      const res = await api(`/api/admin/branches/${branch.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to delete branch.');
      }
      setBranches((prev) => prev.filter((b) => b.id !== branch.id));
    } catch (err) {
      setBranchError(err.message);
    }
  };

  const toggleNewRolePerm  = (p) => setNewRolePerms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  const toggleEditRolePerm = (p) => setEditRolePerms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);

  const handleBranchEditStart = (branch) => {
    setEditingBranch(branch);
    setEditBranchName(branch.name);
    setEditBranchType(branch.type);
    setEditBranchError('');
  };

  const handleBranchEditCancel = () => setEditingBranch(null);

  const handleUpdateBranch = async (e) => {
    e.preventDefault();
    setEditBranchError('');
    setEditBranchLoading(true);
    try {
      const res = await api(`/api/admin/branches/${editingBranch.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editBranchName.trim(), type: editBranchType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update branch.');
      setBranches((prev) =>
        prev.map((b) =>
          b.id === editingBranch.id ? { ...b, name: editBranchName.trim(), type: editBranchType } : b
        ).sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingBranch(null);
    } catch (err) {
      setEditBranchError(err.message);
    } finally {
      setEditBranchLoading(false);
    }
  };

  const handleEditStart = (user) => {
    setEditingUser(user);
    setEditRole(user.role);
    setEditBranchId(user.branchId || '');
    setEditCustomRoleId(user.customRoleId || '');
    setEditError('');
    setEditSuccess('');
  };

  const handleEditCancel = () => setEditingUser(null);

  const handleUpdateStaff = async (e) => {
    e.preventDefault();
    setEditError('');
    setEditSuccess('');
    setEditLoading(true);
    try {
      const res  = await api(`/api/admin/users/${editingUser.uid}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: editRole, branchId: editBranchId, customRoleId: editCustomRoleId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update account.');
      const branch = branches.find((b) => b.id === editBranchId);
      const customRole = roles.find((r) => r.id === editCustomRoleId);
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === editingUser.uid
            ? { ...u, role: editRole, branchId: editBranchId, branchName: branch?.name || u.branchName, entityType: branch?.type || u.entityType, customRoleId: editCustomRoleId || null, customRoleName: customRole?.name || null, permissions: customRole?.permissions || [] }
            : u
        )
      );
      setEditingUser(null);
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteUser = async (user) => {
    if (!window.confirm(`Permanently delete account for ${user.email}? This cannot be undone.`)) return;
    setUsersError('');
    try {
      const res = await api(`/api/admin/users/${user.uid}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to delete user.');
      }
      setUsers((prev) => prev.filter((u) => u.uid !== user.uid));
      if (editingUser?.uid === user.uid) setEditingUser(null);
    } catch (err) {
      setUsersError(err.message);
    }
  };

  const handleResendVerification = async (user) => {
    setResendingVerificationUid(user.uid);
    try {
      const res = await api(`/api/admin/users/${user.uid}/resend-verification`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resend verification email.');
      setUsersError('');
      setStaffSuccess(data.message || `Verification email resent to ${user.email}.`);
    } catch (err) {
      setUsersError(err.message);
    } finally {
      setResendingVerificationUid(null);
    }
  };

  const handleCreateStaff = async (e) => {
    e.preventDefault();
    setStaffError('');
    setStaffSuccess('');
    setStaffLoading(true);
    try {
      const res  = await api('/api/admin/create-staff', {
        method: 'POST',
        body: JSON.stringify({ email: staffEmail.trim(), password: staffPassword, role: staffRole, branchId: staffBranchId, customRoleId: staffCustomRoleId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create account.');
      setStaffSuccess(data.message || `Account created for ${data.email} — ${data.role} at ${data.location}. Verification email sent via Brevo.`);
      setStaffEmail('');
      setStaffPassword('');
      setStaffRole('staff');
      setStaffBranchId('');
      setStaffCustomRoleId('');
    } catch (err) {
      setStaffError(err.message);
    } finally {
      setStaffLoading(false);
    }
  };

  // ── Role CRUD handlers ──────────────────────────────────
  const handleCreateRole = async (e) => {
    e.preventDefault();
    setRolesError('');
    setRolesSuccess('');
    setCreatingRole(true);
    try {
      const res = await api('/api/admin/roles', {
        method: 'POST',
        body: JSON.stringify({ name: newRoleName.trim(), permissions: newRolePerms }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create role.');
      setRolesSuccess(`Role "${data.name}" created.`);
      setNewRoleName('');
      setNewRolePerms([]);
      setRoles((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      setRolesError(err.message);
    } finally {
      setCreatingRole(false);
    }
  };

  const handleRoleEditStart = (role) => {
    setEditingRole(role);
    setEditRoleName(role.name);
    setEditRolePerms(role.permissions || []);
    setEditRoleError('');
  };

  const handleRoleEditCancel = () => setEditingRole(null);

  const handleUpdateRole = async (e) => {
    e.preventDefault();
    setEditRoleError('');
    setEditRoleLoading(true);
    try {
      const res = await api(`/api/admin/roles/${editingRole.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editRoleName.trim(), permissions: editRolePerms }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update role.');
      setRoles((prev) =>
        prev.map((r) =>
          r.id === editingRole.id ? { ...r, name: editRoleName.trim(), permissions: editRolePerms } : r
        ).sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingRole(null);
    } catch (err) {
      setEditRoleError(err.message);
    } finally {
      setEditRoleLoading(false);
    }
  };

  const handleDeleteRole = async (role) => {
    if (!window.confirm(`Delete role "${role.name}"? Staff with this role will retain current permissions until updated.`)) return;
    setRolesError('');
    try {
      const res = await api(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to delete role.');
      }
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
      if (editingRole?.id === role.id) setEditingRole(null);
    } catch (err) {
      setRolesError(err.message);
    }
  };

  const handleArchiveReport = async (report) => {
    const reportId = String(report?.id || '').trim();
    if (!reportId) return;

    if (String(report?.status || '').toLowerCase() === 'archived') {
      setReportActionError('This report is already archived.');
      return;
    }

    const title = report?.title || 'this report';
    if (!window.confirm(`Archive "${title}"?`)) {
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

  const handleDeleteReport = async (report) => {
    const reportId = String(report?.id || '').trim();
    if (!reportId) return;

    const title = report?.title || 'this report';
    if (!window.confirm(`Permanently delete "${title}"? This cannot be undone.`)) {
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
    } catch (err) {
      setReportActionError(err.message || 'Failed to delete report.');
    } finally {
      setDeletingReportId('');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Search filtering
  const filteredUsers = useMemo(() => {
    let result = users;
    if (filterRole !== 'all') {
      result = result.filter((u) => u.role === filterRole);
    }
    if (filterBranch !== 'all') {
      result = result.filter((u) => u.branchId === filterBranch);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((u) =>
        u.email?.toLowerCase().includes(q) ||
        u.fullName?.toLowerCase().includes(q) ||
        u.role?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [users, searchQuery, filterRole, filterBranch]);

  const filteredBranches = useMemo(() => {
    if (!searchQuery) return branches;
    const q = searchQuery.toLowerCase();
    return branches.filter((b) => b.name?.toLowerCase().includes(q));
  }, [branches, searchQuery]);

  const usersByUid = useMemo(
    () => new Map(users.filter((u) => u?.uid).map((u) => [u.uid, u])),
    [users]
  );

  const resolveReporterName = useCallback(
    (report) => getReporterDisplayName(report, usersByUid),
    [usersByUid]
  );

  const initials    = (currentUser?.displayName || currentUser?.email || 'A')[0].toUpperCase();
  const displayName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Admin';
  const displayRole = userClaims?.role === 'admin' ? 'Chief Administrator' : (userClaims?.role || 'Staff');
  const selectedReportPreviewImage = selectedReport ? getReportPreviewImage(selectedReport) : null;

  return (
    <div className={`ap-shell${sidebarCollapsed ? ' ap-shell-sidebar-collapsed' : ''}`}>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="ap-sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ════════════════════════════════════════
          SIDEBAR
      ════════════════════════════════════════ */}
      <aside className={`ap-sidebar${sidebarOpen ? ' ap-sidebar-mobile-open' : ''}`}>
        <div className="ap-sidebar-brand">
          <div className="ap-brand-icon">
            {ICONS.location_city}
          </div>
          <div className="ap-brand-copy">
            <div className="ap-brand-name">OneGapo</div>
            <div className="ap-brand-sub">City Admin Panel</div>
          </div>
          <button
            className="ap-sidebar-rail-toggle"
            type="button"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span className="ap-hamburger-icon">{ICONS.chevron_left}</span>
          </button>
        </div>

        <nav className="ap-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`ap-nav-item${activeSection === item.id ? ' ap-nav-item-active' : ''}`}
              onClick={() => { setActiveSection(item.id); setSidebarOpen(false); }}
              title={item.label}
            >
              <span className="ap-nav-icon">{ICONS[item.icon]}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="ap-sidebar-footer">
          <button type="button" className="ap-nav-item" onClick={() => { openSettings(); setSidebarOpen(false); }} title="Settings">
            <span className="ap-nav-icon">{ICONS.settings}</span>
            <span>Settings</span>
          </button>
          <button className="ap-nav-item ap-nav-signout" onClick={handleLogout} title="Sign out">
            <span className="ap-nav-icon">{ICONS.logout}</span>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* ════════════════════════════════════════
          MAIN AREA
      ════════════════════════════════════════ */}
      <div className="ap-main">

        {/* Sticky header */}
        <header className="ap-header">
          <div className="ap-header-left">
            <button
              className="ap-hamburger"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label="Toggle sidebar"
            >
              <span className="ap-hamburger-icon">{sidebarOpen ? ICONS.close : ICONS.menu}</span>
            </button>
            <div className="ap-search-wrap">
              <span className="ap-search-icon">{ICONS.search}</span>
              <input
                className="ap-search-input"
                type="text"
                placeholder="Search branches, users or areas…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
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
                {ICONS.notifications}
                {unreadNotificationsCount > 0 ? (
                  <span className="ap-notif-badge" aria-hidden="true">{unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}</span>
                ) : null}
              </button>
              {notifOpen ? (
                <div className="ap-notif-menu" role="menu" aria-label="Notifications list">
                  <div className="ap-notif-menu-header">Notifications</div>
                  {notifLoading ? <p className="ap-notif-empty">Loading…</p> : null}
                  {!notifLoading && notifError ? <p className="ap-notif-empty">{notifError}</p> : null}
                  {!notifLoading && !notifError && notifications.length === 0 ? (
                    <p className="ap-notif-empty">No notifications yet.</p>
                  ) : null}
                  {!notifLoading && !notifError
                    ? notifications.slice(0, 8).map((item) => (
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
                </div>
              ) : null}
            </div>
            <div className="ap-header-divider" />
            <div className="ap-header-user">
              <div className="ap-header-user-info">
                <div className="ap-header-user-name">{displayName}</div>
                <div className="ap-header-user-role">{displayRole}</div>
              </div>
              <div className="ap-header-avatar">{initials}</div>
            </div>
          </div>
        </header>

        {/* Scrollable content */}
        <div className="ap-content">

          {/* ══════════════════════════════════════
              DASHBOARD
          ══════════════════════════════════════ */}
          {activeSection === 'dashboard' && (
            <div className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">City Overview</h2>
                  <p className="ap-section-sub">Real-time status of civic management and infrastructure</p>
                </div>
                <div className="ap-section-actions">
                  <button className="ap-btn-outline ap-btn-icon-left" onClick={() => setActiveSection('accounts')}>
                    {ICONS.accounts}
                    Manage Staff
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="ap-stats-grid">
                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-blue">
                      {ICONS.users}
                    </div>
                    <span className="ap-stat-badge ap-stat-badge-green">{stats.totalResidents} residents</span>
                  </div>
                  <p className="ap-stat-label">Total Users</p>
                  <h3 className="ap-stat-value">{usersLoading ? '…' : stats.totalUsers}</h3>
                  <p className="ap-stat-meta">{stats.totalStaff} staff · {stats.totalAdmins} admin{stats.totalAdmins !== 1 ? 's' : ''}</p>
                </div>

                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-amber">
                      {ICONS.branches}
                    </div>
                    <span className="ap-stat-badge ap-stat-badge-amber">{stats.totalPrivate} private</span>
                  </div>
                  <p className="ap-stat-label">Total Branches</p>
                  <h3 className="ap-stat-value">{branchLoading ? '…' : stats.totalBranches}</h3>
                  <p className="ap-stat-meta">{stats.totalPublic} public · {stats.totalPrivate} private</p>
                </div>

                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-emerald">
                      {ICONS.badge}
                    </div>
                    <span className="ap-stat-badge ap-stat-badge-green">Active</span>
                  </div>
                  <p className="ap-stat-label">Staff Accounts</p>
                  <h3 className="ap-stat-value">{usersLoading ? '…' : stats.totalStaff}</h3>
                  <p className="ap-stat-meta">Across all branches</p>
                </div>

                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-purple">
                      {ICONS.domain}
                    </div>
                    <span className="ap-stat-badge ap-stat-badge-purple">{stats.totalPublic} public</span>
                  </div>
                  <p className="ap-stat-label">Coverage</p>
                  <h3 className="ap-stat-value">{branchLoading ? '…' : stats.totalBranches}</h3>
                  <p className="ap-stat-meta">Olongapo City locations</p>
                </div>
              </div>

              {/* Incident map */}
              <div className="ap-card">
                <div className="ap-card-header">
                  <div>
                    <h3 className="ap-card-title">Incident Map</h3>
                    <p className="ap-card-sub">Resident-submitted report locations in Olongapo City</p>
                  </div>
                </div>
                <div className="report-map-wrap">
                  <ReportLocationMap
                    markers={residentReportMarkers}
                    helpText={null}
                    preserveViewOnRefresh
                  />
                  <div className="ap-report-legend" aria-label="Report category legend">
                    {residentLegendItems.map((item) => (
                      <span key={item.value} className="ap-report-legend-item">
                        <span className="ap-report-legend-dot" style={{ backgroundColor: item.color }} />
                        {item.label} ({item.count})
                      </span>
                    ))}
                  </div>
                  <div className="ap-map-meta">
                    <span>
                      Resident report markers: {reportsLoading ? 'Loading…' : residentReportMarkers.length}
                    </span>
                    {reportsError ? <span className="ap-status-high">{reportsError}</span> : null}
                  </div>
                </div>
              </div>

              {/* Recent activity */}
              <div className="ap-card">
                <div className="ap-card-header">
                  <h3 className="ap-card-title">Recent Activity</h3>
                  <button className="ap-btn-outline ap-btn-sm" onClick={() => setActiveSection('users')}>
                    View all
                  </button>
                </div>
                {usersLoading ? (
                  <p className="ap-loading">Loading…</p>
                ) : users.length === 0 ? (
                  <p className="ap-empty">No users yet.</p>
                ) : (
                  <div className="ap-table-wrap">
                    <table className="ap-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Location / Branch</th>
                          <th>Role</th>
                          <th>Entity Type</th>
                          <th>Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.slice(0, 6).map((u) => (
                          <tr key={u.uid}>
                            <td>
                              <div className="ap-table-user">
                                <div className="ap-table-user-icon">
                                  {(u.fullName || u.email || '?')[0].toUpperCase()}
                                </div>
                                <span className="ap-table-user-name">{u.fullName || u.email}</span>
                              </div>
                            </td>
                            <td>{u.branchName || <span className="ap-muted">—</span>}</td>
                            <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                            <td>
                              {u.entityType
                                ? <span className={`badge badge-entity-${u.entityType}`}>{u.entityType}</span>
                                : <span className="ap-muted">—</span>}
                            </td>
                            <td className="ap-muted">{u.email}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Quick actions */}
              <div className="ap-card">
                <h3 className="ap-card-title">Quick Actions</h3>
                <div className="ap-quick-grid">
                  <button className="ap-quick-card" onClick={() => setActiveSection('branches')}>
                    <span className="ap-quick-icon">{ICONS.branches}</span>
                    <p className="ap-quick-title">Manage Branches</p>
                    <p className="ap-quick-body">{stats.totalBranches} location{stats.totalBranches !== 1 ? 's' : ''} registered</p>
                  </button>
                  <button className="ap-quick-card" onClick={() => setActiveSection('accounts')}>
                    <span className="ap-quick-icon">{ICONS.accounts}</span>
                    <p className="ap-quick-title">Create Staff Account</p>
                    <p className="ap-quick-body">Provision a new staff or admin account</p>
                  </button>
                  <button className="ap-quick-card" onClick={() => setActiveSection('users')}>
                    <span className="ap-quick-icon">{ICONS.users}</span>
                    <p className="ap-quick-title">View All Users</p>
                    <p className="ap-quick-body">{stats.totalUsers} registered user{stats.totalUsers !== 1 ? 's' : ''}</p>
                  </button>
                  <button className="ap-quick-card" onClick={() => setActiveSection('reports')}>
                    <span className="ap-quick-icon">{ICONS.report}</span>
                    <p className="ap-quick-title">Reports Inbox</p>
                    <p className="ap-quick-body">Review and act on incoming citizen reports</p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════
              REPORTS
          ══════════════════════════════════════ */}
          {activeSection === 'reports' && (
            <div className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">Reports</h2>
                  <p className="ap-section-sub">Map overview and full report details</p>
                </div>
                <div className="ap-section-actions">
                  <button onClick={() => loadReports()} disabled={reportsLoading} className="ap-btn-outline ap-btn-sm">
                    {reportsLoading ? 'Loading…' : 'Refresh reports'}
                  </button>
                </div>
              </div>

              <div className="ap-card">
                <div className="ap-card-header">
                  <div>
                    <h3 className="ap-card-title">Incident Map</h3>
                    <p className="ap-card-sub">Resident-submitted report locations in Olongapo City</p>
                  </div>
                </div>
                <div className="report-map-wrap">
                  <ReportLocationMap
                    markers={residentReportMarkers}
                    helpText={null}
                    preserveViewOnRefresh
                  />
                  <div className="ap-report-legend" aria-label="Report category legend">
                    {residentLegendItems.map((item) => (
                      <span key={item.value} className="ap-report-legend-item">
                        <span className="ap-report-legend-dot" style={{ backgroundColor: item.color }} />
                        {item.label} ({item.count})
                      </span>
                    ))}
                  </div>
                  <div className="ap-map-meta">
                    <span>
                      Resident report markers: {reportsLoading ? 'Loading…' : residentReportMarkers.length}
                    </span>
                    {reportsError ? <span className="ap-status-high">{reportsError}</span> : null}
                  </div>
                </div>
              </div>

              <div className="ap-card">
                <div className="ap-card-header">
                  <h3 className="ap-card-title">All Report Details</h3>
                  <div className="ap-filters-row">
                    <div>
                      <label htmlFor="report-type-filter" className="form-label">Report type</label>
                      <select
                        id="report-type-filter"
                        className="form-select"
                        value={reportTypeFilter}
                        onChange={(event) => setReportTypeFilter(event.target.value)}
                      >
                        <option value="all">All types</option>
                        {reportTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="report-barangay-filter" className="form-label">Barangay</label>
                      <select
                        id="report-barangay-filter"
                        className="form-select"
                        value={reportBarangayFilter}
                        onChange={(event) => setReportBarangayFilter(event.target.value)}
                      >
                        <option value="all">All barangays</option>
                        {reportBarangayOptions.map((barangay) => (
                          <option key={barangay} value={barangay}>{barangay}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                {reportActionError ? <div className="auth-error" role="alert">{reportActionError}</div> : null}
                {reportsLoading ? (
                  <p className="ap-loading">Loading…</p>
                ) : reports.length === 0 ? (
                  <p className="ap-empty">No reports found.</p>
                ) : filteredReports.length === 0 ? (
                  <p className="ap-empty">No reports match the selected filters.</p>
                ) : (
                  <div className="ap-table-wrap">
                    <table className="ap-table">
                      <thead>
                        <tr>
                          <th>Title</th>
                          <th>Category</th>
                          <th>Status</th>
                          <th>Address</th>
                          <th>Reporter</th>
                          <th>Created</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredReports.map((report) => (
                          <tr
                            key={report.id}
                            className="ap-report-row-clickable"
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedReport(report)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSelectedReport(report);
                              }
                            }}
                          >
                            <td>{report.title || <span className="ap-muted">—</span>}</td>
                            <td>{getReportCategoryLabel(report.category)}</td>
                            <td>{report.status || <span className="ap-muted">—</span>}</td>
                            <td>{report?.location?.address || <span className="ap-muted">—</span>}</td>
                            <td>{resolveReporterName(report)}</td>
                            <td>{report.createdAt ? new Date(report.createdAt).toLocaleString() : <span className="ap-muted">—</span>}</td>
                            <td className="ap-table-actions">
                              <div className="ap-report-row-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
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
                                <button
                                  type="button"
                                  className="ap-report-action-btn ap-report-action-btn-danger"
                                  onClick={() => handleDeleteReport(report)}
                                  disabled={deletingReportId === report.id || archivingReportId === report.id}
                                >
                                  {deletingReportId === report.id ? 'Deleting…' : 'Delete'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {selectedReport && (
                <AppModal
                  title={selectedReport.title || 'Report details'}
                  titleId="report-details-title"
                  onClose={() => setSelectedReport(null)}
                >
                  <div className="ap-report-details-grid">
                    <div className="ap-report-details-row"><span>Status</span><strong>{selectedReport.status || '—'}</strong></div>
                    <div className="ap-report-details-row"><span>Category</span><strong>{selectedReport.category || '—'}</strong></div>
                    <div className="ap-report-details-row"><span>Reporter</span><strong>{resolveReporterName(selectedReport)}</strong></div>
                    <div className="ap-report-details-row"><span>Address</span><strong>{selectedReport?.location?.address || '—'}</strong></div>
                    <div className="ap-report-details-row"><span>Created</span><strong>{selectedReport.createdAt ? new Date(selectedReport.createdAt).toLocaleString() : '—'}</strong></div>
                    <div className="ap-report-details-row"><span>Updated</span><strong>{selectedReport.updatedAt ? new Date(selectedReport.updatedAt).toLocaleString() : '—'}</strong></div>
                  </div>

                  <div className="ap-report-details-description">
                    <p className="form-label">Description</p>
                    <p>{selectedReport.description || '—'}</p>
                  </div>

                  <div className="ap-report-details-media">
                    <p className="form-label">Image</p>
                    {selectedReportPreviewImage ? (
                      <img
                        src={selectedReportPreviewImage}
                        alt={selectedReport.title || 'Report attachment'}
                        className="ap-report-modal-image"
                      />
                    ) : (
                      <p className="ap-muted">No image attachment for this report.</p>
                    )}
                  </div>

                  <div className="ap-report-modal-actions">
                    <button
                      type="button"
                      className="ap-report-action-btn"
                      onClick={() => handleArchiveReport(selectedReport)}
                      disabled={archivingReportId === selectedReport.id || deletingReportId === selectedReport.id || String(selectedReport?.status || '').toLowerCase() === 'archived'}
                    >
                      {archivingReportId === selectedReport.id
                        ? 'Archiving…'
                        : String(selectedReport?.status || '').toLowerCase() === 'archived'
                          ? 'Archived'
                          : 'Archive'}
                    </button>
                    <button
                      type="button"
                      className="ap-report-action-btn ap-report-action-btn-danger"
                      onClick={() => handleDeleteReport(selectedReport)}
                      disabled={deletingReportId === selectedReport.id || archivingReportId === selectedReport.id}
                    >
                      {deletingReportId === selectedReport.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </AppModal>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════
              BRANCHES
          ══════════════════════════════════════ */}
          {activeSection === 'branches' && (
            <div className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">Branches</h2>
                  <p className="ap-section-sub">Manage public and private branch locations</p>
                </div>
              </div>

              <div className="ap-card">
                <h3 className="ap-card-title">Add New Branch</h3>
                {branchError   && <div role="alert"  className="auth-error">{branchError}</div>}
                {branchSuccess && <div role="status" className="auth-success">{branchSuccess}</div>}
                <form onSubmit={handleCreateBranch} className="ap-form" noValidate>
                  <div className="ap-form-row">
                    <div style={{ flex: '1' }}>
                      <label htmlFor="branch-name" className="form-label">Name</label>
                      <input
                        id="branch-name"
                        type="text"
                        required
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        className="form-input"
                        placeholder="e.g. Barangay Poblacion"
                        disabled={creatingBranch}
                      />
                    </div>
                    <div>
                      <label htmlFor="branch-type" className="form-label">Type</label>
                      <select
                        id="branch-type"
                        value={newBranchType}
                        onChange={(e) => setNewBranchType(e.target.value)}
                        className="form-select"
                        disabled={creatingBranch}
                      >
                        <option value="public">Public</option>
                        <option value="private">Private</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="branch-staff-email" className="form-label">Staff email (optional)</label>
                    <input
                      id="branch-staff-email"
                      type="email"
                      value={branchStaffEmail}
                      onChange={(e) => setBranchStaffEmail(e.target.value)}
                      className="form-input"
                      placeholder="staff@onegapo.gov.ph"
                      disabled={creatingBranch}
                    />
                    <p className="ap-field-hint">If provided, a staff account will be created and a password-reset email generated.</p>
                  </div>
                  <button
                    type="submit"
                    disabled={creatingBranch || !newBranchName.trim()}
                    className="ap-btn-primary"
                  >
                    {creatingBranch ? 'Creating…' : 'Create Location'}
                  </button>
                </form>
              </div>

              <div className="ap-card">
                <div className="ap-card-header">
                  <h3 className="ap-card-title">All Locations ({branches.length})</h3>
                  <button onClick={loadBranches} disabled={branchLoading} className="ap-btn-outline ap-btn-sm">
                    {branchLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
                {branchLoading ? (
                  <p className="ap-loading">Loading…</p>
                ) : filteredBranches.length === 0 ? (
                  <p className="ap-empty">{searchQuery ? 'No matching branches.' : 'No branches yet.'}</p>
                ) : (
                  <div className="ap-table-wrap">
                    <table className="ap-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Staff Assigned</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBranches.map((b) => {
                          const count = users.filter((u) => u.branchId === b.id).length;
                          return (
                            <tr key={b.id}>
                              <td>{b.name}</td>
                              <td><span className={`badge badge-entity-${b.type}`}>{b.type}</span></td>
                              <td>{count > 0 ? count : <span className="ap-muted">None</span>}</td>
                              <td className="ap-table-actions">
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                  <button onClick={() => handleBranchEditStart(b)} className="ap-btn-outline ap-btn-sm">Edit</button>
                                  <button onClick={() => handleDeleteBranch(b)} className="ap-btn-danger ap-btn-sm">Delete</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {editingBranch && (
                <AppModal title={`Edit Branch - ${editingBranch.name}`} titleId="edit-branch-title" onClose={handleBranchEditCancel}>
                  {editBranchError && <div role="alert" className="auth-error">{editBranchError}</div>}
                  <form onSubmit={handleUpdateBranch} className="ap-form" noValidate>
                    <div className="ap-form-row">
                      <div style={{ flex: '1' }}>
                        <label htmlFor="edit-branch-name" className="form-label">Name</label>
                        <input
                          id="edit-branch-name"
                          type="text"
                          required
                          value={editBranchName}
                          onChange={(e) => setEditBranchName(e.target.value)}
                          className="form-input"
                          disabled={editBranchLoading}
                        />
                      </div>
                      <div>
                        <label htmlFor="edit-branch-type" className="form-label">Type</label>
                        <select
                          id="edit-branch-type"
                          value={editBranchType}
                          onChange={(e) => setEditBranchType(e.target.value)}
                          className="form-select"
                          disabled={editBranchLoading}
                        >
                          <option value="public">Public</option>
                          <option value="private">Private</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <button
                        type="submit"
                        disabled={editBranchLoading || !editBranchName.trim()}
                        className="ap-btn-primary"
                        style={{ width: 'auto', padding: '0.5rem 1.25rem' }}
                      >
                        {editBranchLoading ? 'Saving…' : 'Save changes'}
                      </button>
                      <button type="button" onClick={handleBranchEditCancel} className="ap-btn-outline">Cancel</button>
                    </div>
                  </form>
                </AppModal>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════
              ROLES
          ══════════════════════════════════════ */}
          {activeSection === 'roles' && (
            <div className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">Roles</h2>
                  <p className="ap-section-sub">Define roles with permissions. Staff inherit permissions from their assigned role.</p>
                </div>
              </div>

              <div className="ap-card">
                <h3 className="ap-card-title">Create New Role</h3>
                {rolesError   && <div role="alert"  className="auth-error">{rolesError}</div>}
                {rolesSuccess && <div role="status" className="auth-success">{rolesSuccess}</div>}
                <form onSubmit={handleCreateRole} className="ap-form" noValidate>
                  <div>
                    <label htmlFor="role-name" className="form-label">Role Name</label>
                    <input
                      id="role-name"
                      type="text"
                      required
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      className="form-input"
                      placeholder="e.g. Field Officer"
                      disabled={creatingRole}
                    />
                  </div>
                  <div>
                    <p className="form-label" style={{ marginBottom: '0.5rem' }}>Permissions</p>
                    <div className="ap-perms-grid">
                      {PERMISSION_OPTIONS.map((opt) => (
                        <label key={opt.value} className="ap-perm-item">
                          <input
                            type="checkbox"
                            checked={newRolePerms.includes(opt.value)}
                            onChange={() => toggleNewRolePerm(opt.value)}
                            disabled={creatingRole}
                            className="ap-perm-check"
                          />
                          <span>{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={creatingRole || !newRoleName.trim()}
                    className="ap-btn-primary"
                  >
                    {creatingRole ? 'Creating…' : 'Create Role'}
                  </button>
                </form>
              </div>

              {editingRole && (
                <AppModal title={`Edit Role - ${editingRole.name}`} titleId="edit-role-title" onClose={handleRoleEditCancel}>
                  {editRoleError && <div role="alert" className="auth-error">{editRoleError}</div>}
                      <form onSubmit={handleUpdateRole} className="ap-form" noValidate>
                        <div>
                          <label htmlFor="edit-role-name" className="form-label">Role Name</label>
                          <input
                            id="edit-role-name"
                            type="text"
                            required
                            value={editRoleName}
                            onChange={(e) => setEditRoleName(e.target.value)}
                            className="form-input"
                            disabled={editRoleLoading}
                          />
                        </div>
                        <div>
                          <p className="form-label" style={{ marginBottom: '0.5rem' }}>Permissions</p>
                          <div className="ap-perms-grid">
                            {PERMISSION_OPTIONS.map((opt) => (
                              <label key={opt.value} className="ap-perm-item">
                                <input
                                  type="checkbox"
                                  checked={editRolePerms.includes(opt.value)}
                                  onChange={() => toggleEditRolePerm(opt.value)}
                                  disabled={editRoleLoading}
                                  className="ap-perm-check"
                                />
                                <span>{opt.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          <button
                            type="submit"
                            disabled={editRoleLoading || !editRoleName.trim()}
                            className="ap-btn-primary"
                            style={{ width: 'auto', padding: '0.5rem 1.25rem' }}
                          >
                            {editRoleLoading ? 'Saving…' : 'Save changes'}
                          </button>
                          <button type="button" onClick={handleRoleEditCancel} className="ap-btn-outline">Cancel</button>
                        </div>
                      </form>
                </AppModal>
              )}

              <div className="ap-card">
                <div className="ap-card-header">
                  <h3 className="ap-card-title">All Roles ({roles.length})</h3>
                  <button onClick={loadRoles} disabled={rolesLoading} className="ap-btn-outline ap-btn-sm">
                    {rolesLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
                {rolesLoading ? (
                  <p className="ap-loading">Loading…</p>
                ) : roles.length === 0 ? (
                  <p className="ap-empty">No roles yet. Create one above.</p>
                ) : (
                  <div className="ap-table-wrap">
                    <table className="ap-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th className="ap-roles-permissions-head">Permissions</th>
                          <th>Staff Using</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {roles.map((r) => {
                          const count = users.filter((u) => u.customRoleId === r.id).length;
                          return (
                            <tr key={r.id}>
                              <td><strong>{r.name}</strong></td>
                              <td>
                                {r.permissions?.length
                                  ? r.permissions.map((p) => (
                                      <span key={p} className="ap-perm-badge">{p.replace(/_/g, ' ')}</span>
                                    ))
                                  : <span className="ap-muted">None</span>}
                              </td>
                              <td>{count > 0 ? count : <span className="ap-muted">0</span>}</td>
                              <td className="ap-table-actions">
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                  <button onClick={() => handleRoleEditStart(r)} className="ap-btn-outline ap-btn-sm">Edit</button>
                                  <button onClick={() => handleDeleteRole(r)} className="ap-btn-danger ap-btn-sm">Delete</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════
              STAFF ACCOUNTS
          ══════════════════════════════════════ */}
          {activeSection === 'accounts' && (
            <div className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">Staff Accounts</h2>
                  <p className="ap-section-sub">Provision and manage staff and admin accounts</p>
                </div>
              </div>

              <div className="ap-card">
                <h3 className="ap-card-title">Create Staff / Admin Account</h3>
                <p className="ap-card-desc">
                  Staff and admin accounts are provisioned here — there is no public sign-up.
                  Each account is tagged to a branch and assigned a role with predefined permissions.
                </p>
                {staffError   && <div role="alert"  className="auth-error">{staffError}</div>}
                {staffSuccess && <div role="status" className="auth-success">{staffSuccess}</div>}
                <form onSubmit={handleCreateStaff} className="ap-form" noValidate>
                  <div className="ap-form-row">
                    <div style={{ flex: '1' }}>
                      <label htmlFor="adm-email" className="form-label">Email address</label>
                      <input
                        id="adm-email"
                        type="email"
                        required
                        value={staffEmail}
                        onChange={(e) => setStaffEmail(e.target.value)}
                        className="form-input"
                        placeholder="staff@onegapo.gov.ph"
                        disabled={staffLoading}
                      />
                    </div>
                    <div style={{ flex: '1' }}>
                      <label htmlFor="adm-password" className="form-label">Temporary password</label>
                      <input
                        id="adm-password"
                        type="password"
                        required
                        minLength={8}
                        value={staffPassword}
                        onChange={(e) => setStaffPassword(e.target.value)}
                        className="form-input"
                        placeholder="At least 8 characters"
                        disabled={staffLoading}
                      />
                    </div>
                  </div>
                  <div className="ap-form-row">
                    <div style={{ flex: '1' }}>
                      <label htmlFor="adm-branch" className="form-label">Assigned branch</label>
                      <select
                        id="adm-branch"
                        value={staffBranchId}
                        onChange={(e) => setStaffBranchId(e.target.value)}
                        className="form-select"
                        required
                        disabled={staffLoading || branches.length === 0}
                      >
                        <option value="">— Select a branch —</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name} ({b.type})</option>
                        ))}
                      </select>
                      {branches.length === 0 && (
                        <p className="ap-field-hint">Create a branch first in the Branches tab.</p>
                      )}
                    </div>
                    <div style={{ flex: '1' }}>
                      <label htmlFor="adm-custom-role" className="form-label">Assigned Role</label>
                      <select
                        id="adm-custom-role"
                        value={staffCustomRoleId}
                        onChange={(e) => setStaffCustomRoleId(e.target.value)}
                        className="form-select"
                        disabled={staffLoading || roles.length === 0}
                      >
                        <option value="">— No role —</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      {roles.length === 0 && (
                        <p className="ap-field-hint">Create a role first in the Roles tab.</p>
                      )}
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={staffLoading || !staffEmail || !staffPassword}
                    className="ap-btn-primary"
                  >
                    {staffLoading ? 'Creating account…' : 'Create account'}
                  </button>
                </form>
              </div>

              {editingUser && (
                <AppModal title={`Edit Account - ${editingUser.email}`} titleId="edit-account-title" onClose={handleEditCancel}>
                  {editError && <div role="alert" className="auth-error">{editError}</div>}
                      {editSuccess && <div role="status" className="auth-success">{editSuccess}</div>}
                      <form onSubmit={handleUpdateStaff} className="ap-form" noValidate>
                        <div className="ap-form-row">
                          <div style={{ flex: '1' }}>
                            <label htmlFor="edit-branch" className="form-label">Assigned branch</label>
                            <select
                              id="edit-branch"
                              value={editBranchId}
                              onChange={(e) => setEditBranchId(e.target.value)}
                              className="form-select"
                              required
                              disabled={editLoading || branches.length === 0}
                            >
                              <option value="">— Select a branch —</option>
                              {branches.map((b) => (
                                <option key={b.id} value={b.id}>{b.name} ({b.type})</option>
                              ))}
                            </select>
                          </div>
                          <div style={{ flex: '1' }}>
                            <label htmlFor="edit-custom-role" className="form-label">Assigned Role</label>
                            <select
                              id="edit-custom-role"
                              value={editCustomRoleId}
                              onChange={(e) => setEditCustomRoleId(e.target.value)}
                              className="form-select"
                              disabled={editLoading || roles.length === 0}
                            >
                              <option value="">— No role —</option>
                              {roles.map((r) => (
                                <option key={r.id} value={r.id}>{r.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          <button
                            type="submit"
                            disabled={editLoading || !editBranchId}
                            className="ap-btn-primary"
                            style={{ width: 'auto', padding: '0.5rem 1.25rem' }}
                          >
                            {editLoading ? 'Saving…' : 'Save changes'}
                          </button>
                          <button type="button" onClick={handleEditCancel} className="ap-btn-outline">Cancel</button>
                        </div>
                      </form>
                </AppModal>
              )}

              <div className="ap-card">
                <div className="ap-card-header">
                  <h3 className="ap-card-title">Existing Staff &amp; Admins</h3>
                  <button onClick={loadUsers} disabled={usersLoading} className="ap-btn-outline ap-btn-sm">
                    {usersLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
                {(() => {
                  const staffList = users.filter((u) => u.role === 'staff' || u.role === 'admin');
                  if (usersLoading) return <p className="ap-loading">Loading…</p>;
                  if (staffList.length === 0) return <p className="ap-empty">No staff or admin accounts yet.</p>;
                  return (
                    <div className="ap-table-wrap">
                      <table className="ap-table">
                        <thead>
                          <tr>
                            <th>Email</th>
                            <th>Role</th>
                            <th>Branch / Location</th>
                            <th>Assigned Role</th>
                            <th>Status</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {staffList.map((u) => (
                            <tr key={u.uid}>
                              <td>{u.email}</td>
                              <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                              <td>
                                {u.branchName
                                  ? u.branchName
                                  : <span className="ap-muted">Unassigned</span>}
                              </td>
                              <td>
                                {u.customRoleName
                                  ? <span className="ap-perm-badge">{u.customRoleName}</span>
                                  : <span className="ap-muted">—</span>}
                              </td>
                              <td>
                                <span className={`badge ${u.verified ? 'badge-verified' : 'badge-unverified'}`}>
                                  {u.verified ? 'Verified' : 'Unverified'}
                                </span>
                              </td>
                              <td className="ap-table-actions">
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                  {!u.verified && (
                                    <button onClick={() => handleResendVerification(u)} disabled={resendingVerificationUid === u.uid} className="ap-btn-sm ap-btn-primary" style={{ width: 'auto', padding: '0.25rem 0.75rem' }}>
                                      {resendingVerificationUid === u.uid ? 'Resending…' : 'Resend Verification'}
                                    </button>
                                  )}
                                  <button onClick={() => handleEditStart(u)} className="ap-btn-outline ap-btn-sm">Edit</button>
                                  <button onClick={() => handleDeleteUser(u)} className="ap-btn-danger ap-btn-sm">Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════
              ALL USERS
          ══════════════════════════════════════ */}
          {activeSection === 'users' && (
            <div className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">All Users</h2>
                  <p className="ap-section-sub">
                    {stats.totalUsers} registered user{stats.totalUsers !== 1 ? 's' : ''} — residents, staff, and admins
                  </p>
                </div>
                <button onClick={loadUsers} disabled={usersLoading} className="ap-btn-outline ap-btn-sm">
                  {usersLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>

              {usersError && <div role="alert" className="auth-error">{usersError}</div>}

              {/* Filters */}
              <div className="ap-card">
                <div className="ap-filters-row">
                  <div>
                    <label htmlFor="filter-role" className="form-label">Filter by Role</label>
                    <select
                      id="filter-role"
                      value={filterRole}
                      onChange={(e) => setFilterRole(e.target.value)}
                      className="form-select"
                    >
                      <option value="all">All Roles</option>
                      <option value="resident">Resident</option>
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="filter-branch" className="form-label">Filter by Branch</label>
                    <select
                      id="filter-branch"
                      value={filterBranch}
                      onChange={(e) => setFilterBranch(e.target.value)}
                      className="form-select"
                    >
                      <option value="all">All Branches</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  {(filterRole !== 'all' || filterBranch !== 'all') && (
                    <button
                      className="ap-btn-outline ap-btn-sm"
                      style={{ alignSelf: 'flex-end' }}
                      onClick={() => { setFilterRole('all'); setFilterBranch('all'); }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              </div>

              <div className="ap-card">
                {usersLoading ? (
                  <p className="ap-loading">Loading…</p>
                ) : filteredUsers.length === 0 ? (
                  <p className="ap-empty">{searchQuery ? 'No matching users.' : 'No users found.'}</p>
                ) : (
                  <div className="ap-table-wrap">
                    <table className="ap-table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Full name</th>
                          <th>Role</th>
                          <th>Branch</th>
                          <th>Assigned Role</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((u) => (
                          <tr key={u.uid}>
                            <td>{u.email}</td>
                            <td>{u.fullName || <span className="ap-muted">—</span>}</td>
                            <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                            <td>
                              {u.branchName
                                ? u.branchName
                                : <span className="ap-muted">—</span>}
                            </td>
                            <td>
                              {u.customRoleName
                                ? <span className="ap-perm-badge">{u.customRoleName}</span>
                                : <span className="ap-muted">—</span>}
                            </td>
                            <td className="ap-table-actions">
                              {u.role !== 'admin' && (
                                <button onClick={() => handleDeleteUser(u)} className="ap-btn-danger ap-btn-sm">
                                  Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════
              ANALYTICS
          ══════════════════════════════════════ */}
          {activeSection === 'analytics' && (
            <div className="ap-section">
              <div className="ap-section-heading">
                <div>
                  <h2 className="ap-section-title">Analytics</h2>
                  <p className="ap-section-sub">System-wide statistics and breakdowns</p>
                </div>
              </div>

              <div className="ap-stats-grid">
                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-blue">
                      {ICONS.people}
                    </div>
                  </div>
                  <p className="ap-stat-label">Total Residents</p>
                  <h3 className="ap-stat-value">{stats.totalResidents}</h3>
                  <p className="ap-stat-meta">Registered citizens</p>
                </div>

                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-purple">
                      {ICONS.badge}
                    </div>
                  </div>
                  <p className="ap-stat-label">Staff Members</p>
                  <h3 className="ap-stat-value">{stats.totalStaff}</h3>
                  <p className="ap-stat-meta">Active personnel</p>
                </div>

                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-amber">
                      {ICONS.admin_panel_settings}
                    </div>
                  </div>
                  <p className="ap-stat-label">Administrators</p>
                  <h3 className="ap-stat-value">{stats.totalAdmins}</h3>
                  <p className="ap-stat-meta">System admins</p>
                </div>

                <div className="ap-stat-card">
                  <div className="ap-stat-top">
                    <div className="ap-stat-icon ap-stat-icon-emerald">
                      {ICONS.branches}
                    </div>
                  </div>
                  <p className="ap-stat-label">Locations</p>
                  <h3 className="ap-stat-value">{stats.totalBranches}</h3>
                  <p className="ap-stat-meta">{stats.totalPublic} public · {stats.totalPrivate} private</p>
                </div>
              </div>

              <div className="ap-card">
                <h3 className="ap-card-title">Branch Breakdown</h3>
                {branchLoading ? (
                  <p className="ap-loading">Loading…</p>
                ) : branches.length === 0 ? (
                  <p className="ap-empty">No branches to display.</p>
                ) : (
                  <div className="ap-table-wrap">
                    <table className="ap-table">
                      <thead>
                        <tr>
                          <th>Branch / Barangay</th>
                          <th>Type</th>
                          <th>Staff Assigned</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map((b) => {
                          const count = users.filter((u) => u.branchId === b.id).length;
                          return (
                            <tr key={b.id}>
                              <td>{b.name}</td>
                              <td><span className={`badge badge-entity-${b.type}`}>{b.type}</span></td>
                              <td>{count > 0 ? count : <span className="ap-muted">None</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>{/* end ap-content */}

        <footer className="ap-footer">
          © {new Date().getFullYear()} OneGapo City Management System. All rights reserved. Olongapo City Admin Office.
        </footer>
      </div>{/* end ap-main */}
    </div>
  );
}
