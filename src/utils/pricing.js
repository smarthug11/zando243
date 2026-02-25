function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function computeDisplayFinalPrice({ priceWithoutDelivery, weightKg }) {
  return round2(Number(priceWithoutDelivery || 0) + 15 * Number(weightKg || 0));
}

function computeCheckoutLineTotal({ priceWithoutDelivery, weightKg, qty }) {
  return round2((Number(priceWithoutDelivery || 0) + 15 * Number(weightKg || 0)) * Number(qty || 1));
}

module.exports = { round2, computeDisplayFinalPrice, computeCheckoutLineTotal };
