const express = require('express');
const router = express.Router();
const {
  getOrphanages,
  getOrphanage,
  createOrphanage,
  updateOrphanage,
  getOrphanageOrphans,
  addReview,
  getOrphanageReviews,
  deleteReview
} = require('../controllers/orphanages');

const { protect, authorize } = require('../middlewares/auth');

router.get('/', getOrphanages);
router.get('/:id', getOrphanage);
router.post(
  '/',
  protect,
  authorize('admin'),
  createOrphanage
);
router.put(
  '/:id',
  protect,
  updateOrphanage
);
router.get('/:id/orphans', getOrphanageOrphans);
router.post('/:id/reviews', protect, addReview);
router.get('/:id/reviews', getOrphanageReviews);
router.delete(
  '/:id/reviews/:reviewId',
  protect,
  deleteReview
);

module.exports = router;