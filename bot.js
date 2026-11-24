const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ───────────────────────── Настройки (переменные окружения) ─────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || ""; // без токена сервер работает в DEMO-режиме (без Telegram)
const WEBAPP_URL = process.env.WEBAPP_URL || ""; // https://ваш-домен.up.railway.app
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID || ""; // ID чата/лички, куда падают заказы
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "demo123"; // пароль веб-админки (/admin)
const PORT = process.env.PORT || 3000;

if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠️  ADMIN_PASSWORD не задан — используется пароль по умолчанию "demo123". Для боевого запуска задайте свой.');
}
if (!BOT_TOKEN) {
  console.warn("⚠️  BOT_TOKEN не задан — DEMO-режим: магазин и админка работают, Telegram-уведомления отключены.");
}

// ───────────────────────── Хранилище ─────────────────────────
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

const DEFAULT_STORE = {
  config: {
    name: "VapeBros Minsk",
    currency: "BYN",
    deliveryFee: 5,
    freeDeliveryFrom: 0,
    workHours: "10:00–21:00, без выходных",
    giftCategory: "Картриджи",
    giftProductId: "cart-xros-06",
    liquidsForGift: 2,
    paymentDetails:
      "Перевод по реквизитам: BY00 BANK 0000 0000 0000 0000 0000\nПолучатель: VapeBros Минск",
    managerContact: "@demovape_bot",
  },
  products: [
    { id: "liq-podonki-1", category: "liquids", brand: "PODONKI", name: "Ледяной Гранат и Мята", price: 21, strengths: [0, 3, 6], inStock: true, icon: "🧊" },
    { id: "liq-podonki-2", category: "liquids", brand: "PODONKI", name: "Кислый Крыжовник", price: 22, strengths: [3, 6], inStock: true, icon: "🫐" },
    { id: "liq-podonki-3", category: "liquids", brand: "PODONKI", name: "Манговый Нектар", price: 20, strengths: [0, 3, 6], inStock: false, icon: "🥭" },
    { id: "liq-catswill-1", category: "liquids", brand: "Catswill", name: "Черничный Пирог", price: 19, strengths: [0, 3, 6], inStock: true, icon: "🥧" },
    { id: "liq-catswill-2", category: "liquids", brand: "Catswill", name: "Хвоя и Зелёное Яблоко", price: 24, strengths: [3, 6], inStock: true, icon: "🍏" },
    { id: "liq-hotspot-1", category: "liquids", brand: "Hotspot", name: "Спелый Персик и Личи", price: 23, strengths: [0, 3, 6], inStock: true, icon: "🍑" },
    { id: "liq-faff-1", category: "liquids", brand: "Faff", name: "Земляника со Сливками", price: 25, strengths: [3, 6], inStock: true, icon: "🍓" },
    { id: "liq-rm-1", category: "liquids", brand: "Rick & Morty", name: "Цитадельский Фрост", price: 16, strengths: [0, 3, 6], inStock: true, icon: "🧪" },
    { id: "cart-xros-06", category: "cartridges", brand: "XROS", name: "Картридж 0.6 Ом (3 мл)", price: 14, strengths: null, inStock: true, icon: "🔋" },
    { id: "cart-xros-08", category: "cartridges", brand: "XROS", name: "Картридж 0.8 Ом (2 мл)", price: 14, strengths: null, inStock: true, icon: "🔋" },
    { id: "cart-vthru-07", category: "cartridges", brand: "V.THRU / VMATE", name: "Картридж VMATE Top Fill 0.7 Ом", price: 15, strengths: null, inStock: true, icon: "⚡" },
    { id: "cart-aegis-04", category: "cartridges", brand: "AEGIS", name: "Испаритель B-Series 0.4 Ом", price: 14, strengths: null, inStock: true, icon: "🛡️" },
    { id: "cart-pasito-06", category: "cartridges", brand: "PASITO", name: "Картридж Pasito II / Mini 0.6 Ом", price: 15, strengths: null, inStock: true, icon: "🎛️" },
  ],
  orders: [],
};

// Статусы заказа
const STATUSES = {
  new: "🆕 Новый",
  accepted: "✅ Принят",
  delivering: "🛵 Передан курьеру",
  done: "📦 Выполнен",
  cancelled: "❌ Отменён",
};

function statusKeyFromLabel(label) {
  const found = Object.entries(STATUSES).find(([, v]) => v === label);
  return found ? found[0] : "new";
}

// Остатки: stock — количество штук. inStock всегда вычисляется из stock (stock > 0).
const DEFAULT_STOCK = 10; // стартовый остаток для товаров, у которых его ещё нет
const LOW_STOCK = 3; // порог «заканчивается»
const MAX_STOCK = 99999;

function parseStock(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_STOCK, Math.max(0, n));
}

function applyStock(prod, n) {
  prod.stock = Math.min(MAX_STOCK, Math.max(0, Math.floor(n)));
  prod.inStock = prod.stock > 0;
}

