const { defineModels } = require("../models");

async function listReturnRequests() {
  const models = defineModels();
  return models.ReturnRequest.findAll({
    include: [{ model: models.Order }]
  });
}

module.exports = { listReturnRequests };
