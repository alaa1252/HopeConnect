const { pool } = require('../config/db');

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