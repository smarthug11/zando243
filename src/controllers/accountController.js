const { body } = require("express-validator");
const { defineModels } = require("../models");
const { asyncHandler } = require("../utils/asyncHandler");
const { handleValidation } = require("../middlewares/validators");
const { setFlash } = require("../middlewares/viewLocals");

defineModels();

const profileValidators = [body("firstName").isLength({ min: 2 }), body("lastName").isLength({ min: 2 }), body("email").isEmail(), handleValidation];
const addressValidators = [body("label").notEmpty(), body("street").notEmpty(), body("city").notEmpty(), body("country").notEmpty(), handleValidation];

const profile = asyncHandler(async (req, res) => {
  const models = defineModels();
  const [addresses, notifications] = await Promise.all([
    models.Address.findAll({ where: { userId: req.user.id }, order: [["isDefault", "DESC"], ["createdAt", "DESC"]] }),
    models.Notification.findAll({ where: { userId: req.user.id }, order: [["createdAt", "DESC"]], limit: 10 })
  ]);
  res.render("pages/account/profile", { title: "Mon compte", user: req.user, addresses, notifications });
});

const updateProfile = asyncHandler(async (req, res) => {
  Object.assign(req.user, {
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email.toLowerCase(),
    phone: req.body.phone || null,
    avatarUrl: req.body.avatarUrl || null
  });
  await req.user.save();
  setFlash(req, "success", "Profil mis à jour.");
  res.redirect("/account/profile");
});

const createAddress = asyncHandler(async (req, res) => {
  const models = defineModels();
  if (req.body.isDefault) {
    await models.Address.update({ isDefault: false }, { where: { userId: req.user.id } });
  }
  await models.Address.create({ ...req.body, userId: req.user.id, isDefault: Boolean(req.body.isDefault) });
  setFlash(req, "success", "Adresse ajoutée.");
  res.redirect("/account/profile");
});

const updateAddress = asyncHandler(async (req, res) => {
  const models = defineModels();
  const address = await models.Address.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!address) return res.status(404).render("pages/errors/404", { title: "Adresse introuvable" });
  if (req.body.isDefault) await models.Address.update({ isDefault: false }, { where: { userId: req.user.id } });
  Object.assign(address, { ...req.body, isDefault: Boolean(req.body.isDefault) });
  await address.save();
  setFlash(req, "success", "Adresse mise à jour.");
  res.redirect("/account/profile");
});

const deleteAddress = asyncHandler(async (req, res) => {
  const models = defineModels();
  await models.Address.destroy({ where: { id: req.params.id, userId: req.user.id } });
  setFlash(req, "success", "Adresse supprimée.");
  res.redirect("/account/profile");
});

module.exports = { profileValidators, addressValidators, profile, updateProfile, createAddress, updateAddress, deleteAddress };
