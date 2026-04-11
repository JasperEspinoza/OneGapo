const admin = require('../config/firebaseAdmin');
const { sanitizePermissions } = require('../constants/rbac');

async function syncRoleMembers(db, roleId, roleName, permissions, updatedBy) {
  const roleMembersSnap = await db.collection('users').where('customRoleId', '==', roleId).get();
  if (roleMembersSnap.empty) return 0;

  const users = roleMembersSnap.docs;
  await Promise.all(
    users.map(async (userDoc) => {
      const uid = userDoc.id;

      await userDoc.ref.set(
        {
          customRoleName: roleName,
          permissions,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy,
        },
        { merge: true }
      );

      try {
        const authUser = await admin.auth().getUser(uid);
        const existingClaims = authUser.customClaims || {};
        await admin.auth().setCustomUserClaims(uid, {
          ...existingClaims,
          permissions,
        });
      } catch (error) {
        if (error?.code !== 'auth/user-not-found') {
          throw error;
        }
      }
    })
  );

  return users.length;
}

/**
 * POST /api/admin/roles
 * Creates a new custom role with a set of permissions.
 */
async function createRole(req, res, next) {
  try {
    const { name, permissions = [] } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Role name is required.' });
    }

    const trimmedName = String(name).trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'Role name cannot be blank.' });
    }

    const sanitizedPerms = sanitizePermissions(permissions);

    const db = admin.firestore();

    // Prevent duplicate names
    const existing = await db.collection('roles').where('name', '==', trimmedName).get();
    if (!existing.empty) {
      return res.status(409).json({ error: 'A role with this name already exists.' });
    }

    const ref = await db.collection('roles').add({
      name: trimmedName,
      permissions: sanitizedPerms,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.uid,
    });

    return res.status(201).json({ id: ref.id, name: trimmedName, permissions: sanitizedPerms });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/admin/roles
 * Returns all custom roles.
 */
async function listRoles(req, res, next) {
  try {
    const snap = await admin.firestore().collection('roles').orderBy('name').get();
    const roles = snap.docs.map((doc) => ({ id: doc.id, ...doc.data(), createdAt: undefined }));
    return res.json(roles);
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/admin/roles/:id
 * Updates an existing role's name and/or permissions.
 */
async function updateRole(req, res, next) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Role id is required.' });

    const { name, permissions } = req.body;
    const updates = {};
    const db = admin.firestore();

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({ error: 'Role name cannot be blank.' });
      }
      const existing = await db.collection('roles').where('name', '==', trimmedName).get();
      const duplicate = existing.docs.find((doc) => doc.id !== id);
      if (duplicate) {
        return res.status(409).json({ error: 'A role with this name already exists.' });
      }
      updates.name = trimmedName;
    }

    if (permissions !== undefined) {
      updates.permissions = sanitizePermissions(permissions);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    const docRef = db.collection('roles').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Role not found.' });
    }

    await docRef.update(updates);

    const roleName = updates.name || snap.data().name;
    const rolePermissions = updates.permissions || sanitizePermissions(snap.data().permissions || []);

    let syncedUsers = 0;
    if (name !== undefined || permissions !== undefined) {
      syncedUsers = await syncRoleMembers(db, id, roleName, rolePermissions, req.user.uid);
    }

    const updated = { id, ...snap.data(), ...updates, updatedAt: undefined };
    return res.json({ ...updated, syncedUsers });
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /api/admin/roles/:id
 * Deletes a role.
 */
async function deleteRole(req, res, next) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Role id is required.' });

    await admin.firestore().collection('roles').doc(id).delete();
    return res.json({ message: 'Role deleted.' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createRole, listRoles, updateRole, deleteRole };
