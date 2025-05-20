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

exports.getOrphanage = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT o.*,
        u.first_name as contact_person_first_name, u.last_name as contact_person_last_name,
        (SELECT COUNT(*) FROM orphans WHERE orphanage_id = o.id) as orphan_count,
        (SELECT AVG(rating) FROM reviews WHERE orphanage_id = o.id) as average_rating,
        (SELECT COUNT(*) FROM reviews WHERE orphanage_id = o.id) as review_count
        FROM orphanages o
        LEFT JOIN users u ON o.contact_person_id = u.id
        WHERE o.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Orphanage not found'
      });
    }

    await pool.execute(
      'UPDATE orphanages SET view_count = view_count + 1 WHERE id = ?',
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      data: rows[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.createOrphanage = async (req, res, next) => {
  try {
    const {
      name,
      description,
      address,
      city,
      country,
      postal_code,
      phone,
      email,
      website,
      year_established,
      contact_person_id,
      location,
      verification_status
    } = req.body;

    if (!name || !description || !address || !city || !country) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, description, address, city, and country'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO orphanages
        (name, description, address, city, country, postal_code, phone, email, website, 
        year_established, contact_person_id, location, verification_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        name,
        description,
        address,
        city,
        country,
        postal_code || null,
        phone || null,
        email || null,
        website || null,
        year_established || null,
        contact_person_id || null,
        location || null,
        verification_status || 'pending'
      ]
    );

    const [orphanage] = await pool.execute(
      'SELECT * FROM orphanages WHERE id = ?',
      [result.insertId]
    );

    const [admins] = await pool.execute(
      'SELECT id, email FROM users WHERE role = "admin"'
    );

    for (const admin of admins) {
      try {
        await pool.execute(
          `INSERT INTO notifications
            (user_id, title, message, notification_type, related_id)
            VALUES (?, ?, ?, ?, ?)`,
          [
            admin.id,
            'New Orphanage Added',
            `A new orphanage "${name}" has been added and requires verification`,
            'system',
            result.insertId
          ]
        );

        await sendEmail({
          email: admin.email,
          subject: 'New Orphanage Requires Verification',
          message: `A new orphanage "${name}" has been added to the platform and requires verification.`
        });
      } catch (emailError) {
        console.error(`Failed to notify admin ${admin.id}:`, emailError);
      }
    }

    res.status(201).json({
      success: true,
      data: orphanage[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.updateOrphanage = async (req, res, next) => {
  try {
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

    if (
      req.user.role !== 'admin' &&
      orphanageRows[0].contact_person_id !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this orphanage'
      });
    }

    const {
      name,
      description,
      address,
      city,
      country,
      postal_code,
      phone,
      email,
      website,
      year_established,
      contact_person_id,
      location,
      verification_status
    } = req.body;

    let finalVerificationStatus = orphanageRows[0].verification_status;
    if (req.user.role === 'admin' && verification_status) {
      finalVerificationStatus = verification_status;
    }

    const fieldUpdates = [];
    const updateValues = [];

    if (name) {
      fieldUpdates.push('name = ?');
      updateValues.push(name);
    }
    if (description) {
      fieldUpdates.push('description = ?');
      updateValues.push(description);
    }
    if (address) {
      fieldUpdates.push('address = ?');
      updateValues.push(address);
    }
    if (city) {
      fieldUpdates.push('city = ?');
      updateValues.push(city);
    }
    if (country) {
      fieldUpdates.push('country = ?');
      updateValues.push(country);
    }
    if (postal_code !== undefined) {
      fieldUpdates.push('postal_code = ?');
      updateValues.push(postal_code);
    }
    if (phone !== undefined) {
      fieldUpdates.push('phone = ?');
      updateValues.push(phone);
    }
    if (email !== undefined) {
      fieldUpdates.push('email = ?');
      updateValues.push(email);
    }
    if (website !== undefined) {
      fieldUpdates.push('website = ?');
      updateValues.push(website);
    }
    if (year_established !== undefined) {
      fieldUpdates.push('year_established = ?');
      updateValues.push(year_established);
    }
    if (req.user.role === 'admin' && contact_person_id !== undefined) {
      fieldUpdates.push('contact_person_id = ?');
      updateValues.push(contact_person_id);
    }
    if (location !== undefined) {
      fieldUpdates.push('location = ?');
      updateValues.push(location);
    }
    fieldUpdates.push('verification_status = ?');
    updateValues.push(finalVerificationStatus);
    fieldUpdates.push('updated_at = NOW()');

    if (fieldUpdates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateValues.push(req.params.id);

    await pool.execute(
      `UPDATE orphanages SET ${fieldUpdates.join(', ')} WHERE id = ?`,
      updateValues
    );

    const [updatedOrphanage] = await pool.execute(
      'SELECT * FROM orphanages WHERE id = ?',
      [req.params.id]
    );

    if (
      req.user.role === 'admin' &&
      verification_status &&
      verification_status !== orphanageRows[0].verification_status &&
      orphanageRows[0].contact_person_id
    ) {
      const statusMessage =
        verification_status === 'approved'
          ? 'approved and is now publicly visible'
          : 'rejected';

      await pool.execute(
        `INSERT INTO notifications
          (user_id, title, message, notification_type, related_id)
          VALUES (?, ?, ?, ?, ?)`,
        [
          orphanageRows[0].contact_person_id,
          `Orphanage ${verification_status.charAt(0).toUpperCase() + verification_status.slice(1)}`,
          `Your orphanage "${orphanageRows[0].name}" has been ${statusMessage}`,
          'system',
          req.params.id
        ]
      );

      const [userRow] = await pool.execute(
        'SELECT email FROM users WHERE id = ?',
        [orphanageRows[0].contact_person_id]
      );

      if (userRow.length > 0) {
        try {
          await sendEmail({
            email: userRow[0].email,
            subject: `Orphanage ${
              verification_status.charAt(0).toUpperCase() + verification_status.slice(1)
            }`,
            message: `Your orphanage "${orphanageRows[0].name}" has been ${statusMessage}.`
          });
        } catch (emailError) {
          console.error('Failed to send verification email:', emailError);
        }
      }
    }

    res.status(200).json({
      success: true,
      data: updatedOrphanage[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.getOrphanageOrphans = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    
    const [orphanageRows] = await pool.execute(
      'SELECT id FROM orphanages WHERE id = ?',
      [req.params.id]
    );

    if (orphanageRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Orphanage not found'
      });
    }

    const [countRows] = await pool.execute(
      'SELECT COUNT(*) as total FROM orphans WHERE orphanage_id = ?',
      [req.params.id]
    );
    const total = countRows[0].total;

    const [rows] = await pool.execute(
      `SELECT o.*, 
        (SELECT COUNT(*) FROM sponsorships WHERE orphan_id = o.id AND status = 'active') as active_sponsorships
        FROM orphans o
        WHERE o.orphanage_id = ?
        ORDER BY o.first_name
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

exports.getOrphanageReviews = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    
    const [orphanageRows] = await pool.execute(
      'SELECT id FROM orphanages WHERE id = ?',
      [req.params.id]
    );

    if (orphanageRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Orphanage not found'
      });
    }

    const [countRows] = await pool.execute(
      'SELECT COUNT(*) as total FROM reviews WHERE orphanage_id = ?',
      [req.params.id]
    );
    const total = countRows[0].total;

    const [rows] = await pool.execute(
      `SELECT r.*, u.first_name, u.last_name, u.profile_image
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.orphanage_id = ?
        ORDER BY r.created_at DESC
        LIMIT ?, ?`,
      [req.params.id, startIndex, limit]
    );

    const [statsRows] = await pool.execute(
      `SELECT 
        COUNT(*) as total_reviews,
        AVG(rating) as average_rating,
        SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star,
        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four_star,
        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three_star,
        SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two_star,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one_star
        FROM reviews
        WHERE orphanage_id = ?`,
      [req.params.id]
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
      stats: statsRows[0],
      data: rows
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteReview = async (req, res, next) => {
  try {
    const [reviewRows] = await pool.execute(
      'SELECT * FROM reviews WHERE id = ? AND orphanage_id = ?',
      [req.params.reviewId, req.params.id]
    );

    if (reviewRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    if (req.user.role !== 'admin' && reviewRows[0].user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this review'
      });
    }

    await pool.execute(
      'DELETE FROM reviews WHERE id = ?',
      [req.params.reviewId]
    );

    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;