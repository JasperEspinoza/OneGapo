const { Router } = require('express');
const multer = require('multer');
const { verifyToken, requireStaffOrAdmin } = require('../middleware/authMiddleware');
const {
  createReport,
  listOwnReports,
  listReportsForOperators,
  getPerformanceMetrics,
  updateReportStatus,
  archiveReport,
  deleteReport,
  listForwardTargets,
  forwardReport,
  listNotifications,
  markNotificationRead,
} = require('../controllers/reportController');

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 6,
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

router.post('/', verifyToken, upload.array('attachments', 6), createReport);
router.get('/me', verifyToken, listOwnReports);
router.get('/', verifyToken, listReportsForOperators);
router.get('/performance', verifyToken, requireStaffOrAdmin, getPerformanceMetrics);
router.get('/forward-targets', verifyToken, requireStaffOrAdmin, listForwardTargets);
router.patch('/:reportId/forward', verifyToken, requireStaffOrAdmin, forwardReport);
router.patch('/:reportId/archive', verifyToken, requireStaffOrAdmin, archiveReport);
router.delete('/:reportId', verifyToken, requireStaffOrAdmin, deleteReport);
router.get('/notifications', verifyToken, requireStaffOrAdmin, listNotifications);
router.patch('/notifications/:notificationId/read', verifyToken, requireStaffOrAdmin, markNotificationRead);
router.patch('/:reportId/status', verifyToken, uploadResolutionEvidence.array('resolutionPhotos', 4), updateReportStatus);

module.exports = router;
