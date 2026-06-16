const rateLimit = require("express-rate-limit");
const { logger } = require("../utils/logger");

// Trace chaque blocage (429) d'un limiteur d'auth pour "jauger" la friction réelle :
// combien d'utilisateurs sont contraints d'attendre, depuis quelle IP, sur quel endpoint.
// Log léger via pino (niveau warn → visible en prod), sans écriture DB → pas
// d'amplification de charge si le blocage vient d'une vraie attaque massive.
function rateLimitBlockHandler(limiterName) {
  return (req, res, _next, options) => {
    logger.warn(
      {
        event: "AUTH_RATE_LIMIT_BLOCK",
        limiter: limiterName,
        ip: req.ip,
        path: req.originalUrl || req.path,
        method: req.method
      },
      `Blocage rate-limit auth (${limiterName}) — l'utilisateur doit patienter`
    );
    res.status(options.statusCode).send(options.message);
  };
}

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitBlockHandler("login"),
  message: { error: { code: "TOO_MANY_ATTEMPTS", message: "Trop de tentatives. Réessayez dans 15 minutes." } }
});

const resetPasswordRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitBlockHandler("reset-password")
});

const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitBlockHandler("register"),
  message: { error: { code: "TOO_MANY_REGISTER", message: "Trop d'inscriptions depuis cette adresse." } }
});

// --- Anti-automation des endpoints Better Auth montés sur /api/auth/* (ASVS V2.2.1) ---
// Les routes SSR /auth2/* sont déjà limitées, mais elles délèguent à Better Auth en
// interne : l'API /api/auth/* reste atteignable directement et doit porter sa propre
// limite, sinon le brute-force / credential stuffing contourne tout. Clé = req.ip
// (derrière `trust proxy`). On ne compte pas les préflights CORS (OPTIONS) ni HEAD.
const ignoreNonMutating = (req) => req.method === "OPTIONS" || req.method === "HEAD";

// Connexion : surface principale de brute-force → limite serrée.
const apiSignInRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: ignoreNonMutating,
  handler: rateLimitBlockHandler("api-sign-in"),
  message: { error: { code: "TOO_MANY_ATTEMPTS", message: "Trop de tentatives de connexion. Réessayez dans 15 minutes." } }
});

// Inscription / réinitialisation de mot de passe : abus et énumération.
const apiSensitiveAuthRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: ignoreNonMutating,
  handler: rateLimitBlockHandler("api-sensitive"),
  message: { error: { code: "TOO_MANY_ATTEMPTS", message: "Trop de tentatives. Réessayez plus tard." } }
});

// Reste de l'API d'auth (get-session, callbacks…) : garde-fou large.
const apiAuthDefaultRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: ignoreNonMutating,
  handler: rateLimitBlockHandler("api-default")
});

const SIGN_IN_PATHS = ["/sign-in"];
const SENSITIVE_AUTH_PATHS = ["/sign-up", "/request-password-reset", "/forget-password", "/reset-password"];
const matchesAny = (pathname, prefixes) => prefixes.some((prefix) => pathname.startsWith(prefix));

// Monté via app.use("/api/auth", ...) : req.path est relatif au point de montage
// (ex. "/sign-in/email"). On aiguille vers le bon seau selon l'action demandée.
function betterAuthRateLimit(req, res, next) {
  const pathname = req.path || "";
  if (matchesAny(pathname, SIGN_IN_PATHS)) return apiSignInRateLimit(req, res, next);
  if (matchesAny(pathname, SENSITIVE_AUTH_PATHS)) return apiSensitiveAuthRateLimit(req, res, next);
  return apiAuthDefaultRateLimit(req, res, next);
}

module.exports = { loginRateLimit, registerRateLimit, resetPasswordRateLimit, betterAuthRateLimit };