// Старые данные (без stock) переносим: был в наличии — DEFAULT_STOCK шт., не был — 0
function normalizeProduct(p) {
  const s = parseStock(p.stock);
  applyStock(p, s === null ? (p.inStock === false ? 0 : DEFAULT_STOCK) : s);
  return p;
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(DEFAULT_STORE, null, 2), "utf8");
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    const orders = (Array.isArray(parsed.orders) ? parsed.orders : []).map((o) => {
      if (!o.statusKey) o.statusKey = statusKeyFromLabel(o.status);
      o.status = STATUSES[o.statusKey];
      return o;
    });
    const products = (Array.isArray(parsed.products) ? parsed.products : JSON.parse(JSON.stringify(DEFAULT_STORE.products))).map(normalizeProduct);
    return {
      config: { ...DEFAULT_STORE.config, ...(parsed.config || {}) },
      products,
      orders,
    };
  } catch (e) {
    const fresh = JSON.parse(JSON.stringify(DEFAULT_STORE));
    fresh.products.forEach(normalizeProduct);
    return fresh;
  }
}

function saveStore() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

let store = ensureStore();

function isAdmin(userId) {
  if (!userId) return false;
  if (ADMIN_IDS.length === 0) return String(userId) === String(MANAGER_CHAT_ID);
  return ADMIN_IDS.includes(String(userId));
}

// ───────────────────────── Утилиты ─────────────────────────
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clip(s, max) {
  return String(s ?? "").trim().slice(0, max);
}

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  return (xff ? String(xff).split(",")[0].trim() : req.socket.remoteAddress) || "unknown";
}

const rateBuckets = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    rateBuckets.set(key, arr);
    return true;
  }
  arr.push(now);
  rateBuckets.set(key, arr);
  return false;
}

function readJson(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (e) {
        reject(new Error("bad_json"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

// Проверка подписи Telegram initData (чтобы знать, что заказ реально из Mini App)
function verifyInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");
    const dataCheck = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("\n");
    const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const calc = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
    if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate || Date.now() / 1000 - authDate > 24 * 3600) return null;
    return JSON.parse(params.get("user") || "null");
  } catch (e) {
    return null;
  }
}

// ───────────────────────── Авторизация админки ─────────────────────────
function adminToken() {
  return crypto.createHmac("sha256", ADMIN_PASSWORD).update("shop4ik-admin-v1").digest("hex");
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isAuthorized(req, url) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("token") || "";
  return token && safeEqual(token, adminToken());
}

// ───────────────────────── Живые события для админки (SSE) ─────────────────────────
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}
setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(": ping\n\n");
    } catch (e) {
      sseClients.delete(res);
    }
  }
}, 20000);

// ───────────────────────── Telegram ─────────────────────────
async function tgApi(method, body) {
  if (!BOT_TOKEN) return { ok: false, description: "no_token" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    console.error(`tgApi ${method}:`, e.message);
    return { ok: false, description: e.message };
  }
}

function formatOrderMessage(order) {
  const itemsLines = (order.items || [])
    .map((item, idx) => {
      const str = item.strength !== null && item.strength !== undefined ? ` (${item.strength} мг)` : "";
      const gift = item.isGift ? " 🎁 [ПОДАРОК]" : "";
      return `${idx + 1}. ${esc(item.brand)} — ${esc(item.name)}${str} × ${item.qty} = ${item.price * item.qty} ${esc(order.currency)}${gift}`;
    })
    .join("\n");

  const deliveryText =
    order.deliveryMethod === "pickup"
      ? `🚇 Самовывоз: м. ${esc(order.metroStation)}`
      : `🛵 Курьер: ${esc(order.address)} (${esc(order.deliveryTimeSlot)})`;

  const paymentText = order.paymentMethod === "cash" ? "Наличными при получении" : "Переводом по реквизитам";

  return (
    `🔥 <b>ЗАКАЗ №${esc(order.orderNumber)}</b> • <b>${esc(STATUSES[order.statusKey] || order.status)}</b>\n\n` +
    `👤 <b>Клиент:</b> ${esc(order.customerName)} (${esc(order.customerTag || "без @username")})\n` +
    (order.customerPhone ? `📞 <b>Телефон:</b> ${esc(order.customerPhone)}\n` : "") +
    `${deliveryText}\n` +
    `💳 <b>Оплата:</b> ${paymentText}\n` +
    (order.comment ? `💬 <b>Комментарий:</b> ${esc(order.comment)}\n` : "") +
    `\n📦 <b>Состав заказа:</b>\n${itemsLines}\n\n` +
    `💰 <b>Итого к оплате: ${order.total} ${esc(order.currency)}</b>`
  );
}

function orderButtons(order) {
  if (order.statusKey === "done" || order.statusKey === "cancelled") return undefined;
  const n = order.orderNumber;
  return {
    inline_keyboard: [
      [
        { text: "✅ Принять", callback_data: `ord:${n}:accepted` },
        { text: "🛵 В пути", callback_data: `ord:${n}:delivering` },
      ],
      [
        { text: "📦 Выполнен", callback_data: `ord:${n}:done` },
        { text: "❌ Отменить", callback_data: `ord:${n}:cancelled` },
      ],
    ],
  };
}

