const express = require('express');
const router = express.Router();
const {
  getOpportunities,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  deleteOpportunity,
  applyForOpportunity,
  uploadResume,
  getApplications,
  updateApplicationStatus,
  getVolunteerStats
} = require('../controllers/volunteers');

const { protect, authorize } = require('../middlewares/auth');

router.get('/opportunities', getOpportunities);
router.get('/stats', protect, authorize('admin'), getVolunteerStats);
router.get('/opportunities/:id', getOpportunity);
router.post(
  '/opportunities',
  protect,
  authorize('admin', 'orphanage_manager'),
  createOpportunity
);
router.put(
  '/opportunities/:id',
  protect,
  authorize('admin', 'orphanage_manager'),
  updateOpportunity
);
router.delete(
  '/opportunities/:id',
  protect,
  authorize('admin', 'orphanage_manager'),
  deleteOpportunity
);
router.post(
  '/opportunities/:id/apply',
  protect,
  applyForOpportunity
);
router.put(
  '/applications/:id/resume',
  protect,
  uploadResume
);
router.get(
  '/opportunities/:id/applications',
  protect,
  authorize('admin', 'orphanage_manager'),
  getApplications
);
router.put(
  '/applications/:id/status',
  protect,
  authorize('admin', 'orphanage_manager'),
  updateApplicationStatus
);

module.exports = router;