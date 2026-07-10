const admin = require('../config/firebaseAdmin');
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require('../services/cloudinaryService');

const REPORT_STATUSES = ['submitted', 'in_progress', 'in_review', 'resolved', 'rejected'];
const BAJAC_BAJAC_BRANCHES = new Set(['east bajac bajac', 'west bajac bajac']);
const HIGH_PRIORITY_REPORT_CATEGORIES = new Set(['disaster', 'safety']);
const PENDING_SLA_STATUSES = new Set(['submitted', 'in_progress', 'in_review']);
const SLA_SYNC_BATCH_LIMIT = 400;
const REPORT_SUBMISSION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

const TIER_TARGETS_MINUTES = {
  1: {
    acknowledgment: 10,
    initialDispatch: 60,
    inspection: null,
    scheduledAction: null,
    resolution: null,
  },
  2: {
    acknowledgment: 60,
    initialDispatch: null,
    inspection: 4 * 60,
    scheduledAction: null,
    resolution: 48 * 60,
  },
  3: {
    acknowledgment: 4 * 60,
    initialDispatch: null,
    inspection: null,
    scheduledAction: 48 * 60,
    resolution: 7 * 24 * 60,
  },
  4: {
    acknowledgment: 24 * 60,
    initialDispatch: null,
    inspection: null,
    scheduledAction: null,
    resolution: 14 * 24 * 60,
  },
};

function toMillis(timestamp) {
  if (!timestamp) return 0;
  if (typeof timestamp.toDate === 'function') {
    const value = timestamp.toDate();
    return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  }
  if (timestamp instanceof Date) {
    return Number.isNaN(timestamp.getTime()) ? 0 : timestamp.getTime();
  }
  if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
  return 0;
}

function toIsoFromMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value).toISOString();
}

function getUserDisplayName(user = {}) {
  return String(
    user.fullName ||
    user.displayName ||
    user.username ||
    user.email ||
    ''
  ).trim();
}

function resolveReportTier({ category, title, description }) {
  const normalizedCategory = String(category || '').trim().toLowerCase();
  const text = `${String(title || '').toLowerCase()} ${String(description || '').toLowerCase()}`;

  if (normalizedCategory === 'disaster' || /\b(live\s*wires?|flash\s*floods?)\b/i.test(text)) {
    return 1;
  }

  if (normalizedCategory === 'safety' || /\b(burst\s*pipes?|blocked\s*roads?)\b/i.test(text)) {
    return 2;
  }

  if (normalizedCategory === 'infrastructure' || normalizedCategory === 'sanitation' || /\b(potholes?|street\s*lights?)\b/i.test(text)) {
    return 3;
  }

  return 4;
}

function buildInitialStageState(tier) {
  const targets = TIER_TARGETS_MINUTES[tier] || TIER_TARGETS_MINUTES[4];
  return {
    acknowledgment: Number.isFinite(targets.acknowledgment) ? 'pending' : 'not_applicable',
    initialDispatch: Number.isFinite(targets.initialDispatch) ? 'pending' : 'not_applicable',
    inspection: Number.isFinite(targets.inspection) ? 'pending' : 'not_applicable',
    scheduledAction: Number.isFinite(targets.scheduledAction) ? 'pending' : 'not_applicable',
    resolution: Number.isFinite(targets.resolution) ? 'pending' : 'not_applicable',
  };
}

function buildSlaDeadlines(tier, createdAtMs) {
  const targets = TIER_TARGETS_MINUTES[tier] || TIER_TARGETS_MINUTES[4];
  const toDeadline = (minutes) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return new Date(createdAtMs + (minutes * 60 * 1000)).toISOString();
  };

  return {
    acknowledgmentAt: toDeadline(targets.acknowledgment),
    initialDispatchAt: toDeadline(targets.initialDispatch),
    inspectionAt: toDeadline(targets.inspection),
    scheduledActionAt: toDeadline(targets.scheduledAction),
    resolutionAt: toDeadline(targets.resolution),
  };
}

function getNextCheckAtMs(deadlines, stageState) {
  const pending = [
    stageState?.acknowledgment === 'pending' ? toMillis(deadlines?.acknowledgmentAt) : 0,
    stageState?.initialDispatch === 'pending' ? toMillis(deadlines?.initialDispatchAt) : 0,
    stageState?.inspection === 'pending' ? toMillis(deadlines?.inspectionAt) : 0,
    stageState?.scheduledAction === 'pending' ? toMillis(deadlines?.scheduledActionAt) : 0,
    stageState?.resolution === 'pending' ? toMillis(deadlines?.resolutionAt) : 0,
  ].filter((value) => value > 0);

  if (pending.length === 0) return null;
  return Math.min(...pending);
}

function createInitialSla(tier, createdAtMs) {
  const targetsMin = TIER_TARGETS_MINUTES[tier] || TIER_TARGETS_MINUTES[4];
  const stageState = buildInitialStageState(tier);
  const deadlines = buildSlaDeadlines(tier, createdAtMs);
  const nextCheckAtMs = getNextCheckAtMs(deadlines, stageState);

  return {
    tier,
    targetsMin,
    stageState,
    deadlines,
    isFlagged: false,
    level: 'pending',
    status: 'submitted',
    activeStage: 'acknowledgment',
    thresholdHours: Number((Number(targetsMin.acknowledgment || 0) / 60).toFixed(2)),
    overdueHours: 0,
    nextCheckAtMs,
    nextCheckAt: toIsoFromMs(nextCheckAtMs),
    lastCheckedAt: null,
    trigger: 'auto_pending',
  };
}

function getDeadlineIsoForStage(deadlines, stage) {
  if (stage === 'acknowledgment') return deadlines?.acknowledgmentAt || null;
  if (stage === 'initialDispatch') return deadlines?.initialDispatchAt || null;
  if (stage === 'inspection') return deadlines?.inspectionAt || null;
  if (stage === 'scheduledAction') return deadlines?.scheduledActionAt || null;
  if (stage === 'resolution') return deadlines?.resolutionAt || null;
  return null;
}

function getActiveSlaStage(report) {
  const status = String(report?.status || 'submitted').trim().toLowerCase();
  if (!PENDING_SLA_STATUSES.has(status)) return '';

  const stageState = report?.sla?.stageState || {};
  const ordered = ['acknowledgment', 'initialDispatch', 'inspection', 'scheduledAction', 'resolution'];
  const pendingStage = ordered.find((key) => stageState?.[key] === 'pending');
  if (pendingStage) return pendingStage;

  const tier = Number(report?.sla?.tier || report?.tier || 4);
  if (status === 'submitted') return 'acknowledgment';
  if (tier === 1) return 'initialDispatch';
  if (tier === 2) return 'inspection';
  if (tier === 3) return 'scheduledAction';
  return 'resolution';
}

function getPendingSlaSnapshot(report, nowMs = Date.now()) {
  const status = String(report?.status || 'submitted').trim().toLowerCase();
  if (!PENDING_SLA_STATUSES.has(status)) {
    return {
      isBreached: false,
      status,
      activeStage: '',
      thresholdHours: 0,
      overdueHours: 0,
      breachedAt: null,
      referenceAt: null,
    };
  }

  const tier = Number(report?.sla?.tier || report?.tier || 4);
  const targetsMin = report?.sla?.targetsMin || TIER_TARGETS_MINUTES[tier] || TIER_TARGETS_MINUTES[4];
  const activeStage = getActiveSlaStage(report);
  const deadlineIso = getDeadlineIsoForStage(report?.sla?.deadlines || {}, activeStage);
  const deadlineMs = toMillis(deadlineIso);
  const thresholdMinutes = Number(targetsMin?.[activeStage] || 0);

  if (!activeStage || !deadlineMs || !Number.isFinite(thresholdMinutes) || thresholdMinutes <= 0) {
    return {
      isBreached: false,
      status,
      activeStage,
      thresholdHours: 0,
      overdueHours: 0,
      breachedAt: null,
      referenceAt: null,
    };
  }

  const referenceMs = toMillis(report?.createdAt) || nowMs;
  const overdueHours = Math.max(0, Number(((nowMs - deadlineMs) / (60 * 60 * 1000)).toFixed(2)));

  return {
    isBreached: nowMs >= deadlineMs,
    status,
    activeStage,
    thresholdHours: Number((thresholdMinutes / 60).toFixed(2)),
    overdueHours,
    breachedAt: deadlineIso,
    referenceAt: toIsoFromMs(referenceMs),
  };
}

function getSlaResponseState(report) {
  const existing = report?.sla && typeof report.sla === 'object' ? report.sla : {};
  const snapshot = getPendingSlaSnapshot(report);
  if (!snapshot.isBreached) {
    return {
      ...existing,
      isFlagged: false,
      overdueHours: 0,
    };
  }

  return {
    ...existing,
    isFlagged: true,
    level: 'pending',
    status: snapshot.status,
    activeStage: snapshot.activeStage,
    thresholdHours: snapshot.thresholdHours,
    referenceAt: snapshot.referenceAt,
    breachedAt: snapshot.breachedAt,
    overdueHours: snapshot.overdueHours,
    trigger: 'auto_pending',
  };
}

