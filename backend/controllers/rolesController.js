const admin = require('../config/firebaseAdmin');

const ALLOWED_PERMISSIONS = [
  'view_reports',
  'update_reports',
  'close_reports',
  'archive_reports',
  'create_announcements',
  'add_branches',
  'add_roles',
  'add_staffs',
];

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

    const sanitizedPerms = permissions.filter((p) => ALLOWED_PERMISSIONS.includes(p));

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
      updates.permissions = permissions.filter((p) => ALLOWED_PERMISSIONS.includes(p));
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

    const updated = { id, ...snap.data(), ...updates, updatedAt: undefined };
    return res.json(updated);
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
