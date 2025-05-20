const { pool } = require('../config/db');
const sendEmail = require('../utils/sendEmail');

exports.getSponsorships = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    const status = req.query.status;
    const orphanId = req.query.orphanId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    let conditions = [];
    let queryParams = [];

    if (req.user.role !== 'admin') {
      conditions.push('sponsor_id = ?');
      queryParams.push(req.user.id);
    } else if (req.query.sponsorId) {
      conditions.push('sponsor_id = ?');
      queryParams.push(req.query.sponsorId);
    }

    if (status) {
      conditions.push('status = ?');
      queryParams.push(status);
    }

    if (orphanId) {
      conditions.push('orphan_id = ?');
      queryParams.push(orphanId);
    }

    if (startDate) {
      conditions.push('start_date >= ?');
      queryParams.push(startDate);
    }

    if (endDate) {
      conditions.push('end_date <= ?');
      queryParams.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM sponsorships ${whereClause}`,
      queryParams
    );
    const total = countRows[0].total;

    const paginationParams = [...queryParams];

    paginationParams.push(startIndex, limit);

    const [rows] = await pool.execute(
      `SELECT s.*, 
       u.first_name as sponsor_first_name, u.last_name as sponsor_last_name,
       o.first_name as orphan_first_name, o.last_name as orphan_last_name,
       o.profile_image as orphan_profile_image,
       og.name as orphanage_name
       FROM sponsorships s
       JOIN users u ON s.sponsor_id = u.id
       JOIN orphans o ON s.orphan_id = o.id
       LEFT JOIN orphanages og ON o.orphanage_id = og.id
       ${whereClause}
       ORDER BY s.created_at DESC
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

exports.getSponsorship = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT s.*, 
       u.first_name as sponsor_first_name, u.last_name as sponsor_last_name, u.email as sponsor_email,
       o.first_name as orphan_first_name, o.last_name as orphan_last_name,
       o.profile_image as orphan_profile_image, o.age, o.gender, o.story,
       og.name as orphanage_name
       FROM sponsorships s
       JOIN users u ON s.sponsor_id = u.id
       JOIN orphans o ON s.orphan_id = o.id
       LEFT JOIN orphanages og ON o.orphanage_id = og.id
       WHERE s.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sponsorship not found'
      });
    }

    if (req.user.role !== 'admin' && rows[0].sponsor_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this sponsorship'
      });
    }

    const [payments] = await pool.execute(
      `SELECT * FROM donations 
       WHERE donor_id = ? AND orphan_id = ? AND donation_type = 'sponsorship'
       ORDER BY created_at DESC
       LIMIT 10`,
      [rows[0].sponsor_id, rows[0].orphan_id]
    );

    const [updates] = await pool.execute(
      `SELECT * FROM orphan_updates
       WHERE orphan_id = ?
       ORDER BY created_at DESC
       LIMIT 5`,
      [rows[0].orphan_id]
    );

    res.status(200).json({
      success: true,
      data: {
        ...rows[0],
        recent_payments: payments,
        recent_updates: updates
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.createSponsorship = async (req, res, next) => {
  try {
    const {
      orphan_id,
      monthly_amount,
      payment_frequency,
      start_date = new Date().toISOString().split('T')[0]
    } = req.body;

    if (!orphan_id || !monthly_amount) {
      return res.status(400).json({
        success: false,
        message: 'Please provide orphan ID and monthly amount'
      });
    }

    const [orphanRows] = await pool.execute(
      'SELECT id, first_name, last_name, is_sponsored FROM orphans WHERE id = ?',
      [orphan_id]
    );

    if (orphanRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Orphan not found'
      });
    }

    if (orphanRows[0].is_sponsored) {
      const [activeSponsorships] = await pool.execute(
        'SELECT COUNT(*) as count FROM sponsorships WHERE orphan_id = ? AND status = "active"',
        [orphan_id]
      );

      if (activeSponsorships[0].count > 0) {
        return res.status(400).json({
          success: false,
          message: 'This orphan is already sponsored by someone else'
        });
      }
    }

    let nextPaymentDate = new Date(start_date);
    switch (payment_frequency || 'monthly') {
      case 'monthly':
        nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
        break;
      case 'quarterly':
        nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 3);
        break;
      case 'annually':
        nextPaymentDate.setFullYear(nextPaymentDate.getFullYear() + 1);
        break;
    }

    const [result] = await pool.execute(
      `INSERT INTO sponsorships
       (sponsor_id, orphan_id, monthly_amount, start_date, payment_frequency, 
        last_payment_date, next_payment_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        orphan_id,
        monthly_amount,
        start_date,
        payment_frequency || 'monthly',
        start_date,
        nextPaymentDate.toISOString().split('T')[0]
      ]
    );

    await pool.execute(
      'UPDATE orphans SET is_sponsored = TRUE WHERE id = ?',
      [orphan_id]
    );

    const [sponsorship] = await pool.execute(
      `SELECT s.*, 
       u.first_name as sponsor_first_name, u.last_name as sponsor_last_name,
       o.first_name as orphan_first_name, o.last_name as orphan_last_name,
       o.profile_image as orphan_profile_image
       FROM sponsorships s
       JOIN users u ON s.sponsor_id = u.id
       JOIN orphans o ON s.orphan_id = o.id
       WHERE s.id = ?`,
      [result.insertId]
    );

    await pool.execute(
      `INSERT INTO notifications
       (user_id, title, message, notification_type, related_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        1,
        'New Sponsorship Started',
        `A new sponsorship has been started for ${orphanRows[0].first_name} ${orphanRows[0].last_name}`,
        'sponsorship',
        result.insertId
      ]
    );

    await pool.execute(
      `INSERT INTO donations
       (donor_id, amount, donation_type, category, status, orphan_id, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        monthly_amount,
        'general',
        'monetary',
        'completed',
        orphan_id,
        'First sponsorship payment'
      ]
    );

    res.status(201).json({
      success: true,
      data: sponsorship[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.updateSponsorshipStatus = async (req, res, next) => {
  try {
    const { status, reason } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Please provide status'
      });
    }

    const validStatuses = ['active', 'paused', 'terminated'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be active, paused, or terminated'
      });
    }

    const [sponsorshipRows] = await pool.execute(
      `SELECT s.*, o.first_name, o.last_name, u.email, u.first_name as sponsor_first_name
       FROM sponsorships s
       JOIN orphans o ON s.orphan_id = o.id
       JOIN users u ON s.sponsor_id = u.id
       WHERE s.id = ?`,
      [req.params.id]
    );

    if (sponsorshipRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sponsorship not found'
      });
    }

    const sponsorship = sponsorshipRows[0];

    if (req.user.role !== 'admin' && sponsorship.sponsor_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this sponsorship'
      });
    }

    await pool.execute(
      'UPDATE sponsorships SET status = ?, end_reason = ?, updated_at = NOW() WHERE id = ?',
      [status, reason || null, req.params.id]
    );

    if (status === 'terminated') {
      await pool.execute(
        'UPDATE orphans SET is_sponsored = FALSE WHERE id = ?',
        [sponsorship.orphan_id]
      );

      await pool.execute(
        `INSERT INTO notifications
         (user_id, title, message, notification_type, related_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          1, // Admin user ID (assuming admin has ID 1)
          'Sponsorship Terminated',
          `Sponsorship for ${sponsorship.first_name} ${sponsorship.last_name} has been terminated`,
          'sponsorship',
          req.params.id
        ]
      );

      try {
        await sendEmail({
          email: sponsorship.email,
          subject: 'Sponsorship Terminated',
          html: `
            <h1>Sponsorship Terminated</h1>
            <p>Dear ${sponsorship.sponsor_first_name},</p>
            <p>Your sponsorship for ${sponsorship.first_name} ${sponsorship.last_name} has been terminated.</p>
            ${reason ? `<p>Reason: ${reason}</p>` : ''}
            <p>We thank you for your support during the sponsorship period.</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send termination email:', emailError);
      }
    }

    const [updatedSponsorship] = await pool.execute(
      `SELECT s.*, 
       u.first_name as sponsor_first_name, u.last_name as sponsor_last_name,
       o.first_name as orphan_first_name, o.last_name as orphan_last_name,
       o.profile_image as orphan_profile_image
       FROM sponsorships s
       JOIN users u ON s.sponsor_id = u.id
       JOIN orphans o ON s.orphan_id = o.id
       WHERE s.id = ?`,
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      data: updatedSponsorship[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.processPayment = async (req, res, next) => {
  try {
    const { payment_method, transaction_id } = req.body;

    const [sponsorshipRows] = await pool.execute(
      `SELECT s.*, o.first_name, o.last_name, u.email, u.first_name as sponsor_first_name
       FROM sponsorships s
       JOIN orphans o ON s.orphan_id = o.id
       JOIN users u ON s.sponsor_id = u.id
       WHERE s.id = ?`,
      [req.params.id]
    );

    if (sponsorshipRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sponsorship not found'
      });
    }

    const sponsorship = sponsorshipRows[0];

    if (req.user.role !== 'admin' && sponsorship.sponsor_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to process payment for this sponsorship'
      });
    }

    if (sponsorship.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot process payment for inactive sponsorship'
      });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [paymentResult] = await connection.execute(
        `INSERT INTO donations
         (donor_id, amount, donation_type, category, status, payment_method, transaction_id, orphan_id, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sponsorship.sponsor_id,
          sponsorship.monthly_amount,
          'sponsorship',
          'monetary',
          'completed',
          payment_method || 'online',
          transaction_id || null,
          sponsorship.orphan_id,
          `Monthly sponsorship payment for ${sponsorship.first_name} ${sponsorship.last_name}`
        ]
      );

      let nextPaymentDate = new Date();
      switch (sponsorship.payment_frequency) {
        case 'monthly':
          nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
          break;
        case 'quarterly':
          nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 3);
          break;
        case 'annually':
          nextPaymentDate.setFullYear(nextPaymentDate.getFullYear() + 1);
          break;
      }

      await connection.execute(
        `UPDATE sponsorships
         SET last_payment_date = NOW(), next_payment_date = ?, payment_count = payment_count + 1,
             total_paid = total_paid + ?, updated_at = NOW()
         WHERE id = ?`,
        [
          nextPaymentDate.toISOString().split('T')[0],
          sponsorship.monthly_amount,
          req.params.id
        ]
      );

      await connection.commit();

      try {
        await sendEmail({
          email: sponsorship.email,
          subject: 'Sponsorship Payment Processed',
          html: `
            <h1>Sponsorship Payment Processed</h1>
            <p>Dear ${sponsorship.sponsor_first_name},</p>
            <p>Your sponsorship payment of ${sponsorship.monthly_amount} for ${sponsorship.first_name} ${sponsorship.last_name} has been processed successfully.</p>
            <p>Thank you for your continued support!</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send payment confirmation email:', emailError);
      }

      const [updatedSponsorship] = await pool.execute(
        `SELECT s.*, 
         u.first_name as sponsor_first_name, u.last_name as sponsor_last_name,
         o.first_name as orphan_first_name, o.last_name as orphan_last_name,
         o.profile_image as orphan_profile_image
         FROM sponsorships s
         JOIN users u ON s.sponsor_id = u.id
         JOIN orphans o ON s.orphan_id = o.id
         WHERE s.id = ?`,
        [req.params.id]
      );

      const [payment] = await pool.execute(
        'SELECT * FROM donations WHERE id = ?',
        [paymentResult.insertId]
      );

      res.status(200).json({
        success: true,
        data: {
          sponsorship: updatedSponsorship[0],
          payment: payment[0]
        }
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

exports.getSponsorshipStats = async (req, res, next) => {
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

    const [overallStats] = await pool.execute(
      `SELECT 
       COUNT(*) as total_sponsorships,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_sponsorships,
       SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused_sponsorships,
       SUM(CASE WHEN status = 'terminated' THEN 1 ELSE 0 END) as terminated_sponsorships,
       SUM(monthly_amount) as total_monthly_amount,
       SUM(total_paid) as total_amount_paid,
       AVG(monthly_amount) as average_monthly_amount,
       COUNT(DISTINCT sponsor_id) as unique_sponsors,
       COUNT(DISTINCT orphan_id) as sponsored_orphans
       FROM sponsorships
       ${whereClause}`,
      queryParams
    );

    const [monthlyTrend] = await pool.execute(
      `SELECT 
       DATE_FORMAT(created_at, '%Y-%m') as month,
       COUNT(*) as new_sponsorships,
       SUM(monthly_amount) as new_monthly_commitments
       FROM sponsorships
       ${whereClause}
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month`,
      queryParams
    );

    const [frequencyStats] = await pool.execute(
      `SELECT 
       payment_frequency, COUNT(*) as count, SUM(monthly_amount) as total_monthly_amount
       FROM sponsorships
       ${whereClause}
       GROUP BY payment_frequency`,
      queryParams
    );

    const [topSponsors] = await pool.execute(
      `SELECT 
       s.sponsor_id, u.first_name, u.last_name, 
       COUNT(*) as sponsorship_count, SUM(s.monthly_amount) as total_monthly_amount,
       SUM(s.total_paid) as total_amount_paid
       FROM sponsorships s
       JOIN users u ON s.sponsor_id = u.id
       ${whereClause}
       GROUP BY s.sponsor_id
       ORDER BY total_monthly_amount DESC
       LIMIT 10`,
      queryParams
    );

    const [retentionRate] = await pool.execute(
      `SELECT 
       ROUND(
         (COUNT(CASE WHEN DATEDIFF(NOW(), created_at) >= 365 AND status = 'active' THEN 1 END) * 100.0) /
         NULLIF(COUNT(CASE WHEN DATEDIFF(NOW(), created_at) >= 365 THEN 1 END), 0),
         2
       ) as one_year_retention_rate,
       ROUND(
         (COUNT(CASE WHEN DATEDIFF(NOW(), created_at) >= 180 AND status = 'active' THEN 1 END) * 100.0) /
         NULLIF(COUNT(CASE WHEN DATEDIFF(NOW(), created_at) >= 180 THEN 1 END), 0),
         2
       ) as six_month_retention_rate
       FROM sponsorships`,
      []
    );

    res.status(200).json({
      success: true,
      data: {
        overall: overallStats[0],
        monthlyTrend,
        byFrequency: frequencyStats,
        topSponsors,
        retentionRate: retentionRate[0]
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;