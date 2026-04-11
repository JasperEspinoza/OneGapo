/**
 * One-off script: sanitize RBAC permissions and sync role members.
 *
 * Run from backend folder:
 *   node scripts/syncRbacPermissions.js
 */

require('dotenv').config();
const admin = require('../config/firebaseAdmin');
const { sanitizePermissions } = require('../constants/rbac');

function toSortedKey(list = []) {
  return [...list].sort().join('|');
}

async function main() {
  const db = admin.firestore();

  const rolesSnap = await db.collection('roles').get();
  const roleMap = new Map();

  let rolesUpdated = 0;
  for (const roleDoc of rolesSnap.docs) {
    const roleData = roleDoc.data() || {};
    const currentPermissions = Array.isArray(roleData.permissions) ? roleData.permissions : [];
    const sanitizedPermissions = sanitizePermissions(currentPermissions);

    if (toSortedKey(currentPermissions) !== toSortedKey(sanitizedPermissions)) {
      await roleDoc.ref.set(
        {
          permissions: sanitizedPermissions,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: 'script:syncRbacPermissions',
        },
        { merge: true }
      );
      rolesUpdated += 1;
    }

    roleMap.set(roleDoc.id, {
      name: roleData.name || null,
      permissions: sanitizedPermissions,
    });
  }

  const usersSnap = await db.collection('users').get();
  let usersUpdated = 0;
  let claimsUpdated = 0;

  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data() || {};
    const customRoleId = userData.customRoleId || null;
    if (!customRoleId || !roleMap.has(customRoleId)) {
      continue;
    }

    const roleInfo = roleMap.get(customRoleId);
    const expectedPermissions = roleInfo.permissions;
    const currentPermissions = Array.isArray(userData.permissions) ? userData.permissions : [];
    const needsUserUpdate =
      toSortedKey(currentPermissions) !== toSortedKey(expectedPermissions) ||
      (userData.customRoleName || null) !== (roleInfo.name || null);

    if (needsUserUpdate) {
      await userDoc.ref.set(
        {
          customRoleName: roleInfo.name || null,
          permissions: expectedPermissions,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: 'script:syncRbacPermissions',
        },
        { merge: true }
      );
      usersUpdated += 1;
    }

    try {
      const authUser = await admin.auth().getUser(userDoc.id);
      const currentClaims = authUser.customClaims || {};
      if (toSortedKey(currentClaims.permissions || []) !== toSortedKey(expectedPermissions)) {
        await admin.auth().setCustomUserClaims(userDoc.id, {
          ...currentClaims,
          permissions: expectedPermissions,
        });
        claimsUpdated += 1;
      }
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') {
        throw error;
      }
    }
  }

  console.log(`Roles scanned: ${rolesSnap.size}, updated: ${rolesUpdated}`);
  console.log(`Users scanned: ${usersSnap.size}, updated: ${usersUpdated}`);
  console.log(`Custom claims updated: ${claimsUpdated}`);
  console.log('RBAC sync complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message || err);
    process.exit(1);
  });
