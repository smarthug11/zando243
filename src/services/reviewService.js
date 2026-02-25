const { fn, col } = require("sequelize");
const { defineModels } = require("../models");
const { AppError } = require("../utils/AppError");

defineModels();

async function recomputeProductRating(productId, transaction) {
  const models = defineModels();
  const [agg] = await models.Review.findAll({
    attributes: [
      [fn("AVG", col("rating")), "avgRating"],
      [fn("COUNT", col("id")), "countReviews"]
    ],
    where: { productId, isHidden: false },
    raw: true,
    transaction
  });

  const avgRating = Number(agg?.avgRating || 0).toFixed(2);
  const countReviews = Number(agg?.countReviews || 0);
  await models.Product.update({ avgRating, countReviews }, { where: { id: productId }, transaction });
  return { avgRating: Number(avgRating), countReviews };
}

async function createOrUpdateReview({ userId, productSlug, rating, comment }) {
  const models = defineModels();
  const product = await models.Product.findOne({ where: { slug: productSlug } });
  if (!product) throw new AppError("Produit introuvable", 404, "PRODUCT_NOT_FOUND");
  if (product.status !== "ACTIVE") throw new AppError("Produit indisponible", 400, "PRODUCT_INACTIVE");

  const deliveredOrder = await models.Order.findOne({
    where: { userId, status: "Delivered" },
    include: [
      {
        model: models.OrderItem,
        as: "items",
        where: { productId: product.id },
        required: true
      }
    ]
  });

  let review = await models.Review.findOne({ where: { userId, productId: product.id } });
  if (review) {
    review.rating = Number(rating);
    review.comment = comment || null;
    review.verifiedPurchase = Boolean(deliveredOrder);
    review.isHidden = false;
    await review.save();
  } else {
    review = await models.Review.create({
      userId,
      productId: product.id,
      rating: Number(rating),
      comment: comment || null,
      verifiedPurchase: Boolean(deliveredOrder),
      isHidden: false
    });
  }

  await recomputeProductRating(product.id);
  return { review, product };
}

module.exports = { createOrUpdateReview, recomputeProductRating };
