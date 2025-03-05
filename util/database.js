const mysql = require('mysql');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    database: 'hopeconnect',
    password: '1252alaa]]]]'
});

module.exports = pool.promise();