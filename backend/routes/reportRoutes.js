const { Router } = require('express');
const multer = require('multer');
const { verifyToken } = require('../middleware/authMiddleware');
const {
  createReport,
  listOwnReports,
  listReportsForOperators,
  updateReportStatus,
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

router.post('/', verifyToken, upload.array('attachments', 6), createReport);
router.get('/me', verifyToken, listOwnReports);
router.get('/', verifyToken, listReportsForOperators);
router.patch('/:reportId/status', verifyToken, updateReportStatus);

module.exports = router;
