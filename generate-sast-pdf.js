const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "storage", "SAST_REPORT_V2.pdf");
const doc = new PDFDocument({ margin: 50, size: "A4" });
const stream = fs.createWriteStream(OUT);
doc.pipe(stream);

// ── Palette
const RED      = "#C0392B";
const ORANGE   = "#E67E22";
const YELLOW   = "#F1C40F";
const GREEN    = "#27AE60";
const BLUE     = "#2563EB";
const DARKBLUE = "#1E3A5F";
const DARK     = "#1A1A2E";
const GREY     = "#6B7280";
const LIGHTBG  = "#F8FAFC";
const WHITE    = "#FFFFFF";

function levelColor(level) {
  if (level === "CRITIQUE") return RED;
  if (level === "ÉLEVÉ")    return ORANGE;
  if (level === "MOYEN")    return YELLOW;
  return GREEN;
}

// ══════════════════════════════════════════
// PAGE DE GARDE
// ══════════════════════════════════════════
doc.rect(0, 0, doc.page.width, 200).fill(DARKBLUE);

doc.fillColor(WHITE)
   .font("Helvetica-Bold")
   .fontSize(28)
   .text("RAPPORT SAST v2", 50, 60, { align: "center" });

doc.fontSize(14)
   .font("Helvetica")
   .text("Audit de Sécurité Approfondi — Zando243", 50, 100, { align: "center" });

doc.fontSize(11)
   .fillColor("#A8C8F8")
   .text("2026-04-25  •  Analyse statique manuelle + traçage de flux de données", 50, 128, { align: "center" });

// Résumé chiffré sous le banner
doc.rect(0, 200, doc.page.width, 90).fill("#EEF2FF");

const cols = [
  { label: "NOUVELLES FAILLES",    val: "3",  color: RED    },
  { label: "PERSISTANTES",          val: "9",  color: ORANGE },
  { label: "CORRIGÉES (vs v1)",     val: "8",  color: GREEN  },
  { label: "TOTAL IDENTIFIÉES",     val: "12", color: BLUE   },
];

cols.forEach((c, i) => {
  const x = 50 + i * 127;
  doc.fillColor(c.color).font("Helvetica-Bold").fontSize(26).text(c.val, x, 216, { width: 110, align: "center" });
  doc.fillColor(GREY).font("Helvetica").fontSize(7).text(c.label, x, 248, { width: 110, align: "center" });
});

doc.moveDown(6);

// ── Progression v1 → v2
function sectionTitle(title, y) {
  doc.rect(50, y !== undefined ? y : doc.y, doc.page.width - 100, 24).fill(DARKBLUE);
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(12)
     .text(title, 58, (y !== undefined ? y : doc.y) + 6);
  doc.moveDown(0.1);
}

doc.moveDown(1.5);
sectionTitle("PROGRESSION DEPUIS LE RAPPORT PRÉCÉDENT (v1 — 2026-03-29)");
doc.moveDown(0.6);

const fixed = [
  "C-1 — Tokens exposés dans flash",
  "C-2 — Secrets JWT fallback faibles",
  "C-3 — Algorithm confusion JWT",
  "E-6 — Mots de passe en clair dans logs",
  "E-7 — Stack trace exposée en production",
  "M-1 — Rate limit login trop permissif (15 → 5 essais)",
  "M-2 — trust proxy: true (→ trust proxy: 1)",
  "M-3 — Énumération utilisateurs via reset password",
];

const persisting = [
  "E-1/E-2 — Mass assignment adresses (déplacé service, toujours présent)",
  "E-3 — Mass assignment produits admin",
  "E-4 — avatarUrl sans validation de schéma",
  "E-5 — Image URL admin sans validation",
  "M-4 — LIKE wildcard non échappé",
  "F-1 — CSP désactivée",
  "F-2 — CORS origin: true + credentials",
  "F-3 — sameSite: lax sur cookies auth",
  "F-4 — Session cookie 7 jours",
];

const colW = (doc.page.width - 100) / 2 - 10;
const startX = 50;
const col2X  = startX + colW + 20;
let rowY = doc.y;

doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(9).text("✅ CORRIGÉES (8)", startX, rowY);
doc.fillColor(ORANGE).font("Helvetica-Bold").fontSize(9).text("⚠️ PERSISTANTES (9)", col2X, rowY);
rowY += 16;

