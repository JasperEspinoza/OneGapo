const admin = require('../config/firebaseAdmin');

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

    // Guard: prevent overwriting claims on already-provisioned staff/admin accounts.
    if (role) {
      return res.status(409).json({
        error: 'This account already has an assigned role and cannot be re-registered.',
      });
    }

    // Fetch display name and email from Firebase Auth
    const userRecord = await admin.auth().getUser(uid);

    await admin.auth().setCustomUserClaims(uid, { role: 'resident' });

    // Create Firestore user document
    await admin.firestore().collection('users').doc(uid).set({
      uid,
      fullName:  userRecord.displayName || '',
      email:     userRecord.email || '',
      role:      'resident',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ message: 'Role assigned.', role: 'resident' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { completeResidentRegistration };
