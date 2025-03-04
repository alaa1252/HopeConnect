const Sequelize = require('sequelize');

const sequelize = new Sequelize('hopeconnect', 'root', '1252alaa]]]]', {
    dialect: 'mysql', host: 'localhost'
});

module.exports = sequelize;