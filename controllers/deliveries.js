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

exports.getDelivery = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT dt.*, 
       d.amount, d.donation_type, d.category, d.donor_id, d.orphanage_id,
       CASE 
          WHEN d.is_anonymous = 1 THEN 'Anonymous' 
          ELSE CONCAT(u.first_name, ' ', u.last_name) 
       END as donor_name,
       u.email as donor_email, u.phone as donor_phone,
       o.name as orphanage_name, o.address as orphanage_address, o.phone as orphanage_phone
       FROM delivery_tracking dt
       JOIN donations d ON dt.donation_id = d.id
       LEFT JOIN users u ON d.donor_id = u.id
       LEFT JOIN orphanages o ON d.orphanage_id = o.id
       WHERE dt.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    if (req.user.role !== 'admin' && rows[0].donor_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this delivery'
      });
    }

    const [statusHistory] = await pool.execute(
      `SELECT status, updated_at
       FROM delivery_status_history
       WHERE delivery_id = ?
       ORDER BY updated_at DESC`,
      [req.params.id]
    );

    res.status(200).json({
      success: true,
      data: {
        ...rows[0],
        status_history: statusHistory
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.createDelivery = async (req, res, next) => {
  try {
    const {
      donation_id,
      status = 'preparing',
      pickup_address,
      delivery_address,
      carrier,
      tracking_number,
      estimated_delivery,
      notes
    } = req.body;

    if (!donation_id) {
      return res.status(400).json({
        success: false,
        message: 'Please provide donation ID'
      });
    }

    const [donationRows] = await pool.execute(
      `SELECT d.*, u.email, u.first_name, o.name as orphanage_name
       FROM donations d
       JOIN users u ON d.donor_id = u.id
       LEFT JOIN orphanages o ON d.orphanage_id = o.id
       WHERE d.id = ?`,
      [donation_id]
    );

    if (donationRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Donation not found'
      });
    }

    const donation = donationRows[0];

    if (donation.category !== 'in_kind') {
      return res.status(400).json({
        success: false,
        message: 'Delivery can only be created for in-kind donations'
      });
    }

    const [existingDeliveryRows] = await pool.execute(
      'SELECT id FROM delivery_tracking WHERE donation_id = ?',
      [donation_id]
    );

    if (existingDeliveryRows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Delivery already exists for this donation'
      });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [result] = await connection.execute(
        `INSERT INTO delivery_tracking
         (donation_id, status, pickup_address, delivery_address, carrier, tracking_number, estimated_delivery, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          donation_id,
          status,
          pickup_address || null,
          delivery_address || null,
          carrier || null,
          tracking_number || null,
          estimated_delivery || null,
          notes || null
        ]
      );

      await connection.execute(
        `INSERT INTO delivery_status_history
         (delivery_id, status)
         VALUES (?, ?)`,
        [result.insertId, status]
      );

      await connection.commit();

      await pool.execute(
        `INSERT INTO notifications
         (user_id, title, message, notification_type, related_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          donation.donor_id,
          'Delivery Created',
          `Your donation will be delivered. Current status: ${status}`,
          'delivery',
          result.insertId
        ]
      );

      await sendEmail({
        email: donation.email,
        subject: 'Delivery Created for Your Donation',
        html: `
          <h1>Delivery Created</h1>
          <p>Dear ${donation.first_name},</p>
          <p>A delivery has been created for your in-kind donation to ${donation.orphanage_name || 'our organization'}.</p>
          <p>Current status: <strong>${status}</strong></p>
          ${estimated_delivery ? `<p>Estimated delivery date: ${new Date(estimated_delivery).toDateString()}</p>` : ''}
          ${tracking_number ? `<p>Tracking number: ${tracking_number}</p>` : ''}
          ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
          <p>You will receive updates as the delivery status changes.</p>
          <p>Thank you for your generosity!</p>
        `
      });

      const [delivery] = await pool.execute(
        `SELECT dt.*, d.donation_type, d.category,
         CASE 
            WHEN d.is_anonymous = 1 THEN 'Anonymous' 
            ELSE CONCAT(u.first_name, ' ', u.last_name) 
         END as donor_name,
         o.name as orphanage_name
         FROM delivery_tracking dt
         JOIN donations d ON dt.donation_id = d.id
         LEFT JOIN users u ON d.donor_id = u.id
         LEFT JOIN orphanages o ON d.orphanage_id = o.id
         WHERE dt.id = ?`,
        [result.insertId]
      );

      res.status(201).json({
        success: true,
        data: delivery[0]
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
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

    const delivery = deliveryRows[0];
    const oldStatus = delivery.status;

    const validStatuses = ['preparing', 'in_transit', 'delivered', 'failed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      await connection.execute(
        `UPDATE delivery_tracking SET
         status = ?,
         carrier = ?,
         tracking_number = ?,
         estimated_delivery = ?,
         actual_delivery = ?,
         notes = ?,
         updated_at = NOW()
         WHERE id = ?`,
        [
          status || delivery.status,
          carrier || delivery.carrier,
          tracking_number || delivery.tracking_number,
          estimated_delivery || delivery.estimated_delivery,
          actual_delivery || delivery.actual_delivery,
          notes || delivery.notes,
          req.params.id
        ]
      );

      if (status && status !== oldStatus) {
        await connection.execute(
          `INSERT INTO delivery_status_history
           (delivery_id, status)
           VALUES (?, ?)`,
          [req.params.id, status]
        );

        await connection.execute(
          `INSERT INTO notifications
           (user_id, title, message, notification_type, related_id)
           VALUES (?, ?, ?, ?, ?)`,
          [
            delivery.donor_id,
            'Delivery Status Update',
            `Your delivery status has been updated to ${status}`,
            'delivery',
            req.params.id
          ]
        );

        await sendEmail({
          email: delivery.email,
          subject: 'Delivery Status Update',
          html: `
            <h1>Delivery Status Update</h1>
            <p>Dear ${delivery.first_name},</p>
            <p>The status of your delivery for donation (${delivery.donation_type}) has been updated to <strong>${status}</strong>.</p>
            ${status === 'in_transit' ? 
              `<p>Your donation is now on its way to the recipient.</p>
               ${tracking_number ? 
                 `<p>You can track your delivery with the tracking number: ${tracking_number}</p>` : 
                 delivery.tracking_number ? 
                 `<p>You can track your delivery with the tracking number: ${delivery.tracking_number}</p>` : ''}` : 
              status === 'delivered' ? 
              `<p>Your donation has been successfully delivered. Thank you for your generosity!</p>` :
              status === 'failed' ? 
              `<p>Unfortunately, there was an issue with your delivery. Our team will contact you shortly to resolve this.</p>` : ''}
            ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
          `
        });

        if (delivery.phone && (status === 'delivered' || status === 'failed')) {
          console.log(`SMS would be sent to ${delivery.phone} about ${status} delivery`);
        }
      }

      await connection.commit();

      const [updatedDelivery] = await pool.execute(
        `SELECT dt.*, d.donation_type, d.category,
         CASE 
            WHEN d.is_anonymous = 1 THEN 'Anonymous' 
            ELSE CONCAT(u.first_name, ' ', u.last_name) 
         END as donor_name,
         o.name as orphanage_name
         FROM delivery_tracking dt
         JOIN donations d ON dt.donation_id = d.id
         LEFT JOIN users u ON d.donor_id = u.id
         LEFT JOIN orphanages o ON d.orphanage_id = o.id
         WHERE dt.id = ?`,
        [req.params.id]
      );

      const [statusHistory] = await pool.execute(
        `SELECT status, updated_at
         FROM delivery_status_history
         WHERE delivery_id = ?
         ORDER BY updated_at DESC`,
        [req.params.id]
      );

      res.status(200).json({
        success: true,
        data: {
          ...updatedDelivery[0],
          status_history: statusHistory
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
};

module.exports = exports;