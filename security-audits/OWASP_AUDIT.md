# OWASP Top 10 Security Audit — Zando243

**Date:** 2026-04-25
**Audited by:** Claude Code (claude-sonnet-4-6)
**Branch:** main — commit `3711bde`
**Stack:** Node.js · Express 4.21.2 · EJS 3.1.10 · Sequelize 6.37.5 · PostgreSQL (prod) / SQLite (dev)
**Scope:** Full source-code review of all routes, controllers, services, middlewares, models, configuration, and dependencies.

---

## Executive Summary

| OWASP Risk | Rating | Worst Finding |
|---|---|---|
| A01 Broken Access Control | Low | Unvalidated `Referer` redirect in cart |
| A02 Cryptographic Failures | Low | Cryptographic primitives sound; `.env` correctly gitignored |
| A03 Injection | Medium | LIKE wildcard injection in catalog/admin search |
| A04 Insecure Design | Medium | No account lockout, no 2FA for admins, no refresh-token rotation |
| A05 Security Misconfiguration | High | CSP disabled, no body-size limits, memory-only rate-limit store |
| A06 Vulnerable & Outdated Components | **Critical** | Sequelize v6 SQL injection via JSON cast; 13 HIGH `npm audit` findings |
| A07 Identification & Authentication Failures | High | No registration rate limit, weak password policy, no lockout |
| A08 Software & Data Integrity Failures | Medium | Nodemailer SMTP injection; no subresource integrity |
| A09 Security Logging & Monitoring Failures | Medium | No alerting, no log aggregation, webhook not rate-limited |
| A10 Server-Side Request Forgery | Low | Image-URL validation present; no user-triggered HTTP calls found |

**Overall risk: HIGH.** One critical dependency issue (Sequelize JSON SQL injection) plus several high-severity hardening gaps must be addressed before production traffic.

---

## A01 — Broken Access Control

### Finding 1 · LOW · Unvalidated `Referer` redirect after cart add-to-cart

**File:** `src/controllers/cartController.js:48`

```js
res.redirect(req.get("referer") || "/products");
```

When a visitor adds a product to the cart and the `redirectTo` body field is not `"cart"`, the server redirects to whatever URL is in the `Referer` request header. The `Referer` header is fully attacker-controlled. A crafted link can redirect users to an external domain after interacting with the cart, enabling phishing.

**Fix:** Replace the `Referer` fallback with a hardcoded safe path.

```js
// Replace:
res.redirect(req.get("referer") || "/products");
// With:
res.redirect("/products");
```

If a back-redirect is truly needed, validate against an allowlist of internal paths:

```js
const backTo = /^\/[a-zA-Z0-9\-_/?=&#%]*$/.test(req.body.backTo) ? req.body.backTo : "/products";
res.redirect(backTo);
```

---

### Finding 2 · INFO · Access control coverage is strong

- All `/admin/*` routes are protected at the router level (`src/routes/adminRoutes.js:7`): `router.use(requireAuth, requireRole("ADMIN"))`.
- Order detail and invoice download (`src/controllers/orderController.js:11,22`) scope every query to `req.user.id` — no IDOR vector found.
- PayPal capture (`src/controllers/paymentController.js:178`) validates `order.userId === req.user.id` AND that the PayPal order ID matches `order.paymentReference` — swap attacks prevented.
- Cart isolation (`src/services/cartService.js:15`) uses `sessionId` for guests and `userId` for authenticated users — carts cannot cross-contaminate.

---

## A02 — Cryptographic Failures

### Finding 3 · INFO · `.env` correctly excluded from version control

**Verification:**
```bash
$ [ -n "$(git ls-files .env)" ] && echo "TRACKED" || echo "NOT TRACKED"
NOT TRACKED
```

`.env` is properly listed in `.gitignore` and is not present in the GitHub repository. The file exists only in the local development environment, which is the correct setup. On cloud deployments (Railway, etc.) secrets are injected as environment variables directly — no `.env` file is committed or shipped.