function notifyTargets(fallbackChatId) {
  const set = new Set([MANAGER_CHAT_ID, ...ADMIN_IDS].filter(Boolean).map(String));
  if (set.size === 0 && fallbackChatId) set.add(String(fallbackChatId));
  return [...set];
}

// Уведомление менеджеру(ам) о новом заказе
async function notifyManagers(order, fallbackChatId) {
  if (!BOT_TOKEN) return;
  order.tgMessages = [];
  for (const chatId of notifyTargets(fallbackChatId)) {
    const r = await tgApi("sendMessage", {
      chat_id: chatId,
      text: formatOrderMessage(order),
      parse_mode: "HTML",
      reply_markup: orderButtons(order),
    });
    if (r.ok) {
      order.tgMessages.push({ chatId, messageId: r.result.message_id });
    } else {
      console.error(`Не удалось уведомить ${chatId}:`, r.description);
    }
  }
  saveStore();
}

async function refreshTelegramMessages(order) {
  for (const m of order.tgMessages || []) {
    await tgApi("editMessageText", {
      chat_id: m.chatId,
      message_id: m.messageId,
      text: formatOrderMessage(order),
      parse_mode: "HTML",
      reply_markup: orderButtons(order),
    });
  }
}

// ───────────────────────── Заказы ─────────────────────────
function generateOrderNumber() {
  for (let i = 0; i < 20; i++) {
    const n = String(Math.floor(10000 + Math.random() * 90000));
    if (!store.orders.some((o) => String(o.orderNumber) === n)) return n;
  }
  return String(Date.now()).slice(-8);
}

