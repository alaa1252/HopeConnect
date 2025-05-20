const express = require('express');
const router = express.Router();
const {
  getDeliveries,
  getDelivery,
  createDelivery,
  updateDelivery
} = require('../controllers/deliveries');

const { protect, authorize } = require('../middlewares/auth');

router.get('/', protect, getDeliveries);
router.get('/:id', protect, getDelivery);
router.post('/', protect, authorize('admin'), createDelivery);
router.put('/:id', protect, authorize('admin'), updateDelivery);

module.exports = router;