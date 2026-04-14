const crypto = require('crypto');
const admin = require('../config/firebaseAdmin');
const { sendVerificationEmail } = require('./emailService');

const TOKEN_COLLECTION = 'emailVerificationTokens';
const TOKEN_TTL_HOURS = 24;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildFrontendVerificationLink(token) {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const verificationUrl = new URL('/verify-email', baseUrl);
  verificationUrl.searchParams.set('token', token);
  return verificationUrl.toString();
}

async function createVerificationToken(uid, email) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000)
  );

  await admin.firestore().collection(TOKEN_COLLECTION).doc(uid).set({
    uid,
    email: String(email || '').toLowerCase().trim(),
    tokenHash: hashToken(token),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    usedAt: null,
  });

  return token;
}

async function markUserVerified(uid) {
  const db = admin.firestore();
  const userRecord = await admin.auth().getUser(uid);
  const currentClaims = userRecord.customClaims || {};

  await Promise.all([
    admin.auth().setCustomUserClaims(uid, {
      ...currentClaims,
      verified: true,
    }),
    db.collection('users').doc(uid).set({
      verified: true,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }),
    db.collection(TOKEN_COLLECTION).doc(uid).set({
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
}

async function getVerificationStatus(uid) {
  const db = admin.firestore();

  const [userSnap, tokenSnap, userRecord] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection(TOKEN_COLLECTION).doc(uid).get(),
    admin.auth().getUser(uid),
  ]);

  const userData = userSnap.exists ? userSnap.data() : null;
  if (userData?.verified === true) {
    return true;
  }

  const tokenData = tokenSnap.exists ? tokenSnap.data() : null;
  const tokenMarkedUsed = Boolean(tokenData?.usedAt);

  if (tokenMarkedUsed || userRecord?.customClaims?.verified === true || userRecord?.emailVerified === true) {
    // Self-heal stale verification records across Auth claims and Firestore user profile.
    try {
      await markUserVerified(uid);
    } catch (err) {
      // If backfill fails transiently, still surface verified=true from observed signal.
      console.warn('[VerificationService] Backfill markUserVerified failed:', err.message);
    }
    return true;
  }

  return false;
}

async function sendAccountVerificationEmail(uid, email, options = {}) {
  const token = await createVerificationToken(uid, email);
  const verificationLink = buildFrontendVerificationLink(token);

  return sendVerificationEmail(email, verificationLink, options);
}

async function verifyEmailToken(token) {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) {
    const err = new Error('Verification token is required.');
    err.status = 400;
    throw err;
  }

  const tokenHash = hashToken(normalizedToken);
  const snap = await admin
    .firestore()
    .collection(TOKEN_COLLECTION)
    .where('tokenHash', '==', tokenHash)
    .limit(1)
    .get();

  if (snap.empty) {
    const err = new Error('This verification link is invalid or has already been replaced.');
    err.status = 400;
    throw err;
  }

  const tokenDoc = snap.docs[0];
  const tokenData = tokenDoc.data();

  if (tokenData.usedAt) {
    await markUserVerified(tokenData.uid);
    return { uid: tokenData.uid, alreadyVerified: true };
  }

  const expiresAt = tokenData.expiresAt?.toDate?.();
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    const err = new Error('This verification link has expired. Request a new email verification link.');
    err.status = 400;
    throw err;
  }

  await markUserVerified(tokenData.uid);
  return { uid: tokenData.uid, alreadyVerified: false };
}

module.exports = {
  getVerificationStatus,
  sendAccountVerificationEmail,
  verifyEmailToken,
};