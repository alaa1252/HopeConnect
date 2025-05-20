const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { testConnection } = require('./config/db');

dotenv.config();

const authRoutes = require('./routes/auth');
const orphanRoutes = require('./routes/orphans');
const orphanageRoutes = require('./routes/orphanages');
const donationRoutes = require('./routes/donations');
const sponsorshipRoutes = require('./routes/sponsorships');
const volunteerRoutes = require('./routes/volunteers');
const campaignRoutes = require('./routes/campaigns');
const deliveryRoutes = require('./routes/deliveries');
const notificationRoutes = require('./routes/notifications');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/orphans', orphanRoutes);
app.use('/api/v1/orphanages', orphanageRoutes);
app.use('/api/v1/donations', donationRoutes);
app.use('/api/v1/sponsorships', sponsorshipRoutes);
app.use('/api/v1/volunteers', volunteerRoutes);
app.use('/api/v1/campaigns', campaignRoutes);
app.use('/api/v1/deliveries', deliveryRoutes);
app.use('/api/v1/notifications', notificationRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to HopeConnect API' });
});

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    const isConnected = await testConnection();
    
    if (isConnected) {
      app.listen(PORT, () => {
        console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
      });
    } else {
      console.error('Failed to connect to database. Server not started.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Server startup error:', error.message);
    process.exit(1);
  }
};

process.on('unhandledRejection', (err) => {
  console.log('Unhandled Rejection:', err.message);
  process.exit(1);
});

startServer();

module.exports = app;