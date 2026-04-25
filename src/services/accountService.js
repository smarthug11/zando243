const { defineModels } = require("../models");

defineModels();

function parseHttpsUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? raw : null;
  } catch (_) {
    return null;
  }
}

async function getProfileData(userId) {
  const models = defineModels();
  const [addresses, notifications] = await Promise.all([
    models.Address.findAll({
      where: { userId },
      order: [["isDefault", "DESC"], ["createdAt", "DESC"]]
    }),
    models.Notification.findAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
      limit: 10
    })
  ]);

  return { addresses, notifications };
}

async function updateUserProfile(user, payload) {
  Object.assign(user, {
    firstName: payload.firstName,
    lastName: payload.lastName,
    email: payload.email.toLowerCase(),
    phone: payload.phone || null,
    avatarUrl: parseHttpsUrl(payload.avatarUrl)
  });
  await user.save();
  return user;
}

function pickAddressFields(payload) {
  return {
    label:        payload.label,
    number:       payload.number || null,
    street:       payload.street,
    neighborhood: payload.neighborhood || null,
    municipality: payload.municipality || null,
    city:         payload.city,
    country:      payload.country,
    isDefault:    Boolean(payload.isDefault)
  };
}

async function createUserAddress(userId, payload) {
  const models = defineModels();
  const data = { ...pickAddressFields(payload), userId };
  if (data.isDefault) {
    await models.Address.update({ isDefault: false }, { where: { userId } });
  }
  return models.Address.create(data);
}

async function updateUserAddress(userId, addressId, payload) {
  const models = defineModels();
  const address = await models.Address.findOne({
    where: { id: addressId, userId }
  });
  if (!address) return null;

  const data = pickAddressFields(payload);
  if (data.isDefault) {
    await models.Address.update({ isDefault: false }, { where: { userId } });
  }

  Object.assign(address, data);
  await address.save();
  return address;
}

async function deleteUserAddress(userId, addressId) {
  const models = defineModels();
  await models.Address.destroy({ where: { id: addressId, userId } });
}

module.exports = {
  getProfileData,
  updateUserProfile,
  createUserAddress,
  updateUserAddress,
  deleteUserAddress
};