// Проверяет заказ с клиента и пересчитывает цены/итог по данным магазина
function buildOrder(raw, ctx) {
  if (!raw || typeof raw !== "object") return { error: "Пустой заказ" };
  if (!Array.isArray(raw.items) || raw.items.length === 0) return { error: "Корзина пуста" };
  if (raw.items.length > 50) return { error: "Слишком много позиций" };

  const items = [];
  const demand = {}; // сколько штук каждого товара просит клиент (одна позиция может быть в разных крепостях)
  let subtotal = 0;
  let paidLiquids = 0;
  let giftId = null;

  for (const it of raw.items) {
    if (it && it.isGift) {
      giftId = it.id;
      continue;
    }
    const prod = store.products.find((p) => p.id === it?.id);
    if (!prod) return { error: "Товар не найден: " + clip(it?.name, 60) };
    if (!prod.inStock) return { error: `Нет в наличии: ${prod.name}` };
    const qty = Math.floor(Number(it.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) return { error: "Некорректное количество" };
    demand[prod.id] = (demand[prod.id] || 0) + qty;
    if (demand[prod.id] > prod.stock) {
      return { error: `Недостаточно товара «${prod.name}»: осталось ${prod.stock} шт.` };
    }
    let strength = null;
    if (Array.isArray(prod.strengths) && prod.strengths.length > 0) {
      strength = prod.strengths.includes(Number(it.strength)) ? Number(it.strength) : prod.strengths[0];
    }
    items.push({ id: prod.id, name: prod.name, brand: prod.brand, strength, qty, price: prod.price, isGift: false });
    subtotal += prod.price * qty;
    if (prod.category === "liquids") paidLiquids += qty;
  }
  if (items.length === 0) return { error: "Корзина пуста" };

  // Подарок: только если набрано нужное число жидкостей и после покупки остался хотя бы 1 шт.
  const needed = Math.max(1, Number(store.config.liquidsForGift) || 2);
  if (giftId && paidLiquids >= needed) {
    const freeLeft = (p) => p.stock - (demand[p.id] || 0) >= 1;
    let gift = store.products.find((p) => p.id === giftId && p.category === "cartridges" && freeLeft(p));
    if (!gift) gift = store.products.find((p) => p.id === store.config.giftProductId && freeLeft(p));
    if (!gift) gift = store.products.find((p) => p.category === "cartridges" && freeLeft(p));
    if (gift) {
      items.push({ id: gift.id, name: gift.name, brand: gift.brand, strength: null, qty: 1, price: 0, isGift: true });
    }
  }

  const customerName = clip(raw.customerName, 80);
  if (!customerName) return { error: "Укажите имя" };

  const deliveryMethod = raw.deliveryMethod === "courier" ? "courier" : "pickup";
  const metroStation = deliveryMethod === "pickup" ? clip(raw.metroStation, 60) : null;
  const address = deliveryMethod === "courier" ? clip(raw.address, 200) : null;
  if (deliveryMethod === "pickup" && !metroStation) return { error: "Укажите станцию метро" };
  if (deliveryMethod === "courier" && !address) return { error: "Укажите адрес" };

  let deliveryFee = 0;
  if (deliveryMethod === "courier") {
    const freeFrom = Number(store.config.freeDeliveryFrom) || 0;
    deliveryFee = freeFrom > 0 && subtotal >= freeFrom ? 0 : Number(store.config.deliveryFee) || 0;
  }

  let orderNumber = String(raw.orderNumber || "");
  if (!/^\d{5,8}$/.test(orderNumber) || store.orders.some((o) => String(o.orderNumber) === orderNumber)) {
    orderNumber = generateOrderNumber();
  }

  const u = ctx.tgUser;
  return {
    order: {
      shop: store.config.name,
      currency: store.config.currency,
      orderNumber,
      createdAt: new Date().toISOString(),
      items,
      deliveryMethod,
      metroStation,
      address,
      deliveryTimeSlot: deliveryMethod === "courier" ? clip(raw.deliveryTimeSlot, 40) : null,
      deliveryFee,
      customerName,
      customerPhone: clip(raw.customerPhone, 40) || null,
      comment: clip(raw.comment, 500) || null,
      paymentMethod: raw.paymentMethod === "cash" ? "cash" : "transfer",
      total: subtotal + deliveryFee,
      customerTag: u ? (u.username ? `@${u.username}` : `ID:${u.id}`) : ctx.source === "demo" ? "демо-заказ" : "сайт (без Telegram)",
      customerChatId: u ? u.id : null,
      source: ctx.source,
      statusKey: "new",
      status: STATUSES.new,
    },
  };
}

async function createOrder(raw, ctx) {
  const built = buildOrder(raw, ctx);
  if (built.error) return { ok: false, error: built.error };
  const order = built.order;

  // Списываем остаток (синхронно с проверкой в buildOrder, поэтому гонок между заказами нет)
  const lowNow = reserveStock(order);
  order.stockReserved = true;

  store.orders.unshift(order);
  store.orders = store.orders.slice(0, 500);
  saveStore();

  broadcast("order_new", order); // мгновенное уведомление в веб-админке
  broadcast("catalog", { products: store.products }); // таблица остатков обновится у всех
  if (lowNow.length) {
    broadcast("low_stock", { products: lowNow.map((p) => ({ id: p.id, name: p.name, brand: p.brand, stock: p.stock })) });
    notifyLowStock(lowNow).catch((e) => console.error("low stock notify:", e));
  }
  console.log(`🆕 Заказ №${order.orderNumber} — ${order.customerName}, ${order.total} ${order.currency} [${order.source}]`);

  // Telegram: менеджеру + подтверждение клиенту (не блокируем ответ клиенту ожиданием Telegram)
  (async () => {
    await notifyManagers(order, ctx.fallbackChatId);
    if (order.customerChatId) {
      await tgApi("sendMessage", {
        chat_id: order.customerChatId,
        text: `✅ Заявка №${order.orderNumber} принята! Менеджер подтвердит заказ в Telegram.`,
      });
    }
    broadcast("order_update", order);
  })().catch((e) => console.error("notify error:", e));

  return { ok: true, order };
}

// Списать остаток по заказу. Возвращает товары, у которых осталось мало (<= LOW_STOCK)
function reserveStock(order) {
  const low = [];
  for (const it of order.items || []) {
    const prod = store.products.find((p) => p.id === it.id);
    if (!prod) continue;
    const before = prod.stock;
    applyStock(prod, prod.stock - it.qty);
    if (before > LOW_STOCK && prod.stock <= LOW_STOCK && !low.includes(prod)) low.push(prod);
  }
  return low;
}

// Вернуть остаток по заказу (при отмене)
function releaseStock(order) {
  for (const it of order.items || []) {
    const prod = store.products.find((p) => p.id === it.id);
    if (prod) applyStock(prod, prod.stock + it.qty);
  }
}

// Хватает ли сейчас остатка, чтобы вернуть отменённый заказ в работу
function canReserve(order) {
  const need = {};
  for (const it of order.items || []) need[it.id] = (need[it.id] || 0) + it.qty;
  for (const [id, qty] of Object.entries(need)) {
    const prod = store.products.find((p) => p.id === id);
    if (prod && prod.stock < qty) return `«${prod.name}»: на складе ${prod.stock} шт., нужно ${qty}`;
  }
  return null;
}

async function notifyLowStock(products) {
  if (!BOT_TOKEN) return;
  const lines = products
    .map((p) => `• ${esc(p.brand)} — ${esc(p.name)}: ${p.stock === 0 ? "<b>закончился</b>" : `осталось <b>${p.stock}</b> шт.`}`)
    .join("\n");
  for (const chatId of notifyTargets()) {
    await tgApi("sendMessage", { chat_id: chatId, text: `⚠️ <b>Заканчивается товар</b>\n${lines}`, parse_mode: "HTML" });
  }
}

// Возвращает { order } или { error }
async function setOrderStatus(orderNumber, key) {
  const order = store.orders.find((o) => String(o.orderNumber) === String(orderNumber));
  if (!order || !STATUSES[key]) return { error: "Заказ не найден" };
  if (order.statusKey === key) return { order };

  const wasCancelled = order.statusKey === "cancelled";
  if (key === "cancelled" && order.stockReserved === true) {
    // Отмена возвращает товар на склад
    releaseStock(order);
    order.stockReserved = false;
    broadcast("catalog", { products: store.products });
  } else if (wasCancelled && key !== "cancelled" && order.stockReserved === false) {
    // Возврат отменённого заказа в работу снова резервирует товар
    const problem = canReserve(order);
    if (problem) return { error: `Недостаточно товара ${problem}` };
    reserveStock(order);
    order.stockReserved = true;
    broadcast("catalog", { products: store.products });
  }

  order.statusKey = key;
  order.status = STATUSES[key];
  saveStore();
  broadcast("order_update", order);
  await refreshTelegramMessages(order);
  if (order.customerChatId && key !== "new") {
    await tgApi("sendMessage", {
      chat_id: order.customerChatId,
      text: `Заказ №${order.orderNumber}: ${STATUSES[key]}`,
    });
  }
  return { order };
}

// Ручное изменение остатка из админки или Telegram. Задайте stock (точное число) или delta (+/-)
function changeStock(id, { stock, delta }) {
  const prod = store.products.find((p) => p.id === id);
  if (!prod) return { error: "Товар не найден" };
  let next;
  if (stock !== undefined && stock !== null && stock !== "") {
    next = parseStock(stock);
    if (next === null) return { error: "Количество должно быть числом" };
  } else {
    const d = Math.floor(Number(delta));
    if (!Number.isFinite(d)) return { error: "Некорректное изменение" };
    next = Math.min(MAX_STOCK, Math.max(0, prod.stock + d));
  }
  applyStock(prod, next);
  saveStore();
  broadcast("catalog", { products: store.products });
  return { product: prod };
}

function makeDemoOrder() {
  const inStock = store.products.filter((p) => p.inStock);
  const liquids = inStock.filter((p) => p.category === "liquids");
  const carts = inStock.filter((p) => p.category === "cartridges");
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const items = [];
  // Берём разные жидкости и не больше, чем есть на складе
  const shuffled = [...liquids].sort(() => Math.random() - 0.5).slice(0, 2);
  for (const p of shuffled) {
    items.push({ id: p.id, qty: Math.min(p.stock, 1 + Math.floor(Math.random() * 2)), strength: pick(p.strengths || [null]) });
  }
  if (carts.length && Math.random() > 0.4) items.push({ id: pick(carts).id, qty: 1 });
  const gift = carts.find((p) => p.id === store.config.giftProductId) || carts[0];
  if (gift) items.push({ id: gift.id, qty: 1, isGift: true });
  const names = ["Алексей", "Мария", "Дмитрий", "Анна", "Игорь", "Екатерина"];
  const stations = ["Немига", "Октябрьская", "Площадь Ленина", "Парк Челюскинцев", "Купаловская"];
  const courier = Math.random() > 0.5;
  return {
    items,
    customerName: pick(names),
    customerPhone: "+375 29 " + String(1000000 + Math.floor(Math.random() * 8999999)),
    deliveryMethod: courier ? "courier" : "pickup",
    metroStation: courier ? null : pick(stations),
    address: courier ? "г. Минск, пр-т Независимости, 45, кв. 12" : null,
    deliveryTimeSlot: courier ? "14:00–17:00" : null,
    paymentMethod: Math.random() > 0.5 ? "cash" : "transfer",
    comment: Math.random() > 0.5 ? "Позвоните за 10 минут" : null,
  };
}

// ───────────────────────── Управление каталогом ─────────────────────────
function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16); // короче, чтобы id влезал в callback_data Telegram (лимит 64 байта)
}

