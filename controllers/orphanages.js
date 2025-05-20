const { pool } = require('../config/db');
const sendEmail = require('../utils/sendEmail');

exports.getOrphanages = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    const name = req.query.name;
    const location = req.query.location;
    const verificationStatus = req.query.verificationStatus;

    let conditions = [];
    let queryParams = [];

    if (name) {
      conditions.push('name LIKE ?');
      queryParams.push(`%${name}%`);
    }

    if (location) {
      conditions.push('location LIKE ?');
      queryParams.push(`%${location}%`);
    }

    if (verificationStatus) {
      conditions.push('verification_status = ?');
      queryParams.push(verificationStatus);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM orphanages ${whereClause}`,
      queryParams
    );
    const total = countRows[0].total;

    const paginationParams = [...queryParams];
    paginationParams.push(startIndex, limit);

    const [rows] = await pool.execute(
      `SELECT o.*, 
       u.first_name as contact_person_first_name, u.last_name as contact_person_last_name,
       (SELECT COUNT(*) FROM orphans WHERE orphanage_id = o.id) as orphan_count
       FROM orphanages o
       LEFT JOIN users u ON o.contact_person_id = u.id
       ${whereClause}
       ORDER BY o.name
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

exports.addReview = async (req, res, next) => {
  try {
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating is required and must be between 1 and 5'
      });
    }

    const [orphanageRows] = await pool.execute(
      'SELECT * FROM orphanages WHERE id = ?',
      [req.params.id]
    );

    if (orphanageRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Orphanage not found'
      });
    }

    const [existingReviewRows] = await pool.execute(
      'SELECT id FROM reviews WHERE user_id = ? AND orphanage_id = ?',
      [req.user.id, req.params.id]
    );

    if (existingReviewRows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this orphanage'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO reviews
       (user_id, orphanage_id, rating, comment)
       VALUES (?, ?, ?, ?)`,
      [req.user.id, req.params.id, rating, comment]
    );

    const [review] = await pool.execute(
      `SELECT r.*, u.first_name, u.last_name
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.id = ?`,
      [result.insertId]
    );

    if (orphanageRows[0].contact_person_id) {
      await pool.execute(
        `INSERT INTO notifications
         (user_id, title, message, notification_type, related_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          orphanageRows[0].contact_person_id,
          'New Orphanage Review',
          `Your orphanage "${orphanageRows[0].name}" has received a new ${rating}-star review`,
          'system',
          result.insertId
        ]
      );
    }

    res.status(201).json({
      success: true,
      data: review[0]
    });
  } catch (error) {
    next(error);
  }
};
