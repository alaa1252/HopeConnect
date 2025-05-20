const { pool } = require('../config/db');

exports.getNotifications = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    const isRead = req.query.isRead;
    const type = req.query.type;

    let conditions = ['user_id = ?'];
    let queryParams = [req.user.id];

    if (isRead !== undefined) {
      conditions.push('is_read = ?');
      queryParams.push(isRead === 'true' ? 1 : 0);
    }

    if (type) {
      conditions.push('notification_type = ?');
      queryParams.push(type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM notifications ${whereClause}`,
      queryParams
    );
    const total = countRows[0].total;

    const paginationParams = [...queryParams];

    paginationParams.push(startIndex, limit);

    const [rows] = await pool.execute(
      `SELECT * FROM notifications
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ?, ?`,
      paginationParams
    );

    const pagination = {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };

    const [unreadCountRows] = await pool.execute(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
      [req.user.id]
    );

    res.status(200).json({
      success: true,
      pagination,
      unread_count: unreadCountRows[0].count,
      data: rows
    });
  } catch (error) {
    next(error);
  }
};

exports.markAsRead = async (req, res, next) => {
  try {
    const [notificationRows] = await pool.execute(
      'SELECT * FROM notifications WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (notificationRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or does not belong to this user'
      });
    }

    await pool.execute(
      'UPDATE notifications SET is_read = 1 WHERE id = ?',
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    next(error);
  }
};

exports.markAllAsRead = async (req, res, next) => {
  try {
    await pool.execute(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [req.user.id]
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteNotification = async (req, res, next) => {
  try {
    const [notificationRows] = await pool.execute(
      'SELECT * FROM notifications WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (notificationRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or does not belong to this user'
      });
    }

    await pool.execute(
      'DELETE FROM notifications WHERE id = ?',
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    next(error);
  }
};