const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID; // ID вашего чата/группы (например -1001234567890)
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ADMIN_KEY = process.env.ADMIN_KEY || "vapebros2026"; // запасной пароль для входа в админку из браузера
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error("ОШИБКА: Не задана переменная BOT_TOKEN в Railway Variables!");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
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
    { id: "liq-podonki-1", category: "liquids", brand: "PODONKI", name: "Ледяной Гранат и Мята", price: 21, strengths: [0, 3, 6], inStock: true, icon: "🧊", image: "" },
    { id: "liq-podonki-2", category: "liquids", brand: "PODONKI", name: "Кислый Крыжовник", price: 22, strengths: [3, 6], inStock: true, icon: "🫐", image: "" },
    { id: "liq-podonki-3", category: "liquids", brand: "PODONKI", name: "Манговый Нектар", price: 20, strengths: [0, 3, 6], inStock: false, icon: "🥭", image: "" },
    { id: "liq-catswill-1", category: "liquids", brand: "Catswill", name: "Черничный Пирог", price: 19, strengths: [0, 3, 6], inStock: true, icon: "🥧", image: "" },
    { id: "liq-catswill-2", category: "liquids", brand: "Catswill", name: "Хвоя и Зелёное Яблоко", price: 24, strengths: [3, 6], inStock: true, icon: "🍏", image: "" },
    { id: "liq-hotspot-1", category: "liquids", brand: "Hotspot", name: "Спелый Персик и Личи", price: 23, strengths: [0, 3, 6], inStock: true, icon: "🍑", image: "" },
    { id: "liq-faff-1", category: "liquids", brand: "Faff", name: "Земляника со Сливками", price: 25, strengths: [3, 6], inStock: true, icon: "🍓", image: "" },
    { id: "liq-rm-1", category: "liquids", brand: "Rick & Morty", name: "Цитадельский Фрост", price: 16, strengths: [0, 3, 6], inStock: true, icon: "🧪", image: "" },
    { id: "cart-xros-06", category: "cartridges", brand: "XROS", name: "Картридж 0.6 Ом (3 мл)", price: 14, strengths: null, inStock: true, icon: "🔋", image: "" },
    { id: "cart-xros-08", category: "cartridges", brand: "XROS", name: "Картридж 0.8 Ом (2 мл)", price: 14, strengths: null, inStock: true, icon: "🔋", image: "" },
    { id: "cart-vthru-07", category: "cartridges", brand: "V.THRU / VMATE", name: "Картридж VMATE Top Fill 0.7 Ом", price: 15, strengths: null, inStock: true, icon: "⚡", image: "" },
    { id: "cart-aegis-04", category: "cartridges", brand: "AEGIS", name: "Испаритель B-Series 0.4 Ом", price: 14, strengths: null, inStock: true, icon: "🛡️", image: "" },
    { id: "cart-pasito-06", category: "cartridges", brand: "PASITO", name: "Картридж Pasito II / Mini 0.6 Ом", price: 15, strengths: null, inStock: true, icon: "🎛️", image: "" },
  ],
  orders: [],
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(DEFAULT_STORE, null, 2), "utf8");
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return {
      config: { ...DEFAULT_STORE.config, ...(parsed.config || {}) },
      products: Array.isArray(parsed.products) ? parsed.products : DEFAULT_STORE.products,
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}

function saveStore(data) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
}

let store = ensureStore();

function isAdminUser(userId, adminKey) {
  if (adminKey && adminKey === ADMIN_KEY) return true;
  if (!userId) return false;
  if (ADMIN_IDS.length === 0) return true; // в демо-режиме, если ADMIN_IDS пуст, пускаем
  return ADMIN_IDS.includes(String(userId));
}

