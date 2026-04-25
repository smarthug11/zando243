const { defineModels } = require("../models");
const { recomputeProductRating } = require("./reviewService");

defineModels();

async function listReviews() {
  const models = defineModels();
  return models.Review.findAll({
    include: [
      { model: models.Product, as: "product" },
      { model: models.User, as: "user" }
    ],
    order: [["createdAt", "DESC"]],
    limit: 100
  });
}

async function moderateReview(reviewId, action) {
  const models = defineModels();
  const review = await models.Review.findByPk(reviewId);
  if (!review) return null;

  const productId = review.productId;
  if (action === "delete") await review.destroy();
  if (action === "hide") await review.update({ isHidden: true });
  if (action === "unhide") await review.update({ isHidden: false });

  await recomputeProductRating(productId);
  return { review, productId, action };
}

module.exports = {
  listReviews,
  moderateReview
};
