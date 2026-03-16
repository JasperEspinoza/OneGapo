/**
 * One-off script: sets role: 'admin' custom claim on the bootstrap admin account
 * and ensures the Firestore user document is complete.
 *
 * Run once from the backend folder:
 *   node scripts/setAdminClaim.js
 */

require('dotenv').config();
const admin = require('../config/firebaseAdmin');

const ADMIN_EMAIL = 'onegapo2026@gmail.com';
const ADMIN_PERMISSIONS = ['view_reports', 'update_reports', 'close_reports', 'create_announcements'];

async function main() {
  // Look up the user by email
  const userRecord = await admin.auth().getUserByEmail(ADMIN_EMAIL);
  const { uid, email } = userRecord;

  console.log(`Found user: ${email} (${uid})`);
  console.log('Current claims:', userRecord.customClaims);

  // Set the admin claim
  await admin.auth().setCustomUserClaims(uid, {
    role: 'admin',
    permissions: ADMIN_PERMISSIONS,
    verified: true,
  });
  console.log('✔ Custom claim set for primary admin with full access.');

  // Upsert Firestore document with all required fields
  await admin.firestore().collection('users').doc(uid).set(
    {
      uid,
      email,
      fullName:    userRecord.displayName || 'Admin',
      role:        'admin',
      verified:    true,
      branchId:    null,
      branchName:  null,
      entityType:  null,
      permissions: ADMIN_PERMISSIONS,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }   // merge so existing fields aren't wiped
  );
  console.log('✔ Firestore user document updated.');
  console.log('Done. Sign out and sign back in to pick up the new claim.');

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
