const { Router } = require('express');
const { verifyToken, requireAdmin } = require('../middleware/authMiddleware');
const { createBranch, listBranches, deleteBranch } = require('../controllers/branchController');

const router = Router();

// All branch routes require a valid admin token
router.use(verifyToken, requireAdmin);

router.get('/',    listBranches);
router.post('/',   createBranch);
router.delete('/:id', deleteBranch);

module.exports = router;
