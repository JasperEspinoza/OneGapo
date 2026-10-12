const { Server } = require('socket.io');
const admin = require('../config/firebaseAdmin');
const socketInstance = require('./socketInstance');
const {
  canStaffAccessReport,
  normalizeReportRecord,
  canonicalCoverageName,
  OLONGAPO_BRANCH_MAPPINGS,
  OLONGAPO_BRANCH_ID_TO_NAME,
} = require('../controllers/reportController');

const notificationStreams = new Map();
const reportStreams = new Map();

function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function serializeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value?.toDate === 'function') {
    return toIso(value);
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, nested]) => {
      out[key] = serializeValue(nested);
    });
    return out;
  }
  return value;
}

function reportDto(doc) {
  const data = doc.data() || {};
  return normalizeReportRecord(data, doc.id);
}

function notificationDto(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    recipientUid: data.recipientUid || '',
    type: data.type || 'general',
    priority: data.priority || 'normal',
    title: data.title || 'Notification',
    message: data.message || '',
    isRead: Boolean(data.isRead),
    reportId: data.reportId || null,
    metadata: data.metadata || {},
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

async function fetchNotificationsForUser(uid) {
  const db = admin.firestore();

  try {
    const snap = await db
      .collection('notifications')
      .where('recipientUid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    return snap.docs.map(notificationDto);
  } catch {
    const fallbackSnap = await db
      .collection('notifications')
      .where('recipientUid', '==', uid)
      .limit(120)
      .get();

    return fallbackSnap.docs
      .map(notificationDto)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 50);
  }
}

function startNotificationStreamForUser(io, uid) {
  if (notificationStreams.has(uid)) {
    const existing = notificationStreams.get(uid);
    existing.refCount += 1;
    return;
  }

  const db = admin.firestore();
  const room = `user:${uid}`;

  const query = db
    .collection('notifications')
    .where('recipientUid', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(50);

  const unsubscribe = query.onSnapshot(
    (snapshot) => {
      const notifications = snapshot.docs.map(notificationDto);
      // eslint-disable-next-line no-console
      console.debug(`[realtime] onSnapshot -> emitting notifications:data to ${room} (${Array.isArray(notifications) ? notifications.length : 0})`);
      io.to(room).emit('notifications:data', notifications);
    },
    async () => {
      // If ordered listener fails due to missing index/quota, fall back once without crashing.
      try {
        const notifications = await fetchNotificationsForUser(uid);
        io.to(room).emit('notifications:data', notifications);
      } catch {
        io.to(room).emit('notifications:data', []);
      }
    }
  );

  notificationStreams.set(uid, {
    unsubscribe,
    refCount: 1,
  });
}

function stopNotificationStreamForUser(uid) {
  const existing = notificationStreams.get(uid);
  if (!existing) return;

  existing.refCount -= 1;
  if (existing.refCount > 0) return;

  try {
    existing.unsubscribe();
  } catch {
    // no-op
  }

  notificationStreams.delete(uid);
}

function canUserAccessReport(report, user) {
  const role = String(user?.roleKey || user?.role || '').toLowerCase();
  const customRole = String(user?.customRoleName || '').toLowerCase();
  const isPrimaryAdmin = String(user?.email || '').toLowerCase() === 'onegapo2026@gmail.com';

  // Primary superadmin gets all reports
  if (isPrimaryAdmin || (role === 'admin' && !user?.branchId)) return true;

  if (role === 'responder' || customRole === 'responder') {
    const requesterUid = String(user?.uid || '').trim();
    const assignedResponderUid = String(report?.assignedResponder?.uid || '').trim();
    const reportStatus = String(report?.status || '').toLowerCase();
    return Boolean(assignedResponderUid && requesterUid && assignedResponderUid === requesterUid) && reportStatus !== 'archived';
  }

  // Resident role only accesses their own reports
  if (role === 'resident') {
    const requesterUid = String(user?.uid || '').trim();
    return String(report?.reporter?.uid || '').trim() === requesterUid;
  }

  // Any operational staff, branch admin, or user with report view permissions
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const canViewReports =
    permissions.length === 0 || // default branch access if permissions array not explicitly restricted
    permissions.includes('view_reports') ||
    permissions.includes('update_reports') ||
    permissions.includes('close_reports') ||
    permissions.includes('archive_reports');

  if (!canViewReports) return false;

  const staffUser = {
    ...user,
    location: user?.location || user?.branchName || '',
    branchName: user?.branchName || user?.location || '',
  };

  return canStaffAccessReport(report, staffUser);
}

async function fetchReportsForUser(user) {
  const db = admin.firestore();
  const uid = String(user?.uid || '').trim();
  const role = String(user?.roleKey || user?.role || '').toLowerCase();

  if (!uid) return [];

  if (role === 'resident') {
    try {
      const snap = await db
        .collection('reports')
        .where('reporter.uid', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(80)
        .get();

      return snap.docs.map(reportDto);
    } catch {
      const fallback = await db
        .collection('reports')
        .orderBy('updatedAt', 'desc')
        .limit(200)
        .get();

      return fallback.docs
        .map(reportDto)
        .filter((report) => String(report?.reporter?.uid || '').trim() === uid)
        .slice(0, 80);
    }
  }

  const operatorSnap = await db
    .collection('reports')
    .orderBy('updatedAt', 'desc')
    .limit(300)
    .get();

  return operatorSnap.docs
    .map(reportDto)
    .filter((report) => canUserAccessReport(report, user));
}

function reportStreamKey(user) {
  const uid = String(user?.uid || '').trim();
  const role = String(user?.roleKey || user?.role || '').trim();
  const location = String(user?.location || user?.branchName || '').trim();
  return `${uid}|${role}|${location}`;
}

function startReportStreamForUser(io, user) {
  const key = reportStreamKey(user);
  if (!key) return;

  if (reportStreams.has(key)) {
    const existing = reportStreams.get(key);
    existing.refCount += 1;
    return;
  }

  const db = admin.firestore();
  const uid = String(user?.uid || '').trim();
  const room = `user:${uid}`;
  const role = String(user?.role || '').toLowerCase();

  let query;
  if (role === 'resident') {
    query = db
      .collection('reports')
      .where('reporter.uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(80);
  } else {
    query = db
      .collection('reports')
      .orderBy('updatedAt', 'desc')
      .limit(300);
  }

  const unsubscribe = query.onSnapshot(
    (snapshot) => {
      try {
        const changes = snapshot.docChanges();

        // On first snapshot (initial data), skip emitting since fetchReportsForUser already emitted initial data directly to socket
        if (changes.length > 0 && snapshot.docs.length === changes.length) {
          return;
        }

        // For incremental updates, emit granular events
        changes.forEach((change) => {
          const doc = change.doc;
          const report = reportDto(doc);

          if (change.type === 'added') {
            if (role === 'resident') {
              // only emit to the resident who created it
              if (String(report?.reporter?.uid || '') === uid) {
                io.to(room).emit('reports:created', report);
              }
            } else {
              if (canUserAccessReport(report, user)) {
                io.to(room).emit('reports:created', report);
              }
            }
            return;
          }

          if (change.type === 'modified') {
            if (role === 'resident') {
              if (String(report?.reporter?.uid || '') === uid) {
                io.to(room).emit('reports:modified', report);
              }
            } else {
              if (canUserAccessReport(report, user)) {
                io.to(room).emit('reports:modified', report);
              } else {
                // If report no longer accessible to the user, inform client to remove it
                io.to(room).emit('reports:deleted', { id: report.id });
              }
            }
            return;
          }

          if (change.type === 'removed') {
            io.to(room).emit('reports:deleted', { id: doc.id });
            return;
          }
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[realtime] onSnapshot processing error', err && err.message ? err.message : err);
      }
    },
    async () => {
      try {
        const reports = await fetchReportsForUser(user);
        io.to(room).emit('reports:data', reports);
      } catch {
        io.to(room).emit('reports:data', []);
      }
    }
  );

  reportStreams.set(key, {
    unsubscribe,
    refCount: 1,
  });
}

function stopReportStreamForUser(user) {
  const key = reportStreamKey(user);
  if (!key) return;

  const existing = reportStreams.get(key);
  if (!existing) return;

  existing.refCount -= 1;
  if (existing.refCount > 0) return;

  try {
    existing.unsubscribe();
  } catch {
    // no-op
  }

  reportStreams.delete(key);
}

function initSocketServer(httpServer, { allowedOrigin }) {
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigin,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Authorization'],
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e8, // 100 MB buffer limit (prevents connection drops on large payloads)
    pingTimeout: 60000,     // 60 seconds (prevents premature ping timeouts)
    pingInterval: 25000,    // 25 seconds heartbeat
    connectTimeout: 45000,  // 45 seconds connection timeout
  });

  // make the io instance available to other modules (controllers)
  try {
    socketInstance.set(io);
  } catch {
    // no-op if instance cannot be set
  }

  io.use(async (socket, next) => {
    try {
      const rawToken = socket.handshake?.auth?.token || socket.handshake?.headers?.authorization || '';
      const token = String(rawToken || '').replace(/^Bearer\s+/i, '').trim();

      if (!token) {
        return next(new Error('Unauthorized: Missing token.'));
      }

      const decoded = await admin.auth().verifyIdToken(token);
      let user = { ...decoded };

      if (decoded.uid) {
        try {
          const userSnap = await admin.firestore().collection('users').doc(decoded.uid).get();
          if (userSnap.exists) {
            const userData = userSnap.data() || {};
            let permissions = Array.isArray(userData.permissions)
              ? userData.permissions
              : (Array.isArray(decoded.permissions) ? decoded.permissions : []);

            if (permissions.length === 0 && userData.customRoleId) {
              try {
                const roleSnap = await admin.firestore().collection('roles').doc(userData.customRoleId).get();
                if (roleSnap.exists) {
                  const roleData = roleSnap.data() || {};
                  if (Array.isArray(roleData.permissions)) {
                    permissions = roleData.permissions;
                  }
                }
              } catch {
                // ignore
              }
            }

            const userBranchId = userData.branchId || decoded.branchId || null;
            const knownBranch = userBranchId ? OLONGAPO_BRANCH_ID_TO_NAME[userBranchId] : null;
            const resolvedBranchName = userData.branchName || userData.location || knownBranch || decoded.branchName || decoded.location || null;
            const resolvedLocation = userData.location || userData.branchName || knownBranch || decoded.location || decoded.branchName || null;

            user = {
              ...user,
              uid: decoded.uid,
              email: userData.email || decoded.email || '',
              fullName: userData.fullName || decoded.fullName || '',
              role: userData.role || decoded.role || '',
              roleKey: userData.role || decoded.role || '',
              branchId: userBranchId,
              branchName: resolvedBranchName,
              location: resolvedLocation,
              entityType: userData.entityType || decoded.entityType || null,
              customRoleId: userData.customRoleId || decoded.customRoleId || null,
              customRoleName: userData.customRoleName || decoded.customRoleName || null,
              permissions,
            };
          }
        } catch {
          // Continue with decoded token if Firestore lookup fails
        }
      }

      socket.data.user = user;
      return next();
    } catch {
      return next(new Error('Unauthorized: Invalid token.'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data?.user;
    const uid = user?.uid;
    if (!uid) {
      socket.disconnect(true);
      return;
    }

    const room = `user:${uid}`;
    socket.join(room);

    const role = String(user?.roleKey || user?.role || '').toLowerCase();
    const customRole = String(user?.customRoleName || '').toLowerCase();
    const isPrimaryAdmin = String(user?.email || '').toLowerCase() === 'onegapo2026@gmail.com';

    if (isPrimaryAdmin || (role === 'admin' && !user?.branchId)) {
      socket.join('role:admin');
    }

    if (role === 'staff' || role.includes('admin') || customRole.includes('admin') || user?.branchId) {
      socket.join('role:staff');
      socket.join('role:operators');

      if (customRole.includes('admin') || role.includes('admin')) {
        socket.join('role:branch_admin');
      }

      if (user?.branchId) {
        socket.join(`branch:${user.branchId}`);
        const knownBranch = OLONGAPO_BRANCH_ID_TO_NAME[user.branchId];
        if (knownBranch) {
          socket.join(`branchName:${knownBranch.toLowerCase()}`);
          socket.join(`location:${knownBranch.toLowerCase()}`);
        }
      }

      if (user?.branchName) {
        const canonical = canonicalCoverageName(user.branchName);
        if (canonical) {
          socket.join(`branchName:${canonical.toLowerCase()}`);
          socket.join(`location:${canonical.toLowerCase()}`);
        }
        socket.join(`branchName:${user.branchName.toLowerCase()}`);
        socket.join(`location:${user.branchName.toLowerCase()}`);
      }

      if (user?.location) {
        const canonical = canonicalCoverageName(user.location);
        if (canonical) {
          socket.join(`location:${canonical.toLowerCase()}`);
          socket.join(`branchName:${canonical.toLowerCase()}`);
        }
        socket.join(`location:${user.location.toLowerCase()}`);
        socket.join(`branchName:${user.location.toLowerCase()}`);
      }
    }

    if (role === 'responder' || customRole === 'responder') {
      socket.join('role:responder');
    }

    // Debug log: new connection
    // eslint-disable-next-line no-console
    console.info(`[realtime] socket connected: uid=${uid}, email=${user?.email}, role=${role}, customRole=${customRole}, branchId=${user?.branchId}, branchName=${user?.branchName}, rooms=${Array.from(socket.rooms).join(',')}`);

    try {
      startNotificationStreamForUser(io, uid);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[realtime] startNotificationStreamForUser failed:', err?.message || err);
    }

    try {
      startReportStreamForUser(io, user);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[realtime] startReportStreamForUser failed:', err?.message || err);
    }

    try {
      const initialNotifications = await fetchNotificationsForUser(uid);
      socket.emit('notifications:data', initialNotifications);
    } catch {
      socket.emit('notifications:data', []);
    }

    try {
      const initialReports = await fetchReportsForUser(user);
      socket.emit('reports:data', initialReports);
      // eslint-disable-next-line no-console
      console.debug(`[realtime] emitted initial reports:data to ${room} (${Array.isArray(initialReports) ? initialReports.length : 0})`);
    } catch {
      socket.emit('reports:data', []);
    }

    socket.on('disconnect', (reason) => {
      // eslint-disable-next-line no-console
      console.info(`[realtime] socket disconnect: uid=${uid}, socketId=${socket.id}, reason=${reason}`);
      stopNotificationStreamForUser(uid);
      stopReportStreamForUser(user);
    });
  });

  return io;
}

module.exports = {
  initSocketServer,
};
