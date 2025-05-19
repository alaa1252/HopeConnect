const { pool } = require('../config/db');

exports.getOpportunities = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    const status = req.query.status;
    const orphanageId = req.query.orphanageId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const skills = req.query.skills;

    let conditions = [];
    let queryParams = [];

    if (status) {
      conditions.push('vo.status = ?');
      queryParams.push(status);
    } else {
      conditions.push('vo.status = "open"');
    }

    if (orphanageId) {
      conditions.push('vo.orphanage_id = ?');
      queryParams.push(orphanageId);
    }

    if (startDate) {
      conditions.push('vo.start_date >= ?');
      queryParams.push(startDate);
    }

    if (endDate) {
      conditions.push('(vo.end_date <= ? OR vo.end_date IS NULL)');
      queryParams.push(endDate);
    }

    if (skills) {
      conditions.push('vo.required_skills LIKE ?');
      queryParams.push(`%${skills}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM volunteer_opportunities vo ${whereClause}`,
      queryParams
    );
    const total = countRows[0].total;

    const paginationParams = [...queryParams];

    paginationParams.push(startIndex, limit);

    const [rows] = await pool.execute(
      `SELECT vo.*, 
       o.name as orphanage_name, o.location as orphanage_location,
       (SELECT COUNT(*) FROM volunteer_applications va WHERE va.opportunity_id = vo.id) as application_count
       FROM volunteer_opportunities vo
       JOIN orphanages o ON vo.orphanage_id = o.id
       ${whereClause}
       ORDER BY vo.created_at DESC
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

exports.applyForOpportunity = async (req, res, next) => {
  try {
    const { message } = req.body;

    if (req.user.role !== 'volunteer' && req.user.role !== 'donor') {
      return res.status(403).json({
        success: false,
        message: 'Only volunteers can apply for opportunities'
      });
    }

    const [opportunityRows] = await pool.execute(
      'SELECT * FROM volunteer_opportunities WHERE id = ? AND status = "open"',
      [req.params.id]
    );

    if (opportunityRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Volunteer opportunity not found or not open'
      });
    }

    const [existingApplicationRows] = await pool.execute(
      'SELECT id FROM volunteer_applications WHERE volunteer_id = ? AND opportunity_id = ?',
      [req.user.id, req.params.id]
    );

    if (existingApplicationRows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You have already applied for this opportunity'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO volunteer_applications
       (volunteer_id, opportunity_id, message, status)
       VALUES (?, ?, ?, ?)`,
      [req.user.id, req.params.id, message, 'pending']
    );

    const [orphanageRows] = await pool.execute(
      `SELECT o.contact_person_id, o.name as orphanage_name, vo.title
       FROM orphanages o
       JOIN volunteer_opportunities vo ON o.id = vo.orphanage_id
       WHERE vo.id = ?`,
      [req.params.id]
    );

    if (orphanageRows.length > 0 && orphanageRows[0].contact_person_id) {
      await pool.execute(
        `INSERT INTO notifications
         (user_id, title, message, notification_type, related_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          orphanageRows[0].contact_person_id,
          'New Volunteer Application',
          `${req.user.first_name} ${req.user.last_name} has applied for the "${orphanageRows[0].title}" opportunity`,
          'volunteer',
          result.insertId
        ]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      data: {
        id: result.insertId,
        status: 'pending',
        opportunity_id: req.params.id,
        created_at: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};