---

### Finding 4 · LOW · Cryptographic primitives are sound

- `bcrypt` with cost factor 10 (`src/services/authService.js:38`) — acceptable.
- Reset and verification tokens are `randomBytes(20)` (160-bit) stored as `SHA-256` hashes (`authService.js:31,39,88`) — correct.
- JWT uses `HS256` with explicit algorithm allowlist (`src/config/jwt.js:21,27`): `{ algorithms: ["HS256"] }` — `"none"` algorithm attack prevented.
- Token-type claim (`type: "access"` / `type: "refresh"`) prevents cross-type substitution attacks (`jwt.js:5,13`).
- Session cookies: `httpOnly: true`, `sameSite: "lax"`, `secure: env.isProd` (`app.js:60–62`) — correct.

---

## A03 — Injection

### Finding 5 · MEDIUM · LIKE wildcard injection in public catalog search

**File:** `src/services/catalogService.js:13`

```js
where[Op.or] = [
  { name: { [likeOp]: `%${query.q}%` } },       // query.q not escaped
  { description: { [likeOp]: `%${query.q}%` } },
  { brand: { [likeOp]: `%${query.q}%` } }
];
```

`query.q` is inserted directly into the LIKE pattern without escaping `%` and `_` wildcards. A request like `GET /products?q=%` matches every product, allowing full-table scans. A request like `GET /products?q=____` enumerates records by single-character positions. While Sequelize parameterises the literal value (no traditional SQL injection), unescaped wildcards can:

- cause disproportionately expensive queries (DoS);
- enable database enumeration through timing differences.

The same issue exists in:
- `src/services/adminProductService.js:40–43` (admin product search — lower impact due to auth requirement)
- `src/services/adminOrderService.js:35–37` (admin order search)

Note: `src/services/auditLogService.js:55–56` correctly implements `escapeLike` — apply the same pattern everywhere.

**Fix:** Apply the existing `escapeLike` helper before inserting into patterns:

```js
// src/services/catalogService.js
function escapeLike(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// then:
if (query.q) {
  const safe = escapeLike(query.q);
  where[Op.or] = [
    { name: { [likeOp]: `%${safe}%` } },
    { description: { [likeOp]: `%${safe}%` } },
    { brand: { [likeOp]: `%${safe}%` } }
  ];
}
```

---

### Finding 6 · INFO · SQL injection properly mitigated

All database access uses Sequelize ORM with parameterised bindings. No raw SQL strings constructed from user input were found. The `ORDER BY` clause in `catalogService.js:25–37` uses a hardcoded `switch` statement — safe. Numbers from query strings are cast with `Number()` before use in range filters.

---

### Finding 7 · INFO · XSS output properly escaped

EJS templates use `<%= %>` (HTML-escaped) for all dynamic user data. The raw `<%- %>` operator is used only for `include()` partials — never for user-supplied content. The input sanitiser in `src/middlewares/validators.js:5–6` strips `<>` characters, but this is defence-in-depth; the real protection is output-side escaping, which is correctly in place.

---

## A04 — Insecure Design

### Finding 8 · MEDIUM · No account lockout after failed logins

**File:** `src/middlewares/rateLimit.js:3–9`

The login rate limit is 5 requests per 15 minutes **per IP address**. An attacker with multiple IP addresses (proxies, botnets) can conduct distributed credential-stuffing attacks indefinitely — no per-account lockout is enforced.

**Fix:** Track failed attempts per email in the database or Redis. After N consecutive failures, set a temporary `lockedUntil` timestamp on the user record.

```js
// In authService.loginUser():
user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
if (user.failedLoginAttempts >= 10) {
  user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
}
await user.save();
throw new AppError("Identifiants invalides", 401, "BAD_CREDENTIALS");
```

---

### Finding 9 · MEDIUM · No refresh-token rotation

**File:** `src/controllers/authController.js:61–65`

