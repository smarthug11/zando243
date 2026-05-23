const test = require("node:test");
const assert = require("node:assert/strict");
const ejs = require("ejs");
const path = require("path");

const navPath = path.join(__dirname, "../src/views/partials/admin-nav.ejs");

async function renderNav(currentPath) {
  return ejs.renderFile(navPath, { currentPath });
}

function classForHref(html, href) {
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<a class="([^"]*)" href="${escapedHref}"`));
  assert.ok(match, `missing nav link ${href}`);
  return match[1];
}

function assertActive(html, href) {
  const classes = classForHref(html, href);
  assert.match(classes, /\bfont-bold\b/);
  assert.match(classes, /\btext-blue-700\b/);
}

function assertInactive(html, href) {
  const classes = classForHref(html, href);
  assert.doesNotMatch(classes, /\bfont-bold\b/);
  assert.doesNotMatch(classes, /\btext-blue-700\b/);
}

test("admin nav active dashboard only on /admin", async () => {
  const html = await renderNav("/admin");

  assertActive(html, "/admin");
  assertInactive(html, "/admin/products");
  assertInactive(html, "/admin/orders");
});

test("admin nav active products for product subpages without activating dashboard", async () => {
  const html = await renderNav("/admin/products/123");

  assertInactive(html, "/admin");
  assertActive(html, "/admin/products");
  assertInactive(html, "/admin/orders");
});

test("admin nav active orders for order subpages without activating dashboard", async () => {
  const html = await renderNav("/admin/orders/123");

  assertInactive(html, "/admin");
  assertInactive(html, "/admin/products");
  assertActive(html, "/admin/orders");
});
