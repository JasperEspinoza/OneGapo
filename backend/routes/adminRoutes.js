const { Router } = require('express');
const { verifyToken, requirePermission } = require('../middleware/authMiddleware');
const { createStaff, createBranchStaff, listBranchStaff, listUsers, updateStaff, deleteUser, resendVerification } = require('../controllers/adminController');

const router = Router();

router.post('/branch-staff', verifyToken, requirePermission('add_staffs'), createBranchStaff);
router.get('/branch-staff', verifyToken, requirePermission('add_staffs'), listBranchStaff);

router.use(verifyToken, requirePermission('add_staffs'));

router.post('/create-staff',           createStaff);
router.get('/users',                   listUsers);
router.post('/users/:uid/resend-verification', resendVerification);
router.patch('/users/:uid',            updateStaff);
router.delete('/users/:uid',           deleteUser);

module.exports = router;
