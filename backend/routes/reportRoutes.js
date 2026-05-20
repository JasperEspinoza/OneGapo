const { Router } = require('express');
const multer = require('multer');
const { verifyToken, requireStaffOrAdmin } = require('../middleware/authMiddleware');
const { createUserScopedRateLimiter } = require('../middleware/firestoreRateLimitMiddleware');
const {
  createReport,
  listOwnReports,
  listReportsForOperators,
  getPerformanceMetrics,
  updateReportStatus,
  updateReportAssignment,
  archiveReport,
  unarchiveReport,
  deleteReport,
  listForwardTargets,
  forwardReport,
  markReportDuplicate,
  revokeReportDuplicate,
  listNotifications,
  markNotificationRead,
} = require('../controllers/reportController');

const router = Router();

const rateLimitResidentReportsRead = createUserScopedRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  keyPrefix: 'reports-me',
  message: 'Rate limit reached for reports. Please retry shortly.',
});

const rateLimitOperatorReportsRead = createUserScopedRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 16,
  keyPrefix: 'reports-operators',
  message: 'Rate limit reached for operator reports. Please retry shortly.',
});

const rateLimitPerformanceRead = createUserScopedRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 8,
  keyPrefix: 'reports-performance',
  message: 'Rate limit reached for performance metrics. Please retry shortly.',
});

const rateLimitNotificationsRead = createUserScopedRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'reports-notifications',
  message: 'Rate limit reached for notifications. Please retry shortly.',
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 3,
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
      return;
    }
    const err = new Error('Only image and video files are allowed.');
    err.status = 400;
    cb(err);
  },
});

const uploadResolutionEvidence = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 4,
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }
    const err = new Error('Only image files are allowed for resolution evidence.');
    err.status = 400;
    cb(err);
  },
});

router.post('/', verifyToken, upload.array('attachments', 3), createReport);
router.get('/me', verifyToken, rateLimitResidentReportsRead, listOwnReports);
router.get('/', verifyToken, rateLimitOperatorReportsRead, listReportsForOperators);
router.get('/performance', verifyToken, requireStaffOrAdmin, rateLimitPerformanceRead, getPerformanceMetrics);
router.get('/forward-targets', verifyToken, requireStaffOrAdmin, listForwardTargets);
router.patch('/:reportId/forward', verifyToken, requireStaffOrAdmin, forwardReport);
router.post('/:reportId/duplicate', verifyToken, requireStaffOrAdmin, markReportDuplicate);
router.delete('/:reportId/duplicate', verifyToken, requireStaffOrAdmin, revokeReportDuplicate);
router.patch('/:reportId/archive', verifyToken, requireStaffOrAdmin, archiveReport);
router.patch('/:reportId/unarchive', verifyToken, requireStaffOrAdmin, unarchiveReport);
router.delete('/:reportId', verifyToken, requireStaffOrAdmin, deleteReport);
router.get('/notifications', verifyToken, requireStaffOrAdmin, rateLimitNotificationsRead, listNotifications);
router.patch('/notifications/:notificationId/read', verifyToken, requireStaffOrAdmin, markNotificationRead);
router.patch('/:reportId/assignment', verifyToken, requireStaffOrAdmin, updateReportAssignment);
router.patch('/:reportId/status', verifyToken, uploadResolutionEvidence.array('resolutionPhotos', 4), updateReportStatus);

module.exports = router;