fixed.forEach((f, i) => {
  doc.fillColor(GREEN).font("Helvetica").fontSize(8).text(`✓  ${f}`, startX, rowY, { width: colW });
  if (persisting[i]) {
    doc.fillColor(ORANGE).font("Helvetica").fontSize(8).text(`→  ${persisting[i]}`, col2X, rowY, { width: colW });
  }
  rowY += 14;
});
// remaining persisting items
for (let i = fixed.length; i < persisting.length; i++) {
  doc.fillColor(ORANGE).font("Helvetica").fontSize(8).text(`→  ${persisting[i]}`, col2X, rowY, { width: colW });
  rowY += 14;
}

doc.y = rowY + 10;

// ══════════════════════════════════════════
// PAGE 2 — NOUVELLES FAILLES CRITIQUES
// ══════════════════════════════════════════
doc.addPage();

// Header page 2
doc.rect(0, 0, doc.page.width, 36).fill(RED);
doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(14)
   .text("CRITIQUE — NOUVELLES FAILLES DÉCOUVERTES", 50, 10, { align: "center" });
doc.moveDown(2);

const findings = [
  {
    id: "N-C1",
    title: "Factures PDF accessibles sans authentification (IDOR massif + fuite PII)",
    file: "app.js:57",
    level: "CRITIQUE",
    confidence: "10/10",
    desc: [
      "Les factures PDF sont servies via express.static SANS aucune vérification",
      "d'authentification. Le nom de fichier est prédictible : ORD-YYYY-NNNNN.pdf",
      "(NNNNN entre 10000 et 99999, ~90 000 combinaisons par an).",
      "Chaque facture contient : nom, email, téléphone, adresse, articles achetés.",
    ],
    exploit: 'curl -s "https://zando243.com/invoices/ORD-2026-14273.pdf"\n→ Télécharge la facture d\'un inconnu sans être connecté',
    fix: [
      "Supprimer : app.use(\"/invoices\", express.static(...))",
      "Créer une route GET /orders/:id/invoice avec requireAuth",
      "Vérifier que order.userId === req.user.id avant d'envoyer le fichier",
    ],
  },
  {
    id: "N-C2",
    title: "Contournement de paiement PayPal (Payment Bypass)",
    file: "src/controllers/paymentController.js:169-202",
    level: "CRITIQUE",
    confidence: "9/10",
    desc: [
      "capturePayPalOrderForSdk reçoit paypalOrderId et localOrderId du body.",
      "Elle trouve la commande locale par localOrderId (filtré userId ✓) mais",
      "NE VÉRIFIE JAMAIS que paypalOrderId === order.paymentReference.",
      "Un attaquant peut payer $1 et faire valider une commande à $500.",
    ],
    exploit: "1. Créer commande A à $500 → localOrderId_A\n2. Créer commande B à $1 → localOrderId_B + paypalOrderId_B\n3. POST /payments/paypal/sdk/capture-order\n   { localOrderId: localOrderId_A, paypalOrderId: paypalOrderId_B }\n→ PayPal capture $1, système marque commande $500 comme PAYÉE",
    fix: [
      "Ajouter dans capturePayPalOrderForSdk :",
      "if (order.paymentReference && order.paymentReference !== paypalOrderId)",
      "  return res.status(400).json({ error: 'PAYPAL_ORDER_MISMATCH' });",
    ],
  },
  {
    id: "N-C3",
    title: "Webhook PayPal : cert_url non validée (Bypass de signature)",
    file: "src/services/paypalService.js:90-112",
    level: "ÉLEVÉ",
    confidence: "8/10",
    desc: [
      "Le header paypal-cert-url est transmis à l'API PayPal SANS validation.",
      "PayPal utilise cette URL pour récupérer le certificat de vérification.",
      "Un attaquant peut pointer vers son propre certificat forgé.",
      "Si PayPal valide sans vérifier le domaine → tout webhook est accepté.",
    ],
    exploit: 'curl -X POST https://zando243.com/payments/paypal/webhook\\\n  -H "paypal-cert-url: https://attacker.com/forged-cert.pem"\\\n  -d \'{"event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"TARGET"}}\'\n→ Peut déclencher markOrderAsPaid sans paiement réel',
    fix: [
      "Valider cert_url avant de l'envoyer à PayPal :",
      "const allowed = /^(api\\.paypal\\.com|api-m\\.paypal\\.com|www\\.paypalobjects\\.com)$/",
      "if (!allowed.test(new URL(certUrl).hostname)) return false;",
    ],
  },
];

