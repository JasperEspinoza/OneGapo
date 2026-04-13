const { Server } = require('socket.io');
const admin = require('../config/firebaseAdmin');

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
  return {
    id: doc.id,
    ...serializeValue(doc.data() || {}),
  };
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
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin') return true;

  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const canViewReports = permissions.includes('view_reports')
    || permissions.includes('update_reports')
    || permissions.includes('close_reports')
    || permissions.includes('archive_reports');

  if (role !== 'staff' || !canViewReports) return false;

  const staffLocation = String(user?.location || '').trim().toLowerCase();
  if (!staffLocation) return false;

  const reportBranch = String(report?.forwarding?.to?.branchName || '').trim().toLowerCase();
  if (reportBranch && reportBranch === staffLocation) return true;

  const reportBarangay = String(report?.location?.barangay || '').trim().toLowerCase();
  if (reportBarangay && reportBarangay === staffLocation) return true;

  const reportCoverage = Array.isArray(report?.coverage)
    ? report.coverage.map((item) => String(item || '').trim().toLowerCase())
    : [];
  if (reportCoverage.includes(staffLocation)) return true;

  return false;
}

async function fetchReportsForUser(user) {
  const db = admin.firestore();
  const uid = String(user?.uid || '').trim();
  const role = String(user?.role || '').toLowerCase();

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
  const role = String(user?.role || '').trim();
  const location = String(user?.location || '').trim();
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
      let reports = snapshot.docs.map(reportDto);
      if (role !== 'resident') {
        reports = reports.filter((report) => canUserAccessReport(report, user));
      }
      io.to(room).emit('reports:data', reports);
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
  });

  io.use(async (socket, next) => {
    try {
      const rawToken = socket.handshake?.auth?.token || socket.handshake?.headers?.authorization || '';
      const token = String(rawToken || '').replace(/^Bearer\s+/i, '').trim();

      if (!token) {
        return next(new Error('Unauthorized: Missing token.'));
      }

      const decoded = await admin.auth().verifyIdToken(token);
      socket.data.user = decoded;
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

    startNotificationStreamForUser(io, uid);
    startReportStreamForUser(io, user);

    try {
      const initialNotifications = await fetchNotificationsForUser(uid);
      socket.emit('notifications:data', initialNotifications);
    } catch {
      socket.emit('notifications:data', []);
    }

    try {
      const initialReports = await fetchReportsForUser(user);
      socket.emit('reports:data', initialReports);
    } catch {
      socket.emit('reports:data', []);
    }

    socket.on('disconnect', () => {
      stopNotificationStreamForUser(uid);
      stopReportStreamForUser(user);
    });
  });

  return io;
}

module.exports = {
  initSocketServer,
};
