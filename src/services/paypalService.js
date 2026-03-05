const { env } = require("../config/env");
const { AppError } = require("../utils/AppError");

function ensureConfigured() {
  if (!env.paypal.clientId || !env.paypal.clientSecret) {
    throw new AppError("Configuration PayPal manquante", 500, "PAYPAL_NOT_CONFIGURED");
  }
}

async function getAccessToken() {
  ensureConfigured();
  const basic = Buffer.from(`${env.paypal.clientId}:${env.paypal.clientSecret}`).toString("base64");
  const response = await fetch(`${env.paypal.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new AppError(`PayPal OAuth error: ${data.error_description || data.error || response.statusText}`, 502, "PAYPAL_OAUTH_FAILED");
  }
  return data.access_token;
}

async function createCheckoutOrder({ localOrder, returnUrl, cancelUrl }) {
  const token = await getAccessToken();
  const response = await fetch(`${env.paypal.baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: localOrder.id,
          custom_id: localOrder.orderNumber,
          amount: {
            currency_code: "USD",
            value: Number(localOrder.total || 0).toFixed(2)
          },
          description: `Commande ${localOrder.orderNumber}`
        }
      ],
      application_context: {
        return_url: returnUrl,
        cancel_url: cancelUrl,
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING"
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    throw new AppError(`PayPal create order error: ${data.message || response.statusText}`, 502, "PAYPAL_CREATE_ORDER_FAILED");
  }
  const approveUrl = (data.links || []).find((link) => link.rel === "approve")?.href;
  if (!approveUrl) {
    throw new AppError("URL d'approbation PayPal introuvable", 502, "PAYPAL_APPROVAL_URL_MISSING");
  }
  return { paypalOrderId: data.id, approveUrl, raw: data };
}

async function captureCheckoutOrder(paypalOrderId) {
  const token = await getAccessToken();
  const response = await fetch(`${env.paypal.baseUrl}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError(`PayPal capture error: ${data.message || response.statusText}`, 502, "PAYPAL_CAPTURE_FAILED");
  }
  return data;
}

async function verifyWebhookSignature(req) {
  if (!env.paypal.webhookId) return false;
  const token = await getAccessToken();
  const body = req.body || {};
  const response = await fetch(`${env.paypal.baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      transmission_id: req.headers["paypal-transmission-id"],
      transmission_time: req.headers["paypal-transmission-time"],
      cert_url: req.headers["paypal-cert-url"],
      auth_algo: req.headers["paypal-auth-algo"],
      transmission_sig: req.headers["paypal-transmission-sig"],
      webhook_id: env.paypal.webhookId,
      webhook_event: body
    })
  });
  const data = await response.json().catch(() => ({}));
  return response.ok && data.verification_status === "SUCCESS";
}

module.exports = {
  createCheckoutOrder,
  captureCheckoutOrder,
  verifyWebhookSignature
};
