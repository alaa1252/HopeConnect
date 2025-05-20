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

exports.getCampaign = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT ec.*, 
       o.name as orphanage_name, o.description as orphanage_description, o.image as orphanage_image,
       u.first_name as creator_first_name, u.last_name as creator_last_name,
       (SELECT COUNT(*) FROM donations WHERE campaign_id = ec.id) as donation_count
       FROM emergency_campaigns ec
       LEFT JOIN orphanages o ON ec.orphanage_id = o.id
       JOIN users u ON ec.created_by = u.id
       WHERE ec.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    const campaign = rows[0];
    const progressPercentage = (campaign.current_amount / campaign.target_amount) * 100;
    campaign.progress_percentage = Math.min(100, Math.round(progressPercentage));

    const [recentDonations] = await pool.execute(
      `SELECT d.id, d.amount, d.created_at, d.is_anonymous,
       IF(d.is_anonymous = 1, 'Anonymous Donor', CONCAT(u.first_name, ' ', u.last_name)) as donor_name
       FROM donations d
       LEFT JOIN users u ON d.donor_id = u.id
       WHERE d.campaign_id = ? AND d.status = 'completed'
       ORDER BY d.created_at DESC
       LIMIT 5`,
      [req.params.id]
    );

    const [donorStats] = await pool.execute(
      `SELECT COUNT(DISTINCT donor_id) as unique_donors,
       COUNT(*) as total_donations,
       MAX(amount) as largest_donation,
       AVG(amount) as average_donation
       FROM donations
       WHERE campaign_id = ? AND status = 'completed'`,
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      data: {
        ...campaign,
        recent_donations: recentDonations,
        donor_stats: donorStats[0]
      }
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

exports.updateCampaign = async (req, res, next) => {
  try {
    const {
      title,
      description,
      target_amount,
      start_date,
      end_date,
      status
    } = req.body;

    const [campaignRows] = await pool.execute(
      'SELECT * FROM emergency_campaigns WHERE id = ?',
      [req.params.id]
    );

    if (campaignRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    const campaign = campaignRows[0];

    if (req.user.role !== 'admin' && campaign.created_by !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this campaign'
      });
    }

    const fieldUpdates = [];
    const updateValues = [];

    if (title) {
      fieldUpdates.push('title = ?');
      updateValues.push(title);
    }
    if (description) {
      fieldUpdates.push('description = ?');
      updateValues.push(description);
    }
    if (target_amount && req.user.role === 'admin') {
      fieldUpdates.push('target_amount = ?');
      updateValues.push(target_amount);
    }
    if (start_date) {
      fieldUpdates.push('start_date = ?');
      updateValues.push(start_date);
    }
    if (end_date) {
      fieldUpdates.push('end_date = ?');
      updateValues.push(end_date);
    }
    if (status && req.user.role === 'admin') {
      fieldUpdates.push('status = ?');
      updateValues.push(status);
    }

    fieldUpdates.push('updated_at = NOW()');

    if (fieldUpdates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateValues.push(req.params.id);

    await pool.execute(
      `UPDATE emergency_campaigns
       SET ${fieldUpdates.join(', ')}
       WHERE id = ?`,
      updateValues
    );

    const [updatedCampaign] = await pool.execute(
      `SELECT ec.*, 
       o.name as orphanage_name,
       u.first_name as creator_first_name, u.last_name as creator_last_name
       FROM emergency_campaigns ec
       LEFT JOIN orphanages o ON ec.orphanage_id = o.id
       JOIN users u ON ec.created_by = u.id
       WHERE ec.id = ?`,
      [req.params.id]
    );

    const progressPercentage = (updatedCampaign[0].current_amount / updatedCampaign[0].target_amount) * 100;
    updatedCampaign[0].progress_percentage = Math.min(100, Math.round(progressPercentage));

    res.status(200).json({
      success: true,
      data: updatedCampaign[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.getCampaignDonations = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const [campaignRows] = await pool.execute(
      'SELECT id FROM emergency_campaigns WHERE id = ?',
      [req.params.id]
    );

    if (campaignRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    const [countRows] = await pool.execute(
      'SELECT COUNT(*) as total FROM donations WHERE campaign_id = ?',
      [req.params.id]
    );
    const total = countRows[0].total;

    const [rows] = await pool.execute(
      `SELECT d.*, 
       IF(d.is_anonymous = 1, 'Anonymous Donor', CONCAT(u.first_name, ' ', u.last_name)) as donor_name,
       IF(d.is_anonymous = 1, NULL, u.profile_image) as donor_image
       FROM donations d
       LEFT JOIN users u ON d.donor_id = u.id
       WHERE d.campaign_id = ?
       ORDER BY d.created_at DESC
       LIMIT ?, ?`,
      [req.params.id, startIndex, limit]
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

exports.getCampaignStats = async (req, res, next) => {
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
       COUNT(*) as total_campaigns,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_campaigns,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_campaigns,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_campaigns,
       SUM(target_amount) as total_target_amount,
       SUM(current_amount) as total_raised_amount,
       ROUND(SUM(current_amount) * 100 / NULLIF(SUM(target_amount), 0), 2) as overall_progress_percentage,
       AVG(target_amount) as average_target_amount,
       COUNT(DISTINCT orphanage_id) as orphanages_with_campaigns
       FROM emergency_campaigns
       ${whereClause}`,
      queryParams
    );

    const [successRateByMonth] = await pool.execute(
      `SELECT 
       DATE_FORMAT(created_at, '%Y-%m') as month,
       COUNT(*) as total_campaigns,
       SUM(CASE WHEN current_amount >= target_amount THEN 1 ELSE 0 END) as successful_campaigns,
       ROUND(SUM(CASE WHEN current_amount >= target_amount THEN 1 ELSE 0 END) * 100 / COUNT(*), 2) as success_rate,
       SUM(target_amount) as total_target_amount,
       SUM(current_amount) as total_raised_amount
       FROM emergency_campaigns
       ${whereClause}
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month`,
      queryParams
    );

    const [campaignsByStatus] = await pool.execute(
      `SELECT 
       status, COUNT(*) as count, 
       SUM(target_amount) as total_target_amount,
       SUM(current_amount) as total_raised_amount
       FROM emergency_campaigns
       ${whereClause}
       GROUP BY status`,
      queryParams
    );

    const [topCampaigns] = await pool.execute(
      `SELECT id, title, target_amount, current_amount, 
       ROUND(current_amount * 100 / target_amount, 2) as progress_percentage,
       (SELECT COUNT(*) FROM donations WHERE campaign_id = emergency_campaigns.id) as donation_count
       FROM emergency_campaigns
       ${whereClause}
       ORDER BY current_amount DESC
       LIMIT 5`,
      queryParams
    );

    const [averageDonation] = await pool.execute(
      `SELECT 
       ec.id, ec.title, 
       COUNT(d.id) as donation_count,
       AVG(d.amount) as average_donation_amount,
       MAX(d.amount) as largest_donation
       FROM emergency_campaigns ec
       JOIN donations d ON ec.id = d.campaign_id
       ${whereClause ? whereClause.replace('created_at', 'ec.created_at') : ''}
       GROUP BY ec.id
       ORDER BY average_donation_amount DESC
       LIMIT 5`,
      queryParams
    );

    res.status(200).json({
      success: true,
      data: {
        overall: overallStats[0],
        successRateByMonth,
        byStatus: campaignsByStatus,
        topCampaigns,
        topAverageDonation: averageDonation
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;