findings.forEach((f, idx) => {
  if (idx > 0) doc.moveDown(0.8);

  const boxY = doc.y;
  const lc = levelColor(f.level);

  // Barre latérale colorée
  doc.rect(50, boxY, 4, 160).fill(lc);

  // Badge niveau
  doc.roundedRect(58, boxY + 2, 64, 16, 3).fill(lc);
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8).text(f.level, 58, boxY + 5, { width: 64, align: "center" });

  // Badge confiance
  doc.roundedRect(128, boxY + 2, 70, 16, 3).fill("#E5E7EB");
  doc.fillColor(DARK).font("Helvetica").fontSize(8).text(`Confiance: ${f.confidence}`, 128, boxY + 5, { width: 70, align: "center" });

  // ID + Titre
  doc.fillColor(DARK).font("Helvetica-Bold").fontSize(11)
     .text(`${f.id} — ${f.title}`, 58, boxY + 24, { width: doc.page.width - 120 });

  doc.fillColor(GREY).font("Helvetica-Oblique").fontSize(8)
     .text(`Fichier : ${f.file}`, 58, doc.y + 2);

  // Description
  doc.fillColor(DARK).font("Helvetica").fontSize(8.5);
  f.desc.forEach(line => {
    doc.text(line, 58, doc.y + 3, { width: doc.page.width - 120 });
  });

  // Exploit box
  doc.moveDown(0.3);
  const exY = doc.y;
  doc.rect(58, exY, doc.page.width - 120, 8 + f.exploit.split("\n").length * 11).fill("#FEF2F2");
  doc.fillColor(RED).font("Helvetica-Bold").fontSize(7.5).text("EXPLOIT :", 62, exY + 3);
  doc.fillColor("#7F1D1D").font("Courier").fontSize(7.2);
  f.exploit.split("\n").forEach((line, li) => {
    doc.text(line, 62, exY + 12 + li * 10, { width: doc.page.width - 130 });
  });
  doc.y = exY + 10 + f.exploit.split("\n").length * 11;

  // Fix box
  doc.moveDown(0.3);
  const fixY = doc.y;
  doc.rect(58, fixY, doc.page.width - 120, 8 + f.fix.length * 11).fill("#F0FDF4");
  doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(7.5).text("CORRECTION :", 62, fixY + 3);
  doc.fillColor("#14532D").font("Courier").fontSize(7.2);
  f.fix.forEach((line, li) => {
    doc.text(line, 62, fixY + 12 + li * 10, { width: doc.page.width - 130 });
  });
  doc.y = fixY + 10 + f.fix.length * 11;
});

// ══════════════════════════════════════════
// PAGE 3 — FAILLES PERSISTANTES
// ══════════════════════════════════════════
doc.addPage();

doc.rect(0, 0, doc.page.width, 36).fill(ORANGE);
doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(14)
   .text("FAILLES PERSISTANTES (non corrigées depuis v1)", 50, 10, { align: "center" });
doc.moveDown(2);

const persistent = [
  {
    id: "P-E1", level: "ÉLEVÉ", confidence: "9/10",
    title: "Mass Assignment — createUserAddress / updateUserAddress",
    file: "src/services/accountService.js:40-61",
    desc: "...payload spread complet de req.body → injection de champs arbitraires du modèle (userId, id...).",
    fix: "Whitelist explicite : label, number, street, neighborhood, municipality, city, country.",
  },
  {
    id: "P-E2", level: "ÉLEVÉ", confidence: "8/10",
    title: "avatarUrl sans validation de schéma (XSS stocké potentiel)",
    file: "src/services/accountService.js:28",
    desc: "javascript:alert(1) passe deepSanitize (filtre seulement < et >). Si template utilise href=avatarUrl → XSS au clic.",
    fix: "Valider protocol === 'https:' via new URL(). Rejeter tout autre schéma.",
  },
  {
    id: "P-E3", level: "ÉLEVÉ", confidence: "8/10",
    title: "Image URL Produit sans validation (XSS via panel admin)",
    file: "src/controllers/adminController.js:97, 118, 175",
    desc: "3 points d'entrée (addProductImage, updateProductImage, createProduct) acceptent req.body.url sans validation de schéma.",
    fix: "Même validation parseHttpsUrl() que P-E2 sur toutes les URLs d'images.",
  },
  {
    id: "P-E4", level: "ÉLEVÉ", confidence: "9/10",
    title: "Mass Assignment — createProduct / updateProduct (Admin)",
    file: "src/controllers/adminController.js:174, 193",
    desc: "...req.body spread complet → injection de avgRating, popularityScore, countReviews, finalPrice, id.",
    fix: "Whitelist explicite des champs autorisés dans productValidators.",
  },
  {
    id: "P-M1", level: "MOYEN", confidence: "9/10",
    title: "CORS : toute origine reflétée avec credentials (Cross-Origin Data Exfiltration)",
    file: "app.js:37",
    desc: "origin: true reflète n'importe quel Origin. Combiné à credentials: true → tout site peut lire les réponses JSON authentifiées (ex: /admin/stats si victime admin).",
    fix: "Restreindre à ALLOWED_ORIGINS ou env.appUrl uniquement.",
  },
  {
    id: "P-M2", level: "MOYEN", confidence: "8/10",
    title: "Injection LIKE SQL — Wildcard non échappé",
    file: "src/services/auditLogService.js:60-64",
    desc: "% et _ non échappés dans les clauses LIKE → bypass des filtres de recherche, scan complet de table.",
    fix: "escapeLike() : remplacer % → \\% et _ → \\_ avant interpolation.",
  },
];