function upsertProduct(rawInput) {
  // Для существующего товара недостающие поля берём из базы. Так правка цены не затрёт свежий остаток.
  const current = rawInput.id ? store.products.find((p) => p.id === rawInput.id) : null;
  const input = current ? { ...current, ...rawInput, stock: rawInput.stock } : rawInput;
  const category = input.category === "cartridges" ? "cartridges" : "liquids";
  const brand = clip(input.brand, 60);
  const name = clip(input.name, 100);
  const price = Number(input.price);
  if (!brand || !name) return { error: "Укажите бренд и название" };
  if (!Number.isFinite(price) || price <= 0) return { error: "Некорректная цена" };

  let strengths = null;
  if (category === "liquids") {
    const arr = (Array.isArray(input.strengths) ? input.strengths : String(input.strengths || "").split(/[,\s]+/))
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 0);
    strengths = arr.length ? [...new Set(arr)].sort((a, b) => a - b) : [0, 3, 6];
  }

  const data = {
    category,
    brand,
    name,
    price,
    strengths,
    icon: clip(input.icon, 8) || (category === "liquids" ? "💧" : "🔋"),
  };

  const existing = input.id ? store.products.find((p) => p.id === input.id) : null;
  const given = parseStock(input.stock);
  if (input.stock !== undefined && input.stock !== null && input.stock !== "" && given === null) {
    return { error: "Количество должно быть числом" };
  }

  if (existing) {
    Object.assign(existing, data);
    if (given !== null) applyStock(existing, given);
    saveStore();
    return { product: existing };
  }
  let id = `${category === "liquids" ? "liq" : "cart"}-${slugify(brand) || "x"}-${slugify(name) || Date.now()}`;
  while (store.products.some((p) => p.id === id)) id += "-" + Math.floor(Math.random() * 100);
  const product = { id, ...data };
  applyStock(product, given === null ? DEFAULT_STOCK : given);
  store.products.push(product);
  saveStore();
  return { product };
}

