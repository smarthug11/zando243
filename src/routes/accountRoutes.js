const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const ctrl = require("../controllers/accountController");

const router = express.Router();
router.use(requireAuth);
router.get("/profile", ctrl.profile);
router.post("/profile", ...ctrl.profileValidators, ctrl.updateProfile);
router.post("/addresses", ...ctrl.addressValidators, ctrl.createAddress);
router.post("/addresses/:id", ...ctrl.addressValidators, ctrl.updateAddress);
router.post("/addresses/:id/delete", ctrl.deleteAddress);

module.exports = router;
