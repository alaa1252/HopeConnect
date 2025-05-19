const { pool } = require('../config/db');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sendEmail = require('../utils/sendEmail');

const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadDir = './uploads/receipts';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    cb(
      null,
      `receipt_${Date.now()}${path.extname(file.originalname)}`
    );
  }
});

exports.upload = multer({
  storage: storage,
  limits: { fileSize: 5000000 },
  fileFilter: function(req, file, cb) {
    checkFileType(file, cb);
  }
}).single('receipt_image');

function checkFileType(file, cb) {
  const filetypes = /jpeg|jpg|png|pdf/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only JPEG, JPG, PNG, and PDF files are allowed'));
  }
}

exports.getDonations = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    const donationType = req.query.type;
    const status = req.query.status;
    const minAmount = req.query.minAmount;
    const maxAmount = req.query.maxAmount;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const donorId = req.query.donorId;
    const orphanId = req.query.orphanId;
    const orphanageId = req.query.orphanageId;
    const campaignId = req.query.campaignId;

    let conditions = [];
    let queryParams = [];

    if (req.user.role !== 'admin') {
      conditions.push('donor_id = ?');
      queryParams.push(req.user.id);
    } else if (donorId) {
      conditions.push('donor_id = ?');
      queryParams.push(donorId);
    }

    if (donationType) {
      conditions.push('donation_type = ?');
      queryParams.push(donationType);
    }

    if (status) {
      conditions.push('status = ?');
      queryParams.push(status);
    }

    if (minAmount) {
      conditions.push('amount >= ?');
      queryParams.push(parseFloat(minAmount));
    }

    if (maxAmount) {
      conditions.push('amount <= ?');
      queryParams.push(parseFloat(maxAmount));
    }

    if (startDate) {
      conditions.push('created_at >= ?');
      queryParams.push(startDate);
    }

    if (endDate) {
      conditions.push('created_at <= ?');
      queryParams.push(endDate);
    }

    if (orphanId) {
      conditions.push('orphan_id = ?');
      queryParams.push(orphanId);
    }

    if (orphanageId) {
      conditions.push('orphanage_id = ?');
      queryParams.push(orphanageId);
    }

    if (campaignId) {
      conditions.push('campaign_id = ?');
      queryParams.push(campaignId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM donations ${whereClause}`,
      queryParams
    );
    const total = countRows[0].total;

    const paginationParams = [...queryParams];

    paginationParams.push(startIndex, limit);

    const [rows] = await pool.execute(
      `SELECT d.*, 
       u.first_name as donor_first_name, u.last_name as donor_last_name,
       o.first_name as orphan_first_name, o.last_name as orphan_last_name,
       og.name as orphanage_name,
       ec.title as campaign_title
       FROM donations d
       LEFT JOIN users u ON d.donor_id = u.id
       LEFT JOIN orphans o ON d.orphan_id = o.id
       LEFT JOIN orphanages og ON d.orphanage_id = og.id
       LEFT JOIN emergency_campaigns ec ON d.campaign_id = ec.id
       ${whereClause}
       ORDER BY d.created_at DESC
       LIMIT ?, ?`,
      paginationParams
    );

    const pagination = {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };

    res.status(200).json({
      success: true,
      pagination,
      data: rows
    });
  } catch (error) {
    next(error);
  }
};

exports.createDonation = async (req, res, next) => {
  try {
    const {
      amount,
      donation_type,
      category,
      payment_method,
      transaction_id,
      orphan_id,
      orphanage_id,
      campaign_id,
      description,
      is_anonymous,
      pickup_address,
      delivery_address
    } = req.body;

    if (!amount || !donation_type || !category) {
      return res.status(400).json({
        success: false,
        message: 'Please provide amount, donation type, and category'
      });
    }

    if (orphan_id) {
      const [orphanRows] = await pool.execute(
        'SELECT id FROM orphans WHERE id = ?',
        [orphan_id]
      );

      if (orphanRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Orphan not found'
        });
      }
    }

    if (orphanage_id) {
      const [orphanageRows] = await pool.execute(
        'SELECT id FROM orphanages WHERE id = ?',
        [orphanage_id]
      );

      if (orphanageRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Orphanage not found'
        });
      }
    }

    if (campaign_id) {
      const [campaignRows] = await pool.execute(
        'SELECT id, status FROM emergency_campaigns WHERE id = ?',
        [campaign_id]
      );

      if (campaignRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }

      if (campaignRows[0].status !== 'active') {
        return res.status(400).json({
          success: false,
          message: 'Campaign is not active'
        });
      }
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [result] = await connection.execute(
        `INSERT INTO donations
         (donor_id, amount, donation_type, category, status, payment_method, transaction_id,
          orphan_id, orphanage_id, campaign_id, description, is_anonymous)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          amount,
          donation_type,
          category,
          'pending',
          payment_method,
          transaction_id,
          orphan_id,
          orphanage_id,
          campaign_id,
          description,
          is_anonymous || false
        ]
      );

      const donationId = result.insertId;

      if (category === 'in_kind' && (pickup_address || delivery_address)) {
        await connection.execute(
          `INSERT INTO delivery_tracking
           (donation_id, status, pickup_address, delivery_address)
           VALUES (?, ?, ?, ?)`,
          [donationId, 'preparing', pickup_address, delivery_address]
        );
      }

      if (campaign_id) {
        await connection.execute(
          `UPDATE emergency_campaigns 
           SET current_amount = current_amount + ? 
           WHERE id = ?`,
          [parseFloat(amount), campaign_id]
        );
      }

      await connection.commit();

      const [donation] = await pool.execute(
        `SELECT d.*, 
         u.first_name as donor_first_name, u.last_name as donor_last_name,
         o.first_name as orphan_first_name, o.last_name as orphan_last_name,
         og.name as orphanage_name,
         ec.title as campaign_title
         FROM donations d
         LEFT JOIN users u ON d.donor_id = u.id
         LEFT JOIN orphans o ON d.orphan_id = o.id
         LEFT JOIN orphanages og ON d.orphanage_id = og.id
         LEFT JOIN emergency_campaigns ec ON d.campaign_id = ec.id
         WHERE d.id = ?`,
        [donationId]
      );

      await pool.execute(
        `INSERT INTO notifications
         (user_id, title, message, notification_type, related_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          1, // Admin user ID (assuming admin has ID 1)
          'New Donation Received',
          `A new ${donation_type} donation of ${amount} has been received`,
          'donation',
          donationId
        ]
      );

      await sendEmail({
        email: req.user.email,
        subject: 'Thank You for Your Donation',
        html: `
          <h1>Thank You for Your Donation!</h1>
          <p>Dear ${req.user.first_name},</p>
          <p>Thank you for your generous donation of ${amount} to HopeConnect.</p>
          <p>Your contribution will make a real difference in the lives of orphaned children in Gaza.</p>
          <p>Donation Details:</p>
          <ul>
            <li>Amount: ${amount}</li>
            <li>Type: ${donation_type}</li>
            <li>Status: Pending</li>
          </ul>
          <p>You will receive updates on how your donation is being used.</p>
          <p>Thank you for your support!</p>
        `
      });

      res.status(201).json({
        success: true,
        data: donation[0]
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
};