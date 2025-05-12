const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '1252alaa]]]]',
  database: 'hopeconnect',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('MySQL connection established successfully');
    connection.release();
    return true;
  } catch (error) {
    console.error('Error connecting to MySQL:', error);
    return false;
  }
};

module.exports = {
  pool,
  testConnection
};