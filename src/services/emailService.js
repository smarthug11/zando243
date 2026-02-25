const nodemailer = require("nodemailer");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");

let transporter = null;

function hasSmtpConfig() {
  return Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
}

function getTransporter() {
  if (transporter) return transporter;
  if (!hasSmtpConfig()) return null;
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass
    }
  });
  return transporter;
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_e) {
    return {};
  }
}

function renderInvoiceEmailHtml(order) {
  const address = normalizeJson(order.addressSnapshot);
  const itemsHtml = (order.items || [])
    .map((item) => {
      const snap = normalizeJson(item.productSnapshot);
      return `
        <tr>
          <td style="padding:12px 10px;border-bottom:1px solid #e2e8f0;">
            <div style="font-weight:600;color:#0f172a;">${escapeHtml(snap.name || "Article")}</div>
            <div style="font-size:12px;color:#64748b;">SKU: ${escapeHtml(snap.sku || "-")} • Poids: ${escapeHtml(snap.weightKg || 0)} kg</div>
          </td>
          <td style="padding:12px 10px;border-bottom:1px solid #e2e8f0;text-align:center;">${item.qty}</td>
          <td style="padding:12px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${money(item.unitPrice)}</td>
          <td style="padding:12px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;">${money(item.lineTotal)}</td>
        </tr>
      `;
    })
    .join("");

  return `
  <!doctype html>
  <html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Facture ${escapeHtml(order.orderNumber)}</title>
  </head>
  <body style="margin:0;background:#eef2f7;font-family:Inter,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:720px;margin:24px auto;padding:0 12px;">
      <div style="background:linear-gradient(135deg,#1d4ed8,#2563eb);border-radius:18px;padding:22px 24px;color:#fff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="vertical-align:middle;">
              <div style="display:flex;align-items:center;gap:10px;">
                <img src="${env.appUrl}/public/images/logosf.png" alt="Logo" width="42" height="42" style="display:block;border-radius:10px;background:#fff;padding:4px;border:1px solid rgba(255,255,255,.35);" />
                <div>
                  <div style="font-size:20px;font-weight:800;line-height:1;">${escapeHtml(env.appName)}</div>
                  <div style="font-size:12px;opacity:.9;margin-top:3px;">Facture de commande</div>
                </div>
              </div>
            </td>
            <td style="text-align:right;vertical-align:middle;">
              <div style="font-size:12px;opacity:.9;">Commande</div>
              <div style="font-size:18px;font-weight:800;">${escapeHtml(order.orderNumber)}</div>
              <div style="font-size:12px;opacity:.9;margin-top:4px;">${new Date(order.createdAt).toLocaleString("fr-FR")}</div>
            </td>
          </tr>
        </table>
      </div>

      <div style="background:#fff;border-radius:18px;margin-top:14px;border:1px solid #dbe3ef;overflow:hidden;">
        <div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="vertical-align:top;padding-right:12px;">
                <div style="font-size:12px;color:#64748b;font-weight:700;letter-spacing:.04em;">CLIENT</div>
                <div style="margin-top:6px;font-weight:700;">${escapeHtml(order.User ? `${order.User.firstName} ${order.User.lastName}` : "")}</div>
                <div style="font-size:13px;color:#334155;">${escapeHtml(order.User?.email || "")}</div>
                <div style="font-size:13px;color:#334155;">${escapeHtml(order.User?.phone || "")}</div>
              </td>
              <td style="vertical-align:top;padding-left:12px;">
                <div style="font-size:12px;color:#64748b;font-weight:700;letter-spacing:.04em;">LIVRAISON</div>
                <div style="margin-top:6px;font-weight:700;">${escapeHtml(address.label || "Adresse")}</div>
                <div style="font-size:13px;color:#334155;">${escapeHtml([address.number, address.street].filter(Boolean).join(" "))}</div>
                <div style="font-size:13px;color:#334155;">${escapeHtml([address.neighborhood, address.municipality, address.city].filter(Boolean).join(", "))}</div>
                <div style="font-size:13px;color:#334155;">${escapeHtml(address.country || "")}</div>
              </td>
            </tr>
          </table>
        </div>

        <div style="padding:8px 24px 0 24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            <thead>
              <tr>
                <th align="left" style="padding:10px;color:#64748b;font-size:12px;border-bottom:2px solid #e2e8f0;">Article</th>
                <th align="center" style="padding:10px;color:#64748b;font-size:12px;border-bottom:2px solid #e2e8f0;">Qté</th>
                <th align="right" style="padding:10px;color:#64748b;font-size:12px;border-bottom:2px solid #e2e8f0;">PU</th>
                <th align="right" style="padding:10px;color:#64748b;font-size:12px;border-bottom:2px solid #e2e8f0;">Total</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
        </div>

        <div style="padding:18px 24px 24px 24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="vertical-align:top;">
                <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#334155;">
                  Statut: <strong>${escapeHtml(order.status)}</strong>
                </div>
                <div style="margin-top:10px;font-size:12px;color:#64748b;">
                  Paiement: ${escapeHtml(order.paymentMethod)}${order.trackingNumber ? ` • Tracking: ${escapeHtml(order.trackingNumber)}` : ""}
                </div>
              </td>
              <td width="280" style="vertical-align:top;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px;">
                  <tr><td style="padding:6px 0;color:#475569;">Sous-total</td><td align="right" style="padding:6px 0;font-weight:600;">${money(order.subtotal)}</td></tr>
                  <tr><td style="padding:6px 0;color:#475569;">Livraison porte</td><td align="right" style="padding:6px 0;font-weight:600;">${money(order.shippingFee)}</td></tr>
                  <tr><td style="padding:6px 0;color:#475569;">Réduction</td><td align="right" style="padding:6px 0;font-weight:600;">-${money(order.discountTotal)}</td></tr>
                  <tr><td style="padding:6px 0;color:#475569;">Frais douane</td><td align="right" style="padding:6px 0;font-weight:600;">${money(order.customsFee)}</td></tr>
                  <tr><td colspan="2" style="border-top:1px solid #dbe3ef;padding-top:10px;"></td></tr>
                  <tr><td style="padding:2px 0;font-size:15px;font-weight:800;color:#0f172a;">TOTAL</td><td align="right" style="padding:2px 0;font-size:20px;font-weight:800;color:#1d4ed8;">${money(order.total)}</td></tr>
                </table>
              </td>
            </tr>
          </table>
        </div>
      </div>

      <div style="text-align:center;font-size:12px;color:#64748b;padding:14px 8px;">
        Merci pour votre achat sur ${escapeHtml(env.appName)}. Votre facture PDF est disponible sur votre compte.
      </div>
    </div>
  </body>
  </html>`;
}

async function sendOrderInvoiceEmail(order, options = {}) {
  const html = renderInvoiceEmailHtml(order);
  const transport = getTransporter();
  if (!transport) {
    logger.info(
      { orderNumber: order.orderNumber, to: order.User?.email, reason: "smtp_not_configured" },
      "Email facture non envoye (SMTP non configuré)"
    );
    return { sent: false, reason: "smtp_not_configured", html };
  }

  const mailOptions = {
    from: env.smtp.from,
    to: order.User?.email,
    subject: `Facture ${order.orderNumber} - ${env.appName}`,
    html
  };
  if (options.attachmentPath) {
    mailOptions.attachments = [{ filename: `${order.orderNumber}.pdf`, path: options.attachmentPath }];
  }

  const info = await transport.sendMail(mailOptions);
  logger.info({ orderNumber: order.orderNumber, messageId: info.messageId, to: order.User?.email }, "Email facture envoye");
  return { sent: true, info };
}

module.exports = { sendOrderInvoiceEmail, renderInvoiceEmailHtml };
