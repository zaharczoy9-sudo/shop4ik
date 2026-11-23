const http = require("http");
const fs = require("fs");
const path = require("path");

// Настройки берутся из переменных окружения Railway (Variables)
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL; // https://ваш-домен.up.railway.app
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID; // Ваш Telegram ID или ID группы (например, -1001234567890)
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error("ОШИБКА: Не задана переменная BOT_TOKEN в настройках Railway!");
  process.exit(1);
}

// 1. Встроенный веб-сервер для раздачи index.html
const server = http.createServer((req, res) => {
  const cleanUrl = req.url.split("?")[0];
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
  } else {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
});

server.listen(PORT, () => {
  console.log(`Сервер магазина и бота запущен на порту ${PORT}`);
});

// 2. Вспомогательная функция вызова Telegram Bot API
async function tgApi(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// 3. Обработка сообщений и заказов из Mini App (Long Polling)
let offset = 0;

async function pollUpdates() {
  while (true) {
    try {
      const data = await tgApi("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message"],
      });

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          await handleUpdate(update);
        }
      }
    } catch (err) {
      console.error("Ошибка получения обновлений Telegram:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;

  // Обработка команды /start — приветствие и кнопка открытия магазина
  if (msg.text && msg.text.startsWith("/start")) {
    const firstName = msg.from?.first_name || "друг";
    const appUrl = WEBAPP_URL || "https://example.com";

    await tgApi("sendMessage", {
      chat_id: chatId,
      text:
        `👋 Привет, ${firstName}!\n\n` +
        `Добро пожаловать в наш магазин в Минске.\n` +
        `• Жидкости и картриджи в наличии\n` +
        `• 🎁 Акция: при покупке 2 жидкостей — картридж в подарок\n` +
        `• Самовывоз у метро или доставка курьером\n\n` +
        `Нажмите кнопку ниже, чтобы открыть каталог 👇`,
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

  // Обработка заказа, отправленного через Telegram.WebApp.sendData()
  if (msg.web_app_data && msg.web_app_data.data) {
    try {
      const order = JSON.parse(msg.web_app_data.data);
      const userTag = msg.from?.username
        ? `@${msg.from.username}`
        : `ID: ${msg.from?.id}`;

      const itemsLines = (order.items || [])
        .map((item, idx) => {
          const str = item.strength !== null ? ` (${item.strength} мг)` : "";
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

      const adminMessage =
        `🔥 <b>НОВЫЙ ЗАКАЗ №${order.orderNumber}</b>\n\n` +
        `👤 <b>Клиент:</b> ${order.customerName} (${userTag})\n` +
        (order.customerPhone ? `📞 <b>Телефон:</b> ${order.customerPhone}\n` : "") +
        `${deliveryText}\n` +
        `💳 <b>Оплата:</b> ${paymentText}\n` +
        (order.comment ? `💬 <b>Комментарий:</b> ${order.comment}\n` : "") +
        `\n📦 <b>Состав заказа:</b>\n${itemsLines}\n\n` +
        `💰 <b>Итого к оплате: ${order.total} ${order.currency}</b>`;

      // Подтверждение покупателю
      await tgApi("sendMessage", {
        chat_id: chatId,
        text: `✅ Заявка №${order.orderNumber} принята! Менеджер скоро свяжется с вами для подтверждения.`,
      });

      // Отправка заявки менеджеру / в группу заказов
      if (MANAGER_CHAT_ID) {
        await tgApi("sendMessage", {
          chat_id: MANAGER_CHAT_ID,
          text: adminMessage,
          parse_mode: "HTML",
        });
      }
    } catch (err) {
      console.error("Ошибка разбора заказа:", err);
    }
  }
}

// Устанавливаем также синюю кнопку меню слева от поля ввода
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
