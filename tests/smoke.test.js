const test = require("node:test");
const assert = require("node:assert/strict");
const { computeDisplayFinalPrice, computeCheckoutLineTotal } = require("../src/utils/pricing");
const { toSlug } = require("../src/utils/slugify");
const { sanitizeBody } = require("../src/middlewares/validators");

test("pricing formulas match business rules", () => {
  assert.equal(computeDisplayFinalPrice({ priceWithoutDelivery: 100, weightKg: 2 }), 130);
  assert.equal(computeCheckoutLineTotal({ priceWithoutDelivery: 100, weightKg: 2, qty: 1 }), 130);
});

test("slugify helper", () => {
  assert.equal(toSlug("Téléphone Premium 2026"), "telephone-premium-2026");
});

test("sanitizeBody supprime tous les tags HTML en texte brut", () => {
  const req = {
    body: {
      firstName: "<strong>Alice</strong>",
      address: { street: "Rue <img src=x onerror=alert(1)> Principale" },
      messages: ["Bonjour <script>alert(1)</script>"]
    }
  };

  sanitizeBody(req);

  assert.equal(req.body.firstName, "Alice");
  assert.equal(req.body.address.street, "Rue  Principale");
  assert.equal(req.body.messages[0], "Bonjour");
});
