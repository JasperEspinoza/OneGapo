const admin = require('../config/firebaseAdmin');
const {
  getVerificationStatus,
  sendAccountVerificationEmail,
  verifyEmailToken,
} = require('../services/verificationService');

const CONTACT_NUMBER_REGEX = /^[+()\-\s\d]{7,20}$/;

function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * POST /api/auth/complete-registration
 *
 * Called immediately after a resident self-registers via the Firebase Client SDK.
 * Assigns the 'resident' custom claim and creates a Firestore user document.
 *
 * Protected: verifyToken middleware must run first (req.user = decoded token).
 */
async function completeResidentRegistration(req, res, next) {
  try {
    const { uid, role } = req.user;
    const contactNumber = normalizeText(req.body?.contactNumber);
    const address = normalizeText(req.body?.address);

    if (!contactNumber) {
      return res.status(400).json({ error: 'Contact number is required.' });
    }

    if (!CONTACT_NUMBER_REGEX.test(contactNumber)) {
      return res.status(400).json({
        error: 'Contact number format is invalid. Use digits and optional +, spaces, parentheses, or dashes.',
      });
    }

    if (!address) {
      return res.status(400).json({ error: 'Address is required.' });
    }

    // Guard: prevent overwriting claims on already-provisioned staff/admin accounts.
    if (role) {
      return res.status(409).json({
        error: 'This account already has an assigned role and cannot be re-registered.',
      });
    }

    // Fetch display name and email from Firebase Auth
    const userRecord = await admin.auth().getUser(uid);

    await admin.auth().setCustomUserClaims(uid, { role: 'resident', verified: false });

    // Create Firestore user document
    await admin.firestore().collection('users').doc(uid).set({
      uid,
      fullName:  userRecord.displayName || '',
      email:     userRecord.email || '',
      phone:     contactNumber,
      address,
      role:      'resident',
      verified:  false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    let emailDelivery = { sent: true, skipped: false };
    try {
      const emailResult = await sendAccountVerificationEmail(uid, userRecord.email || '');
      if (emailResult?.skipped) {
        emailDelivery = {
          sent: false,
          skipped: true,
          reason: emailResult.reason || 'Email not configured',
        };
      }
    } catch (emailErr) {
      console.warn('[completeResidentRegistration] Verification email send failed:', emailErr.message);
      emailDelivery = {
        sent: false,
        skipped: false,
        reason: emailErr.message,
      };
    }

    const message = emailDelivery.sent
      ? 'Registration completed. Verification email sent.'
      : emailDelivery.skipped
        ? 'Registration completed, but verification email is not configured.'
        : 'Registration completed, but verification email failed to send.';

    return res.status(200).json({
      message,
      role: 'resident',
      verified: false,
      emailDelivery,
    });
  } catch (err) {
    return next(err);
  }
}

async function getResidentVerificationStatus(req, res, next) {
  try {
    const uid = String(req.user?.uid || '').trim();
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized: Missing user identifier.' });
    }

    const verified = await getVerificationStatus(uid);
    return res.json({
      verified,
      profile: {
        uid: req.user?.uid || uid,
        email: req.user?.email || '',
        role: req.user?.role || null,
        branchId: req.user?.branchId || null,
        branchName: req.user?.branchName || req.user?.location || null,
        location: req.user?.location || null,
        entityType: req.user?.entityType || null,
        customRoleId: req.user?.customRoleId || null,
        customRoleName: req.user?.customRoleName || null,
        permissions: Array.isArray(req.user?.permissions) ? req.user.permissions : [],
        isPrimaryAdmin: req.user?.isPrimaryAdmin === true,
      },
    });
  } catch (err) {
    if (err?.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User account not found.' });
    }
    return next(err);
  }
}

async function resendOwnVerification(req, res, next) {
  try {
    const uid = String(req.user?.uid || '').trim();
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized: Missing user identifier.' });
    }

    const verified = await getVerificationStatus(uid);
    if (verified) {
      return res.status(400).json({ error: 'This account is already verified.' });
    }

    const [userRecord, userSnap] = await Promise.all([
      admin.auth().getUser(uid),
      admin.firestore().collection('users').doc(uid).get(),
    ]);
    const userData = userSnap.exists ? userSnap.data() : {};

    let emailResult;
    try {
      emailResult = await sendAccountVerificationEmail(uid, userRecord.email || '', {
        branchName: userData.branchName || null,
      });
    } catch (emailErr) {
      console.warn('[resendOwnVerification] Verification email send failed:', emailErr.message);
      return res.status(503).json({
        error: 'Verification email service is temporarily unavailable. Please try again later.',
        details: emailErr.message,
      });
    }

    if (emailResult?.skipped) {
      return res.json({ message: 'Verification email is not configured. Please configure SMTP.' });
    }

    return res.json({ message: 'Verification email sent.' });
  } catch (err) {
    if (err?.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User account not found.' });
    }

    if (err?.message && /verification link has expired|verification token is required|invalid/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }

    if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT' || err?.code === 'ESOCKET') {
      return res.status(503).json({
        error: 'Verification email service is temporarily unavailable. Please try again later.',
        details: err.message,
      });
    }

    return next(err);
  }
}

async function confirmEmailVerification(req, res, next) {
  try {
    const { token } = req.body || {};
    const result = await verifyEmailToken(token);

    return res.json({
      message: result.alreadyVerified ? 'Email already verified.' : 'Email verified successfully.',
      uid: result.uid,
      verified: true,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  completeResidentRegistration,
  getResidentVerificationStatus,
  resendOwnVerification,
  confirmEmailVerification,
};
