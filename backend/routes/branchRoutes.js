const { Router } = require('express');
const { verifyToken, requireAnyPermission, requirePermission } = require('../middleware/authMiddleware');
const {
	createBranch,
	listBranches,
	provisionDefaultBranches,
	updateBranch,
	deleteBranch,
} = require('../controllers/branchController');

const router = Router();

router.use(verifyToken);

router.get('/', requireAnyPermission(['add_branches', 'add_staffs']), listBranches);
router.post('/', requirePermission('add_branches'), createBranch);
router.post('/provision-defaults', requirePermission('add_branches'), provisionDefaultBranches);
router.patch('/:id', requirePermission('add_branches'), updateBranch);
router.delete('/:id', requirePermission('add_branches'), deleteBranch);

module.exports = router;