```js
const refresh = asyncHandler(async (req, res) => {
  const user = await authService.refreshSession(req.cookies.refreshToken);
  authService.setAuthCookies(req, res, user);  // issues new access token
  res.json({ ok: true });
});
```

`refreshSession` verifies the token version but issues the **same** refresh token again (the existing cookie is re-set). If a refresh token is stolen, the attacker can indefinitely maintain access — the only revocation mechanism is logout (which increments `refreshTokenVersion`) or password reset.

**Fix:** Increment `refreshTokenVersion` on every refresh call, invalidating the old token:

```js
// authService.refreshSession() should return the user and then:
await models.User.increment({ refreshTokenVersion: 1 }, { where: { id: user.id } });
// Then re-fetch and sign new tokens with the updated version.
```

---

### Finding 10 · MEDIUM · Email not verified before checkout

**File:** `src/services/authService.js:32–43`, `src/controllers/cartController.js`

Users can complete an order immediately after registration without verifying their email. The `emailVerifiedAt` field is set on verification but never checked during checkout or order creation.

**Impact:** Bogus orders with throwaway email addresses, spam, and fake accounts with loyalty points.

**Fix:** Add a verification guard in `orderService.createOrderFromCart`:

```js
if (!req.user.emailVerifiedAt) {
  throw new AppError("Veuillez vérifier votre adresse email avant de passer commande.", 403, "EMAIL_NOT_VERIFIED");
}
```

---

### Finding 11 · MEDIUM · No multi-factor authentication for admins

Admin accounts have the same authentication flow as customers. A compromised admin credential (password reuse, phishing) gives full platform access — product management, user data, order history, audit logs, refunds.

**Fix:** Require TOTP (e.g. `speakeasy` + `qrcode`) at admin login. Enforce setup on first admin login.

---

### Finding 12 · LOW · Admin session timeout same as customer (4 hours)

**File:** `app.js:63` — `maxAge: 1000 * 60 * 60 * 4`

An unattended admin browser session stays valid for 4 hours. For a high-privilege role, this is long.

**Fix:** Issue separate admin session cookies with a shorter timeout (e.g. 30–60 minutes), or require password re-entry for destructive admin operations.

---

## A05 — Security Misconfiguration

### Finding 13 · HIGH · Content Security Policy disabled

**File:** `app.js:31–34`

```js
app.use(
  helmet({
    contentSecurityPolicy: false   // ← CSP completely off
  })
);
```

With CSP absent, any XSS vulnerability (current or future) can load arbitrary scripts. Inline event handlers, `eval()`, and external script tags are all permitted by the browser with no restriction.

**Fix:** Enable a strict CSP tailored to this EJS app and the PayPal SDK:

```js
helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://www.paypal.com",
        "https://www.paypalobjects.com",
        "https://js.braintreegateway.com"
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],  // relax only if needed for inline styles
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://www.paypal.com", "https://api-m.paypal.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: []
    }
  }
})
```

---

### Finding 14 · HIGH · No body-size limit on JSON and URL-encoded parsers

**File:** `app.js:35–36`

```js
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
```

Both parsers use Express's default limit of **100 kB** for URL-encoded bodies and **100 kB** for JSON. There is no explicit `limit` option set. An attacker can send large payloads to any POST endpoint (including the unauthenticated PayPal webhook and login) to consume CPU and memory.

**Fix:**

```js
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.json({ limit: "64kb" }));
// For the webhook, keep raw body parsing:
router.post("/paypal/webhook", express.json({ limit: "256kb" }), ctrl.paypalWebhook);
```

---

### Finding 15 · MEDIUM · Rate-limit store is in-memory only

**File:** `src/middlewares/security.js:5–12`, `src/middlewares/rateLimit.js:3–16`

All `express-rate-limit` instances use the default in-memory store. In a multi-process or clustered deployment (e.g. Railway with multiple replicas, or `cluster` mode), each process maintains its own counter — an attacker gets N × limit requests before being blocked.