async function syncPendingSlaFlags(db, reports) {
  if (!db || !Array.isArray(reports) || reports.length === 0) return;

  let batch = db.batch();
  let pendingWrites = 0;
  const nowIso = new Date().toISOString();

  const commitBatch = async () => {
    if (pendingWrites === 0) return;
    await batch.commit();
    batch = db.batch();
    pendingWrites = 0;
  };

  for (const report of reports) {
    const reportId = String(report?.id || '').trim();
    if (!reportId) continue;

    const existing = report?.sla && typeof report.sla === 'object' ? report.sla : {};
    const snapshot = getPendingSlaSnapshot(report);
    const alreadyFlaggedForStage =
      existing?.isFlagged === true &&
      existing?.status === snapshot.status &&
      existing?.activeStage === snapshot.activeStage;

    if (!snapshot.isBreached && existing?.isFlagged !== true) {
      continue;
    }

    const nextSla = {
      ...existing,
      lastCheckedAt: nowIso,
      status: snapshot.status,
      activeStage: snapshot.activeStage,
      thresholdHours: snapshot.thresholdHours,
      referenceAt: snapshot.referenceAt,
      breachedAt: snapshot.breachedAt,
      overdueHours: snapshot.overdueHours,
      trigger: 'auto_pending',
    };

    let updatePayload;
    if (snapshot.isBreached) {
      nextSla.isFlagged = true;
      nextSla.level = 'pending';

      updatePayload = {
        sla: nextSla,
      };

      if (!alreadyFlaggedForStage) {
        updatePayload.auditTrail = admin.firestore.FieldValue.arrayUnion({
          type: 'sla_flagged',
          changedAt: nowIso,
          changedBy: {
            uid: 'system',
            role: 'system',
            email: 'system@onegapo.local',
          },
          progressNote: `Auto-flagged as pending. Stage "${snapshot.activeStage}" exceeded SLA target of ${snapshot.thresholdHours} hour(s).`,
        });
      }
    } else {
      nextSla.isFlagged = false;
      nextSla.overdueHours = 0;
      nextSla.clearedAt = nowIso;
      nextSla.clearReason = 'status_updated_or_within_threshold';
      updatePayload = {
        sla: nextSla,
      };
    }

    batch.update(db.collection('reports').doc(reportId), updatePayload);
    pendingWrites += 1;

    if (pendingWrites >= SLA_SYNC_BATCH_LIMIT) {
      await commitBatch();
    }
  }

  await commitBatch();
}

const COVERAGE_ALIASES = new Map([
  ['asinan', 'Asinan'],
  ['new asinan', 'New Asinan'],
  ['banicain', 'Banicain'],
  ['barretto', 'Barretto'],
  ['east bajac bajac', 'East Bajac-Bajac'],
  ['west bajac bajac', 'West Bajac-Bajac'],
  ['bajac bajac', 'Bajac-Bajac'],
  ['east tapinac', 'East Tapinac'],
  ['west tapinac', 'West Tapinac'],
  ['gordon heights', 'Gordon Heights'],
  ['kababae', 'Kababae'],
  ['new kababae', 'New Kababae'],
  ['kalaklan', 'Kalaklan'],
  ['kalalake', 'Kalalake'],
  ['new kalalake', 'New Kalalake'],
  ['mabayuan', 'Mabayuan'],
  ['new cabalan', 'New Cabalan'],
  ['old cabalan', 'Old Cabalan'],
  ['new ilalim', 'New Ilalim'],
  ['pag asa', 'Pag-asa'],
  ['sta rita', 'Sta. Rita'],
  ['sta. rita', 'Sta. Rita'],
  ['santa rita', 'Sta. Rita'],
  ['sbma', 'SBMA Freeport Zone'],
  ['freeport', 'SBMA Freeport Zone'],
  ['freeport zone', 'SBMA Freeport Zone'],
  ['subic bay freeport zone', 'SBMA Freeport Zone'],
  ['subic bay metropolitan authority', 'SBMA Freeport Zone'],
]);

const METRICS_BARANGAYS = [
  'Asinan',
  'New Asinan',
  'Banicain',
  'Barretto',
  'East Bajac-Bajac',
  'West Bajac-Bajac',
  'East Tapinac',
  'West Tapinac',
  'Gordon Heights',
  'Kababae',
  'New Kababae',
  'Kalaklan',
  'Kalalake',
  'New Kalalake',
  'Mabayuan',
  'New Cabalan',
  'Old Cabalan',
  'New Ilalim',
  'Pag-asa',
  'Sta. Rita',
];

const OLONGAPO_CITY_BOUNDS = {
  minLat: 14.73,
  maxLat: 14.92,
  minLng: 120.22,
  maxLng: 120.34,
};

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalCoverageName(value) {
  const normalized = normalizeToken(value);
  if (!normalized) return '';

  if (COVERAGE_ALIASES.has(normalized)) {
    return COVERAGE_ALIASES.get(normalized);
  }

  for (const [alias, canonical] of COVERAGE_ALIASES.entries()) {
    if (normalized.includes(alias)) {
      return canonical;
    }
  }

  return '';
}

function extractCoverageFromAddress(address) {
  const rawAddress = String(address || '').trim();
  if (!rawAddress) return '';

  const fromPrefixMatch = rawAddress.match(/(?:^|,|\s)(?:brgy\.?|barangay)\s+([^,;]+)/i);
  if (fromPrefixMatch?.[1]) {
    const fromPrefix = canonicalCoverageName(fromPrefixMatch[1]);
    if (fromPrefix) return fromPrefix;
  }

  const addressSegments = rawAddress
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of addressSegments) {
    const cleaned = segment
      .replace(/\b(city of olongapo|olongapo city|olongapo|zambales|philippines)\b/gi, '')
      .replace(/^(?:brgy\.?|barangay)\s+/i, '')
      .trim();

    const known = canonicalCoverageName(cleaned);
    if (known) return known;
  }

  return canonicalCoverageName(rawAddress);
}
function getReportCoverage(report) {
  const directBarangay = canonicalCoverageName(report?.location?.barangay || report?.barangay || '');
  if (directBarangay) return directBarangay;

  return extractCoverageFromAddress(report?.location?.address || '');
}

function buildCoverageTokens(value) {
  const tokens = new Set();
  const canonical = canonicalCoverageName(value);
  const normalizedValue = normalizeToken(value);

  if (canonical) {
    tokens.add(normalizeToken(canonical));
  }
  if (normalizedValue) {
    tokens.add(normalizedValue);
  }

  return tokens;
}

function isReportInCoverage(report, coverageName) {
  const scopeTokens = buildCoverageTokens(coverageName);
  const reportCoverage = getReportCoverage(report);
  const reportTokens = new Set([
    ...buildCoverageTokens(reportCoverage),
    ...buildCoverageTokens(report?.location?.address || ''),
  ]);

  if (scopeTokens.size === 0 || reportTokens.size === 0) {
    return false;
  }

  for (const scopeToken of scopeTokens) {
    if (reportTokens.has(scopeToken)) {
      return true;
    }

    if (BAJAC_BAJAC_BRANCHES.has(scopeToken) && reportTokens.has('bajac bajac')) {
      return true;
    }
  }

  return false;
}

function getRequesterUid(req) {
  const uid = req.user?.uid || req.user?.user_id || req.user?.sub || null;
  if (!uid) {
    const err = new Error('Unauthorized: Missing user identifier in token.');
    err.status = 401;
    throw err;
  }
  return uid;
}

