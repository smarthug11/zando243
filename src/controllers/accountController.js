const { body } = require("express-validator");
const { asyncHandler } = require("../utils/asyncHandler");
const { handleValidation } = require("../middlewares/validators");
const { setFlash } = require("../middlewares/viewLocals");
const accountService = require("../services/accountService");

const profileValidators = [body("firstName").isLength({ min: 2 }), body("lastName").isLength({ min: 2 }), body("email").isEmail(), handleValidation];
const addressValidators = [body("label").notEmpty(), body("street").notEmpty(), body("city").notEmpty(), body("country").notEmpty(), handleValidation];

const profile = asyncHandler(async (req, res) => {
  const { addresses, notifications } = await accountService.getProfileData(req.user.id);
  res.render("pages/account/profile", { title: "Mon compte", user: req.user, addresses, notifications });
});

const updateProfile = asyncHandler(async (req, res) => {
  await accountService.updateUserProfile(req.user, req.body);
  setFlash(req, "success", "Profil mis à jour.");
  res.redirect("/account/profile");
});

const createAddress = asyncHandler(async (req, res) => {
  await accountService.createUserAddress(req.user.id, req.body);
  setFlash(req, "success", "Adresse ajoutée.");
  res.redirect("/account/profile");
});

const updateAddress = asyncHandler(async (req, res) => {
  const address = await accountService.updateUserAddress(req.user.id, req.params.id, req.body);
  if (!address) return res.status(404).render("pages/errors/404", { title: "Adresse introuvable" });
  setFlash(req, "success", "Adresse mise à jour.");
  res.redirect("/account/profile");
});

const deleteAddress = asyncHandler(async (req, res) => {
  await accountService.deleteUserAddress(req.user.id, req.params.id);
  setFlash(req, "success", "Adresse supprimée.");
  res.redirect("/account/profile");
});

module.exports = { profileValidators, addressValidators, profile, updateProfile, createAddress, updateAddress, deleteAddress };
