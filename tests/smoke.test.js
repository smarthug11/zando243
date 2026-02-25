const test = require("node:test");
const assert = require("node:assert/strict");
const { computeDisplayFinalPrice, computeCheckoutLineTotal } = require("../src/utils/pricing");
const { toSlug } = require("../src/utils/slugify");

test("pricing formulas match business rules", () => {
  assert.equal(computeDisplayFinalPrice({ priceWithoutDelivery: 100, weightKg: 2 }), 130);
  assert.equal(computeCheckoutLineTotal({ priceWithoutDelivery: 100, weightKg: 2, qty: 1 }), 130);
});

test("slugify helper", () => {
  assert.equal(toSlug("Téléphone Premium 2026"), "telephone-premium-2026");
});
