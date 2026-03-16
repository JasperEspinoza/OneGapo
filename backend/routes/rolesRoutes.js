const { Router } = require('express');
const { verifyToken, requireAdmin } = require('../middleware/authMiddleware');
const { createRole, listRoles, updateRole, deleteRole } = require('../controllers/rolesController');

const router = Router();

router.use(verifyToken, requireAdmin);

router.get('/',       listRoles);
router.post('/',      createRole);
router.patch('/:id',  updateRole);
router.delete('/:id', deleteRole);

module.exports = router;