function toIso(timestamp) {
  if (!timestamp) return null;
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toISOString();
  }
  if (timestamp instanceof Date) {
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
  }
  if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function safeDocData(doc) {
  try {
    const data = doc.data();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function normalizeReportRecord(data, id) {
  return {
    id: data?.id || id,
    ...data,
    createdAt: toIso(data?.createdAt),
    updatedAt: toIso(data?.updatedAt),
  };
}

function isDuplicateChildReport(report) {
  return Boolean(String(report?.duplicateOfReportId || '').trim());
}

async function fetchReportRecordById(db, reportId, cache) {
  const key = String(reportId || '').trim();
  if (!key) {
    return null;
  }

  if (cache.has(key)) {
    return cache.get(key);
  }

  const fetchPromise = db.collection('reports').doc(key).get().then((snap) => {
    if (!snap.exists) {
      return null;
    }

    return normalizeReportRecord(safeDocData(snap), snap.id);
  });

  cache.set(key, fetchPromise);
  return fetchPromise;
}

async function hydrateDuplicateReport(db, report, cache = new Map(), chain = new Set()) {
  if (!report || !isDuplicateChildReport(report)) {
    return {
      ...report,
      duplicateOfReportId: String(report?.duplicateOfReportId || '').trim() || null,
      duplicateOfReport: null,
      isDuplicateChild: false,
    };
  }

  const reportId = String(report?.id || '').trim();
  const motherReportId = String(report?.duplicateOfReportId || '').trim();

  if (!motherReportId || motherReportId === reportId || chain.has(motherReportId)) {
    return {
      ...report,
      duplicateOfReportId: motherReportId || null,
      duplicateOfReport: null,
      isDuplicateChild: true,
      duplicateResolutionError: 'duplicate_cycle_detected',
    };
  }

  const motherReport = await fetchReportRecordById(db, motherReportId, cache);
  if (!motherReport) {
    return {
      ...report,
      duplicateOfReportId: motherReportId,
      duplicateOfReport: null,
      isDuplicateChild: true,
      duplicateResolutionError: 'duplicate_source_missing',
    };
  }

  const nextChain = new Set(chain);
  if (reportId) {
    nextChain.add(reportId);
  }

  const hydratedMother = await hydrateDuplicateReport(db, motherReport, cache, nextChain);

  return {
    ...report,
    duplicateOfReportId: hydratedMother.id,
    duplicateOfReport: {
      id: hydratedMother.id,
      title: hydratedMother.title || '',
      status: hydratedMother.status || '',
      category: hydratedMother.category || '',
      createdAt: hydratedMother.createdAt || '',
      updatedAt: hydratedMother.updatedAt || '',
    },
    isDuplicateChild: true,
    status: hydratedMother.status || report.status,
    resolution: hydratedMother.resolution ?? report.resolution ?? null,
    auditTrail: Array.isArray(hydratedMother.auditTrail) ? hydratedMother.auditTrail : (Array.isArray(report.auditTrail) ? report.auditTrail : []),
    lifecycle: hydratedMother.lifecycle && typeof hydratedMother.lifecycle === 'object'
      ? hydratedMother.lifecycle
      : (report.lifecycle && typeof report.lifecycle === 'object' ? report.lifecycle : null),
    sla: hydratedMother.sla && typeof hydratedMother.sla === 'object'
      ? hydratedMother.sla
      : (report.sla && typeof report.sla === 'object' ? report.sla : null),
    lastUpdatedBy: hydratedMother.lastUpdatedBy || report.lastUpdatedBy || null,
  };
}

function buildDuplicateMirrorPayload(report) {
  return {
    status: report?.status || 'submitted',
    resolution: report?.resolution ?? null,
    auditTrail: Array.isArray(report?.auditTrail) ? report.auditTrail : [],
    lifecycle: report?.lifecycle && typeof report.lifecycle === 'object' ? report.lifecycle : null,
    sla: report?.sla && typeof report.sla === 'object' ? report.sla : null,
    lastUpdatedBy: report?.lastUpdatedBy || null,
  };
}

async function syncDuplicateChildrenFromSource(db, sourceReport, { excludeIds = [] } = {}) {
  const sourceReportId = String(sourceReport?.id || '').trim();
  if (!sourceReportId) {
    return;
  }

  const childSnap = await db
    .collection('reports')
    .where('duplicateOfReportId', '==', sourceReportId)
    .get();

  if (childSnap.empty) {
    return;
  }

  const mirrorPayload = buildDuplicateMirrorPayload(sourceReport);
  const excluded = new Set(excludeIds.map((value) => String(value || '').trim()).filter(Boolean));
  const batch = db.batch();
  let hasUpdates = false;

  childSnap.docs.forEach((doc) => {
    if (excluded.has(doc.id)) {
      return;
    }

    hasUpdates = true;
    batch.update(doc.ref, {
      ...mirrorPayload,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  if (hasUpdates) {
    await batch.commit();
  }
}

async function hydrateReportsWithDuplicates(db, reports) {
  const cache = new Map();
  return Promise.all(reports.map((report) => hydrateDuplicateReport(db, report, cache)));
}

function parseCoordinate(value, label) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    const err = new Error(`Invalid ${label} coordinate.`);
    err.status = 400;
    throw err;
  }
  return num;
}

function validateLatLng(lat, lng) {
  if (lat < -90 || lat > 90) {
    const err = new Error('Latitude must be between -90 and 90.');
    err.status = 400;
    throw err;
  }
  if (lng < -180 || lng > 180) {
    const err = new Error('Longitude must be between -180 and 180.');
    err.status = 400;
    throw err;
  }
}

function validateInsideOlongapo(lat, lng) {
  const isInside =
    lat >= OLONGAPO_CITY_BOUNDS.minLat
    && lat <= OLONGAPO_CITY_BOUNDS.maxLat
    && lng >= OLONGAPO_CITY_BOUNDS.minLng
    && lng <= OLONGAPO_CITY_BOUNDS.maxLng;

  if (!isInside) {
    const err = new Error('Report location is outside Olongapo City and cannot be submitted.');
    err.status = 400;
    throw err;
  }
}

function canStaffAccessReport(report, reqUser) {
  const staffCoverage = String(reqUser?.location || '').trim();
  if (!staffCoverage) {
    return false;
  }

  const assignedResponderUid = String(report?.assignedResponder?.uid || '').trim();
  if (assignedResponderUid && assignedResponderUid === String(reqUser?.uid || '').trim()) {
    return true;
  }

  if (isReportInCoverage(report, staffCoverage)) {
    return true;
  }

  const staffBranchId = normalizeToken(reqUser?.branchId || '');
  const forwardedBranchId = normalizeToken(report?.forwarding?.to?.branchId || '');
  if (staffBranchId && forwardedBranchId && staffBranchId === forwardedBranchId) {
    return true;
  }

  return false;
}

function hasPermission(reqUser, permission) {
  if (!permission) return false;
  const permissions = Array.isArray(reqUser?.permissions) ? reqUser.permissions : [];
  return permissions.includes(permission);
}

function getRequesterRoleKey(reqUser = {}) {
  const roleKey = String(reqUser?.roleKey || reqUser?.role || '').trim().toLowerCase();
  const customRoleKey = String(reqUser?.customRoleName || '').trim().toLowerCase();

  if (roleKey === 'responder' || customRoleKey === 'responder') {
    return 'responder';
  }

  return roleKey || customRoleKey || '';
}

function canManageReportLifecycle(reqUser) {
  const role = getRequesterRoleKey(reqUser);
  if (role === 'admin') {
    return true;
  }

  if (role === 'staff' && hasPermission(reqUser, 'archive_reports')) {
    return true;
  }

  return false;
}

function toNotificationDto(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    createdAt: toIso(data.createdAt),
    readAt: toIso(data.readAt),
  };
}

function emitReportsRefresh(reportId) {
  try {
    const socketInstance = require('../realtime/socketInstance');
    const io = socketInstance.get && socketInstance.get();
    if (io && typeof io.emit === 'function') {
      io.emit('reports:refresh', reportId ? { reportId } : {});
    }
  } catch {
    // no-op
  }
}

function getReportResolvedAtMs(report) {
  if (String(report?.status || '').toLowerCase() !== 'resolved') {
    return 0;
  }

  const directResolvedAt = toMillis(report?.resolution?.resolvedAt);
  if (directResolvedAt) {
    return directResolvedAt;
  }

  const auditTrail = Array.isArray(report?.auditTrail) ? report.auditTrail : [];
  const latestResolvedEntry = auditTrail
    .slice()
    .sort((a, b) => toMillis(b?.changedAt) - toMillis(a?.changedAt))
    .find((entry) => String(entry?.toStatus || '').toLowerCase() === 'resolved');

  if (latestResolvedEntry) {
    return toMillis(latestResolvedEntry.changedAt);
  }

  return toMillis(report?.updatedAt);
}

function getReportMttrMinutes(report) {
  const createdAtMs = toMillis(report?.createdAt);
  const resolvedAtMs = getReportResolvedAtMs(report);

  if (!createdAtMs || !resolvedAtMs || resolvedAtMs < createdAtMs) {
    return null;
  }

  return (resolvedAtMs - createdAtMs) / 60000;
}

function isResourceExhaustedError(err) {
  const code = String(err?.code || '').toLowerCase();
  const message = String(err?.message || err?.details || '').toLowerCase();
  return (
    code === '8' ||
    code === 'resource-exhausted' ||
    message.includes('resource_exhausted') ||
    message.includes('quota exceeded')
  );
}

function getReportBranchCoverageName(report) {
  return String(
    report?.forwarding?.to?.branchName ||
    report?.branchName ||
    report?.location?.branchName ||
    report?.location?.barangay ||
    ''
  ).trim();
}

function buildPerformanceRows(locations, reports, getLocationName, getReportCoverageName = getLocationName, getExtraFields = () => ({})) {
  const rowsByName = new Map();

  locations.forEach((location) => {
    const name = String(getLocationName(location) || '').trim();
    if (!name) return;

    rowsByName.set(name, {
      name,
      ...getExtraFields(location),
      totalReports: 0,
      resolvedReports: 0,
      pendingReports: 0,
      mttrCount: 0,
      mttrTotalMinutes: 0,
    });
  });

  reports.forEach((report) => {
    const name = String(getReportCoverageName(report) || '').trim();
    if (!name) return;

    if (!rowsByName.has(name)) {
      rowsByName.set(name, {
        name,
        ...getExtraFields({ name }),
        totalReports: 0,
        resolvedReports: 0,
        pendingReports: 0,
        mttrCount: 0,
        mttrTotalMinutes: 0,
      });
    }

    const row = rowsByName.get(name);
    row.totalReports += 1;

    const status = String(report?.status || 'submitted').trim().toLowerCase();
    if (status === 'resolved') {
      row.resolvedReports += 1;
      const mttrMinutes = getReportMttrMinutes(report);
      if (Number.isFinite(mttrMinutes)) {
        row.mttrCount += 1;
        row.mttrTotalMinutes += mttrMinutes;
      }
    }

    if (status === 'submitted' || status === 'in_review') {
      row.pendingReports += 1;
    }
  });

  return Array.from(rowsByName.values())
    .map((row) => {
      const averageMttrMinutes = row.mttrCount > 0 ? row.mttrTotalMinutes / row.mttrCount : null;
      return {
        name: row.name,
        type: row.type || null,
        totalReports: row.totalReports,
        resolvedReports: row.resolvedReports,
        pendingReports: row.pendingReports,
        resolutionRate: row.totalReports > 0 ? (row.resolvedReports / row.totalReports) * 100 : 0,
        averageMttrMinutes,
      };
    })
    .sort((a, b) => b.totalReports - a.totalReports || a.name.localeCompare(b.name));
}

async function getPerformanceMetrics(req, res, next) {
  try {
    const role = getRequesterRoleKey(req.user);
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can access performance metrics.' });
    }

    const db = admin.firestore();

    let reportSnap;
    try {
      reportSnap = await db.collection('reports').limit(800).get();
    } catch (queryErr) {
      console.warn('[getPerformanceMetrics] Primary report query failed, using fallback scan:', queryErr.message || queryErr);
      reportSnap = await db.collection('reports').get();
    }

    const rawReports = reportSnap.docs
      .map((doc) => normalizeReportRecord(safeDocData(doc), doc.id))
      .filter((report) => Boolean(report && report.id));

    await syncPendingSlaFlags(db, rawReports);

    let reports = rawReports.filter((report) => !isDuplicateChildReport(report));
    if (role === 'staff') {
      reports = reports.filter((report) => {
        try {
          return canStaffAccessReport(report, req.user);
        } catch {
          return false;
        }
      });
    }

    let branchDocs = [];
    try {
      const branchSnap = await db.collection('branches').orderBy('name').get();
      branchDocs = branchSnap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() || {}),
      }));
    } catch {
      const fallbackBranchSnap = await db.collection('branches').get();
      branchDocs = fallbackBranchSnap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() || {}),
      }));
    }

    const normalizedBranches = branchDocs.map((branch) => ({
      id: branch.id,
      name: String(branch.name || '').trim(),
      type: String(branch.type || 'public').trim().toLowerCase() || 'public',
    }));

    const barangaySeed = new Map();
    METRICS_BARANGAYS.forEach((name) => barangaySeed.set(name, { name }));
    normalizedBranches
      .filter((branch) => branch.type === 'public' && branch.name)
      .forEach((branch) => barangaySeed.set(branch.name, { name: branch.name }));

    const barangayRows = buildPerformanceRows(
      Array.from(barangaySeed.values()),
      reports,
      (location) => location.name,
      (report) => getReportCoverage(report)
    );

    const branchRows = buildPerformanceRows(
      normalizedBranches,
      reports,
      (branch) => branch.name,
      (report) => canonicalCoverageName(getReportBranchCoverageName(report)) || getReportCoverage(report),
      (branch) => ({ type: branch.type || 'public' })
    );

    const totalReports = reports.length;
    const resolvedReports = reports.filter((report) => String(report?.status || '').toLowerCase() === 'resolved').length;
    const pendingReports = reports.filter((report) => {
      const status = String(report?.status || '').toLowerCase();
      return status === 'submitted' || status === 'in_review';
    }).length;

    const resolvedMttrValues = reports
      .filter((report) => String(report?.status || '').toLowerCase() === 'resolved')
      .map((report) => getReportMttrMinutes(report))
      .filter((value) => Number.isFinite(value));

    const averageMttrMinutes = resolvedMttrValues.length > 0
      ? resolvedMttrValues.reduce((sum, value) => sum + value, 0) / resolvedMttrValues.length
      : null;

    return res.json({
      summary: {
        totalReports,
        resolvedReports,
        pendingReports,
        resolutionRate: totalReports > 0 ? (resolvedReports / totalReports) * 100 : 0,
        averageMttrMinutes,
      },
      barangayRows,
      branchRows,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return next(err);
  }
}

