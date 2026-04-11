const ALLOWED_ROLES = ['staff', 'admin'];

const ALLOWED_PERMISSIONS = [
  'view_reports',
  'update_reports',
  'close_reports',
  'archive_reports',
  'add_branches',
  'add_roles',
  'add_staffs',
];

function sanitizePermissions(permissions = []) {
  if (!Array.isArray(permissions)) return [];

  return Array.from(
    new Set(permissions.filter((permission) => ALLOWED_PERMISSIONS.includes(permission)))
  );
}

module.exports = {
  ALLOWED_ROLES,
  ALLOWED_PERMISSIONS,
  sanitizePermissions,
};