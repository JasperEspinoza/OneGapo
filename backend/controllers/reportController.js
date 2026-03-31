const admin = require('../config/firebaseAdmin');
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require('../services/cloudinaryService');

const REPORT_STATUSES = ['submitted', 'in_review', 'resolved', 'rejected'];
const BAJAC_BAJAC_BRANCHES = new Set(['east bajac bajac', 'west bajac bajac']);

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

    // Legacy addresses sometimes include only "Bajac-Bajac" with no east/west qualifier.
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

function canStaffAccessReport(report, reqUser) {
  const staffCoverage = String(reqUser?.location || '').trim();
  if (!staffCoverage) {
    return false;
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

function canManageReportLifecycle(reqUser) {
  const role = reqUser?.role;
  if (role === 'admin') {
    return true;
  }

  // Branch admins are modeled as staff accounts with archive_reports permission.
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

async function notifyUsersForForwarding({ db, recipients, report, targetBranch, actor, note }) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return;
  }

  const batch = db.batch();
  const title = `Report forwarded to ${targetBranch.name}`;
  const message = `${actor.email || actor.uid || 'An operator'} forwarded "${report.title || report.id}".`;

  for (const recipient of recipients) {
    const ref = db.collection('notifications').doc();
    batch.set(ref, {
      recipientUid: recipient.uid,
      type: 'report_forwarded',
      title,
      message,
      isRead: false,
      reportId: report.id,
      metadata: {
        targetBranchId: targetBranch.id,
        targetBranchName: targetBranch.name,
        note: note || null,
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

    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const category = String(req.body?.category || 'general').trim().toLowerCase();
    const address = String(req.body?.address || '').trim();
    const inferredBarangay = extractCoverageFromAddress(address);
    const lat = parseCoordinate(req.body?.latitude, 'latitude');
    const lng = parseCoordinate(req.body?.longitude, 'longitude');
    validateLatLng(lat, lng);

    if (!title || title.length < 5) {
      return res.status(400).json({ error: 'Title is required and must be at least 5 characters.' });
    }
    if (!description || description.length < 20) {
      return res.status(400).json({ error: 'Description is required and must be at least 20 characters.' });
    }

    const files = Array.isArray(req.files) ? req.files : [];

    if (files.length > 0 && !isCloudinaryConfigured()) {
      return res.status(503).json({
        error: 'Cloudinary is not configured. Please set CLOUDINARY credentials in backend environment variables.',
      });
    }

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

    const db = admin.firestore();
    const reportRef = db.collection('reports').doc();

    const payload = {
      id: reportRef.id,
      title,
      description,
      category,
      status: 'submitted',
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await reportRef.set(payload);

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

    const reports = snap.docs
      .map((doc) => ({
        ...doc.data(),
        createdAt: toIso(doc.data().createdAt),
        updatedAt: toIso(doc.data().updatedAt),
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
    const role = req.user?.role;
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can access this endpoint.' });
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

    let reports = snap.docs
      .map((doc) => {
        const data = safeDocData(doc);
        return {
          id: data.id || doc.id,
          ...data,
          createdAt: toIso(data.createdAt),
          updatedAt: toIso(data.updatedAt),
        };
      })
      .filter((report) => Boolean(report && report.id))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (role === 'staff') {
      const staffCoverage = String(req.user?.location || '').trim();
      if (!staffCoverage) {
        return res.status(403).json({
          error: 'Staff account is not assigned to a branch/barangay coverage.',
        });
      }

      reports = reports.filter((report) => {
        try {
          return canStaffAccessReport(report, req.user);
        } catch {
          return false;
        }
      });
    }

    return res.json(reports);
  } catch (err) {
    if (!err.status) {
      console.error('[listReportsForOperators] Unexpected error, returning empty list:', err.message || err);
      return res.json([]);
    }
    return next(err);
  }
}

async function updateReportStatus(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = req.user?.role;
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can update report status.' });
    }

    const reportId = String(req.params?.reportId || '').trim();
    const status = String(req.body?.status || '').trim().toLowerCase();
    const progressNote = String(req.body?.progressNote || '').trim();

    if (!REPORT_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Allowed values: ${REPORT_STATUSES.join(', ')}`,
      });
    }

    const db = admin.firestore();
    const ref = db.collection('reports').doc(reportId);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    if (role === 'staff') {
      const currentReport = snap.data();
      if (!canStaffAccessReport(currentReport, req.user)) {
        return res.status(403).json({
          error: 'You can only update reports inside your assigned branch/barangay coverage.',
        });
      }
    }

    const currentReport = snap.data();
    const previousStatus = String(currentReport?.status || 'submitted').trim().toLowerCase();

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

    const auditEntry = {
      fromStatus: previousStatus,
      toStatus: status,
      changedAt: new Date().toISOString(),
      changedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
        location: req.user.location || '',
      },
      progressNote: progressNote || null,
      resolutionPhotos,
    };

    const updates = {
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
        location: req.user.location || '',
      },
      auditTrail: admin.firestore.FieldValue.arrayUnion(auditEntry),
    };

    if (status === 'resolved') {
      updates.resolution = {
        note: progressNote || null,
        photos: resolutionPhotos,
        resolvedAt: new Date().toISOString(),
        resolvedBy: {
          uid: requesterUid,
          role,
          email: req.user.email || '',
          location: req.user.location || '',
        },
      };
    }

    await ref.update(updates);

    const updatedSnap = await ref.get();
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

async function archiveReport(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = req.user?.role;
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

async function deleteReport(req, res, next) {
  try {
    const role = req.user?.role;
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
    if (role === 'staff' && !canStaffAccessReport(report, req.user)) {
      return res.status(403).json({
        error: 'You can only delete reports inside your assigned branch/barangay coverage.',
      });
    }

    await ref.delete();

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
    const role = req.user?.role;
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
    const role = req.user?.role;
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

async function listNotifications(req, res, next) {
  try {
    const requesterUid = getRequesterUid(req);
    const role = req.user?.role;
    if (role !== 'staff' && role !== 'admin') {
      return res.status(403).json({ error: 'Only staff and admins can access notifications.' });
    }

    const db = admin.firestore();
    let docs = [];

    try {
      const snap = await db
        .collection('notifications')
        .where('recipientUid', '==', requesterUid)
        .limit(100)
        .get();
      docs = snap.docs;
    } catch (queryErr) {
      // Avoid hard failure when field indexes/legacy docs break filtered queries.
      console.warn('[listNotifications] Primary query failed, using fallback scan:', queryErr.message || queryErr);
      const fallbackSnap = await db.collection('notifications').limit(300).get();
      docs = fallbackSnap.docs.filter((doc) => {
        const data = safeDocData(doc);
        return data.recipientUid === requesterUid;
      });
    }

    const notifications = docs
      .map(toNotificationDto)
      .sort((a, b) => {
        const aMs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bMs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bMs - aMs;
      })
      .slice(0, 50);

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
    const role = req.user?.role;
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
  updateReportStatus,
  archiveReport,
  deleteReport,
  listForwardTargets,
  forwardReport,
  listNotifications,
  markNotificationRead,
};
