const backendHandler = require('../backend/api/template-access-start');

module.exports = async function handler(req, res) {
    return backendHandler(req, res);
};
