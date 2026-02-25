const slugifyPkg = require("slugify");

function toSlug(input) {
  return slugifyPkg(String(input || ""), { lower: true, strict: true, trim: true });
}

module.exports = { toSlug };
