const express = require('express');
const router = express.Router();
const {
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  getCampaignDonations,
  getCampaignStats
} = require('../controllers/campaigns');

const { protect, authorize } = require('../middlewares/auth');

router.get('/', getCampaigns);
router.get('/stats', protect, authorize('admin'), getCampaignStats);
router.get('/:id', getCampaign);
router.post(
  '/',
  protect,
  authorize('admin', 'orphanage_manager'),
  createCampaign
);
router.put(
  '/:id',
  protect,
  updateCampaign
);
router.get('/:id/donations', getCampaignDonations);

module.exports = router;