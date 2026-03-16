const { Router } = require('express');
const { verifyToken, requireAdmin, requireStaffOrAdmin } = require('../middleware/authMiddleware');
const { createStaff, createBranchStaff, listBranchStaff, listUsers, updateStaff, deleteUser, resendVerification } = require('../controllers/adminController');

const router = Router();

// Staff-accessible routes (staff can manage staff within their own branch)
router.post('/branch-staff', verifyToken, requireStaffOrAdmin, createBranchStaff);
router.get('/branch-staff',  verifyToken, requireStaffOrAdmin, listBranchStaff);

// All remaining admin routes require admin token
router.use(verifyToken, requireAdmin);

router.post('/create-staff',           createStaff);
router.get('/users',                   listUsers);
router.post('/users/:uid/resend-verification', resendVerification);
router.patch('/users/:uid',            updateStaff);
router.delete('/users/:uid',           deleteUser);

module.exports = router;
