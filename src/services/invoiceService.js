const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { env } = require("../config/env");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function generateInvoicePdf(order) {
  ensureDir(env.invoiceDir);
  const filename = `${order.orderNumber}.pdf`;
  const filepath = path.join(env.invoiceDir, filename);
  const doc = new PDFDocument({ margin: 50 });
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);
  doc.fontSize(20).text("Facture Zando243");
  doc.moveDown();
  doc.fontSize(12).text(`Commande: ${order.orderNumber}`);
  doc.text(`Date: ${new Date(order.createdAt).toLocaleString("fr-FR")}`);
  doc.text(`Statut: ${order.status}`);
  doc.moveDown();
  doc.text("Adresse de livraison:");
  doc.text(JSON.stringify(order.addressSnapshot, null, 2));
  doc.moveDown();
  doc.text(`Sous-total: $${order.subtotal}`);
  doc.text(`Livraison porte: $${order.shippingFee}`);
  doc.text(`Réduction: -$${order.discountTotal}`);
  doc.text(`Total: $${order.total}`);
  doc.moveDown();
  (order.items || []).forEach((item) => {
    doc.text(`${item.productSnapshot?.name || "Article"} x${item.qty} - $${item.lineTotal}`);
  });
  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return `/invoices/${filename}`;
}

function getInvoiceDownload(order) {
  const filename = `${order.orderNumber}.pdf`;
  const filepath = path.join(env.invoiceDir, filename);
  if (!fs.existsSync(filepath)) return null;
  return {
    filepath,
    contentType: "application/pdf",
    contentDisposition: `attachment; filename="${filename}"`
  };
}

module.exports = { generateInvoicePdf, getInvoiceDownload };