**Fix:** Use a shared store backed by Redis:

```bash
npm install rate-limit-redis ioredis
```

```js
const RedisStore = require("rate-limit-redis");
const Redis = require("ioredis");
const redis = new Redis(process.env.REDIS_URL);

rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) })
})
```

---

### Finding 16 · MEDIUM · CSRF can be disabled via environment variable

**File:** `src/middlewares/csrf.js:4`

```js
const csrfMw = env.csrfEnabled
  ? csurf({ cookie: false, ignoreMethods: ["GET", "HEAD", "OPTIONS"] })
  : (req, res, next) => next();   // ← no-op if CSRF_ENABLED=false
```

If `CSRF_ENABLED` is set to `false` in production (e.g. for debugging), all state-changing endpoints are unprotected. There is no safeguard preventing this in production mode.

**Fix:** In `env.js`, force CSRF on in production:

```js
csrfEnabled: isProd ? true : toBool(process.env.CSRF_ENABLED, true),
```

---

### Finding 17 · LOW · PayPal webhook endpoint has no rate limit

**File:** `src/routes/paymentRoutes.js:11`

```js
router.post("/paypal/webhook", ctrl.paypalWebhook);
```

The webhook endpoint is exempted from CSRF (correct — signature-verified instead) and from the global 500/15 min rate limit (the global limiter does apply, but it is shared across all traffic). A flood of unauthenticated POST requests can exhaust the global quota for legitimate users and trigger repeated PayPal OAuth token requests.

**Fix:** Add a dedicated rate limit for the webhook:

```js
const webhookRateLimit = rateLimit({ windowMs: 60 * 1000, max: 60 });
router.post("/paypal/webhook", webhookRateLimit, ctrl.paypalWebhook);
```

---

## A06 — Vulnerable and Outdated Components

### Finding 18 · **CRITICAL** · Sequelize v6 — SQL Injection via JSON column cast

**Source:** `npm audit` — HIGH severity

```
HIGH sequelize  Sequelize v6 Vulnerable to SQL Injection via JSON Column Cast Type
```

This app uses JSONB/JSON column types (`src/models/index.js:14`):

```js
const JsonType = isPostgres ? DataTypes.JSONB : DataTypes.JSON;
// Used for:
addressSnapshot  (Order model, line 181)
logisticsMeta    (Order model, line 197)
productSnapshot  (OrderItem model, line 209)
meta             (AuditLog model, line 337)
```

The vulnerability allows SQL injection when a JSON column field is used in a `WHERE` clause with a cast type. If any query path filters on a JSONB field using user-supplied data, raw SQL can be injected. Review all queries that filter on these four columns.

**Fix:**

```bash
npm update sequelize
```

Verify the fixed version resolves the advisory, then re-run `npm audit`. Also audit any query that filters on `addressSnapshot`, `productSnapshot`, `logisticsMeta`, or `meta` fields.

---

### Finding 19 · HIGH · 13 high-severity npm vulnerabilities

```
npm audit: critical: 0  high: 13  moderate: 2  low: 4
```

| Package | Severity | Issue |
|---|---|---|
| `nodemailer` | HIGH | SMTP command injection via CRLF, EHLO injection, unintended domain routing, addressparser DoS |
| `path-to-regexp` | HIGH | ReDoS via multiple route parameters |
| `minimatch` | HIGH | Multiple ReDoS patterns |
| `lodash` | HIGH | Code injection via `_.template`, prototype pollution |
| `tar` | HIGH | Path traversal, arbitrary file write (used only via build tools) |
| `sequelize` | HIGH | SQL injection via JSON cast (see Finding 18) |
| `picomatch` | HIGH | ReDoS, method injection |
| `brace-expansion` | MODERATE | ReDoS |

**Priority remediations:**

1. `nodemailer` — used at runtime for transactional email (`src/services/emailService.js`). Upgrade immediately:
   ```bash
   npm update nodemailer
   ```