persistent.forEach((f, idx) => {
  if (idx > 0) doc.moveDown(0.5);
  if (doc.y > 700) doc.addPage();

  const boxY = doc.y;
  const lc = levelColor(f.level);

  doc.rect(50, boxY, 4, 72).fill(lc);
  doc.roundedRect(58, boxY + 2, 64, 16, 3).fill(lc);
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8).text(f.level, 58, boxY + 5, { width: 64, align: "center" });
  doc.roundedRect(128, boxY + 2, 70, 16, 3).fill("#E5E7EB");
  doc.fillColor(DARK).font("Helvetica").fontSize(8).text(`Confiance: ${f.confidence}`, 128, boxY + 5, { width: 70, align: "center" });

  doc.fillColor(DARK).font("Helvetica-Bold").fontSize(10)
     .text(`${f.id} — ${f.title}`, 58, boxY + 24, { width: doc.page.width - 120 });
  doc.fillColor(GREY).font("Helvetica-Oblique").fontSize(8)
     .text(`Fichier : ${f.file}`, 58, doc.y + 2);
  doc.fillColor(DARK).font("Helvetica").fontSize(8.5)
     .text(f.desc, 58, doc.y + 4, { width: doc.page.width - 120 });
  doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(8)
     .text(`✓ Correction : `, 58, doc.y + 4, { continued: true });
  doc.fillColor(DARK).font("Helvetica").fontSize(8)
     .text(f.fix, { width: doc.page.width - 120 });
});

// ══════════════════════════════════════════
// PAGE 4 — MATRICE + PLAN
// ══════════════════════════════════════════
doc.addPage();

doc.rect(0, 0, doc.page.width, 36).fill(DARKBLUE);
doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(14)
   .text("MATRICE DES RISQUES & PLAN DE REMÉDIATION", 50, 10, { align: "center" });
doc.moveDown(2);

// Matrice
sectionTitle("MATRICE DES RISQUES CONSOLIDÉE");
doc.moveDown(0.5);

const matrix = [
  { id: "N-C1", file: "app.js:57",                              level: "CRITIQUE", statut: "🆕 Nouveau",    vecteur: "Factures PDF sans auth"        },
  { id: "N-C2", file: "paymentController.js:169",               level: "CRITIQUE", statut: "🆕 Nouveau",    vecteur: "Payment bypass PayPal"          },
  { id: "N-C3", file: "paypalService.js:90",                    level: "ÉLEVÉ",    statut: "🆕 Nouveau",    vecteur: "Webhook forgery (cert_url)"      },
  { id: "P-E1", file: "accountService.js:40",                   level: "ÉLEVÉ",    statut: "⚠️ Persistant", vecteur: "Mass assignment adresses"       },
  { id: "P-E2", file: "accountService.js:28",                   level: "ÉLEVÉ",    statut: "⚠️ Persistant", vecteur: "XSS via avatarUrl"              },
  { id: "P-E3", file: "adminController.js:97,118,175",          level: "ÉLEVÉ",    statut: "⚠️ Persistant", vecteur: "XSS via image URL"              },
  { id: "P-E4", file: "adminController.js:174,193",             level: "ÉLEVÉ",    statut: "⚠️ Persistant", vecteur: "Mass assignment produits"       },
  { id: "P-M1", file: "app.js:37",                              level: "MOYEN",    statut: "⚠️ Persistant", vecteur: "CORS + credentials"             },
  { id: "P-M2", file: "auditLogService.js:60",                  level: "MOYEN",    statut: "⚠️ Persistant", vecteur: "LIKE wildcard"                  },
  { id: "P-F1", file: "app.js:31",                              level: "FAIBLE",   statut: "⚠️ Persistant", vecteur: "CSP désactivée"                 },
  { id: "P-F2", file: "authService.js:11",                      level: "FAIBLE",   statut: "⚠️ Persistant", vecteur: "sameSite: lax"                  },
  { id: "P-F3", file: "app.js:49",                              level: "FAIBLE",   statut: "⚠️ Persistant", vecteur: "Session 7 jours"                },
  { id: "P-F4", file: "validators.js:6",                        level: "FAIBLE",   statut: "⚠️ Persistant", vecteur: "Sanitization partielle"         },
];