const CONFIG_FIELDS = {
  name: "string",
  currency: "string",
  deliveryFee: "number",
  freeDeliveryFrom: "number",
  workHours: "string",
  liquidsForGift: "number",
  giftProductId: "string",
  paymentDetails: "string",
  managerContact: "string",
};

function updateConfig(input) {
  for (const [key, type] of Object.entries(CONFIG_FIELDS)) {
    if (!(key in input)) continue;
    if (type === "number") {
      const n = Number(input[key]);
      if (Number.isFinite(n) && n >= 0) store.config[key] = n;
    } else {
      store.config[key] = clip(input[key], 500);
    }
  }
  saveStore();
}

// ───────────────────────── HTTP-сервер ─────────────────────────
function serveFile(res, file, contentType) {
  fs.readFile(path.join(__dirname, file), (err, content) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Ошибка чтения " + file);
      return;
    }
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  try {
    // ── Публичное API магазина ──
    if (p === "/api/store" && req.method === "GET") {
      return sendJson(res, 200, { config: store.config, products: store.products });
    }

    if (p === "/api/order" && req.method === "POST") {
      if (rateLimited("order:" + clientIp(req), 10, 60 * 1000)) {
        return sendJson(res, 429, { ok: false, error: "Слишком много запросов, попробуйте через минуту" });
      }
      const body = await readJson(req);
      const tgUser = verifyInitData(body.initData);
      const result = await createOrder(body.order, { source: tgUser ? "telegram" : "web", tgUser });
      if (!result.ok) return sendJson(res, 400, result);
      return sendJson(res, 200, { ok: true, orderNumber: result.order.orderNumber, total: result.order.total });
    }

    if (p === "/api/health") return sendJson(res, 200, { ok: true, telegram: Boolean(BOT_TOKEN) });

    // ── Страницы ──
    if (p === "/" || p === "/index.html") return serveFile(res, "index.html", "text/html; charset=utf-8");
    if (p === "/admin" || p === "/admin/") return serveFile(res, "admin.html", "text/html; charset=utf-8");

    // ── API админки ──
    if (p === "/admin/api/login" && req.method === "POST") {
      if (rateLimited("login:" + clientIp(req), 8, 60 * 1000)) {
        return sendJson(res, 429, { ok: false, error: "Слишком много попыток" });
      }
      const body = await readJson(req, 4096);
      if (body.password && safeEqual(body.password, ADMIN_PASSWORD)) {
        return sendJson(res, 200, { ok: true, token: adminToken() });
      }
      return sendJson(res, 401, { ok: false, error: "Неверный пароль" });
    }

    if (p.startsWith("/admin/api/")) {
      if (!isAuthorized(req, url)) return sendJson(res, 401, { ok: false, error: "unauthorized" });

      if (p === "/admin/api/state" && req.method === "GET") {
        return sendJson(res, 200, {
          config: store.config,
          products: store.products,
          orders: store.orders,
          statuses: STATUSES,
          telegram: Boolean(BOT_TOKEN),
        });
      }

      if (p === "/admin/api/stream" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write("retry: 3000\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      if (p === "/admin/api/order/status" && req.method === "POST") {
        const body = await readJson(req, 4096);
        const r = await setOrderStatus(body.orderNumber, body.status);
        if (r.error) return sendJson(res, r.error === "Заказ не найден" ? 404 : 409, { ok: false, error: r.error });
        return sendJson(res, 200, { ok: true, order: r.order });
      }

      if (p === "/admin/api/stock" && req.method === "POST") {
        const body = await readJson(req, 4096);
        const r = changeStock(body.id, { stock: body.stock, delta: body.delta });
        if (r.error) return sendJson(res, 400, { ok: false, error: r.error });
        return sendJson(res, 200, { ok: true, product: r.product });
      }

      if (p === "/admin/api/test-order" && req.method === "POST") {
        const result = await createOrder(makeDemoOrder(), { source: "demo", tgUser: null });
        if (!result.ok) return sendJson(res, 400, result);
        return sendJson(res, 200, { ok: true, order: result.order });
      }

      if (p === "/admin/api/product" && req.method === "POST") {
        const body = await readJson(req);
        const r = upsertProduct(body);
        if (r.error) return sendJson(res, 400, { ok: false, error: r.error });
        broadcast("catalog", { products: store.products });
        return sendJson(res, 200, { ok: true, product: r.product });
      }

      if (p === "/admin/api/product/delete" && req.method === "POST") {
        const body = await readJson(req, 4096);
        store.products = store.products.filter((x) => x.id !== body.id);
        saveStore();
        broadcast("catalog", { products: store.products });
        return sendJson(res, 200, { ok: true });
      }

      if (p === "/admin/api/config" && req.method === "POST") {
        const body = await readJson(req);
        updateConfig(body);
        broadcast("config", { config: store.config });
        return sendJson(res, 200, { ok: true, config: store.config });
      }

      return sendJson(res, 404, { ok: false, error: "not_found" });
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  } catch (err) {
    if (err.message === "too_large") return sendJson(res, 413, { ok: false, error: "Слишком большой запрос" });
    if (err.message === "bad_json") return sendJson(res, 400, { ok: false, error: "Некорректный JSON" });
    console.error("HTTP error:", err);
    sendJson(res, 500, { ok: false, error: "Ошибка сервера" });
  }
});

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Магазин: http://localhost:${PORT}/   Админка: http://localhost:${PORT}/admin`);
});