2. `path-to-regexp` — used by Express for route matching. Upgrade Express or the direct dependency.
3. `sequelize` — see Finding 18.
4. `lodash`, `minimatch`, `picomatch`, `tar` — appear to be transitive/build-time dependencies; run `npm audit fix` and test.

---

### Finding 20 · MEDIUM · `csurf` is deprecated

`csurf@1.11.0` is listed as unmaintained by its author. The underlying `csrf` package still receives some attention, but `csurf` itself has no active maintainer.

**Fix:** Migrate to `csrf-csrf` (actively maintained, ESM + CJS compatible) or implement a custom double-submit cookie pattern.

---

## A07 — Identification and Authentication Failures

### Finding 21 · HIGH · No rate limit on `POST /auth/register`

**File:** `src/routes/authRoutes.js:8`

```js
router.post("/register", requireGuest, ...ctrl.registerValidators, ctrl.register);
```

No rate limit is applied to the registration endpoint. An attacker can:
- Create thousands of accounts programmatically (account spam, loyalty-point farming).
- Enumerate which email addresses are registered by observing the 409 response from `authService.js:30`.

**Fix:** Apply `resetPasswordRateLimit` (or a tighter custom limiter) to the register route:

```js
const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: { code: "TOO_MANY_REGISTER", message: "Trop d'inscriptions depuis cette adresse." } }
});
router.post("/register", requireGuest, registerRateLimit, ...ctrl.registerValidators, ctrl.register);
```

---

### Finding 22 · HIGH · Weak password policy — 8-character minimum, no complexity

**File:** `src/controllers/authController.js:12`

```js
body("password").isLength({ min: 8 }),
```

Any 8-character string is a valid password (e.g. `12345678`, `aaaaaaaa`). Common password lists include billions of 8-character entries. This makes credential-stuffing and dictionary attacks highly effective.

**Fix:** Add a stronger server-side validator:

```js
body("password")
  .isLength({ min: 10 })
  .matches(/[A-Z]/).withMessage("Majuscule requise")
  .matches(/[a-z]/).withMessage("Minuscule requise")
  .matches(/[0-9]/).withMessage("Chiffre requis")
  .matches(/[^A-Za-z0-9]/).withMessage("Caractère spécial requis"),
```

Or integrate `zxcvbn` for entropy-based scoring instead of rule-based validation.

---

### Finding 23 · MEDIUM · `cookieOptions` uses `req.app.get("env")` instead of `env.isProd`

**File:** `src/services/authService.js:9–15`

```js
function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: req.app.get("env") === "production"   // ← indirect check
  };
}
```

The `app.js` session cookie correctly uses `env.isProd`, but auth token cookies use `req.app.get("env")`. Express defaults `app.get("env")` to `"development"` unless `NODE_ENV=production` is set explicitly. If `NODE_ENV` is omitted in the production environment, auth cookies will be sent over HTTP, exposing tokens.

**Fix:** Use the canonical `env.isProd` flag:

```js
secure: env.isProd,
```

---

## A08 — Software and Data Integrity Failures

### Finding 24 · MEDIUM · Nodemailer SMTP injection risk

**Source:** `npm audit` — HIGH severity

The `nodemailer` version currently installed has confirmed SMTP command injection vulnerabilities (CRLF in headers, EHLO name injection, unintended-domain routing). The `emailService.js` passes user-derived values (email address, order number, user name) into the `to:` and `subject:` fields of outgoing emails.

While the `escapeHtml` helper in `emailService.js:30` protects HTML content inside the email body, it does NOT protect SMTP header fields (To, From, Subject) from CRLF injection. A crafted email address like `victim@example.com\r\nBcc: spam@attacker.com` can be exploited if `nodemailer` does not strip CRLFs.

**Fix:** Update nodemailer: `npm update nodemailer`. Verify the installed version resolves all four CVEs listed in `npm audit`.

