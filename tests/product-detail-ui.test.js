const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const detailViewPath = path.join(__dirname, "../src/views/pages/products/detail.ejs");

function extractDetailScript() {
  // On retire les balises EJS (ex. l'attribut nonce="<%= cspNonce %>") avant de
  // localiser le <script> : le `%>` contient un `>` qui casserait sinon le match.
  const view = fs.readFileSync(detailViewPath, "utf8").replace(/<%[\s\S]*?%>/g, "");
  const match = view.match(/<script[^>]*>\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(match, "product detail script must exist");
  return match[1];
}

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add(name) {
      classes.add(name);
    },
    remove(name) {
      classes.delete(name);
    },
    toggle(name, enabled) {
      if (enabled) classes.add(name);
      else classes.delete(name);
    },
    contains(name) {
      return classes.has(name);
    }
  };
}

function createThumb({ imageUrl, variantId = "", main = false }) {
  return {
    dataset: {
      imageUrl,
      variantId,
      main: main ? "true" : "false"
    },
    style: {},
    classList: createClassList(["thumb-btn", "border-slate-200"]),
    addEventListener() {}
  };
}

function runDetailScriptWithThumbs(thumbs) {
  const mainImg = { src: "" };
  const variantInput = { value: "" };
  const document = {
    getElementById(id) {
      if (id === "productMainImage") return mainImg;
      if (id === "selectedVariantIdInput") return variantInput;
      if (id === "variantSelector") return null;
      if (id === "productThumbs") {
        return {
          querySelectorAll(selector) {
            return selector === ".thumb-btn" ? thumbs : [];
          }
        };
      }
      return null;
    }
  };

  vm.runInNewContext(extractDetailScript(), { document });
  return mainImg.src;
}

test("product detail thumbnails expose data-main for the main image", () => {
  const view = fs.readFileSync(detailViewPath, "utf8");
  assert.ok(view.includes('data-main="<%= isMainThumb ? \'true\' : \'false\' %>"'));
});

test("product detail initializes on the main thumbnail even when it is not first", () => {
  const src = runDetailScriptWithThumbs([
    createThumb({ imageUrl: "https://cdn.example.com/first.jpg" }),
    createThumb({ imageUrl: "https://cdn.example.com/main.jpg", main: true })
  ]);

  assert.equal(src, "https://cdn.example.com/main.jpg");
});

test("product detail falls back to the first thumbnail when none is main", () => {
  const src = runDetailScriptWithThumbs([
    createThumb({ imageUrl: "https://cdn.example.com/first.jpg" }),
    createThumb({ imageUrl: "https://cdn.example.com/second.jpg" })
  ]);

  assert.equal(src, "https://cdn.example.com/first.jpg");
});
