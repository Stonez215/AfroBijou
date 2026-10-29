// Afro Bijou Jewelry: website server
// Serves the site from ./public and handles:
//   POST /api/checkout  -> Square payment link for in-stock pieces in the bag (shipping or pickup)
//   POST /api/deposit   -> Square payment link for a 50% deposit on a made-to-order piece (+ alerts Papa)
//   POST /api/request   -> custom quote / question / reservation request -> email (with photos) + text to Papa
// All prices come from the server's own copy of the catalog, never from the browser.
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const env = (k, d = "") => (process.env[k] ?? d).trim();
const CFG = {
  port: +env("PORT", "3000"),
  site: env("SITE_URL", "https://afrobijou.com").replace(/\/$/, ""),
  squareToken: env("SQUARE_ACCESS_TOKEN"),
  squareLocation: env("SQUARE_LOCATION_ID"),
  squareBase: env("SQUARE_ENVIRONMENT", "production") === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com",
  squareApi: env("SQUARE_API_BASE"), // only for testing
  shipCents: Math.round(+env("SHIPPING_FLAT", "10") * 100),
  taxPct: env("SALES_TAX_PERCENT", "7"),
  depositPct: +env("DEPOSIT_PERCENT", "50"),
  notifyEmail: env("NOTIFY_EMAIL"),
  mailFrom: env("MAIL_FROM") || env("SMTP_USER"),
  smtp: { host: env("SMTP_HOST", "smtp.gmail.com"), port: +env("SMTP_PORT", "465"), user: env("SMTP_USER"), pass: env("SMTP_PASS") },
  twSid: env("TWILIO_ACCOUNT_SID"), twToken: env("TWILIO_AUTH_TOKEN"), twFrom: env("TWILIO_FROM"),
  twApi: env("TWILIO_API_BASE", "https://api.twilio.com"),
  papaPhone: env("PAPA_PHONE", "+13053916937"),
};

// ---------- catalog (same file the website uses) ----------
const PUB = path.join(__dirname, "public");
function loadCatalog() {
  const s = fs.readFileSync(path.join(PUB, "assets", "catalog.js"), "utf8");
  return JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
}
let CATALOG = loadCatalog();
let byId = Object.fromEntries(CATALOG.map(i => [i.id, i]));
fs.watchFile(path.join(PUB, "assets", "catalog.js"), () => { try { CATALOG = loadCatalog(); byId = Object.fromEntries(CATALOG.map(i => [i.id, i])); } catch (e) {} });
const METAL = { gold: "18k or 24k gold", silver: "925 sterling silver", brass: "Brass", copper: "Copper", beaded: "Natural stone, beads and shell" };
const mlab = i => i.mlabel || METAL[i.metal];
const clean = (v, n = 500) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
const money = c => "$" + (c / 100).toFixed(2).replace(/\.00$/, "");

// ---------- Square ----------
async function squareLink(body) {
  if (!CFG.squareToken || !CFG.squareLocation) throw Object.assign(new Error("Square is not connected yet"), { code: "NO_SQUARE" });
  const r = await fetch((CFG.squareApi || CFG.squareBase) + "/v2/online-checkout/payment-links", {
    method: "POST",
    headers: { "Authorization": "Bearer " + CFG.squareToken, "Content-Type": "application/json", "Square-Version": "2024-10-17" },
    body: JSON.stringify(Object.assign({ idempotency_key: crypto.randomUUID() }, body)),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.payment_link) { console.error("Square error", r.status, JSON.stringify(j.errors || j)); throw new Error("Square could not create the checkout"); }
  return j.payment_link.url;
}

// ---------- alerts ----------
const mailer = CFG.smtp.user && CFG.smtp.pass ? nodemailer.createTransport({ host: CFG.smtp.host, port: CFG.smtp.port, secure: CFG.smtp.port === 465, auth: { user: CFG.smtp.user, pass: CFG.smtp.pass } }) : null;
async function sendEmail(subject, text, attachments = [], replyTo) {
  if (!mailer || !CFG.notifyEmail) { console.log("[email skipped: not configured]\n" + subject + "\n" + text); return false; }
  await mailer.sendMail({ from: `Afro Bijou Website <${CFG.mailFrom}>`, to: CFG.notifyEmail, subject, text, attachments, replyTo: replyTo || undefined });
  return true;
}
async function sendText(body) {
  if (!CFG.twSid || !CFG.twToken || !CFG.twFrom) { console.log("[text skipped: not configured] " + body); return false; }
  const r = await fetch(`${CFG.twApi}/2010-04-01/Accounts/${CFG.twSid}/Messages.json`, {
    method: "POST",
    headers: { "Authorization": "Basic " + Buffer.from(CFG.twSid + ":" + CFG.twToken).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: CFG.papaPhone, From: CFG.twFrom, Body: body.slice(0, 1500) }),
  });
  if (!r.ok) console.error("Twilio error", r.status, await r.text());
  return r.ok;
}
async function alertPapa(subject, lines, sms, attachments, replyTo) {
  const text = lines.filter(Boolean).join("\n");
  const res = await Promise.allSettled([sendEmail(subject, text, attachments, replyTo), sendText(sms)]);
  res.forEach(x => x.status === "rejected" && console.error("alert failed:", x.reason && x.reason.message));
  return res.some(x => x.status === "fulfilled" && x.value === true);
}

