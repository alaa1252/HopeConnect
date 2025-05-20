const { pool } = require('../config/db');
const sendEmail = require('../utils/sendEmail');

exports.getCampaigns = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const status = req.query.status;
    const orphanageId = req.query.orphanageId;
    const minTarget = req.query.minTarget;
    const maxTarget = req.query.maxTarget;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    let conditions = [];
    let queryParams = [];

    if (status) {
      conditions.push('status = ?');
      queryParams.push(status);
    }

    if (orphanageId) {
      conditions.push('orphanage_id = ?');
      queryParams.push(orphanageId);
    }

    if (minTarget) {
      conditions.push('target_amount >= ?');
      queryParams.push(parseFloat(minTarget));
    }

    if (maxTarget) {
      conditions.push('target_amount <= ?');
      queryParams.push(parseFloat(maxTarget));
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
      `SELECT COUNT(*) as total FROM emergency_campaigns ${whereClause}`,
      queryParams
    );
    const total = countRows[0].total;

    const paginationParams = [...queryParams, startIndex, limit];

    const [rows] = await pool.execute(
      `SELECT ec.*, 
       o.name as orphanage_name,
       u.first_name as creator_first_name, u.last_name as creator_last_name,
       (SELECT COUNT(*) FROM donations WHERE campaign_id = ec.id) as donation_count
       FROM emergency_campaigns ec
       LEFT JOIN orphanages o ON ec.orphanage_id = o.id
       JOIN users u ON ec.created_by = u.id
       ${whereClause}
       ORDER BY ec.created_at DESC
       LIMIT ?, ?`,
      paginationParams
    );

    const campaigns = rows.map(campaign => {
      const progressPercentage = (campaign.current_amount / campaign.target_amount) * 100;
      return {
        ...campaign,
        progress_percentage: Math.min(100, Math.round(progressPercentage))
      };
    });

    const pagination = {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };

    res.status(200).json({
      success: true,
      pagination,
      data: campaigns
    });
  } catch (error) {
    next(error);
  }
};

exports.createCampaign = async (req, res, next) => {
  try {
    const {
      title,
      description,
      target_amount,
      start_date,
      end_date,
      orphanage_id
    } = req.body;

    if (!title || !description || !target_amount || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
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

    const [result] = await pool.execute(
      `INSERT INTO emergency_campaigns
       (title, description, target_amount, current_amount, start_date, end_date, 
        orphanage_id, created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        description,
        target_amount,
        0,
        start_date,
        end_date,
        orphanage_id,
        req.user.id,
        'active'
      ]
    );

    const [campaign] = await pool.execute(
      `SELECT ec.*, o.name as orphanage_name
       FROM emergency_campaigns ec
       LEFT JOIN orphanages o ON ec.orphanage_id = o.id
       WHERE ec.id = ?`,
      [result.insertId]
    );

    const [donorRows] = await pool.execute(
      `SELECT DISTINCT u.id, u.email, u.first_name
       FROM users u
       JOIN donations d ON u.id = d.donor_id
       WHERE d.status = 'completed'
       LIMIT 100`
    );

    for (const donor of donorRows) {
      await pool.execute(
        `INSERT INTO notifications
         (user_id, title, message, notification_type, related_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          donor.id,
          'New Emergency Campaign',
          `A new emergency campaign "${title}" has been launched`,
          'campaign',
          result.insertId
        ]
      );

      try {
        await sendEmail({
          email: donor.email,
          subject: 'New Emergency Campaign Launched',
          html: `
            <h1>New Emergency Campaign</h1>
            <p>Dear ${donor.first_name},</p>
            <p>A new emergency campaign has been launched on HopeConnect:</p>
            <h2>${title}</h2>
            <p>${description}</p>
            <p><strong>Target:</strong> ${target_amount}</p>
            <p><strong>End Date:</strong> ${end_date}</p>
            <p>Your support can make a difference in the lives of children in need.</p>
            <p>Visit the platform to learn more and contribute if you can.</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send email notification:', emailError);
      }
    }

    res.status(201).json({
      success: true,
      data: campaign[0]
    });
  } catch (error) {
    next(error);
  }
};
