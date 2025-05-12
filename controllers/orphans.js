const { pool } = require('../config/db');

exports.getOrphans = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    const gender = req.query.gender;
    const isSponsored = req.query.isSponsored;
    const minAge = req.query.minAge;
    const maxAge = req.query.maxAge;
    const orphanageId = req.query.orphanageId;

    let conditions = [];
    let queryParams = [];

    if (gender) {
      conditions.push('gender = ?');
      queryParams.push(gender);
    }

    if (isSponsored !== undefined) {
      conditions.push('is_sponsored = ?');
      queryParams.push(isSponsored === 'true' ? 1 : 0);
    }

    if (minAge) {
      conditions.push('TIMESTAMPDIFF(YEAR, dob, CURDATE()) >= ?');
      queryParams.push(parseInt(minAge, 10));
    }

    if (maxAge) {
      conditions.push('TIMESTAMPDIFF(YEAR, dob, CURDATE()) <= ?');
      queryParams.push(parseInt(maxAge, 10));
    }

    if (orphanageId) {
      conditions.push('orphanage_id = ?');
      queryParams.push(parseInt(orphanageId, 10));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM orphans ${whereClause}`,
      queryParams
    );
    const total = countRows[0].total;

    const paginationParams = [...queryParams];
    paginationParams.push(startIndex, limit);

    const [rows] = await pool.execute(
      `SELECT o.id, o.first_name, o.last_name, o.dob, o.gender, 
       o.health_status, o.education_status, o.background_story, 
       o.is_sponsored, o.created_at, o.updated_at,
       og.name as orphanage_name
       FROM orphans o
       LEFT JOIN orphanages og ON o.orphanage_id = og.id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT ?, ?`,
      paginationParams
    );

    const orphans = rows.map(orphan => {
      const birthDate = new Date(orphan.dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      
      return {
        ...orphan,
        age
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
      data: orphans
    });
  } catch (error) {
    next(error);
  }
};

exports.getOrphan = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT o.id, o.first_name, o.last_name, o.dob, o.gender, 
       o.health_status, o.education_status, o.background_story, 
       o.is_sponsored, o.created_at, o.updated_at,
       og.name as orphanage_name, og.id as orphanage_id
       FROM orphans o
       LEFT JOIN orphanages og ON o.orphanage_id = og.id
       WHERE o.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Orphan not found'
      });
    }

    const orphan = rows[0];
    const birthDate = new Date(orphan.dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    const [sponsorships] = await pool.execute(
      `SELECT COUNT(*) as total FROM sponsorships 
       WHERE orphan_id = ? AND status = 'active'`,
      [req.params.id]
    );

    const hasActiveSponsorship = sponsorships[0].total > 0;

    const [updates] = await pool.execute(
      `SELECT id, update_type, title, description, created_at
       FROM orphan_updates
       WHERE orphan_id = ? ORDER BY created_at DESC LIMIT 5`,
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      data: {
        ...orphan,
        age,
        hasActiveSponsorship,
        updates
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.createOrphan = async (req, res, next) => {
  try {
    const {
      first_name,
      last_name,
      dob,
      gender,
      orphanage_id,
      health_status,
      education_status,
      background_story
    } = req.body;

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
      `INSERT INTO orphans 
       (first_name, last_name, dob, gender, orphanage_id, health_status, education_status, background_story)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [first_name, last_name, dob, gender, orphanage_id, health_status, education_status, background_story]
    );

    const [orphan] = await pool.execute(
      'SELECT * FROM orphans WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: orphan[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.updateOrphan = async (req, res, next) => {
  try {
    const {
      first_name,
      last_name,
      dob,
      gender,
      orphanage_id,
      health_status,
      education_status,
      background_story,
      is_sponsored
    } = req.body;

    const [orphanRows] = await pool.execute(
      'SELECT * FROM orphans WHERE id = ?',
      [req.params.id]
    );

    if (orphanRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Orphan not found'
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

    await pool.execute(
      `UPDATE orphans SET
       first_name = ?,
       last_name = ?,
       dob = ?,
       gender = ?,
       orphanage_id = ?,
       health_status = ?,
       education_status = ?,
       background_story = ?,
       is_sponsored = ?
       WHERE id = ?`,
      [
        first_name,
        last_name,
        dob,
        gender,
        orphanage_id,
        health_status,
        education_status,
        background_story,
        is_sponsored !== undefined ? is_sponsored : orphanRows[0].is_sponsored,
        req.params.id
      ]
    );

    const [updatedOrphan] = await pool.execute(
      'SELECT * FROM orphans WHERE id = ?',
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      data: updatedOrphan[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteOrphan = async (req, res, next) => {
  try {
    const [orphanRows] = await pool.execute(
      'SELECT * FROM orphans WHERE id = ?',
      [req.params.id]
    );

    if (orphanRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Orphan not found'
      });
    }

    const [sponsorships] = await pool.execute(
      'SELECT COUNT(*) as count FROM sponsorships WHERE orphan_id = ? AND status = "active"',
      [req.params.id]
    );

    if (sponsorships[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete orphan with active sponsorships'
      });
    }

    await pool.execute(
      'DELETE FROM orphans WHERE id = ?',
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      message: 'Orphan deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};