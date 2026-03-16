const admin = require('../config/firebaseAdmin');
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require('../services/cloudinaryService');

const REPORT_STATUSES = ['submitted', 'in_review', 'resolved', 'rejected'];

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
  return null;
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
    const snap = await db.collection('reports').limit(200).get();

    const reports = snap.docs
      .map((doc) => ({
        ...doc.data(),
        createdAt: toIso(doc.data().createdAt),
        updatedAt: toIso(doc.data().updatedAt),
      }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    return res.json(reports);
  } catch (err) {
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

    await ref.update({
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: {
        uid: requesterUid,
        role,
        email: req.user.email || '',
      },
    });

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

module.exports = {
  createReport,
  listOwnReports,
  listReportsForOperators,
  updateReportStatus,
};
