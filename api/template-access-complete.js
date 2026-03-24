const backendHandler = require('../backend/api/template-access-complete');

module.exports = async function handler(req, res) {
    return backendHandler(req, res);
};
