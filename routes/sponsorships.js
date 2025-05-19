const express = require('express');
const router = express.Router();
const {
  getSponsorships,
  getSponsorship,
  createSponsorship,
  updateSponsorshipStatus,
  processPayment,
  getSponsorshipStats
} = require('../controllers/sponsorships');

const { protect, authorize } = require('../middlewares/auth');

router.get('/', protect, getSponsorships);
router.get('/stats', protect, authorize('admin'), getSponsorshipStats);
router.get('/:id', protect, getSponsorship);
router.post('/', protect, createSponsorship);
router.put('/:id/status', protect, updateSponsorshipStatus);
router.post('/:id/payment', protect, processPayment);

module.exports = router;