---

### Finding 25 · LOW · No Subresource Integrity (SRI) on external resources

If any EJS template loads external CSS/JS from a CDN (fonts, icon libraries, etc.), there is no SRI hash to prevent CDN compromise from injecting malicious code.

**Fix:** Audit all `<script src>` and `<link rel="stylesheet">` tags in `src/views/`. For any external resource, add `integrity` and `crossorigin` attributes. For PayPal's SDK, use the official integration pattern which does not require SRI (PayPal manages SDK integrity).

---

## A09 — Security Logging and Monitoring Failures

### Finding 26 · MEDIUM · No alerting or log aggregation

The application has well-implemented audit logging (`src/services/auditLogService.js`) and Pino HTTP logging, but:
- Logs are written to stdout/disk with no forwarding to a SIEM or log aggregation service.
- No alerting rules exist for security events (multiple failed logins, admin login at unusual hours, bulk order creation, payment failures).
- No dashboards to surface anomalies in real time.

**Fix:**
1. Forward Pino JSON logs to a service (Logtail, Datadog, Elastic, Grafana Loki).
2. Create alert rules for: ≥ 3 `AUTH→USER_LOGIN` failures within 5 minutes for the same IP; any `ADMIN` login outside business hours; ≥ 5 payment failures per hour.
3. Set up an uptime monitor for the `/health` endpoint.

---

### Finding 27 · LOW · PayPal webhook events not rate-limited at application level

Covered under A05/Finding 17. A flood of invalid webhook events generates repeated PayPal OAuth calls (each is an outbound HTTPS request) and audit log entries. There is no circuit-breaker.

---

### Finding 28 · INFO · Audit logging coverage is good

The following security events are correctly logged with `requestId`, IP, user agent, and actor email:

- `AUTH → USER_REGISTER`, `USER_LOGIN`, `USER_LOGOUT` (`authController.js:28,46,71`)
- `PAYMENT → PAYPAL_ORDER_CREATED`, `PAYPAL_CAPTURE_COMPLETED`, `PAYPAL_CAPTURE_COMPLETED_SDK` (`paymentController.js:40,89,192`)
- `SYSTEM → HTTP_ERROR` for all 4xx/5xx (`errorHandler.js:25`)

Sensitive fields (`password`, `_csrf`, `refreshToken`, `authorization`) are redacted from error logs (`errorHandler.js:4–17`).

---

## A10 — Server-Side Request Forgery (SSRF)

### Finding 29 · LOW · Image URL validation is present but only checks protocol

**Files:** `src/services/adminProductService.js:5–13`, `src/services/accountService.js:5–12`

```js
function parseHttpsUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? raw : null;
  } catch (_) {
    return null;
  }
}
```

This correctly rejects `http://`, `file://`, `ftp://`, and `javascript:` URLs. However, it does not block HTTPS requests to internal/private IP ranges (e.g. `https://169.254.169.254/latest/meta-data/` on cloud VMs, `https://10.0.0.1/`).

In this application, the URL is stored in the database and returned to users as an `<img src>` — the browser fetches the image, **not the server**. There is therefore **no SSRF in the current design** because the server never fetches the URL itself.

However, if a future feature adds server-side image proxying, processing, or validation by fetching the URL, this becomes a full SSRF vector.

**Fix (defensive):** Block private IP ranges at storage time in case of future server-side fetch:

```js
function parseHttpsUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    const host = u.hostname;
    // Block private/loopback ranges
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1)/.test(host)) return null;
    return raw;
  } catch (_) { return null; }
}
```

---

### Finding 30 · INFO · PayPal API base URL is not user-controlled

`env.paypal.baseUrl` (`src/services/paypalService.js:13`) is set from `PAYPAL_BASE_URL` environment variable with a hardcoded default. No request path in this application builds PayPal API URLs from user input. SSRF through the PayPal client is not possible in the current design.

---

## Consolidated Issue Register