function isEmergencyEscalation({ report, note }) {
  const category = String(report?.category || '').trim().toLowerCase();
  if (HIGH_PRIORITY_REPORT_CATEGORIES.has(category)) {
    return true;
  }

  const noteText = String(note || '').trim().toLowerCase();
  if (!noteText) {
    return false;
  }

  return /(emergency|urgent|escalat|high[\s-]?priority)/i.test(noteText);
}

async function notifyUsersForForwarding({ db, recipients, report, targetBranch, actor, note }) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return;
  }

  const batch = db.batch();
  const emergencyEscalation = isEmergencyEscalation({ report, note });
  const title = emergencyEscalation
    ? `Emergency escalation to ${targetBranch.name}`
    : `Report forwarded to ${targetBranch.name}`;
  const message = emergencyEscalation
    ? `${actor.email || actor.uid || 'An operator'} escalated "${report.title || report.id}" as high priority.`
    : `${actor.email || actor.uid || 'An operator'} forwarded "${report.title || report.id}".`;

  for (const recipient of recipients) {
    const ref = db.collection('notifications').doc();
    batch.set(ref, {
      recipientUid: recipient.uid,
      type: emergencyEscalation ? 'report_emergency_escalation' : 'report_forwarded',
      priority: emergencyEscalation ? 'high' : 'normal',
      title,
      message,
      isRead: false,
      reportId: report.id,
      metadata: {
        targetBranchId: targetBranch.id,
        targetBranchName: targetBranch.name,
        reportCategory: String(report?.category || '').trim().toLowerCase() || null,
        alertCategory: emergencyEscalation ? 'emergency' : 'general',
        note: note || null,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
}

async function notifyUsersForEmergencySubmission({ db, report, reporter }) {
  const category = String(report?.category || '').trim().toLowerCase();
  if (!HIGH_PRIORITY_REPORT_CATEGORIES.has(category)) {
    return;
  }

  const coverage = String(getReportCoverage(report) || report?.location?.barangay || report?.location?.address || '').trim();
  const areaLabel = coverage || 'assigned area';

  const staffSnap = await db.collection('users').where('role', '==', 'staff').get();
  const staffRecipients = staffSnap.docs
    .map((doc) => doc.data())
    .filter((user) => user?.uid && canStaffAccessReport(report, user))
    .map((user) => ({ uid: user.uid }));

  const adminSnap = await db.collection('users').where('role', '==', 'admin').get();
  const adminRecipients = adminSnap.docs
    .map((doc) => doc.data())
    .filter((user) => user?.uid)
    .map((user) => ({ uid: user.uid }));

  const recipientMap = new Map();
  for (const recipient of [...staffRecipients, ...adminRecipients]) {
    recipientMap.set(recipient.uid, recipient);
  }

  if (recipientMap.size === 0) {
    return;
  }

  const batch = db.batch();
  const title = `Emergency in ${areaLabel}: ${report.title || report.id}`;
  const message = `${reporter?.email || 'A resident'} submitted a high-priority ${category} report for ${areaLabel}.`;

  for (const recipient of recipientMap.values()) {
    const ref = db.collection('notifications').doc();
    batch.set(ref, {
      recipientUid: recipient.uid,
      type: 'report_emergency_submitted',
      priority: 'high',
      title,
      message,
      isRead: false,
      reportId: report.id,
      metadata: {
        reportCategory: category,
        alertCategory: 'emergency',
        alertArea: areaLabel,
        coverage,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
}

async function createReport(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = req.user?.role;
    if (role !== 'resident') {
      return res.status(403).json({ error: 'Only residents can submit reports.' });
    }

    // --- Report submission cooldown (5 minutes per user) ---
    const db = admin.firestore();
    const userDocSnap = await db.collection('users').doc(requesterUid).get();
    const userData = userDocSnap.exists ? (userDocSnap.data() || {}) : {};
    const lastSubmittedAt = toMillis(userData.lastReportSubmittedAt);
    if (lastSubmittedAt) {
      const elapsed = Date.now() - lastSubmittedAt;
      if (elapsed < REPORT_SUBMISSION_COOLDOWN_MS) {
        const remainingMs = REPORT_SUBMISSION_COOLDOWN_MS - elapsed;
        const remainingSeconds = Math.ceil(remainingMs / 1000);
        return res.status(429).json({
          error: `You can only submit one report every 5 minutes. Please wait ${remainingSeconds} second(s) before submitting again.`,
          remainingSeconds,
        });
      }
    }

    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const category = String(req.body?.category || 'general').trim().toLowerCase();
    const address = String(req.body?.address || '').trim();
    const inferredBarangay = extractCoverageFromAddress(address);
    const lat = parseCoordinate(req.body?.latitude, 'latitude');
    const lng = parseCoordinate(req.body?.longitude, 'longitude');
    validateLatLng(lat, lng);
    validateInsideOlongapo(lat, lng);

    if (!title || title.length < 5) {
      return res.status(400).json({ error: 'Title is required and must be at least 5 characters.' });
    }
    if (!description || description.length < 20) {
      return res.status(400).json({ error: 'Description is required and must be at least 20 characters.' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const tier = resolveReportTier({ category, title, description });
    const createdAtMs = Date.now();

    if (files.length > 0 && !isCloudinaryConfigured()) {
      return res.status(503).json({
        error: 'Cloudinary is not configured. Please set CLOUDINARY credentials in backend environment variables.',
      });
    }

    // Update lastReportSubmittedAt before processing so concurrent submissions are blocked
    await db.collection('users').doc(requesterUid).update({
      lastReportSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {
      // Non-fatal: if the update fails, we still proceed (don't block the user)
    });

    const attachments = await Promise.all(
      files.map(async (file) => {
        const upload = await uploadBufferToCloudinary(file.buffer);
        return {
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          resourceType: upload.resource_type,
          url: upload.secure_url,
          publicId: upload.public_id,
          format: upload.format || null,
          bytes: upload.bytes || file.size,
          uploadedAt: new Date().toISOString(),
        };
      })
    );

    const reportRef = db.collection('reports').doc();

    const payload = {
      id: reportRef.id,
      title,
      description,
      category,
      status: 'submitted',
      duplicateOfReportId: null,
      location: {
        latitude: lat,
        longitude: lng,
        address,
        barangay: inferredBarangay,
        mapProvider: 'openstreetmap',
      },
      reporter: {
        uid: requesterUid,
        email: req.user.email || '',
        role,
      },
      attachments,
      tier,
      lifecycle: {
        acknowledgedAt: null,
        dispatchedAt: null,
        inspectedAt: null,
        scheduledActionAt: null,
        resolvedAt: null,
      },
      sla: createInitialSla(tier, createdAtMs),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await reportRef.set(payload);

    emitReportsRefresh(reportRef.id);

    try {
      await notifyUsersForEmergencySubmission({
        db,
        report: payload,
        reporter: {
          uid: requesterUid,
          email: req.user?.email || '',
        },
      });
    } catch (notifErr) {
      console.warn('[createReport] Failed to create emergency notifications:', notifErr.message || notifErr);
    }

    return res.status(201).json({
      message: 'Report submitted successfully.',
      report: {
        ...payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function listOwnReports(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const db = admin.firestore();
    let snap;

    try {
      snap = await db
        .collection('reports')
        .where('reporter.uid', '==', requesterUid)
        .get();
    } catch (queryErr) {
      // Fallback path for Firestore query incompatibilities with legacy data.
      console.warn('[listOwnReports] Primary query failed, using fallback scan:', queryErr.message || queryErr);
      const fallbackSnap = await db.collection('reports').limit(500).get();
      const filteredDocs = fallbackSnap.docs.filter((doc) => {
        const data = doc.data();
        return data?.reporter?.uid === requesterUid;
      });
      snap = { docs: filteredDocs };
    }

    const rawReports = snap.docs
      .map((doc) => {
        const data = safeDocData(doc);
        return {
          id: data.id || doc.id,
          ...data,
          createdAt: toIso(data.createdAt),
          updatedAt: toIso(data.updatedAt),
        };
      })
      .filter((report) => Boolean(report && report.id));

    await syncPendingSlaFlags(db, rawReports);

    const hydratedReports = await hydrateReportsWithDuplicates(db, rawReports);

    const reports = hydratedReports
      .map((doc) => ({
        ...doc,
        sla: getSlaResponseState(doc),
      }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    return res.json(reports);
  } catch (err) {
    if (!err.status) {
      console.error('[listOwnReports] Unexpected error:', err.message || err);
    }
    return next(err);
  }
}

async function listReportsForOperators(req, res, next) {
  try {
    const role = getRequesterRoleKey(req.user);
    if (role !== 'staff' && role !== 'admin' && role !== 'responder') {
      return res.status(403).json({ error: 'Only staff, responders, and admins can access this endpoint.' });
    }

    const db = admin.firestore();
    let snap;

    try {
      snap = await db.collection('reports').limit(500).get();
    } catch (queryErr) {
      // Fall back to a plain scan if the primary query fails unexpectedly.
      console.warn('[listReportsForOperators] Primary query failed, using fallback scan:', queryErr.message || queryErr);
      snap = await db.collection('reports').get();
    }

    const rawReports = snap.docs
      .map((doc) => normalizeReportRecord(safeDocData(doc), doc.id))
      .filter((report) => Boolean(report && report.id));

    await syncPendingSlaFlags(db, rawReports);

    let hydratedReports = await hydrateReportsWithDuplicates(db, rawReports);

    hydratedReports = hydratedReports
      .map((report) => ({
        ...report,
        sla: getSlaResponseState(report),
      }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (role === 'staff') {
      const staffCoverage = String(req.user?.location || '').trim();
      if (!staffCoverage) {
        return res.status(403).json({
          error: 'Staff account is not assigned to a branch/barangay coverage.',
        });
      }

      hydratedReports = hydratedReports.filter((report) => {
        try {
          return canStaffAccessReport(report, req.user);
        } catch {
          return false;
        }
      });
    }

    if (role === 'responder') {
      const requesterUid = String(req.user?.uid || '').trim();
      hydratedReports = hydratedReports.filter((report) => {
        const assignedResponderUid = String(report?.assignedResponder?.uid || '').trim();
        const reportStatus = String(report?.status || '').toLowerCase();
        return Boolean(assignedResponderUid && requesterUid && assignedResponderUid === requesterUid) && reportStatus !== 'archived';
      });
    }

    return res.json(hydratedReports);
  } catch (err) {
    if (!err.status) {
      console.error('[listReportsForOperators] Unexpected error, returning empty list:', err.message || err);
      return res.json([]);
    }
    return next(err);
  }
}

const RESPONDER_ALLOWED_STATUSES = new Set(['in_progress', 'resolved']);

async function updateReportStatus(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = req.user?.roleKey;
    const actorDisplayName = getUserDisplayName(req.user);
    if (role !== 'staff' && role !== 'admin' && role !== 'responder') {
      return res.status(403).json({ error: 'Only staff, responders, and admins can update report status.' });
    }

    const reportId = String(req.params?.reportId || '').trim();
    const status = String(req.body?.status || '').trim().toLowerCase();
    const progressNote = String(req.body?.progressNote || '').trim();

    if (!REPORT_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Allowed values: ${REPORT_STATUSES.join(', ')}`,
      });
    }

    // Responders may only set in_progress or resolved
    if (role === 'responder' && !RESPONDER_ALLOWED_STATUSES.has(status)) {
      return res.status(403).json({
        error: 'Responders can only set a report to In Progress or Resolved.',
      });
    }

    if (status === 'rejected' && (!progressNote || progressNote.trim() === '')) {
      return res.status(400).json({
        error: 'A justification (progress note) is required when rejecting a report.',
      });
    }

    const db = admin.firestore();
    const ref = db.collection('reports').doc(reportId);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    // Responders can only update reports assigned to them
    if (role === 'responder') {
      const currentReport = snap.data();
      const assignedUid = String(currentReport?.assignedResponder?.uid || '').trim();
      if (!assignedUid || assignedUid !== requesterUid) {
        return res.status(403).json({
          error: 'You can only update reports that are assigned to you.',
        });
      }
    }

    if (role === 'staff') {
      const currentReport = snap.data();
      const assignedResponderUid = String(currentReport?.assignedResponder?.uid || '').trim();
      if (assignedResponderUid && assignedResponderUid !== String(req.user?.uid || '').trim()) {
        return res.status(403).json({
          error: 'This report is assigned to another responder.',
        });
      }

      if (!canStaffAccessReport(currentReport, req.user)) {
        return res.status(403).json({
          error: 'You can only update reports inside your assigned branch/barangay coverage.',
        });
      }
    }

    const currentReport = normalizeReportRecord(safeDocData(snap), snap.id);
    const linkedMotherReportId = String(currentReport?.duplicateOfReportId || '').trim();
    let updateRef = ref;
    let updateTargetReport = currentReport;

    if (linkedMotherReportId) {
      const motherRef = db.collection('reports').doc(linkedMotherReportId);
      const motherSnap = await motherRef.get();
      if (motherSnap.exists) {
        updateRef = motherRef;
        updateTargetReport = normalizeReportRecord(safeDocData(motherSnap), motherSnap.id);
      }
    }

    const previousStatus = String(updateTargetReport?.status || 'submitted').trim().toLowerCase();

    const resolutionFiles = Array.isArray(req.files) ? req.files : [];

    if (resolutionFiles.length > 0 && !isCloudinaryConfigured()) {
      return res.status(503).json({
        error: 'Cloudinary is not configured. Please set CLOUDINARY credentials in backend environment variables.',
      });
    }

    const resolutionPhotos = await Promise.all(
      resolutionFiles.map(async (file) => {
        const upload = await uploadBufferToCloudinary(file.buffer, {
          folder: process.env.CLOUDINARY_RESOLUTION_UPLOAD_FOLDER || 'onegapo/resolutions',
        });

        return {
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          resourceType: upload.resource_type,
          url: upload.secure_url,
          publicId: upload.public_id,
          format: upload.format || null,
          bytes: upload.bytes || file.size,
          uploadedAt: new Date().toISOString(),
        };
      })
    );

    if (status === 'resolved' && !progressNote && resolutionPhotos.length === 0) {
      return res.status(400).json({
        error: 'Progress notes or at least one resolution photo are required when resolving a report.',
      });
    }

    const nowIso = new Date().toISOString();
    const tier = Number(updateTargetReport?.tier || updateTargetReport?.sla?.tier || resolveReportTier({
      category: updateTargetReport?.category,
      title: updateTargetReport?.title,
      description: updateTargetReport?.description,
    }));
    const createdAtMs = toMillis(updateTargetReport?.createdAt) || Date.now();
    const fallbackSla = createInitialSla(tier, createdAtMs);
    const existingSla = updateTargetReport?.sla && typeof updateTargetReport.sla === 'object' ? updateTargetReport.sla : fallbackSla;
    const stageState = {
      ...buildInitialStageState(tier),
      ...(existingSla.stageState || {}),
    };
    const deadlines = existingSla.deadlines || buildSlaDeadlines(tier, createdAtMs);

    const lifecycle = {
      acknowledgedAt: null,
      dispatchedAt: null,
      inspectedAt: null,
      scheduledActionAt: null,
      resolvedAt: null,
      ...(updateTargetReport?.lifecycle && typeof updateTargetReport.lifecycle === 'object' ? updateTargetReport.lifecycle : {}),
    };

    if (status !== 'submitted' && stageState.acknowledgment === 'pending') {
      stageState.acknowledgment = 'met';
      if (!lifecycle.acknowledgedAt) {
        lifecycle.acknowledgedAt = nowIso;
      }
    }

    if (status === 'in_review') {
      if (tier === 1 && stageState.initialDispatch === 'pending') {
        stageState.initialDispatch = 'met';
        if (!lifecycle.dispatchedAt) {
          lifecycle.dispatchedAt = nowIso;
        }
      }

      if (tier === 2 && stageState.inspection === 'pending') {
        stageState.inspection = 'met';
        if (!lifecycle.inspectedAt) {
          lifecycle.inspectedAt = nowIso;
        }
      }

      if (tier === 3 && stageState.scheduledAction === 'pending') {
        stageState.scheduledAction = 'met';
        if (!lifecycle.scheduledActionAt) {
          lifecycle.scheduledActionAt = nowIso;
        }
      }
    }

    if ((status === 'resolved' || status === 'rejected') && stageState.resolution === 'pending') {
      stageState.resolution = 'met';
      if (!lifecycle.resolvedAt) {
        lifecycle.resolvedAt = nowIso;
      }
    }

    const previewReport = {
      ...updateTargetReport,
      status,
      tier,
      lifecycle,
      sla: {
        ...existingSla,
        tier,
        targetsMin: existingSla.targetsMin || TIER_TARGETS_MINUTES[tier] || TIER_TARGETS_MINUTES[4],
        stageState,
        deadlines,
      },
    };
    const snapshot = getPendingSlaSnapshot(previewReport);

    const nextCheckAtMs = PENDING_SLA_STATUSES.has(status)
      ? getNextCheckAtMs(deadlines, stageState)
      : null;

    const auditEntry = {
      fromStatus: previousStatus,
      toStatus: status,
      changedAt: nowIso,
      changedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
        displayName: actorDisplayName || null,
        location: req.user.location || '',
      },
      progressNote: progressNote || null,
      resolutionPhotos,
    };

    const updates = {
      status,
      tier,
      lifecycle,
      sla: {
        ...existingSla,
        tier,
        targetsMin: existingSla.targetsMin || TIER_TARGETS_MINUTES[tier] || TIER_TARGETS_MINUTES[4],
        stageState,
        deadlines,
        isFlagged: snapshot.isBreached,
        level: snapshot.isBreached ? 'pending' : null,
        status: snapshot.status,
        activeStage: snapshot.activeStage,
        thresholdHours: snapshot.thresholdHours,
        referenceAt: snapshot.referenceAt,
        breachedAt: snapshot.breachedAt,
        overdueHours: snapshot.overdueHours,
        nextCheckAtMs,
        nextCheckAt: toIsoFromMs(nextCheckAtMs),
        lastCheckedAt: nowIso,
        trigger: 'auto_pending',
        clearedAt: snapshot.isBreached ? null : nowIso,
        clearReason: snapshot.isBreached ? null : 'status_updated_or_within_threshold',
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
        displayName: actorDisplayName || null,
        location: req.user.location || '',
      },
      auditTrail: admin.firestore.FieldValue.arrayUnion(auditEntry),
    };

    if (status === 'resolved') {
      updates.resolution = {
        note: progressNote || null,
        photos: resolutionPhotos,
        resolvedAt: nowIso,
        resolvedBy: {
          uid: requesterUid,
          role,
          email: req.user.email || '',
          displayName: actorDisplayName || null,
          location: req.user.location || '',
        },
      };
    }

    await updateRef.update(updates);

    const refreshedTargetSnap = await updateRef.get();
    const refreshedTarget = normalizeReportRecord(safeDocData(refreshedTargetSnap), refreshedTargetSnap.id);

    await syncDuplicateChildrenFromSource(db, refreshedTarget, {
      excludeIds: [refreshedTarget.id],
    });

    emitReportsRefresh(updateRef.id);

    const responseRef = linkedMotherReportId ? ref : updateRef;
    const updatedSnap = await responseRef.get();
    const data = updatedSnap.data();

    return res.json({
      message: 'Report status updated.',
      report: {
        ...data,
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt),
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function updateReportAssignment(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = req.user?.roleKey;

    // Primary admin cannot assign responders (they have no branch context)
    if (req.user?.isPrimaryAdmin) {
      return res.status(403).json({ error: 'Primary admin accounts cannot assign report responders.' });
    }

    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can assign report responders.' });
    }

    // Only the branch main admin (staff with assign_responders permission or Branch Admin/Main Admin custom role) can assign responders
    if (role === 'staff') {
      const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
      const customRole = String(req.user?.customRoleName || '').trim().toLowerCase();
      const isBranchAdmin = permissions.includes('assign_responders') || permissions.includes('add_staffs') || customRole === 'branch admin' || customRole === 'main admin';
      if (!isBranchAdmin) {
        return res.status(403).json({
          error: 'Only the branch admin can assign report responders.',
        });
      }
    }

    const reportId = String(req.params?.reportId || '').trim();
    const responderUid = String(
      req.body?.responderUid || req.body?.assignedResponderUid || req.body?.uid || ''
    ).trim();

    if (!reportId) {
      return res.status(400).json({ error: 'reportId is required.' });
    }

    const db = admin.firestore();
    const ref = db.collection('reports').doc(reportId);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    const currentReport = snap.data() || {};
    if (role === 'staff' && !canStaffAccessReport(currentReport, req.user)) {
      return res.status(403).json({
        error: 'You can only assign responders for reports inside your assigned branch/barangay coverage.',
      });
    }

    let assignedResponder = null;
    if (responderUid) {
      const userSnap = await db.collection('users').doc(responderUid).get();
      if (!userSnap.exists) {
        return res.status(404).json({ error: 'Responder not found.' });
      }

      const userData = userSnap.data() || {};
      const responderRole = String(userData.role || '').trim().toLowerCase();
      const responderRoleName = String(userData.customRoleName || '').trim().toLowerCase();
      const isResponderAccount = responderRole === 'responder' || responderRoleName === 'responder';
      if (!isResponderAccount) {
        return res.status(400).json({ error: 'Only users with the Responder role can be assigned as responders.' });
      }

      if (role === 'staff' && String(req.user?.branchId || '').trim()) {
        const requesterBranchId = String(req.user.branchId || '').trim();
        const responderBranchId = String(userData.branchId || '').trim();
        if (responderBranchId && responderBranchId !== requesterBranchId) {
          return res.status(403).json({
            error: 'You can only assign responders from your own branch.',
          });
        }
      }

      assignedResponder = {
        uid: userSnap.id,
        email: userData.email || null,
        displayName: userData.fullName || userData.displayName || userData.username || userData.email || null,
        role: userData.role || null,
        branchId: userData.branchId || null,
        branchName: userData.branchName || null,
        customRoleId: userData.customRoleId || null,
        customRoleName: userData.customRoleName || 'Responder',
        assignedAt: new Date().toISOString(),
        assignedBy: {
          uid: requesterUid,
          role,
          email: req.user.email || '',
          branchId: req.user.branchId || null,
          branchName: req.user.location || null,
        },
      };
    }

    const nowIso = new Date().toISOString();
    const auditEntry = {
      type: assignedResponder ? 'assigned_responder' : 'unassigned_responder',
      changedAt: nowIso,
      changedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
        displayName: getUserDisplayName(req.user) || null,
        location: req.user.location || '',
      },
      assignedResponder,
    };

    await ref.update({
      assignedResponder,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
        location: req.user.location || '',
      },
      auditTrail: admin.firestore.FieldValue.arrayUnion(auditEntry),
    });

    emitReportsRefresh(reportId);

    const updatedSnap = await ref.get();
    const data = updatedSnap.data() || {};
    return res.json({
      message: assignedResponder ? 'Responder assigned.' : 'Responder assignment cleared.',
      report: {
        id: updatedSnap.id,
        ...data,
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt),
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function archiveReport(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = getRequesterRoleKey(req.user);
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can archive reports.' });
    }

    if (!canManageReportLifecycle(req.user)) {
      return res.status(403).json({
        error: 'Only the main admin and branch admins can archive reports.',
      });
    }

    const reportId = String(req.params?.reportId || '').trim();
    if (!reportId) {
      return res.status(400).json({ error: 'reportId is required.' });
    }

    const reason = String(req.body?.reason || '').trim();
    const db = admin.firestore();
    const ref = db.collection('reports').doc(reportId);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    const report = snap.data() || {};

    if (role === 'staff' && !canStaffAccessReport(report, req.user)) {
      return res.status(403).json({
        error: 'You can only archive reports inside your assigned branch/barangay coverage.',
      });
    }

    const previousStatus = String(report?.status || 'submitted').trim().toLowerCase();
    if (previousStatus === 'archived') {
      return res.json({
        message: 'Report is already archived.',
        report: {
          ...report,
          id: report.id || reportId,
          createdAt: toIso(report.createdAt),
          updatedAt: toIso(report.updatedAt),
        },
      });
    }

    const archivedAtIso = new Date().toISOString();
    const auditEntry = {
      type: 'archived',
      fromStatus: previousStatus,
      toStatus: 'archived',
      changedAt: archivedAtIso,
      changedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
        displayName: getUserDisplayName(req.user) || null,
      },
      progressNote: reason || null,
    };

    await ref.update({
      status: 'archived',
      archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      archivedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
      },
      auditTrail: admin.firestore.FieldValue.arrayUnion(auditEntry),
    });

    emitReportsRefresh(reportId);

    const updatedSnap = await ref.get();
    const data = updatedSnap.data() || {};

    return res.json({
      message: 'Report archived successfully.',
      report: {
        ...data,
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt),
        archivedAt: toIso(data.archivedAt) || archivedAtIso,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function unarchiveReport(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = getRequesterRoleKey(req.user);
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can unarchive reports.' });
    }

    if (!canManageReportLifecycle(req.user)) {
      return res.status(403).json({ error: 'Only the main admin and branch admins can unarchive reports.' });
    }

    const reportId = String(req.params?.reportId || '').trim();
    if (!reportId) return res.status(400).json({ error: 'reportId is required.' });

    const db = admin.firestore();
    const ref = db.collection('reports').doc(reportId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Report not found.' });

    const report = snap.data() || {};
    if (role === 'staff' && !canStaffAccessReport(report, req.user)) {
      return res.status(403).json({ error: 'You can only unarchive reports inside your assigned branch/barangay coverage.' });
    }

    const previousStatus = String(report?.status || 'submitted').trim().toLowerCase();
    if (previousStatus !== 'archived') {
      return res.json({ message: 'Report is not archived.', report: { ...report, id: report.id || reportId } });
    }

    // Determine last non-archived status from auditTrail if available
    let restoreStatus = 'submitted';
    try {
      const audit = Array.isArray(report.auditTrail) ? report.auditTrail.slice().reverse() : [];
      for (const entry of audit) {
        if (!entry) continue;
        if (entry.type === 'archived') continue;
        if (entry.toStatus) {
          restoreStatus = String(entry.toStatus).trim().toLowerCase();
          break;
        }
      }
    } catch (e) {
      // fallback to submitted
      restoreStatus = 'submitted';
    }

    const unarchivedAtIso = new Date().toISOString();
    const auditEntry = {
      type: 'unarchived',
      fromStatus: 'archived',
      toStatus: restoreStatus,
      changedAt: unarchivedAtIso,
      changedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
        displayName: getUserDisplayName(req.user) || null,
      },
      progressNote: null,
    };

    await ref.update({
      status: restoreStatus,
      archivedAt: admin.firestore.FieldValue.delete(),
      archivedBy: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
      },
      auditTrail: admin.firestore.FieldValue.arrayUnion(auditEntry),
    });

    emitReportsRefresh(reportId);

    const updatedSnap = await ref.get();
    const data = updatedSnap.data() || {};

    return res.json({
      message: 'Report unarchived successfully.',
      report: {
        ...data,
        id: data.id || reportId,
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt),
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function deleteReport(req, res, next) {
  try {
    const role = getRequesterRoleKey(req.user);
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can delete reports.' });
    }

    if (!canManageReportLifecycle(req.user)) {
      return res.status(403).json({
        error: 'Only the main admin and branch admins can delete reports.',
      });
    }

    const reportId = String(req.params?.reportId || '').trim();
    if (!reportId) {
      return res.status(400).json({ error: 'reportId is required.' });
    }

    const ref = admin.firestore().collection('reports').doc(reportId);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    const report = snap.data() || {};

    // Only archived reports can be permanently deleted
    if (String(report.status || '').toLowerCase() !== 'archived') {
      return res.status(400).json({
        error: 'Only archived reports can be deleted. Please archive the report first.',
      });
    }

    if (role === 'staff' && !canStaffAccessReport(report, req.user)) {
      return res.status(403).json({
        error: 'You can only delete reports inside your assigned branch/barangay coverage.',
      });
    }

    // Attempt to remove attached media from Cloudinary (if configured).
    try {
      const attachments = Array.isArray(report.attachments) ? report.attachments : [];
      const resolutionPhotos = Array.isArray(report?.resolution?.photos) ? report.resolution.photos : [];
      const { deleteResourceByPublicId, isCloudinaryConfigured } = require('../services/cloudinaryService');

      if (isCloudinaryConfigured() && (attachments.length || resolutionPhotos.length)) {
        const allMedia = [...attachments, ...resolutionPhotos];
        await Promise.all(allMedia.map(async (media) => {
          const publicId = media?.publicId || media?.public_id || null;
          if (!publicId) return null;
          try {
            return await deleteResourceByPublicId(publicId, { resource_type: media.resourceType || 'image' });
          } catch (err) {
            // Log and continue; deletion should not block report deletion
            console.warn('[deleteReport] Failed to delete media', publicId, err.message || err);
            return null;
          }
        }));
      }
    } catch (err) {
      console.warn('[deleteReport] Cloudinary cleanup failed:', err.message || err);
    }

    await ref.delete();

    emitReportsRefresh(reportId);

    return res.json({
      message: 'Report deleted successfully.',
      reportId,
    });
  } catch (err) {
    return next(err);
  }
}

async function listForwardTargets(req, res, next) {
  try {
    const role = getRequesterRoleKey(req.user);
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can access forwarding targets.' });
    }

    const callerBranchId = String(req.user?.branchId || '').trim();
    const snap = await admin.firestore().collection('branches').orderBy('name').get();
    const targets = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((branch) => branch.id !== callerBranchId)
      .map((branch) => ({
        id: branch.id,
        name: canonicalCoverageName(branch.name || '') || String(branch.name || ''),
        type: String(branch.type || 'public'),
      }));

    return res.json(targets);
  } catch (err) {
    return next(err);
  }
}

async function forwardReport(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = getRequesterRoleKey(req.user);
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can forward reports.' });
    }

    const reportId = String(req.params?.reportId || '').trim();
    const targetBranchId = String(req.body?.targetBranchId || '').trim();
    const note = String(req.body?.note || '').trim();

    if (!targetBranchId) {
      return res.status(400).json({ error: 'targetBranchId is required.' });
    }

    const db = admin.firestore();
    const reportRef = db.collection('reports').doc(reportId);
    const reportSnap = await reportRef.get();
    if (!reportSnap.exists) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    const report = reportSnap.data();
    if (role === 'staff' && !canStaffAccessReport(report, req.user)) {
      return res.status(403).json({
        error: 'You can only forward reports inside your assigned branch/barangay coverage.',
      });
    }

    // Prevent re-forwarding reports that have already been forwarded
    if (report?.forwarding) {
      return res.status(400).json({
        error: 'This report has already been forwarded to another branch and cannot be forwarded again.',
      });
    }

    const targetBranchSnap = await db.collection('branches').doc(targetBranchId).get();
    if (!targetBranchSnap.exists) {
      return res.status(404).json({ error: 'Target branch not found.' });
    }

    const targetBranch = { id: targetBranchSnap.id, ...targetBranchSnap.data() };
    const targetBranchName = canonicalCoverageName(targetBranch.name || '') || String(targetBranch.name || '');
    const forwarding = {
      to: {
        branchId: targetBranch.id,
        branchName: targetBranchName,
        branchType: String(targetBranch.type || 'public'),
      },
      from: {
        branchId: req.user?.branchId || null,
        branchName: req.user?.location || null,
      },
      note: note || null,
      forwardedAt: new Date().toISOString(),
      forwardedBy: {
        uid: requesterUid,
        role,
        email: req.user?.email || '',
      },
    };

    const auditEntry = {
      type: 'forwarded',
      changedAt: new Date().toISOString(),
      changedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
        displayName: getUserDisplayName(req.user) || null,
      },
      forwarding,
      progressNote: note || null,
    };

    await reportRef.update({
      forwarding,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
      },
      auditTrail: admin.firestore.FieldValue.arrayUnion(auditEntry),
    });

    emitReportsRefresh(reportId);

    const staffSnap = await db.collection('users').where('branchId', '==', targetBranch.id).get();
    const staffRecipients = staffSnap.docs
      .map((doc) => doc.data())
      .filter((user) => user?.uid && user?.role === 'staff')
      .map((user) => ({ uid: user.uid }));

    const adminSnap = await db.collection('users').where('role', '==', 'admin').get();
    const adminRecipients = adminSnap.docs
      .map((doc) => doc.data())
      .filter((user) => user?.uid)
      .map((user) => ({ uid: user.uid }));

    const recipientMap = new Map();
    for (const recipient of [...staffRecipients, ...adminRecipients]) {
      recipientMap.set(recipient.uid, recipient);
    }

    await notifyUsersForForwarding({
      db,
      recipients: Array.from(recipientMap.values()),
      report,
      targetBranch,
      actor: {
        uid: requesterUid,
        email: req.user?.email || '',
      },
      note,
    });

    const updatedSnap = await reportRef.get();
    const updated = updatedSnap.data();
    return res.json({
      message: 'Report forwarded successfully.',
      report: {
        ...updated,
        createdAt: toIso(updated.createdAt),
        updatedAt: toIso(updated.updatedAt),
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function markReportDuplicate(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = getRequesterRoleKey(req.user);
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can mark duplicate reports.' });
    }

    const reportId = String(req.params?.reportId || '').trim();
    const motherReportId = String(req.body?.motherReportId || '').trim();

    if (!reportId) {
      return res.status(400).json({ error: 'reportId is required.' });
    }

    if (!motherReportId) {
      return res.status(400).json({ error: 'motherReportId is required.' });
    }

    if (motherReportId === reportId) {
      return res.status(400).json({ error: 'A report cannot be a duplicate of itself.' });
    }

    const db = admin.firestore();
    const reportRef = db.collection('reports').doc(reportId);
    const motherRef = db.collection('reports').doc(motherReportId);

    const [reportSnap, motherSnap] = await Promise.all([reportRef.get(), motherRef.get()]);
    if (!reportSnap.exists) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    if (!motherSnap.exists) {
      return res.status(404).json({ error: 'Mother report not found.' });
    }

    const report = normalizeReportRecord(safeDocData(reportSnap), reportSnap.id);
    const motherReport = normalizeReportRecord(safeDocData(motherSnap), motherSnap.id);

    const reportChildrenSnap = await db
      .collection('reports')
      .where('duplicateOfReportId', '==', report.id)
      .limit(1)
      .get();

    if (!reportChildrenSnap.empty) {
      return res.status(400).json({
        error: 'This report is already linked as a mother report and cannot be tagged as duplicate.',
      });
    }

    if (String(motherReport?.duplicateOfReportId || '').trim()) {
      return res.status(400).json({
        error: 'The selected mother report is already a duplicate and cannot be used as a mother report.',
      });
    }

    if (role === 'staff') {
      if (!canStaffAccessReport(report, req.user)) {
        return res.status(403).json({ error: 'You can only update reports inside your assigned branch/barangay coverage.' });
      }

      if (!canStaffAccessReport(motherReport, req.user)) {
        return res.status(403).json({ error: 'You can only link to a mother report inside your assigned branch/barangay coverage.' });
      }
    }

    const duplicateOfReportId = motherReport.id;
    const auditEntry = {
      type: 'duplicate_linked',
      changedAt: new Date().toISOString(),
      changedBy: {
        uid: requesterUid,
        role,
        email: req.user?.email || '',
        displayName: getUserDisplayName(req.user) || null,
      },
      duplicateOfReportId,
    };

    await reportRef.update({
      duplicateOfReportId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: {
        uid: requesterUid,
        role,
        email: req.user?.email || '',
      },
      auditTrail: admin.firestore.FieldValue.arrayUnion(auditEntry),
    });

    await syncDuplicateChildrenFromSource(db, motherReport);

    emitReportsRefresh(reportId);

    const updatedSnap = await reportRef.get();
    const updated = normalizeReportRecord(safeDocData(updatedSnap), updatedSnap.id);
    const hydrated = await hydrateDuplicateReport(db, updated);

    return res.json({
      message: 'Report marked as duplicate successfully.',
      report: hydrated,
    });
  } catch (err) {
    return next(err);
  }
}

async function revokeReportDuplicate(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = getRequesterRoleKey(req.user);
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can revoke duplicate reports.' });
    }

    const reportId = String(req.params?.reportId || '').trim();
    if (!reportId) {
      return res.status(400).json({ error: 'reportId is required.' });
    }

    const db = admin.firestore();
    const reportRef = db.collection('reports').doc(reportId);
    const reportSnap = await reportRef.get();

    if (!reportSnap.exists) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    const report = normalizeReportRecord(safeDocData(reportSnap), reportSnap.id);

    if (role === 'staff' && !canStaffAccessReport(report, req.user)) {
      return res.status(403).json({ error: 'You can only update reports inside your assigned branch/barangay coverage.' });
    }

    const currentMotherReportId = String(report?.duplicateOfReportId || '').trim();
    if (!currentMotherReportId) {
      return res.status(400).json({ error: 'This report is not currently marked as duplicate.' });
    }

    const auditEntry = {
      type: 'duplicate_unlinked',
      changedAt: new Date().toISOString(),
      changedBy: {
        uid: requesterUid,
        role,
        email: req.user?.email || '',
        displayName: getUserDisplayName(req.user) || null,
      },
      duplicateOfReportId: currentMotherReportId,
    };

    await reportRef.update({
      duplicateOfReportId: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: {
        uid: requesterUid,
        role,
        email: req.user?.email || '',
      },
      auditTrail: admin.firestore.FieldValue.arrayUnion(auditEntry),
    });

    emitReportsRefresh(reportId);

    const updatedSnap = await reportRef.get();
    const updated = normalizeReportRecord(safeDocData(updatedSnap), updatedSnap.id);

    return res.json({
      message: 'Report duplication revoked successfully.',
      report: updated,
    });
  } catch (err) {
    return next(err);
  }
}

async function listNotifications(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = getRequesterRoleKey(req.user);
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can access notifications.' });
    }

    const db = admin.firestore();
    let notifications = [];

    try {
      const snap = await db
        .collection('notifications')
        .where('recipientUid', '==', requesterUid)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      notifications = snap.docs.map(toNotificationDto);
    } catch (orderedQueryErr) {
      if (isResourceExhaustedError(orderedQueryErr)) {
        return res.status(429).json({ error: 'Notifications are temporarily rate-limited. Please retry shortly.' });
      }

      // Use a relaxed query path when the ordered index is not ready yet.
      console.warn('[listNotifications] Ordered query failed, using fallback path:', orderedQueryErr.message || orderedQueryErr);

      try {
        const fallbackFilteredSnap = await db
          .collection('notifications')
          .where('recipientUid', '==', requesterUid)
          .limit(120)
          .get();

        notifications = fallbackFilteredSnap.docs
          .map(toNotificationDto)
          .sort((a, b) => {
            const aMs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bMs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bMs - aMs;
          })
          .slice(0, 50);
      } catch (fallbackFilteredErr) {
        if (isResourceExhaustedError(fallbackFilteredErr)) {
          return res.status(429).json({ error: 'Notifications are temporarily rate-limited. Please retry shortly.' });
        }

        // Avoid broad collection scans to prevent read amplification under constrained quotas.
        console.warn('[listNotifications] Filtered fallback failed, returning empty list:', fallbackFilteredErr.message || fallbackFilteredErr);
        notifications = [];
      }
    }

    return res.json(notifications);
  } catch (err) {
    if (!err.status) {
      console.error('[listNotifications] Unexpected error, returning empty list:', err.message || err);
      return res.json([]);
    }
    return next(err);
  }
}

async function markNotificationRead(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = getRequesterRoleKey(req.user);
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can update notifications.' });
    }

    const notificationId = String(req.params?.notificationId || '').trim();
    if (!notificationId) {
      return res.status(400).json({ error: 'notificationId is required.' });
    }

    const ref = admin.firestore().collection('notifications').doc(notificationId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    const notification = snap.data() || {};
    if (notification.recipientUid !== requesterUid) {
      return res.status(403).json({ error: 'You can only update your own notifications.' });
    }

    await ref.update({
      isRead: true,
      readAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const updatedSnap = await ref.get();
    return res.json({ notification: toNotificationDto(updatedSnap) });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createReport,
  listOwnReports,
  listReportsForOperators,
  getPerformanceMetrics,
  updateReportStatus,
  updateReportAssignment,
  archiveReport,
  unarchiveReport,
  deleteReport,
  listForwardTargets,
  forwardReport,
  markReportDuplicate,
  revokeReportDuplicate,
  listNotifications,
  markNotificationRead,
};
