const { Server } = require('socket.io');
const admin = require('../config/firebaseAdmin');

const notificationStreams = new Map();

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
      // If ordered listener fails due to missing index, fall back to one-time fetch.
      const notifications = await fetchNotificationsForUser(uid);
      io.to(room).emit('notifications:data', notifications);
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
    const uid = socket.data?.user?.uid;
    if (!uid) {
      socket.disconnect(true);
      return;
    }

    const room = `user:${uid}`;
    socket.join(room);

    startNotificationStreamForUser(io, uid);

    try {
      const initialNotifications = await fetchNotificationsForUser(uid);
      socket.emit('notifications:data', initialNotifications);
    } catch {
      socket.emit('notifications:data', []);
    }

    socket.on('disconnect', () => {
      stopNotificationStreamForUser(uid);
    });
  });

  return io;
}

module.exports = {
  initSocketServer,
};