// ───────────────────────── Telegram-бот (Long Polling) ─────────────────────────
let offset = 0;

async function pollUpdates() {
  // Если ранее был установлен webhook, getUpdates не работает (ошибка 409) — снимаем его
  await tgApi("deleteWebhook", { drop_pending_updates: false });

  while (true) {
    try {
      const data = await tgApi("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      });

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          try {
            if (update.message) await handleMessage(update.message);
            else if (update.callback_query) await handleCallback(update.callback_query);
          } catch (e) {
            console.error("Ошибка обработки update:", e);
          }
        }
      } else if (!data.ok) {
        console.error("getUpdates:", data.description);
        await new Promise((r) => setTimeout(r, 5000));
      }
    } catch (err) {
      console.error("Ошибка Long Polling:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const userId = cb.from?.id;
  const data = cb.data || "";

  if (!isAdmin(userId)) {
    await tgApi("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: "Нет прав администратора",
      show_alert: true,
    });
    return;
  }

  // Кнопки статуса заказа: ord:12345:accepted
  if (data.startsWith("ord:")) {
    const [, orderNumber, statusKey] = data.split(":");
    const r = await setOrderStatus(orderNumber, statusKey);
    await tgApi("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: r.order ? `Статус №${orderNumber}: ${STATUSES[statusKey]}` : r.error,
      show_alert: Boolean(r.error),
    });
    return;
  }

  // Изменение остатка: qty:liq-podonki-1:-1 / qty:liq-podonki-1:+1
  if (data.startsWith("qty:")) {
    const [, pid, d] = data.split(":");
    const r = changeStock(pid, { delta: Number(d) });
    if (r.product) await sendStockMenu(chatId, messageId);
    await tgApi("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: r.product ? `${r.product.name}: ${r.product.stock} шт.` : r.error,
    });
    return;
  }

  // Кнопки старого меню (stock:ID) или подпись товара (noop) — просто обновляем меню
  if (data.startsWith("stock:") || data === "noop") {
    await sendStockMenu(chatId, messageId);
    await tgApi("answerCallbackQuery", { callback_query_id: cb.id });
  }
}

function stockIcon(pr) {
  return pr.stock === 0 ? "🔴" : pr.stock <= LOW_STOCK ? "🟡" : "🟢";
}

