const backendHandler = require('../backend/api/template-download');

module.exports = async function handler(req, res) {
    return backendHandler(req, res);
};
