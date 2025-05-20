const { pool } = require('../config/db');
const sendEmail = require('../utils/sendEmail');

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

exports.getDonation = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT d.*, 
       u.first_name as donor_first_name, u.last_name as donor_last_name,
       o.first_name as orphan_first_name, o.last_name as orphan_last_name,
       og.name as orphanage_name,
       ec.title as campaign_title,
       dt.status as delivery_status, dt.pickup_address, dt.delivery_address,
       dt.pickup_date, dt.delivery_date
       FROM donations d
       LEFT JOIN users u ON d.donor_id = u.id
       LEFT JOIN orphans o ON d.orphan_id = o.id
       LEFT JOIN orphanages og ON d.orphanage_id = og.id
       LEFT JOIN emergency_campaigns ec ON d.campaign_id = ec.id
       LEFT JOIN delivery_tracking dt ON d.id = dt.donation_id
       WHERE d.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Donation not found'
      });
    }

    // Check if user is admin or the donor
    if (req.user.role !== 'admin' && rows[0].donor_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this donation'
      });
    }

    res.status(200).json({
      success: true,
      data: rows[0]
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

exports.updateDonationStatus = async (req, res, next) => {
  try {
    const { status, admin_note } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Please provide status'
      });
    }

    const validStatuses = ['pending', 'verified', 'completed', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be pending, verified, completed, or rejected'
      });
    }

    const [donationRows] = await pool.execute(
      'SELECT * FROM donations WHERE id = ?',
      [req.params.id]
    );

    if (donationRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Donation not found'
      });
    }

    const donation = donationRows[0];

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      await connection.execute(
        'UPDATE donations SET status = ?, admin_note = ?, updated_at = NOW() WHERE id = ?',
        [status, admin_note, req.params.id]
      );

      // If a donation is rejected, remove its amount from the campaign
      if (status === 'rejected' && donation.campaign_id && donation.status !== 'rejected') {
        await connection.execute(
          'UPDATE emergency_campaigns SET current_amount = current_amount - ? WHERE id = ?',
          [parseFloat(donation.amount), donation.campaign_id]
        );
      }

      await connection.commit();

      // Notify the donor about status change
      const [userRow] = await pool.execute(
        'SELECT email, first_name FROM users WHERE id = ?',
        [donation.donor_id]
      );

      if (userRow.length > 0) {
        await pool.execute(
          `INSERT INTO notifications
           (user_id, title, message, notification_type, related_id)
           VALUES (?, ?, ?, ?, ?)`,
          [
            donation.donor_id,
            `Donation ${status.charAt(0).toUpperCase() + status.slice(1)}`,
            `Your donation of ${donation.amount} has been ${status}`,
            'donation',
            req.params.id
          ]
        );

        try {
          await sendEmail({
            email: userRow[0].email,
            subject: `Donation ${status.charAt(0).toUpperCase() + status.slice(1)}`,
            html: `
              <h1>Donation ${status.charAt(0).toUpperCase() + status.slice(1)}</h1>
              <p>Dear ${userRow[0].first_name},</p>
              <p>Your donation of ${donation.amount} has been ${status}.</p>
              ${admin_note ? `<p>Note: ${admin_note}</p>` : ''}
              <p>Thank you for your support!</p>
            `
          });
        } catch (emailError) {
          console.error('Failed to send status update email:', emailError);
        }
      }

      const [updatedDonation] = await pool.execute(
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
        [req.params.id]
      );

      res.status(200).json({
        success: true,
        data: updatedDonation[0]
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

exports.uploadDonationReceipt = async (req, res, next) => {
  try {
    const [donationRows] = await pool.execute(
      'SELECT * FROM donations WHERE id = ?',
      [req.params.id]
    );

    if (donationRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Donation not found'
      });
    }

    // Check if user is the donor
    if (donationRows[0].donor_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to upload receipt for this donation'
      });
    }

    // Simplified receipt upload without file handling
    const { receipt_url } = req.body;
    
    if (!receipt_url) {
      return res.status(400).json({
        success: false,
        message: 'Please provide receipt URL'
      });
    }

    await pool.execute(
      'UPDATE donations SET receipt_image = ?, updated_at = NOW() WHERE id = ?',
      [receipt_url, req.params.id]
    );

    const [updatedDonation] = await pool.execute(
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
      [req.params.id]
    );

    // Notify admins about new receipt upload
    await pool.execute(
      `INSERT INTO notifications
       (user_id, title, message, notification_type, related_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        1, // Admin user ID (assuming admin has ID 1)
        'Receipt Uploaded',
        `A receipt has been uploaded for donation ID ${req.params.id}`,
        'donation',
        req.params.id
      ]
    );

    res.status(200).json({
      success: true,
      data: updatedDonation[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.getDonationStats = async (req, res, next) => {
  try {
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const dateFilter = [];
    const queryParams = [];

    if (startDate) {
      dateFilter.push('created_at >= ?');
      queryParams.push(startDate);
    }

    if (endDate) {
      dateFilter.push('created_at <= ?');
      queryParams.push(endDate);
    }

    const whereClause = dateFilter.length > 0 ? `WHERE ${dateFilter.join(' AND ')}` : '';

    // Total donations by type and status
    const [totalByTypeAndStatus] = await pool.execute(
      `SELECT 
       donation_type, status, COUNT(*) as count, SUM(amount) as total_amount
       FROM donations
       ${whereClause}
       GROUP BY donation_type, status`,
      queryParams
    );

    // Monthly donations trend
    const [monthlyTrend] = await pool.execute(
      `SELECT 
       DATE_FORMAT(created_at, '%Y-%m') as month,
       COUNT(*) as count,
       SUM(amount) as total_amount
       FROM donations
       ${whereClause}
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month`,
      queryParams
    );

    // Donations by category
    const [byCategory] = await pool.execute(
      `SELECT 
       category, COUNT(*) as count, SUM(amount) as total_amount
       FROM donations
       ${whereClause}
       GROUP BY category`,
      queryParams
    );

    // Top donors
    const [topDonors] = await pool.execute(
      `SELECT 
       d.donor_id, u.first_name, u.last_name, 
       COUNT(*) as donation_count, SUM(d.amount) as total_amount
       FROM donations d
       JOIN users u ON d.donor_id = u.id
       ${whereClause}
       GROUP BY d.donor_id
       ORDER BY total_amount DESC
       LIMIT 10`,
      queryParams
    );

    // Top campaigns
    const [topCampaigns] = await pool.execute(
      `SELECT 
       d.campaign_id, ec.title, 
       COUNT(*) as donation_count, SUM(d.amount) as total_amount
       FROM donations d
       JOIN emergency_campaigns ec ON d.campaign_id = ec.id
       ${whereClause} AND d.campaign_id IS NOT NULL
       GROUP BY d.campaign_id
       ORDER BY total_amount DESC
       LIMIT 10`,
      queryParams
    );

    // Overall summary
    const [overallSummary] = await pool.execute(
      `SELECT 
       COUNT(*) as total_donations,
       SUM(amount) as total_amount,
       AVG(amount) as average_amount,
       COUNT(DISTINCT donor_id) as unique_donors
       FROM donations
       ${whereClause}`,
      queryParams
    );

    res.status(200).json({
      success: true,
      data: {
        overallSummary: overallSummary[0],
        byTypeAndStatus: totalByTypeAndStatus,
        monthlyTrend: monthlyTrend,
        byCategory: byCategory,
        topDonors: topDonors,
        topCampaigns: topCampaigns
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;