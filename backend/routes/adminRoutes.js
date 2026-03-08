const { Router } = require('express');
const { verifyToken, requireAdmin } = require('../middleware/authMiddleware');
const { createStaff, listUsers, updateStaff, deleteUser } = require('../controllers/adminController');

const router = Router();

// All admin routes require a valid admin token
router.use(verifyToken, requireAdmin);

router.post('/create-staff',   createStaff);
router.get('/users',           listUsers);
router.patch('/users/:uid',    updateStaff);
router.delete('/users/:uid',   deleteUser);

module.exports = router;
