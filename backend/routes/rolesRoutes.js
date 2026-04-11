const { Router } = require('express');
const { verifyToken, requireAnyPermission, requirePermission } = require('../middleware/authMiddleware');
const { createRole, listRoles, updateRole, deleteRole } = require('../controllers/rolesController');

const router = Router();

router.use(verifyToken);

router.get('/', requireAnyPermission(['add_roles', 'add_staffs']), listRoles);
router.post('/', requirePermission('add_roles'), createRole);
router.patch('/:id', requirePermission('add_roles'), updateRole);
router.delete('/:id', requirePermission('add_roles'), deleteRole);

module.exports = router;
