const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const orphanRoutes = require('./routes/orphans');
const orphanageRoutes = require('./routes/orphanages');
const donationRoutes = require('./routes/donations');
const sponsorshipRoutes = require('./routes/sponsorships');
const volunteerRoutes = require('./routes/volunteers');
const campaignRoutes = require('./routes/campaigns');
const deliveryRoutes = require('./routes/deliveries');
const notificationRoutes = require('./routes/notifications');
const reviewRoutes = require('./routes/reviews');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/orphans', orphanRoutes);
app.use('/api/v1/orphanages', orphanageRoutes);
app.use('/api/v1/donations', donationRoutes);
app.use('/api/v1/sponsorships', sponsorshipRoutes);
app.use('/api/v1/volunteers', volunteerRoutes);
app.use('/api/v1/campaigns', campaignRoutes);
app.use('/api/v1/deliveries', deliveryRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/reviews', reviewRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to HopeConnect API' });
});

module.exports = app;