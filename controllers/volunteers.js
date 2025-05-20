const { pool } = require('../config/db');
const sendEmail = require('../utils/sendEmail');

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

exports.getOpportunity = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT vo.*, 
       o.name as orphanage_name, o.location as orphanage_location, o.description as orphanage_description,
       o.image as orphanage_image,
       (SELECT COUNT(*) FROM volunteer_applications va WHERE va.opportunity_id = vo.id) as application_count
       FROM volunteer_opportunities vo
       JOIN orphanages o ON vo.orphanage_id = o.id
       WHERE vo.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Volunteer opportunity not found'
      });
    }

    let userHasApplied = false;
    if (req.user) {
      const [applicationRows] = await pool.execute(
        'SELECT id FROM volunteer_applications WHERE volunteer_id = ? AND opportunity_id = ?',
        [req.user.id, req.params.id]
      );
      userHasApplied = applicationRows.length > 0;
    }

    res.status(200).json({
      success: true,
      data: {
        ...rows[0],
        user_has_applied: userHasApplied
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.createOpportunity = async (req, res, next) => {
  try {
    const {
      title,
      description,
      responsibilities,
      required_skills,
      preferred_skills,
      commitment_hours,
      start_date,
      end_date,
      orphanage_id,
      location,
      is_remote,
      status = 'open'
    } = req.body;

    if (!title || !description || !orphanage_id) {
      return res.status(400).json({
        success: false,
        message: 'Please provide title, description, and orphanage ID'
      });
    }

    if (req.user.role !== 'admin') {
      const [orphanageRows] = await pool.execute(
        'SELECT id FROM orphanages WHERE id = ? AND contact_person_id = ?',
        [orphanage_id, req.user.id]
      );

      if (orphanageRows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to create opportunities for this orphanage'
        });
      }
    }

    const [result] = await pool.execute(
      `INSERT INTO volunteer_opportunities
       (title, description, responsibilities, required_skills, preferred_skills, 
        commitment_hours, start_date, end_date, orphanage_id, location, is_remote, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        description,
        responsibilities,
        required_skills,
        preferred_skills,
        commitment_hours,
        start_date,
        end_date,
        orphanage_id,
        location,
        is_remote || false,
        status
      ]
    );

    const [opportunity] = await pool.execute(
      `SELECT vo.*, 
       o.name as orphanage_name, o.location as orphanage_location
       FROM volunteer_opportunities vo
       JOIN orphanages o ON vo.orphanage_id = o.id
       WHERE vo.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: opportunity[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.updateOpportunity = async (req, res, next) => {
  try {
    const {
      title,
      description,
      responsibilities,
      required_skills,
      preferred_skills,
      commitment_hours,
      start_date,
      end_date,
      location,
      is_remote,
      status
    } = req.body;

    const [opportunityRows] = await pool.execute(
      'SELECT * FROM volunteer_opportunities WHERE id = ?',
      [req.params.id]
    );

    if (opportunityRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Volunteer opportunity not found'
      });
    }

    const opportunityData = opportunityRows[0];

    if (req.user.role !== 'admin') {
      const [orphanageRows] = await pool.execute(
        'SELECT id FROM orphanages WHERE id = ? AND contact_person_id = ?',
        [opportunityData.orphanage_id, req.user.id]
      );

      if (orphanageRows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to update opportunities for this orphanage'
        });
      }
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
    if (responsibilities) {
      fieldUpdates.push('responsibilities = ?');
      updateValues.push(responsibilities);
    }
    if (required_skills) {
      fieldUpdates.push('required_skills = ?');
      updateValues.push(required_skills);
    }
    if (preferred_skills) {
      fieldUpdates.push('preferred_skills = ?');
      updateValues.push(preferred_skills);
    }
    if (commitment_hours) {
      fieldUpdates.push('commitment_hours = ?');
      updateValues.push(commitment_hours);
    }
    if (start_date) {
      fieldUpdates.push('start_date = ?');
      updateValues.push(start_date);
    }
    if (end_date) {
      fieldUpdates.push('end_date = ?');
      updateValues.push(end_date);
    }
    if (location) {
      fieldUpdates.push('location = ?');
      updateValues.push(location);
    }
    if (is_remote !== undefined) {
      fieldUpdates.push('is_remote = ?');
      updateValues.push(is_remote);
    }
    if (status) {
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
      `UPDATE volunteer_opportunities
       SET ${fieldUpdates.join(', ')}
       WHERE id = ?`,
      updateValues
    );

    const [updatedOpportunity] = await pool.execute(
      `SELECT vo.*, 
       o.name as orphanage_name, o.location as orphanage_location
       FROM volunteer_opportunities vo
       JOIN orphanages o ON vo.orphanage_id = o.id
       WHERE vo.id = ?`,
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      data: updatedOpportunity[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteOpportunity = async (req, res, next) => {
  try {
    const [opportunityRows] = await pool.execute(
      'SELECT * FROM volunteer_opportunities WHERE id = ?',
      [req.params.id]
    );

    if (opportunityRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Volunteer opportunity not found'
      });
    }

    const opportunityData = opportunityRows[0];

    if (req.user.role !== 'admin') {
      const [orphanageRows] = await pool.execute(
        'SELECT id FROM orphanages WHERE id = ? AND contact_person_id = ?',
        [opportunityData.orphanage_id, req.user.id]
      );

      if (orphanageRows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to delete opportunities for this orphanage'
        });
      }
    }

    const [applicationsRows] = await pool.execute(
      'SELECT id FROM volunteer_applications WHERE opportunity_id = ?',
      [req.params.id]
    );

    if (applicationsRows.length > 0) {
      await pool.execute(
        'UPDATE volunteer_opportunities SET status = "closed", updated_at = NOW() WHERE id = ?',
        [req.params.id]
      );

      res.status(200).json({
        success: true,
        message: 'Opportunity has applications and has been closed instead of deleted'
      });
    } else {
      await pool.execute(
        'DELETE FROM volunteer_opportunities WHERE id = ?',
        [req.params.id]
      );

      res.status(200).json({
        success: true,
        message: 'Opportunity deleted successfully'
      });
    }
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

exports.uploadResume = async (req, res, next) => {
  try {
    const { resume_url } = req.body;

    if (!resume_url) {
      return res.status(400).json({
        success: false,
        message: 'Please provide resume URL'
      });
    }

    const [applicationRows] = await pool.execute(
      'SELECT * FROM volunteer_applications WHERE id = ?',
      [req.params.id]
    );

    if (applicationRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    if (applicationRows[0].volunteer_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this application'
      });
    }

    await pool.execute(
      'UPDATE volunteer_applications SET resume = ?, updated_at = NOW() WHERE id = ?',
      [resume_url, req.params.id]
    );

    const [updatedApplication] = await pool.execute(
      'SELECT * FROM volunteer_applications WHERE id = ?',
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      data: updatedApplication[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.getApplications = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    const status = req.query.status;

    const [opportunityRows] = await pool.execute(
      'SELECT * FROM volunteer_opportunities WHERE id = ?',
      [req.params.id]
    );

    if (opportunityRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Volunteer opportunity not found'
      });
    }

    if (req.user.role !== 'admin') {
      const [orphanageRows] = await pool.execute(
        'SELECT id FROM orphanages WHERE id = ? AND contact_person_id = ?',
        [opportunityRows[0].orphanage_id, req.user.id]
      );

      if (orphanageRows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to view applications for this opportunity'
        });
      }
    }

    let conditions = ['va.opportunity_id = ?'];
    let queryParams = [req.params.id];

    if (status) {
      conditions.push('va.status = ?');
      queryParams.push(status);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM volunteer_applications va ${whereClause}`,
      queryParams
    );
    const total = countRows[0].total;

    const paginationParams = [...queryParams];
    paginationParams.push(startIndex, limit);

    const [rows] = await pool.execute(
      `SELECT va.*, 
       u.first_name, u.last_name, u.email, u.phone, u.profile_image
       FROM volunteer_applications va
       JOIN users u ON va.volunteer_id = u.id
       ${whereClause}
       ORDER BY va.created_at DESC
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

exports.updateApplicationStatus = async (req, res, next) => {
  try {
    const { status, feedback } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Please provide status'
      });
    }

    const validStatuses = ['pending', 'approved', 'rejected', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be pending, approved, rejected, or completed'
      });
    }

    const [applicationRows] = await pool.execute(
      `SELECT va.*, vo.title, vo.orphanage_id, u.email, u.first_name, o.name as orphanage_name
       FROM volunteer_applications va
       JOIN volunteer_opportunities vo ON va.opportunity_id = vo.id
       JOIN users u ON va.volunteer_id = u.id
       JOIN orphanages o ON vo.orphanage_id = o.id
       WHERE va.id = ?`,
      [req.params.id]
    );

    if (applicationRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    const application = applicationRows[0];

    if (req.user.role !== 'admin') {
      const [orphanageRows] = await pool.execute(
        'SELECT id FROM orphanages WHERE id = ? AND contact_person_id = ?',
        [application.orphanage_id, req.user.id]
      );

      if (orphanageRows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to update applications for this opportunity'
        });
      }
    }

    await pool.execute(
      'UPDATE volunteer_applications SET status = ?, feedback = ?, updated_at = NOW() WHERE id = ?',
      [status, feedback, req.params.id]
    );

    if (status === 'approved' || status === 'rejected') {
      try {
        await sendEmail({
          email: application.email,
          subject: `Volunteer Application ${status.charAt(0).toUpperCase() + status.slice(1)}`,
          html: `
            <h1>Your Application Has Been ${status.charAt(0).toUpperCase() + status.slice(1)}</h1>
            <p>Dear ${application.first_name},</p>
            <p>Your application for the volunteer opportunity "${application.title}" at ${application.orphanage_name} has been ${status}.</p>
            ${status === 'approved' ? '<p>The orphanage will contact you with further details.</p>' : ''}
            ${feedback ? `<p>Feedback: ${feedback}</p>` : ''}
            <p>Thank you for your interest in helping the children.</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send application status email:', emailError);
      }

      await pool.execute(
        `INSERT INTO notifications
         (user_id, title, message, notification_type, related_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          application.volunteer_id,
          `Volunteer Application ${status.charAt(0).toUpperCase() + status.slice(1)}`,
          `Your application for "${application.title}" has been ${status}`,
          'volunteer',
          req.params.id
        ]
      );
    }

    const [updatedApplication] = await pool.execute(
      `SELECT va.*, 
       u.first_name, u.last_name, u.email, u.phone
       FROM volunteer_applications va
       JOIN users u ON va.volunteer_id = u.id
       WHERE va.id = ?`,
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      data: updatedApplication[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.getVolunteerStats = async (req, res, next) => {
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

    const opportunityWhereClause = dateFilter.length > 0 ? `WHERE ${dateFilter.join(' AND ')}` : '';
    const applicationWhereClause = dateFilter.length > 0 ? `WHERE ${dateFilter.join(' AND ')}` : '';

    const [opportunityStats] = await pool.execute(
      `SELECT 
       COUNT(*) as total_opportunities,
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_opportunities,
       SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_opportunities,
       SUM(CASE WHEN status = 'filled' THEN 1 ELSE 0 END) as filled_opportunities,
       AVG(commitment_hours) as average_commitment_hours,
       SUM(CASE WHEN is_remote = TRUE THEN 1 ELSE 0 END) as remote_opportunities,
       COUNT(DISTINCT orphanage_id) as orphanages_with_opportunities
       FROM volunteer_opportunities
       ${opportunityWhereClause}`,
      queryParams
    );

    const [applicationStats] = await pool.execute(
      `SELECT 
       COUNT(*) as total_applications,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_applications,
       SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_applications,
       SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_applications,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_applications,
       COUNT(DISTINCT volunteer_id) as unique_volunteers,
       COUNT(DISTINCT opportunity_id) as opportunities_with_applications
       FROM volunteer_applications
       ${applicationWhereClause}`,
      queryParams
    );

    const [monthlyTrend] = await pool.execute(
      `SELECT 
       DATE_FORMAT(created_at, '%Y-%m') as month,
       COUNT(*) as new_opportunities,
       (SELECT COUNT(*) FROM volunteer_applications 
        WHERE DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(vo.created_at, '%Y-%m')) as applications
       FROM volunteer_opportunities vo
       ${opportunityWhereClause}
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month`,
      queryParams
    );

    const [topSkills] = await pool.execute(
      `SELECT 
       SUBSTRING_INDEX(SUBSTRING_INDEX(CONCAT(required_skills, ',', preferred_skills), ',', n.n), ',', -1) as skill,
       COUNT(*) as count
       FROM volunteer_opportunities vo
       CROSS JOIN (
         SELECT a.N + b.N * 10 + 1 as n
         FROM 
           (SELECT 0 as N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a,
           (SELECT 0 as N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b
         LIMIT 100
       ) n
       WHERE n.n <= 1 + LENGTH(CONCAT(required_skills, ',', preferred_skills)) - LENGTH(REPLACE(CONCAT(required_skills, ',', preferred_skills), ',', ''))
       ${opportunityWhereClause ? 'AND ' + opportunityWhereClause.substring(6) : ''}
       GROUP BY skill
       ORDER BY count DESC
       LIMIT 10`,
      queryParams
    );

    const [topOrphanages] = await pool.execute(
      `SELECT 
       vo.orphanage_id, o.name as orphanage_name, 
       COUNT(vo.id) as opportunity_count,
       (SELECT COUNT(*) FROM volunteer_applications va
        WHERE va.opportunity_id IN (SELECT id FROM volunteer_opportunities WHERE orphanage_id = vo.orphanage_id)) as application_count
       FROM volunteer_opportunities vo
       JOIN orphanages o ON vo.orphanage_id = o.id
       ${opportunityWhereClause}
       GROUP BY vo.orphanage_id
       ORDER BY opportunity_count DESC
       LIMIT 10`,
      queryParams
    );

    res.status(200).json({
      success: true,
      data: {
        opportunities: opportunityStats[0],
        applications: applicationStats[0],
        monthlyTrend,
        topSkills,
        topOrphanages
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;