async function sendStockMenu(chatId, editMessageId = null) {
  // На каждый товар одна строка: [−1] [название · остаток] [+1]
  const rows = store.products.map((pr) => {
    const label = `${stockIcon(pr)} ${pr.name}`.slice(0, 24) + ` · ${pr.stock}`;
    return [
      { text: "➖", callback_data: `qty:${pr.id}:-1` },
      { text: label, callback_data: "noop" },
      { text: "➕", callback_data: `qty:${pr.id}:+1` },
    ];
  });

  const payload = {
    chat_id: chatId,
    text:
      "🛠 <b>Остатки товаров</b>\n" +
      "Кнопками ➖ / ➕ меняйте количество на 1 (🟢 много, 🟡 заканчивается, 🔴 нет).\n" +
      "Точное число: <code>/stock ID_ТОВАРА КОЛИЧЕСТВО</code>\n" +
      "Сменить цену: <code>/price ID_ТОВАРА НОВАЯ_ЦЕНА</code>\n" +
      "Список ID: /products" +
      (WEBAPP_URL ? `\n\n🖥 Полная веб-админка: ${esc(WEBAPP_URL.replace(/\/$/, ""))}/admin` : ""),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  };

  if (editMessageId) {
    await tgApi("editMessageText", { ...payload, message_id: editMessageId });
  } else {
    await tgApi("sendMessage", payload);
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  // Запасной путь: заказ через tg.sendData (если приложение открыто кнопкой-клавиатурой)
  if (msg.web_app_data && msg.web_app_data.data) {
    try {
      const parsed = JSON.parse(msg.web_app_data.data);
      if (parsed.orderNumber && store.orders.some((o) => String(o.orderNumber) === String(parsed.orderNumber))) return;
      const result = await createOrder(parsed, { source: "telegram", tgUser: msg.from, fallbackChatId: chatId });
      if (!result.ok) {
        await tgApi("sendMessage", { chat_id: chatId, text: `⚠️ Не удалось принять заказ: ${result.error}` });
      }
    } catch (err) {
      console.error("Ошибка обработки заказа:", err);
    }
    return;
  }

  if (!msg.text) return;
  const text = msg.text.trim();

  if (text.startsWith("/start")) {
    const firstName = msg.from?.first_name || "друг";
    const appUrl = WEBAPP_URL || "https://example.com";

    await tgApi("sendMessage", {
      chat_id: chatId,
      text:
        `👋 Привет, ${esc(firstName)}!\n\n` +
        `Добро пожаловать в <b>${esc(store.config.name)}</b> (Минск).\n` +
        `• Жидкости и картриджи в наличии\n` +
        `• 🎁 При покупке ${store.config.liquidsForGift} жидкостей — картридж в подарок\n` +
        `• Самовывоз у метро или курьер по Минску\n\n` +
        `Нажмите кнопку ниже, чтобы открыть каталог 👇`,
      parse_mode: "HTML",
      reply_markup: {
        keyboard: [[{ text: "🛍 Открыть каталог", web_app: { url: appUrl } }]],
        resize_keyboard: true,
      },
    });
    return;
  }

  if (text.startsWith("/admin")) {
    if (!isAdmin(userId)) {
      await tgApi("sendMessage", { chat_id: chatId, text: "Доступ к админке ограничен." });
      return;
    }
    await sendStockMenu(chatId);
    return;
  }

  if (text.startsWith("/orders")) {
    if (!isAdmin(userId)) {
      await tgApi("sendMessage", { chat_id: chatId, text: "Доступ к заказам ограничен." });
      return;
    }
    if (store.orders.length === 0) {
      await tgApi("sendMessage", { chat_id: chatId, text: "Заказов пока нет." });
      return;
    }
    const list = store.orders
      .slice(0, 10)
      .map((o) => `• <b>№${esc(o.orderNumber)}</b> (${esc(o.status || "Новый")}) — ${esc(o.customerName)}, ${o.total} ${esc(o.currency)}`)
      .join("\n");
    await tgApi("sendMessage", {
      chat_id: chatId,
      text: `📋 <b>Последние заказы:</b>\n\n${list}`,
      parse_mode: "HTML",
    });
    return;
  }

  // /stock — меню остатков; /stock ID 25 — задать точное число; /stock ID +5 / -2 — изменить на N
  if (text === "/stock" || text.startsWith("/stock ")) {
    if (!isAdmin(userId)) return;
    const parts = text.split(/\s+/);
    if (parts.length === 1) {
      await sendStockMenu(chatId);
      return;
    }
    const arg = parts[2] || "";
    const isDelta = /^[+-]\d+$/.test(arg);
    const r = changeStock(parts[1], isDelta ? { delta: Number(arg) } : { stock: arg });
    await tgApi("sendMessage", {
      chat_id: chatId,
      text: r.product
        ? `✅ ${r.product.brand} — ${r.product.name}: теперь ${r.product.stock} шт.`
        : `${r.error}. Формат: /stock ID_ТОВАРА 25 (или +5 / -2). Список ID: /products`,
    });
    return;
  }

  if (text === "/products") {
    if (!isAdmin(userId)) return;
    const list = store.products
      .map((pr) => `${stockIcon(pr)} <code>${esc(pr.id)}</code> — ${esc(pr.brand)} ${esc(pr.name)}: ${pr.stock} шт., ${pr.price} ${esc(store.config.currency)}`)
      .join("\n");
    await tgApi("sendMessage", { chat_id: chatId, text: `📦 <b>Товары</b>\n\n${list}`, parse_mode: "HTML" });
    return;
  }

  if (text.startsWith("/price ")) {
    if (!isAdmin(userId)) return;
    const parts = text.split(/\s+/);
    const prod = store.products.find((x) => x.id === parts[1]);
    const newPrice = Number(parts[2]);
    if (!prod || !Number.isFinite(newPrice) || newPrice <= 0) {
      await tgApi("sendMessage", {
        chat_id: chatId,
        text: "Формат: /price ID_ТОВАРА НОВАЯ_ЦЕНА (например: /price liq-podonki-1 23)",
      });
      return;
    }
    prod.price = newPrice;
    saveStore();
    broadcast("catalog", { products: store.products });
    await tgApi("sendMessage", {
      chat_id: chatId,
      text: `✅ Цена обновлена: ${prod.brand} — ${prod.name} теперь ${prod.price} ${store.config.currency}`,
    });
    return;
  }

  if (text.startsWith("/delivery ")) {
    if (!isAdmin(userId)) return;
    const fee = Number(text.split(/\s+/)[1]);
    if (!Number.isFinite(fee) || fee < 0) {
      await tgApi("sendMessage", { chat_id: chatId, text: "Формат: /delivery 5" });
      return;
    }
    store.config.deliveryFee = fee;
    saveStore();
    broadcast("config", { config: store.config });
    await tgApi("sendMessage", {
      chat_id: chatId,
      text: `✅ Стоимость доставки обновлена: ${fee} ${store.config.currency}`,
    });
  }
}

if (BOT_TOKEN) {
  if (WEBAPP_URL) {
    tgApi("setChatMenuButton", {
      menu_button: { type: "web_app", text: "Каталог", web_app: { url: WEBAPP_URL } },
    }).catch(() => {});
  }
  pollUpdates();
}
