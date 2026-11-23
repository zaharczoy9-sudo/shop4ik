const http = require("http");
const fs = require("fs");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL; // https://ваш-домен.up.railway.app
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID; // ID чата или лички для заказов
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error("ОШИБКА: Не задана переменная BOT_TOKEN!");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

// Стартовое состояние магазина (используется при первом запуске)
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

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
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
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

let store = ensureStore();

function isAdmin(userId) {
  if (!userId) return false;
  if (ADMIN_IDS.length === 0) return String(userId) === String(MANAGER_CHAT_ID);
  return ADMIN_IDS.includes(String(userId));
}

// 1. HTTP-сервер: отдаёт index.html и JSON каталога/настроек для Mini App
const server = http.createServer((req, res) => {
  const cleanUrl = req.url.split("?")[0];

  if (cleanUrl === "/api/store") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({
        config: store.config,
        products: store.products,
      })
    );
    return;
  }

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

// 2. Вызов Telegram Bot API
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
    `👤 <b>Клиент:</b> ${order.customerName} (${order.customerTag || "без @username"})\n` +
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

// 3. Обработка обновлений Telegram
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
          if (update.message) {
            await handleMessage(update.message);
          } else if (update.callback_query) {
            await handleCallback(update.callback_query);
          }
        }
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

  // Обработка кнопок статуса заказа: ord:12345:accepted
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
      text: `Статус №${orderNumber}: ${label}`,
    });
    return;
  }

  // Переключение наличия товара из админки: stock:liq-podonki-1
  if (data.startsWith("stock:")) {
    const pid = data.slice("stock:".length);
    const prod = store.products.find((p) => p.id === pid);
    if (prod) {
      prod.inStock = !prod.inStock;
      saveStore(store);
      await sendStockMenu(chatId, messageId);
    }
    await tgApi("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: prod ? `${prod.name}: ${prod.inStock ? "в наличии" : "нет в наличии"}` : "Товар не найден",
    });
  }
}

async function sendStockMenu(chatId, editMessageId = null) {
  const rows = store.products.map((p) => [
    {
      text: `${p.inStock ? "🟢" : "🔴"} ${p.brand} — ${p.name} (${p.price} ${store.config.currency})`,
      callback_data: `stock:${p.id}`,
    },
  ]);

  const payload = {
    chat_id: chatId,
    text:
      "🛠 <b>Управление наличием товаров</b>\n" +
      "Нажмите на товар, чтобы переключить статус (🟢 в наличии / 🔴 нет в наличии).\n" +
      "Сменить цену: <code>/price ID_ТОВАРА НОВАЯ_ЦЕНА</code>",
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

  // 1. Заказ из Mini App
  if (msg.web_app_data && msg.web_app_data.data) {
    try {
      const parsed = JSON.parse(msg.web_app_data.data);
      const order = {
        ...parsed,
        customerTag: msg.from?.username ? `@${msg.from.username}` : `ID:${userId}`,
        status: "🆕 Новый",
      };
      store.orders.unshift(order);
      store.orders = store.orders.slice(0, 200);
      saveStore(store);

      await tgApi("sendMessage", {
        chat_id: chatId,
        text: `✅ Заявка №${order.orderNumber} принята! Менеджер подтвердит заказ в Telegram.`,
      });

      const targetChat = MANAGER_CHAT_ID || chatId;
      await tgApi("sendMessage", {
        chat_id: targetChat,
        text: formatOrderMessage(order, order.status),
        parse_mode: "HTML",
        reply_markup: orderButtons(order.orderNumber),
      });
    } catch (err) {
      console.error("Ошибка обработки заказа:", err);
    }
    return;
  }

  if (!msg.text) return;
  const text = msg.text.trim();

  // 2. Команда /start — приветствие и кнопка открытия каталога
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
        keyboard: [
          [
            {
              text: "🛍 Открыть каталог",
              web_app: { url: appUrl },
            },
          ],
        ],
        resize_keyboard: true,
      },
    });
    return;
  }

  // 3. Команды админки
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
      .map(
        (o) =>
          `• <b>№${o.orderNumber}</b> (${o.status || "Новый"}) — ${o.customerName}, ${o.total} ${o.currency}`
      )
      .join("\n");
    await tgApi("sendMessage", {
      chat_id: chatId,
      text: `📋 <b>Последние заказы:</b>\n\n${list}`,
      parse_mode: "HTML",
    });
    return;
  }

  if (text.startsWith("/price ")) {
    if (!isAdmin(userId)) return;
    const parts = text.split(/\s+/);
    const pid = parts[1];
    const newPrice = Number(parts[2]);
    const prod = store.products.find((p) => p.id === pid);
    if (!prod || !Number.isFinite(newPrice) || newPrice <= 0) {
      await tgApi("sendMessage", {
        chat_id: chatId,
        text: "Формат: /price ID_ТОВАРА НОВАЯ_ЦЕНА (например: /price liq-podonki-1 23)",
      });
      return;
    }
    prod.price = newPrice;
    saveStore(store);
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
    saveStore(store);
    await tgApi("sendMessage", {
      chat_id: chatId,
      text: `✅ Стоимость доставки обновлена: ${fee} ${store.config.currency}`,
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
