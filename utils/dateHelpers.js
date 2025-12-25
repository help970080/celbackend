// utils/dateHelpers.js
const moment = require('moment-timezone');
const TIMEZONE = "America/Mexico_City";

const startOfDay = (date) => {
    return moment(date).tz(TIMEZONE).startOf('day').toDate();
};

const getNextDueDate = (lastPaymentDate, frequency) => {
    const baseDate = moment(lastPaymentDate).tz(TIMEZONE);
    switch (frequency) {
        case 'daily':
            return baseDate.add(1, 'days').endOf('day').toDate();
        case 'fortnightly':
            return baseDate.add(15, 'days').endOf('day').toDate();
        case 'monthly':
            return baseDate.add(1, 'months').endOf('day').toDate();
        case 'weekly':
        default:
            return baseDate.add(7, 'days').endOf('day').toDate();
    }
};

const N = (value) => {
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
};

module.exports = { startOfDay, getNextDueDate, N };