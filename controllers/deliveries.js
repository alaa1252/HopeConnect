const { pool } = require('../config/db');
const sendEmail = require('../utils/sendEmail');

exports.getDeliveries = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    const status = req.query.status;
    const donationId = req.query.donationId;
    const estimatedStartDate = req.query.estimatedStartDate;
    const estimatedEndDate = req.query.estimatedEndDate;

    let conditions = [];
    let queryParams = [];

    if (status) {
      conditions.push('dt.status = ?');
      queryParams.push(status);
    }

    if (donationId) {
      conditions.push('dt.donation_id = ?');
      queryParams.push(donationId);
    }

    if (estimatedStartDate) {
      conditions.push('dt.estimated_delivery >= ?');
      queryParams.push(estimatedStartDate);
    }

    if (estimatedEndDate) {
      conditions.push('dt.estimated_delivery <= ?');
      queryParams.push(estimatedEndDate);
    }

    if (req.user.role !== 'admin') {
      conditions.push('d.donor_id = ?');
      queryParams.push(req.user.id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total 
       FROM delivery_tracking dt 
       JOIN donations d ON dt.donation_id = d.id
       ${whereClause}`,
      queryParams
    );
    const total = countRows[0].total;

    const paginationParams = [...queryParams];

    paginationParams.push(startIndex, limit);

    const [rows] = await pool.execute(
      `SELECT dt.*, 
       d.amount, d.donation_type, d.category,
       CASE 
          WHEN d.is_anonymous = 1 THEN 'Anonymous' 
          ELSE CONCAT(u.first_name, ' ', u.last_name) 
       END as donor_name,
       o.name as orphanage_name
       FROM delivery_tracking dt
       JOIN donations d ON dt.donation_id = d.id
       LEFT JOIN users u ON d.donor_id = u.id
       LEFT JOIN orphanages o ON d.orphanage_id = o.id
       ${whereClause}
       ORDER BY dt.created_at DESC
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

exports.updateDelivery = async (req, res, next) => {
  try {
    const {
      status,
      carrier,
      tracking_number,
      estimated_delivery,
      actual_delivery,
      notes
    } = req.body;

    const [deliveryRows] = await pool.execute(
      `SELECT dt.*, d.donor_id, d.donation_type, 
       u.email, u.first_name, u.phone
       FROM delivery_tracking dt
       JOIN donations d ON dt.donation_id = d.id
       JOIN users u ON d.donor_id = u.id
       WHERE dt.id = ?`,
      [req.params.id]
    );

    if (deliveryRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Delivery tracking record not found'
      });
    }

    const validStatuses = ['preparing', 'in_transit', 'delivered', 'failed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    await pool.execute(
      `UPDATE delivery_tracking SET
       status = ?,
       carrier = ?,
       tracking_number = ?,
       estimated_delivery = ?,
       actual_delivery = ?,
       notes = ?
       WHERE id = ?`,
      [
        status || deliveryRows[0].status,
        carrier || deliveryRows[0].carrier,
        tracking_number || deliveryRows[0].tracking_number,
        estimated_delivery || deliveryRows[0].estimated_delivery,
        actual_delivery || deliveryRows[0].actual_delivery,
        notes || deliveryRows[0].notes,
        req.params.id
      ]
    );

    if (status && status !== deliveryRows[0].status) {
      await pool.execute(
        `INSERT INTO notifications
         (user_id, title, message, notification_type, related_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          deliveryRows[0].donor_id,
          'Delivery Status Update',
          `Your delivery status has been updated to ${status}`,
          'delivery',
          req.params.id
        ]
      );

      await sendEmail({
        email: deliveryRows[0].email,
        subject: 'Delivery Status Update',
        html: `
          <h1>Delivery Status Update</h1>
          <p>Dear ${deliveryRows[0].first_name},</p>
          <p>The status of your delivery for donation (${deliveryRows[0].donation_type}) has been updated to <strong>${status}</strong>.</p>
          ${status === 'in_transit' ? 
            `<p>Your donation is now on its way to the recipient.</p>
             ${deliveryRows[0].tracking_number ? 
               `<p>You can track your delivery with the tracking number: ${deliveryRows[0].tracking_number}</p>` : ''}` : 
            status === 'delivered' ? 
            `<p>Your donation has been successfully delivered. Thank you for your generosity!</p>` :
            status === 'failed' ? 
            `<p>Unfortunately, there was an issue with your delivery. Our team will contact you shortly to resolve this.</p>` : ''}
          ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
        `
      });

      if (deliveryRows[0].phone && (status === 'delivered' || status === 'failed')) {
        console.log(`SMS would be sent to ${deliveryRows[0].phone} about ${status} delivery`);
      }
    }

    const [updatedDelivery] = await pool.execute(
      `SELECT dt.*, d.donation_type, d.category
       FROM delivery_tracking dt
       JOIN donations d ON dt.donation_id = d.id
       WHERE dt.id = ?`,
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      data: updatedDelivery[0]
    });
  } catch (error) {
    next(error);
  }
};