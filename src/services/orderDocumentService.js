const PDFDocument = require("pdfkit");
let QRCode = null;
try {
  // Optionnel: si la dépendance existe, on génère un vrai QR.
  QRCode = require("qrcode");
} catch (_err) {
  QRCode = null;
}

function parseMaybeJson(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_err) {
      return {};
    }
  }
  return value;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function drawPseudoBarcode(doc, text, x, y, width, height) {
  const source = String(text || "TRACKING");
  let cursor = x + 6;
  const maxX = x + width - 6;
  doc.rect(x, y, width, height).stroke("#111111");
  doc.fillColor("#111111");

  for (let i = 0; i < source.length && cursor < maxX; i += 1) {
    const code = source.charCodeAt(i);
    const barCount = (code % 3) + 1;
    for (let j = 0; j < barCount && cursor < maxX; j += 1) {
      const barW = ((code + j) % 2) + 1;
      const barH = height - (code % 8) - 6;
      doc.rect(cursor, y + 3, barW, Math.max(14, barH)).fill("#111111");
      cursor += barW + 1;
    }
    cursor += (code % 2) + 1;
  }

  doc.fillColor("#111111").font("Helvetica").fontSize(7).text(source, x + 2, y + height + 2, { width, align: "center" });
}

async function drawQrOrBarcode(doc, tracking, x, y, width, height) {
  const payload = String(tracking || "TRACKING-PENDING");
  if (QRCode) {
    try {
      const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: Math.floor(width) });
      const base64 = dataUrl.split(",")[1];
      const buffer = Buffer.from(base64, "base64");
      doc.rect(x, y, width, height).stroke("#111111");
      doc.image(buffer, x + 2, y + 2, { fit: [width - 4, height - 4], align: "center", valign: "center" });
      doc.font("Helvetica").fontSize(7).fillColor("#111111").text(payload, x, y + height + 2, { width, align: "center" });
      return;
    } catch (_err) {
      // Fallback automatique vers barcode dessiné.
    }
  }
  drawPseudoBarcode(doc, payload, x, y, width, height);
}

