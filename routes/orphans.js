const express = require('express');
const router = express.Router();
const {
  getOrphans,
  getOrphan,
  createOrphan,
  updateOrphan,
  deleteOrphan,
  uploadOrphanPhoto,
  addOrphanUpdate,
  getOrphanUpdates
} = require('../controllers/orphans');

const { protect, authorize } = require('../middlewares/auth');

router.get('/', getOrphans);
router.get('/:id', getOrphan);
router.post(
  '/',
  protect,
  authorize('admin', 'orphanage_manager'),
  createOrphan
);
router.put(
  '/:id',
  protect,
  authorize('admin', 'orphanage_manager'),
  updateOrphan
);
router.delete(
  '/:id',
  protect,
  authorize('admin'),
  deleteOrphan
);
router.post(
  '/:id/updates',
  protect,
  authorize('admin', 'orphanage_manager'),
  addOrphanUpdate
);
router.get('/:id/updates', getOrphanUpdates);

module.exports = router;