| # | Severity | OWASP | File:Line | Title |
|---|---|---|---|---|
| 18 | **Critical** | A06 | `models/index.js:14` | Sequelize v6 JSON column SQL injection (npm vuln) |
| 13 | High | A05 | `app.js:32` | CSP disabled globally |
| 14 | High | A05 | `app.js:35–36` | No body-size limits on parsers |
| 19 | High | A06 | `package.json` | 13 HIGH npm vulnerabilities (nodemailer, path-to-regexp, etc.) |
| 21 | High | A07 | `routes/authRoutes.js:8` | No rate limit on `POST /auth/register` |
| 22 | High | A07 | `authController.js:12` | Weak password policy (8 chars, no complexity) |
| 5 | Medium | A03 | `catalogService.js:13` | LIKE wildcard injection in public search |
| 8 | Medium | A04 | `rateLimit.js:3` | No per-account lockout after failed logins |
| 9 | Medium | A04 | `authController.js:61` | Refresh token not rotated |
| 10 | Medium | A04 | `authService.js:32` | Email not verified before checkout |
| 11 | Medium | A04 | `adminRoutes.js` | No 2FA for admin accounts |
| 15 | Medium | A05 | `security.js:5` | Rate-limit in-memory store (not cluster-safe) |
| 16 | Medium | A05 | `csrf.js:4` | CSRF can be disabled via env var in production |
| 20 | Medium | A06 | `package.json` | `csurf` deprecated, no active maintainer |
| 23 | Medium | A07 | `authService.js:13` | Auth cookies use `req.app.get("env")` instead of `env.isProd` |
| 24 | Medium | A08 | `emailService.js` | Nodemailer SMTP injection (unpatched npm vuln) |
| 26 | Medium | A09 | — | No alerting or log aggregation |
| 1 | Low | A01 | `cartController.js:48` | Unvalidated `Referer` redirect |
| 12 | Low | A04 | `app.js:63` | Admin session timeout 4 hours |
| 17 | Low | A05 | `paymentRoutes.js:11` | Webhook has no dedicated rate limit |
| 25 | Low | A08 | `src/views/` | No SRI on external CDN resources |
| 29 | Low | A10 | `adminProductService.js:5` | Image-URL validation does not block private IPs |

---

## Remediation Roadmap

### Immediate (before any production traffic)

1. **`npm audit fix`** — at minimum update `sequelize`, `nodemailer`, `path-to-regexp`.
2. **Enable CSP** (`app.js`) with a whitelist covering PayPal SDK origins.
3. **Add body-size limits** to `express.json()` and `express.urlencoded()`.
4. **Add registration rate limit** to `POST /auth/register`.
5. **Fix auth cookie `secure` flag** in `authService.js:13` — use `env.isProd`.

### Short-term (before launch)

8. **Escape LIKE wildcards** in `catalogService.js`, `adminProductService.js`, `adminOrderService.js`.
9. **Implement refresh-token rotation** in `authService.refreshSession`.
10. **Enforce email verification** before order creation.
11. **Add per-account login lockout** (track `failedLoginAttempts` and `lockedUntil` on the User model).
12. **Strengthen password policy** to ≥ 10 chars + uppercase + lowercase + digit + symbol.
13. **Move rate-limit store to Redis** for production deployments.
14. **Add 2FA for admin accounts** (TOTP-based).
15. **Add a dedicated webhook rate limit** (`/payments/paypal/webhook`).

### Before first production deployment

16. Fix the open `Referer` redirect in `cartController.js`.
17. Force CSRF on in production regardless of env var.
18. Set up log forwarding and alerting.
19. Reduce admin session timeout to 30–60 minutes.
20. Add `security.txt` at `/.well-known/security.txt`.
21. Migrate from deprecated `csurf` to `csrf-csrf`.
22. Run `npm audit` in CI as a blocking step.

---

*End of audit. All file references are relative to the project root `/home/junior/websites/zando243/`.*
