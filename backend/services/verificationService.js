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
  const tokenHash = hashToken(token);
  const expiresAt = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000)
  );

  console.log(`[createVerificationToken] Creating token for uid: ${uid}, email: ${email}`);
  console.log(`[createVerificationToken] Token hash: ${tokenHash}`);

  try {
    await admin.firestore().collection(TOKEN_COLLECTION).doc(uid).set({
      uid,
      email: String(email || '').toLowerCase().trim(),
      tokenHash,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
      usedAt: null,
    });
    console.log(`[createVerificationToken] Token successfully saved to Firestore for uid: ${uid}`);
  } catch (err) {
    console.error(`[createVerificationToken] Failed to save token to Firestore for uid ${uid}:`, err);
    throw err;
  }

  return token;
}

async function markUserVerified(uid) {
  const db = admin.firestore();

  try {
    const userRecord = await admin.auth().getUser(uid);
    const currentClaims = userRecord.customClaims || {};

    await admin.auth().updateUser(uid, {
      emailVerified: true,
    });

    const [claimResult, userResult, tokenResult] = await Promise.allSettled([
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

    const nonFatalFailures = [];
    if (claimResult.status === 'rejected') {
      nonFatalFailures.push(`Firebase Auth claim: ${claimResult.reason?.message || String(claimResult.reason)}`);
    }
    if (userResult.status === 'rejected') {
      nonFatalFailures.push(`Firestore user: ${userResult.reason?.message || String(userResult.reason)}`);
    }
    if (tokenResult.status === 'rejected') {
      nonFatalFailures.push(`Firestore token: ${tokenResult.reason?.message || String(tokenResult.reason)}`);
    }

    if (nonFatalFailures.length > 0) {
      console.warn(`[markUserVerified] Verification completed for uid ${uid}, but some backfill writes failed: ${nonFatalFailures.join('; ')}`);
    }
  } catch (err) {
    console.error(`[markUserVerified] Error marking uid ${uid} as verified:`, err);
    throw err;
  }
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
  console.log(`[verifyEmailToken] Looking for token with hash: ${tokenHash}`);

  let snap;
  
  try {
    snap = await admin
      .firestore()
      .collection(TOKEN_COLLECTION)
      .where('tokenHash', '==', tokenHash)
      .limit(1)
      .get();
    console.log(`[verifyEmailToken] Query returned ${snap.size} document(s)`);
  } catch (err) {
    console.error('[verifyEmailToken] Error querying token collection:', err.message);
    const error = new Error(`Could not query verification tokens: ${err.message}`);
    error.status = 503;
    throw error;
  }

  if (snap.empty) {
    console.warn(`[verifyEmailToken] No token found with hash: ${tokenHash}`);
    const err = new Error('This verification link is invalid or has already been replaced.');
    err.status = 400;
    throw err;
  }

  const tokenDoc = snap.docs[0];
  const tokenData = tokenDoc.data();
  const uid = tokenData.uid;
  
  console.log(`[verifyEmailToken] Token found for uid: ${uid}, already used: ${Boolean(tokenData.usedAt)}`);

  if (tokenData.usedAt) {
    console.log(`[verifyEmailToken] Token already used at ${tokenData.usedAt}`);
    try {
      await markUserVerified(uid);
    } catch (err) {
      console.warn(`[verifyEmailToken] Verification backfill failed for already-used token (uid: ${uid}):`, err.message);
      // Even if backfill fails, return success since token was already used
    }
    return { uid, alreadyVerified: true };
  }

  const expiresAt = tokenData.expiresAt?.toDate?.();
  console.log(`[verifyEmailToken] Token expires at: ${expiresAt?.toISOString()}, now: ${new Date().toISOString()}`);
  
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    console.warn(`[verifyEmailToken] Token expired for uid: ${uid}`);
    const err = new Error('This verification link has expired. Request a new email verification link.');
    err.status = 400;
    throw err;
  }

  console.log(`[verifyEmailToken] Marking user ${uid} as verified...`);
  try {
    await markUserVerified(uid);
    console.log(`[verifyEmailToken] Successfully marked user ${uid} as verified`);
  } catch (err) {
    console.error(`[verifyEmailToken] Failed to mark user ${uid} as verified:`, err);
    throw new Error(`Could not complete verification: ${err.message}`);
  }
  
  return { uid, alreadyVerified: false };
}

module.exports = {
  getVerificationStatus,
  sendAccountVerificationEmail,
  verifyEmailToken,
};