// ---------- spam guard: honeypot + simple rate limit ----------
const hits = new Map();
function limited(ip, max = 8) {
  const now = Date.now(), w = 10 * 60 * 1000;
  const a = (hits.get(ip) || []).filter(t => now - t < w); a.push(now); hits.set(ip, a);
  return a.length > max;
}
setInterval(() => hits.clear(), 60 * 60 * 1000).unref();

// ---------- app ----------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "50kb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 6, fileSize: 8 * 1024 * 1024 }, fileFilter: (req, f, cb) => cb(null, /^image\//.test(f.mimetype)) });

app.get("/api/health", (req, res) => res.json({ ok: true, square: !!(CFG.squareToken && CFG.squareLocation), email: !!(mailer && CFG.notifyEmail), text: !!(CFG.twSid && CFG.twFrom) }));
app.get("/api/config", (req, res) => res.json({ shipping: CFG.shipCents / 100, taxPercent: +CFG.taxPct, depositPercent: CFG.depositPct }));

// Bag checkout: in-stock pieces only
app.post("/api/checkout", async (req, res) => {
  try {
    if (limited(req.ip, 20)) return res.status(429).json({ error: "Too many tries. Please wait a few minutes." });
    const lines = Array.isArray(req.body.items) ? req.body.items.slice(0, 30) : [];
    const ship = req.body.fulfillment === "ship";
    const line_items = [];
    for (const l of lines) {
      const i = byId[l.id];
      if (!i || !i.ready) return res.status(400).json({ error: "One of the pieces in your bag is no longer available online. Please remove it and try again." });
      const qty = Math.max(1, Math.min(5, parseInt(l.qty) || 1));
      const size = clean(l.size, 6);
      line_items.push({ name: `${i.name} (${mlab(i)})`.slice(0, 500), quantity: String(qty), base_price_money: { amount: i.price * 100, currency: "USD" }, note: size ? `Ring size ${size}` : undefined });
    }
    if (!line_items.length) return res.status(400).json({ error: "Your bag is empty." });
    const order = { location_id: CFG.squareLocation, line_items, taxes: +CFG.taxPct > 0 ? [{ uid: "sales-tax", name: "Sales tax", percentage: CFG.taxPct, scope: "ORDER" }] : undefined };
    if (ship && CFG.shipCents > 0) order.service_charges = [{ name: "Shipping", amount_money: { amount: CFG.shipCents, currency: "USD" }, calculation_phase: "TOTAL_PHASE" }];
    const url = await squareLink({
      order,
      checkout_options: { redirect_url: `${CFG.site}/thank-you/?type=order&f=${ship ? "ship" : "pickup"}`, ask_for_shipping_address: ship, allow_tipping: false },
      payment_note: ship ? "Website order: ship to customer" : "Website order: pickup in Miami by appointment",
      description: ship ? "Shipping to customer" : "Pickup in Miami by appointment",
    });
    res.json({ url });
  } catch (e) { res.status(e.code === "NO_SQUARE" ? 503 : 502).json({ error: e.message }); }
});