function saveBase64Image(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return "";
  if (dataUrl.startsWith("/uploads/")) return dataUrl;
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) return "";
  const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  const filename = `prod_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

function deleteOldImageIfUnused(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith("/uploads/")) return;
  const stillUsed = store.products.some((p) => p.image === imageUrl);
  if (stillUsed) return;
  const safeName = path.basename(imageUrl);
  const fullPath = path.join(UPLOADS_DIR, safeName);
  if (fs.existsSync(fullPath)) {
    fs.unlink(fullPath, () => {});
  }
}

async function tgApi(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function formatOrderMessage(order, statusLabel = "🆕 Новый") {
  const itemsLines = (order.items || [])
    .map((item, idx) => {
      const str = item.strength !== null && item.strength !== undefined ? ` (${item.strength} мг)` : "";
      const gift = item.isGift ? " 🎁 [ПОДАРОК]" : "";
      return `${idx + 1}. ${item.brand} — ${item.name}${str} × ${item.qty} = ${item.price * item.qty} ${order.currency}${gift}`;
    })
    .join("\n");

  const deliveryText =
    order.deliveryMethod === "pickup"
      ? `🚇 Самовывоз: м. ${order.metroStation}`
      : `🛵 Курьер: ${order.address} (${order.deliveryTimeSlot})`;

  const paymentText =
    order.paymentMethod === "cash"
      ? "Наличными при получении"
      : "Переводом по реквизитам";

  return (
    `🔥 <b>ЗАКАЗ №${order.orderNumber}</b> • <b>${statusLabel}</b>\n\n` +
    `👤 <b>Клиент:</b> ${order.customerName} (${order.customerTag || "из Mini App"})\n` +
    (order.customerPhone ? `📞 <b>Телефон:</b> ${order.customerPhone}\n` : "") +
    `${deliveryText}\n` +
    `💳 <b>Оплата:</b> ${paymentText}\n` +
    (order.comment ? `💬 <b>Комментарий:</b> ${order.comment}\n` : "") +
    `\n📦 <b>Состав заказа:</b>\n${itemsLines}\n\n` +
    `💰 <b>Итого к оплате: ${order.total} ${order.currency}</b>`
  );
}

function orderButtons(orderNumber) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Принять", callback_data: `ord:${orderNumber}:accepted` },
        { text: "🛵 В пути", callback_data: `ord:${orderNumber}:delivering` },
      ],
      [{ text: "❌ Отменить", callback_data: `ord:${orderNumber}:cancelled` }],
    ],
  };
}

async function processIncomingOrder(rawOrder, fallbackUser = null) {
  const userTag =
    rawOrder.customerTag ||
    (fallbackUser?.username
      ? `@${fallbackUser.username}`
      : fallbackUser?.id
      ? `ID:${fallbackUser.id}`
      : "Mini App");

  const order = {
    ...rawOrder,
    customerTag: userTag,
    status: "🆕 Новый",
  };

  store.orders.unshift(order);
  store.orders = store.orders.slice(0, 200);
  saveStore(store);

  const recipients = new Set();
  if (MANAGER_CHAT_ID) recipients.add(String(MANAGER_CHAT_ID));
  if (recipients.size === 0) {
    ADMIN_IDS.forEach((id) => recipients.add(String(id)));
  }

  for (const chatId of recipients) {
    await tgApi("sendMessage", {
      chat_id: chatId,
      text: formatOrderMessage(order, order.status),
      parse_mode: "HTML",
      reply_markup: orderButtons(order.orderNumber),
    }).catch((e) => console.error("Ошибка отправки заказа в чат:", e.message));
  }

  if (fallbackUser?.id) {
    await tgApi("sendMessage", {
      chat_id: fallbackUser.id,
      text: `✅ Заявка №${order.orderNumber} принята! Менеджер скоро свяжется с вами в Telegram.`,
    }).catch(() => {});
  }

  return order;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const cleanUrl = parsedUrl.pathname;

  // Раздача загруженных фотографий товаров
  if (cleanUrl.startsWith("/uploads/") && req.method === "GET") {
    const safeName = path.basename(cleanUrl);
    const filePath = path.join(UPLOADS_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ext = path.extname(safeName).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
        ? "image/webp"
        : "image/jpeg";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Публичные данные магазина
  if (cleanUrl === "/api/store" && req.method === "GET") {
    sendJson(res, 200, { config: store.config, products: store.products });
    return;
  }

  // Проверка прав админа для UI Mini App
  if (cleanUrl === "/api/admin/check" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const allowed = isAdminUser(body.userId, body.adminKey);
      sendJson(res, 200, {
        ok: true,
        isAdmin: allowed,
        orders: allowed ? store.orders : [],
      });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  // Сохранение / добавление товара из админки Mini App
  if (cleanUrl === "/api/admin/product" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!isAdminUser(body.userId, body.adminKey)) {
        sendJson(res, 403, { ok: false, error: "Нет прав администратора" });
        return;
      }
      const p = body.product || {};
      const name = String(p.name || "").trim();
      const brand = String(p.brand || "").trim();
      const price = Number(p.price);
      if (!name || !brand || !Number.isFinite(price) || price <= 0) {
        sendJson(res, 400, { ok: false, error: "Заполните название, бренд и цену" });
        return;
      }

      const category = p.category === "cartridges" ? "cartridges" : "liquids";
      const strengths =
        category === "liquids" && Array.isArray(p.strengths) && p.strengths.length > 0
          ? p.strengths.map(Number).filter((n) => !Number.isNaN(n))
          : null;

      let imageUrl = "";
      if (p.imageData) {
        imageUrl = saveBase64Image(p.imageData);
      } else if (p.image && p.image.startsWith("/uploads/")) {
        imageUrl = p.image;
      }

      const existingIdx = p.id ? store.products.findIndex((item) => item.id === p.id) : -1;
      if (existingIdx !== -1) {
        const prevImage = store.products[existingIdx].image;
        store.products[existingIdx] = {
          ...store.products[existingIdx],
          category,
          brand,
          name,
          price,
          strengths,
          inStock: Boolean(p.inStock),
          icon: String(p.icon || (category === "liquids" ? "💧" : "🔋")).trim(),
          image: imageUrl,
        };
        if (prevImage && prevImage !== imageUrl) {
          deleteOldImageIfUnused(prevImage);
        }
      } else {
        const newId = `${category === "liquids" ? "liq" : "cart"}-${Date.now().toString(36)}`;
        store.products.unshift({
          id: newId,
          category,
          brand,
          name,
          price,
          strengths,
          inStock: p.inStock !== false,
          icon: String(p.icon || (category === "liquids" ? "💧" : "🔋")).trim(),
          image: imageUrl,
        });
      }

      saveStore(store);
      sendJson(res, 200, { ok: true, products: store.products });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  // Удаление товара из админки Mini App
  if (cleanUrl === "/api/admin/product/delete" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!isAdminUser(body.userId, body.adminKey)) {
        sendJson(res, 403, { ok: false, error: "Нет прав администратора" });
        return;
      }
      const idx = store.products.findIndex((p) => p.id === body.productId);
      if (idx !== -1) {
        const removed = store.products.splice(idx, 1)[0];
        deleteOldImageIfUnused(removed.image);
        saveStore(store);
      }
      sendJson(res, 200, { ok: true, products: store.products });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  // Сохранение настроек магазина из админки Mini App
  if (cleanUrl === "/api/admin/config" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!isAdminUser(body.userId, body.adminKey)) {
        sendJson(res, 403, { ok: false, error: "Нет прав администратора" });
        return;
      }
      const c = body.config || {};
      if (c.name) store.config.name = String(c.name).trim();
      if (c.deliveryFee !== undefined && Number.isFinite(Number(c.deliveryFee))) {
        store.config.deliveryFee = Math.max(0, Number(c.deliveryFee));
      }
      if (c.liquidsForGift !== undefined && Number.isFinite(Number(c.liquidsForGift))) {
        store.config.liquidsForGift = Math.max(1, Number(c.liquidsForGift));
      }
      if (c.giftProductId) store.config.giftProductId = String(c.giftProductId).trim();
      if (c.workHours) store.config.workHours = String(c.workHours).trim();
      if (c.paymentDetails) store.config.paymentDetails = String(c.paymentDetails).trim();
      if (c.managerContact) store.config.managerContact = String(c.managerContact).trim();

      saveStore(store);
      sendJson(res, 200, { ok: true, config: store.config });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  // Смена статуса заказа из админки Mini App
  if (cleanUrl === "/api/admin/order-status" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!isAdminUser(body.userId, body.adminKey)) {
        sendJson(res, 403, { ok: false, error: "Нет прав администратора" });
        return;
      }
      const order = store.orders.find((o) => String(o.orderNumber) === String(body.orderNumber));
      if (order && body.status) {
        order.status = String(body.status);
        saveStore(store);
      }
      sendJson(res, 200, { ok: true, orders: store.orders });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  // Приём заказа из Mini App
  if (cleanUrl === "/api/order" && req.method === "POST") {
    try {
      const parsed = await readJsonBody(req);
      const order = await processIncomingOrder(parsed, parsed.tgUser || null);
      sendJson(res, 200, { ok: true, orderNumber: order.orderNumber });
    } catch (err) {
      console.error("Ошибка /api/order:", err.message);
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return;
  }

  // Главная страница Mini App
  if (cleanUrl === "/" || cleanUrl === "/index.html") {
    const filePath = path.join(__dirname, "index.html");
    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Ошибка чтения index.html");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

// Telegram Bot Polling
let offset = 0;

async function pollUpdates() {
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
          if (update.message) await handleMessage(update.message);
          else if (update.callback_query) await handleCallback(update.callback_query);
        }
      } else if (!data.ok) {
        console.error("Telegram API error:", data.description);
        await new Promise((r) => setTimeout(r, 3000));
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

  if (!isAdminUser(userId)) {
    await tgApi("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: `Нет прав. Ваш ID: ${userId}`,
      show_alert: true,
    });
    return;
  }

  if (data.startsWith("ord:")) {
    const [, orderNumber, statusKey] = data.split(":");
    const order = store.orders.find((o) => String(o.orderNumber) === String(orderNumber));
    const statusMap = {
      accepted: "✅ Принят",
      delivering: "🛵 Передан курьеру",
      cancelled: "❌ Отменён",
    };
    const label = statusMap[statusKey] || "Обновлён";

    if (order) {
      order.status = label;
      saveStore(store);
      if (chatId && messageId) {
        await tgApi("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: formatOrderMessage(order, label),
          parse_mode: "HTML",
          reply_markup: statusKey === "cancelled" ? undefined : orderButtons(orderNumber),
        });
      }
    }

    await tgApi("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: `Заказ №${orderNumber}: ${label}`,
    });
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (msg.web_app_data && msg.web_app_data.data) {
    try {
      const parsed = JSON.parse(msg.web_app_data.data);
      await processIncomingOrder(parsed, msg.from);
    } catch (err) {
      console.error("Ошибка web_app_data:", err.message);
    }
    return;
  }

  if (!msg.text) return;
  const text = msg.text.trim();

  // Команда для получения ID чата/группы, куда должны приходить заказы
  if (text.startsWith("/chatid")) {
    await tgApi("sendMessage", {
      chat_id: chatId,
      text: `🆔 ID этого чата: <code>${chatId}</code>\nВаш личный ID: <code>${userId}</code>\n\nВставьте ID чата в переменную <code>MANAGER_CHAT_ID</code> на Railway.`,
      parse_mode: "HTML",
    });
    return;
  }

  if (text.startsWith("/start")) {
    const firstName = msg.from?.first_name || "друг";
    const appUrl = WEBAPP_URL || "https://example.com";

    await tgApi("sendMessage", {
      chat_id: chatId,
      text:
        `👋 Привет, ${firstName}!\n\n` +
        `Добро пожаловать в <b>${store.config.name}</b> (Минск).\n` +
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
  }
}

if (WEBAPP_URL) {
  tgApi("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Каталог",
      web_app: { url: WEBAPP_URL },
    },
  }).catch(() => {});
}

pollUpdates();