function streamRawOrderPdf(order, res) {
  const addr = parseMaybeJson(order.addressSnapshot);
  const items = order.items || [];
  const filename = `commande-${order.orderNumber || order.id}.pdf`;
  const doc = new PDFDocument({ size: "A4", margin: 40 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  doc.fontSize(20).text("Export brut commande", { align: "left" });
  doc.moveDown(0.7);
  doc.fontSize(11);
  doc.text(`Commande: ${order.orderNumber || "-"}`);
  doc.text(`ID commande: ${order.id}`);
  doc.text(`Date: ${new Date(order.createdAt).toLocaleString("fr-FR")}`);
  doc.text(`Statut: ${order.status}`);
  doc.text(`Paiement: ${order.paymentMethod || "-"}`);
  doc.text(`Tracking: ${order.trackingNumber || "-"}`);
  doc.moveDown(0.7);

  doc.fontSize(13).text("Client");
  doc.fontSize(11);
  doc.text(`ID client: ${order.userId || "-"}`);
  doc.text(`Nom: ${order.User ? `${order.User.firstName} ${order.User.lastName}` : "-"}`);
  doc.text(`Email: ${order.User?.email || "-"}`);
  doc.text(`Téléphone: ${order.User?.phone || "-"}`);
  doc.moveDown(0.7);

  doc.fontSize(13).text("Adresse destination (snapshot)");
  doc.fontSize(11);
  doc.text(`Label: ${addr.label || "-"}`);
  doc.text(`Numero: ${addr.number || "-"}`);
  doc.text(`Rue: ${addr.street || "-"}`);
  doc.text(`Quartier: ${addr.neighborhood || "-"}`);
  doc.text(`Commune: ${addr.municipality || "-"}`);
  doc.text(`Ville: ${addr.city || "-"}`);
  doc.text(`Pays: ${addr.country || "-"}`);
  doc.moveDown(0.7);

  doc.fontSize(13).text("Totaux");
  doc.fontSize(11);
  doc.text(`Sous-total: $${money(order.subtotal)}`);
  doc.text(`Livraison porte: $${money(order.shippingFee)}`);
  doc.text(`Reduction: $${money(order.discountTotal)}`);
  doc.text(`Frais douane: $${money(order.customsFee)}`);
  doc.text(`Total: $${money(order.total)}`);
  doc.moveDown(0.7);

  doc.fontSize(13).text("Articles");
  doc.moveDown(0.3);
  items.forEach((item, idx) => {
    const snap = parseMaybeJson(item.productSnapshot);
    doc.fontSize(11).text(
      `${idx + 1}. ${snap.name || "Article"} | SKU: ${snap.sku || "-"} | Qty: ${item.qty} | PU: $${money(item.unitPrice)} | Ligne: $${money(item.lineTotal)}`
    );
  });

  doc.moveDown(0.7);
  doc.fontSize(13).text("Historique statut");
  const history = (order.statusHistory || []).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  history.forEach((h) => {
    doc.fontSize(11).text(`${new Date(h.createdAt).toLocaleString("fr-FR")} | ${h.status} | ${h.note || ""}`);
  });

  doc.end();
}

async function streamShippingLabelPdf(order, res) {
  const addr = parseMaybeJson(order.addressSnapshot);
  const items = order.items || [];
  const filename = `bordereau-${order.orderNumber || order.id}.pdf`;
  const cm = 28.3465;
  const width = 10 * cm;
  const height = 15 * cm;

  const doc = new PDFDocument({ size: [width, height], margin: 12 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  doc.rect(0, 0, width, 42).fill("#FFCC00");
  doc.fillColor("#D40511").font("Helvetica-Bold").fontSize(18).text("ITS EXPRESS", 12, 12);
  doc.fillColor("#111111").font("Helvetica").fontSize(8).text("BORDEREAU D'ENVOI", width - 110, 16, { width: 98, align: "right" });

  let y = 52;
  doc.fillColor("#111111").font("Helvetica-Bold").fontSize(10).text("EXPEDITEUR", 12, y);
  y += 14;
  doc.font("Helvetica").fontSize(9).text("Zando243 Marketplace", 12, y);
  y += 12;
  doc.text("Service logistique", 12, y);
  y += 16;

  doc.font("Helvetica-Bold").fontSize(10).text("DESTINATAIRE", 12, y);
  y += 14;
  doc.font("Helvetica").fontSize(9);
  doc.text(`${order.User ? `${order.User.firstName} ${order.User.lastName}` : "Client"}`, 12, y);
  y += 12;
  doc.text(`${addr.number || ""} ${addr.street || "-"}`.trim(), 12, y, { width: width - 24 });
  y += 12;
  doc.text(`${addr.neighborhood || ""} ${addr.municipality || ""}`.trim(), 12, y, { width: width - 24 });
  y += 12;
  doc.text(`${addr.city || "-"}, ${addr.country || "-"}`, 12, y);
  y += 14;
  if (order.User?.phone) {
    doc.text(`Tel: ${order.User.phone}`, 12, y);
    y += 12;
  }

  doc.roundedRect(12, y, width - 24, 42, 4).stroke("#111111");
  doc.font("Helvetica-Bold").fontSize(11).text(`N° COMMANDE: ${order.orderNumber || "-"}`, 16, y + 7);
  doc.font("Helvetica").fontSize(9).text(`Tracking: ${order.trackingNumber || "-"}`, 16, y + 23);
  y += 50;

  const totalQty = items.reduce((acc, item) => acc + Number(item.qty || 0), 0);
  const totalWeight = items.reduce((acc, item) => {
    const snap = parseMaybeJson(item.productSnapshot);
    return acc + Number(snap.weightKg || 0) * Number(item.qty || 0);
  }, 0);
  const door = Number(order.shippingFee || 0) > 0 ? "OUI" : "NON";

  doc.font("Helvetica-Bold").fontSize(10).text("DETAILS ENVOI", 12, y);
  y += 14;
  doc.font("Helvetica").fontSize(9);
  doc.text(`Date expedition: ${new Date().toLocaleDateString("fr-FR")}`, 12, y);
  y += 12;
  doc.text(`Pieces: ${totalQty}`, 12, y);
  y += 12;
  doc.text(`Poids total: ${totalWeight.toFixed(2)} kg`, 12, y);
  y += 12;
  doc.text(`Livraison a la porte: ${door}`, 12, y);
  y += 12;
  doc.text(`Paiement: ${order.paymentMethod || "-"}`, 12, y);
  y += 18;

  doc.rect(12, y, width - 24, 46).fillAndStroke("#F4F4F4", "#111111");
  doc.fillColor("#111111").font("Helvetica-Bold").fontSize(18).text(order.trackingNumber || "TRACKING PENDING", 12, y + 14, {
    width: width - 24,
    align: "center"
  });
  y += 56;

  const codeWidth = 92;
  const codeHeight = 52;
  await drawQrOrBarcode(doc, order.trackingNumber || "TRACKING-PENDING", width - codeWidth - 12, y - 6, codeWidth, codeHeight);

  doc.font("Helvetica").fontSize(7).fillColor("#444444").text("Instruction: scanner le tracking au depot puis a la remise client.", 12, y, {
    width: width - codeWidth - 18
  });
  doc.text(`Genere le ${new Date().toLocaleString("fr-FR")}`, 12, height - 18, { width: width - 24, align: "right" });

  doc.end();
}

module.exports = {
  streamRawOrderPdf,
  streamShippingLabelPdf
};
