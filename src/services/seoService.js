const catalogService = require("./catalogService");

async function generateSitemapXml(appUrl) {
  const { products } = await catalogService.listProducts({ limit: 200, page: 1 });
  const categories = await catalogService.listCategories();
  const urls = [
    "/",
    "/products",
    ...categories.map((category) => `/categories/${category.slug}`),
    ...products.map((product) => `/products/${product.slug}`)
  ];

  return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n${urls.map((url) => `<url><loc>${appUrl}${url}</loc></url>`).join("\n")}\n</urlset>`;
}

function generateRobotsTxt() {
  return "User-agent: *\nAllow: /\nSitemap: /sitemap.xml";
}

module.exports = { generateSitemapXml, generateRobotsTxt };
