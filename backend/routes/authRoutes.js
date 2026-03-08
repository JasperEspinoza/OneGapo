const { Router } = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { completeResidentRegistration } = require('../controllers/authController');

const router = Router();

/**
 * POST /api/auth/complete-registration
 *
 * Accessible to any newly-registered Firebase user (no prior role claim).
 * Assigns the 'resident' custom claim after client-side user creation.
 *
 * Headers:
 *   Authorization: Bearer <firebaseIdToken>
 */
router.post('/complete-registration', verifyToken, completeResidentRegistration);

module.exports = router;
