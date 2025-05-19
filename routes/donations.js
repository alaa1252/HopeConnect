const express = require('express');
const router = express.Router();
const {
  getDonations,
  getDonation,
  createDonation,
  updateDonationStatus,
  uploadDonationReceipt,
  getDonationStats
} = require('../controllers/donations');

const { protect, authorize } = require('../middlewares/auth');

router.get('/', protect, getDonations);
router.get('/stats', protect, authorize('admin'), getDonationStats);
router.get('/:id', protect, getDonation);
router.post('/', protect, createDonation);
router.put('/:id/status', protect, authorize('admin'), updateDonationStatus);
router.put('/:id/receipt', protect, uploadDonationReceipt);

module.exports = router;