const PDFDocument = require("pdfkit");

function toObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_e) {
    return {};
  }
}

function money(v) {
  return `$${Number(v || 0).toFixed(2)}`;
}

function buildPdfBuffer(drawFn, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(options);
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    drawFn(doc);
    doc.end();
  });
}

function drawPseudoBarcode(doc, x, y, width, height, input) {
  const text = String(input || "0000000000");
  const bits = Array.from(text)
    .map((ch) => ch.charCodeAt(0).toString(2).padStart(8, "0"))
    .join("");
  const barW = Math.max(1, Math.floor(width / Math.max(bits.length, 1)));
  let cx = x;
  for (const bit of bits) {
    if (bit === "1") doc.rect(cx, y, barW, height).fill("#000");
    cx += barW;
    if (cx > x + width) break;
  }
  doc.strokeColor("#000").lineWidth(0.5).rect(x, y, width, height).stroke();
}

async function generateOrderDetailsPdf(order) {
  return buildPdfBuffer((doc) => {
    const addr = toObject(order.addressSnapshot);
    const items = order.items || [];
    doc.fontSize(20).fillColor("#0f172a").text("Export Commande (Brut)", { align: "left" });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor("#475569");
    doc.text(`Commande: ${order.orderNumber}`);
    doc.text(`Date: ${new Date(order.createdAt).toLocaleString("fr-FR")}`);
    doc.text(`Statut: ${order.status}`);
    doc.text(`Paiement: ${order.paymentMethod}`);
    doc.text(`Tracking: ${order.trackingNumber || "-"}`);
    doc.moveDown(0.6);

    doc.fontSize(13).fillColor("#0f172a").text("Client");
    doc.fontSize(10).fillColor("#334155");
    doc.text(`Nom: ${order.User ? `${order.User.firstName} ${order.User.lastName}` : "-"}`);
    doc.text(`ID client: ${order.userId}`);
    doc.text(`Email: ${order.User?.email || "-"}`);
    doc.text(`Téléphone: ${order.User?.phone || "-"}`);
    doc.moveDown(0.5);

    doc.fontSize(13).fillColor("#0f172a").text("Adresse");
    doc.fontSize(10).fillColor("#334155");
    doc.text(`Label: ${addr.label || "-"}`);
    doc.text(`Rue: ${[addr.number, addr.street].filter(Boolean).join(" ") || "-"}`);
    doc.text(`Quartier/Commune: ${[addr.neighborhood, addr.municipality].filter(Boolean).join(", ") || "-"}`);
    doc.text(`Ville/Pays: ${[addr.city, addr.country].filter(Boolean).join(", ") || "-"}`);
    doc.moveDown(0.6);

    doc.fontSize(13).fillColor("#0f172a").text("Contenu");
    doc.moveDown(0.2);
    items.forEach((item, idx) => {
      const snap = toObject(item.productSnapshot);
      doc.fontSize(10).fillColor("#0f172a").text(`${idx + 1}. ${snap.name || "Article"}`, { continued: true });
      doc.fillColor("#64748b").text(`  x${item.qty}  ${money(item.lineTotal)}`);
      doc.fillColor("#64748b").text(`   SKU: ${snap.sku || "-"} • Poids: ${snap.weightKg || 0}kg • PU: ${money(item.unitPrice)}`);
    });

    doc.moveDown(0.8);
    doc.fontSize(13).fillColor("#0f172a").text("Totaux");
    doc.fontSize(10).fillColor("#334155");
    doc.text(`Sous-total: ${money(order.subtotal)}`);
    doc.text(`Livraison porte: ${money(order.shippingFee)} (${Number(order.shippingFee || 0) > 0 ? "Oui" : "Non"})`);
    doc.text(`Réduction: ${money(order.discountTotal)}`);
    doc.text(`Douane: ${money(order.customsFee)}`);
    doc.fontSize(12).fillColor("#1d4ed8").text(`TOTAL: ${money(order.total)}`);
  });
}

async function generateShippingLabelPdf(order) {
  const CM = 28.3465;
  const width = 10 * CM;
  const height = 15 * CM;
  const addr = toObject(order.addressSnapshot);
  return buildPdfBuffer(
    (doc) => {
      doc.rect(0, 0, width, height).fill("#fff");
      doc.fillColor("#facc15").rect(0, 0, width, 42).fill();
      doc.fillColor("#111827").fontSize(15).font("Helvetica-Bold").text("ITS EXPRESS", 10, 12);
      doc.fontSize(8).font("Helvetica").text("BORDEREAU D'ENVOI", width - 92, 16, { width: 84, align: "right" });

      doc.fillColor("#111827").rect(10, 52, width - 20, 58).stroke("#d1d5db");
      doc.fontSize(7).fillColor("#6b7280").text("DESTINATAIRE", 14, 56);
      doc.fontSize(10).fillColor("#111827").font("Helvetica-Bold").text(order.User ? `${order.User.firstName} ${order.User.lastName}` : "Client", 14, 69);
      doc.font("Helvetica").fontSize(8).text([addr.label, [addr.number, addr.street].filter(Boolean).join(" "), [addr.neighborhood, addr.municipality].filter(Boolean).join(", "), [addr.city, addr.country].filter(Boolean).join(", ")].filter(Boolean).join("\n"), 14, 83, { width: width - 28 });

      doc.rect(10, 116, width - 20, 40).stroke("#d1d5db");
      doc.fontSize(7).fillColor("#6b7280").text("TRACKING", 14, 120);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text(order.trackingNumber || "-", 14, 132);
      doc.font("Helvetica").fontSize(7).fillColor("#374151").text(`Commande: ${order.orderNumber}`, width - 96, 134, { width: 82, align: "right" });

      drawPseudoBarcode(doc, 14, 162, width - 28, 34, order.trackingNumber || order.orderNumber);
      doc.fontSize(7).fillColor("#6b7280").text("Scannez ce code pour le suivi interne", 14, 199);

      doc.rect(10, 214, width - 20, 82).stroke("#d1d5db");
      doc.fontSize(7).fillColor("#6b7280").text("INFOS ENVOI", 14, 218);
      doc.fontSize(8).fillColor("#111827");
      doc.text(`Statut: ${order.status}`, 14, 231);
      doc.text(`Paiement: ${order.paymentMethod}`, 14, 243);
      doc.text(`Livraison à la porte: ${Number(order.shippingFee || 0) > 0 ? "OUI" : "NON"}`, 14, 255);
      doc.text(`Total colis: ${money(order.total)}`, 14, 267);
      doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString("fr-FR")}`, 14, 279);

      doc.fillColor("#111827").fontSize(7).text("ITS Logistics • Document non fiscal • Usage interne", 10, height - 16, {
        width: width - 20,
        align: "center"
      });
    },
    { size: [width, height], margin: 0 }
  );
}

module.exports = { generateOrderDetailsPdf, generateShippingLabelPdf };