// 50% deposit on a made-to-order piece
app.post("/api/deposit", async (req, res) => {
  try {
    if (limited(req.ip)) return res.status(429).json({ error: "Too many tries. Please wait a few minutes." });
    if (req.body.website) return res.json({ ok: true });
    const i = byId[req.body.id];
    if (!i || i.ready) return res.status(400).json({ error: "This piece can't be reserved online. Please call Papa." });
    const name = clean(req.body.name, 80), phone = clean(req.body.phone, 30), email = clean(req.body.email, 120), notes = clean(req.body.notes, 1000), size = clean(req.body.size, 6);
    if (!name || phone.replace(/\D/g, "").length < 10) return res.status(400).json({ error: "Add your name and a phone number so Papa can reach you." });
    const dep = Math.round(i.price * 100 * CFG.depositPct / 100);
    const url = await squareLink({
      quick_pay: { name: `${CFG.depositPct}% deposit: ${i.name} (${mlab(i)})`.slice(0, 255), price_money: { amount: dep, currency: "USD" }, location_id: CFG.squareLocation },
      checkout_options: { redirect_url: `${CFG.site}/thank-you/?type=deposit`, allow_tipping: false },
      pre_populated_data: email ? { buyer_email: email } : undefined,
      payment_note: `Deposit for ${i.name} (${mlab(i)}). ${name}, ${phone}${size ? ", ring size " + size : ""}`.slice(0, 500),
    });
    await alertPapa(`Reservation started: ${i.name} (${mlab(i)})`,
      [`A customer started a ${CFG.depositPct}% deposit on the website.`, "", `Piece: ${i.name} (${mlab(i)})`, `Estimated price: ${money(i.price * 100)}`, `Deposit: ${money(dep)}`, size && `Ring size: ${size}`, `Name: ${name}`, `Phone: ${phone}`, email && `Email: ${email}`, `Notes: ${notes || "none"}`, "", "Check the Square app to see when the deposit is paid. Call the customer to confirm the final price."],
      `Afro Bijou: ${name} (${phone}) is reserving the ${i.name}, ${mlab(i)}. ${money(dep)} deposit via Square. Notes: ${notes || "none"}`, [], email);
    res.json({ url });
  } catch (e) { res.status(e.code === "NO_SQUARE" ? 503 : 502).json({ error: e.message }); }
});

// Custom quote / question about a piece
app.post("/api/request", upload.array("photos", 6), async (req, res) => {
  try {
    if (limited(req.ip)) return res.status(429).json({ error: "Too many requests. Please wait a few minutes or call Papa." });
    const b = req.body || {};
    if (b.website) return res.json({ ok: true });
    const kind = b.kind === "question" ? "question" : "custom";
    const name = clean(b.name, 80), phone = clean(b.phone, 30), email = clean(b.email, 120);
    if (!name || phone.replace(/\D/g, "").length < 10) return res.status(400).json({ error: "Add your name and a phone number so Papa can reach you." });
    const files = (req.files || []).map(f => ({ filename: clean(f.originalname, 80) || "photo.jpg", content: f.buffer, contentType: f.mimetype }));
    let ok;
    if (kind === "question") {
      const i = byId[b.id];
      ok = await alertPapa(`Question about ${i ? i.name : "a piece"}`,
        [`Piece: ${i ? `${i.name} (${mlab(i)}), ${money(i.price * 100)} est.` : "not given"}`, `Name: ${name}`, `Phone: ${phone}`, email && `Email: ${email}`, "", `Question: ${clean(b.notes, 2000) || "none"}`],
        `Afro Bijou question from ${name} (${phone}) about the ${i ? i.name : "a piece"}: ${clean(b.notes, 300)}`, [], email);
    } else {
      ok = await alertPapa(`Custom order request from ${name}`,
        [`Name: ${name}`, `Phone: ${phone}`, email && `Email: ${email}`, `Piece: ${clean(b.piece, 60)}`, `Metal: ${clean(b.metal, 60)}`, `Budget: ${clean(b.budget, 60)}`, `Size: ${clean(b.size, 60) || "not given"}`, `Needed by: ${clean(b.date, 30) || "no date"}`, "", `Idea: ${clean(b.idea, 3000) || "not described"}`, files.length ? `\n${files.length} reference photo(s) attached.` : ""],
        `Afro Bijou custom request from ${name} (${phone}): ${clean(b.piece, 40)}, ${clean(b.metal, 40)}, budget ${clean(b.budget, 40)}. ${clean(b.idea, 200)}${files.length ? ` (${files.length} photos in email)` : ""}`, files, email);
    }
    if (!ok) return res.status(503).json({ error: "Online sending isn't switched on yet." });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Something went wrong sending your request." }); }
});
app.use("/api", (err, req, res, next) => res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Each photo must be under 8 MB." : "That request couldn't be read." }));

// ---------- static site ----------
app.use((req, res, next) => { res.set("X-Content-Type-Options", "nosniff"); res.set("Referrer-Policy", "strict-origin-when-cross-origin"); next(); });
app.use(express.static(PUB, {
  extensions: ["html"], redirect: true,
  setHeaders: (res, p) => res.set("Cache-Control", /\.(jpg|png|svg|webp)$/.test(p) ? "public, max-age=2592000" : /\.(css|js)$/.test(p) ? "public, max-age=3600" : "no-cache"),
}));
app.use((req, res) => res.status(404).sendFile(path.join(PUB, "404.html")));

app.listen(CFG.port, () => console.log(`Afro Bijou running on port ${CFG.port}. Square: ${CFG.squareToken ? "on" : "off"}, email: ${mailer && CFG.notifyEmail ? "on" : "off"}, text: ${CFG.twSid ? "on" : "off"}`));