// Table header
const tY = doc.y;
const cols2 = [50, 100, 260, 320, 400];
const headers = ["ID", "Fichier", "Niveau", "Statut", "Vecteur"];
doc.rect(50, tY, doc.page.width - 100, 18).fill("#1E3A5F");
headers.forEach((h, i) => {
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8).text(h, cols2[i] + 3, tY + 4, { width: (cols2[i+1] || 510) - cols2[i] - 4 });
});
doc.y = tY + 18;

matrix.forEach((row, i) => {
  const ry = doc.y;
  const bg = i % 2 === 0 ? "#F8FAFC" : WHITE;
  doc.rect(50, ry, doc.page.width - 100, 15).fill(bg);
  const lc = levelColor(row.level);
  const rowData = [row.id, row.file, row.level, row.statut, row.vecteur];
  rowData.forEach((cell, ci) => {
    const color = ci === 2 ? lc : DARK;
    const font = ci === 2 ? "Helvetica-Bold" : "Helvetica";
    doc.fillColor(color).font(font).fontSize(7.5)
       .text(cell, cols2[ci] + 3, ry + 3, { width: (cols2[ci+1] || 510) - cols2[ci] - 4, ellipsis: true });
  });
  doc.y = ry + 15;
});

// Plan de remédiation
doc.moveDown(1.2);
sectionTitle("PLAN DE REMÉDIATION PRIORITAIRE");
doc.moveDown(0.6);

const sprints = [
  {
    label: "🔴 SPRINT IMMÉDIAT — Avant tout déploiement",
    color: RED,
    items: [
      "N-C1 — Supprimer express.static('/invoices'). Créer route authentifiée GET /orders/:id/invoice.",
      "N-C2 — Vérifier paypalOrderId === order.paymentReference dans capturePayPalOrderForSdk.",
      "N-C3 — Valider que cert_url appartient à *.paypal.com avant envoi à l'API PayPal.",
    ],
  },
  {
    label: "🟠 SPRINT 48H",
    color: ORANGE,
    items: [
      "P-E1 — Whitelist explicite dans createUserAddress et updateUserAddress (accountService.js).",
      "P-E2/E3 — Valider schéma https:// sur avatarUrl et toutes les URLs d'images produit.",
      "P-E4 — Whitelist explicite dans createProduct et updateProduct (adminController.js).",
    ],
  },
  {
    label: "🟡 SPRINT SEMAINE",
    color: "#B7950B",
    items: [
      "P-M1 — Restreindre CORS à env.appUrl. Supprimer origin: true.",
      "P-M2 — Échapper les wildcards LIKE (% → \\%, _ → \\_) dans auditLogService.js.",
      "P-F1 — Activer CSP dans helmet (politique adaptée EJS).",
      "P-F2/F3 — sameSite: 'strict', réduire maxAge session à 4 heures.",
    ],
  },
];

sprints.forEach(sprint => {
  if (doc.y > 680) doc.addPage();
  const sy = doc.y;
  doc.rect(50, sy, doc.page.width - 100, 18).fill(sprint.color);
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9).text(sprint.label, 58, sy + 4);
  doc.y = sy + 20;
  sprint.items.forEach(item => {
    doc.fillColor(DARK).font("Helvetica").fontSize(8.5)
       .text(`    •  ${item}`, 50, doc.y + 2, { width: doc.page.width - 100 });
    doc.moveDown(0.2);
  });
  doc.moveDown(0.4);
});

// Footer
doc.moveDown(1);
doc.rect(50, doc.y, doc.page.width - 100, 1).fill("#CBD5E1");
doc.moveDown(0.4);
doc.fillColor(GREY).font("Helvetica-Oblique").fontSize(8)
   .text(
     "Rapport SAST v2 — Zando243 — 2026-04-25  •  3 nouvelles failles · 8 corrigées · 9 persistantes  •  Analyse statique manuelle",
     50, doc.y, { align: "center", width: doc.page.width - 100 }
   );

doc.end();

stream.on("finish", () => {
  console.log(`✅ PDF généré : ${OUT}`);
});
stream.on("error", err => {
  console.error("❌ Erreur :", err);
  process.exit(1);
});
