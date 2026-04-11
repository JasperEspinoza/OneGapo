/**
 * One-off script: ensures the primary admin account has:
 * - branch/location: Main Admin
 * - custom role: Main Admin
 *
 * Run from backend folder:
 *   node scripts/setMainAdminProfile.js
 */

require('dotenv').config();
const admin = require('../config/firebaseAdmin');
const { ALLOWED_PERMISSIONS } = require('../constants/rbac');

const ADMIN_EMAIL = 'onegapo2026@gmail.com';
const MAIN_ADMIN_BRANCH_NAME = 'Main Admin';
const MAIN_ADMIN_BRANCH_TYPE = 'private';
const MAIN_ADMIN_ROLE_NAME = 'Main Admin';
const ADMIN_PERMISSIONS = ALLOWED_PERMISSIONS;

async function ensureBranch(db) {
  const snap = await db.collection('branches').where('name', '==', MAIN_ADMIN_BRANCH_NAME).limit(1).get();
  if (!snap.empty) {
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  const ref = await db.collection('branches').add({
    name: MAIN_ADMIN_BRANCH_NAME,
    type: MAIN_ADMIN_BRANCH_TYPE,
    seeded: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'script:setMainAdminProfile',
  });

  return {
    id: ref.id,
    name: MAIN_ADMIN_BRANCH_NAME,
    type: MAIN_ADMIN_BRANCH_TYPE,
  };
}

async function ensureRole(db) {
  const snap = await db.collection('roles').where('name', '==', MAIN_ADMIN_ROLE_NAME).limit(1).get();
  if (!snap.empty) {
    const doc = snap.docs[0];
    await doc.ref.set(
      {
        permissions: ADMIN_PERMISSIONS,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { id: doc.id, ...doc.data(), permissions: ADMIN_PERMISSIONS };
  }

  const ref = await db.collection('roles').add({
    name: MAIN_ADMIN_ROLE_NAME,
    permissions: ADMIN_PERMISSIONS,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'script:setMainAdminProfile',
  });

  return {
    id: ref.id,
    name: MAIN_ADMIN_ROLE_NAME,
    permissions: ADMIN_PERMISSIONS,
  };
}

async function main() {
  const db = admin.firestore();

  const userRecord = await admin.auth().getUserByEmail(ADMIN_EMAIL);
  const { uid, email } = userRecord;
  console.log(`Found user: ${email} (${uid})`);

  const [branch, role] = await Promise.all([ensureBranch(db), ensureRole(db)]);
  console.log(`Using branch: ${branch.name} (${branch.id})`);
  console.log(`Using role: ${role.name} (${role.id})`);

  const mergedClaims = {
    ...(userRecord.customClaims || {}),
    role: 'admin',
    branchId: branch.id,
    location: branch.name,
    entityType: branch.type,
    permissions: ADMIN_PERMISSIONS,
    verified: true,
  };

  await admin.auth().setCustomUserClaims(uid, mergedClaims);
  console.log('Updated Firebase Auth custom claims.');

  await db.collection('users').doc(uid).set(
    {
      uid,
      email,
      fullName: userRecord.displayName || 'Main Admin',
      role: 'admin',
      verified: true,
      branchId: branch.id,
      branchName: branch.name,
      entityType: branch.type,
      customRoleId: role.id,
      customRoleName: role.name,
      permissions: ADMIN_PERMISSIONS,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'script:setMainAdminProfile',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log('Updated Firestore user document.');
  console.log('Done. Sign out and sign in again for claims refresh.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message || err);
    process.exit(1);
  });
