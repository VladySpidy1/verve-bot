// Підключаємо залежності та конфігурацію
require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const express = require("express");

// Змінні середовища
const BOT_TOKEN = process.env.BOT_TOKEN;             // Токен Telegram-бота
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;   // ID Google Таблиці
const KEY_JSON = process.env.KEY_JSON;               // Повний JSON ключа сервісного акаунта (одним рядком)

// Ініціалізуємо Telegram-бота
const bot = new Telegraf(BOT_TOKEN);

// Ініціалізуємо GoogleSpreadsheet
const doc = new GoogleSpreadsheet(SPREADSHEET_ID);

// Функція для авторизації та завантаження інформації з таблиці
async function accessSheet() {
  const creds = JSON.parse(KEY_JSON);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
}

// Функція для отримання замовлень з таблиці
// filterFn – функція фільтрації для кожного рядка, title – заголовок повідомлення
async function getOrders(filterFn, title) {
  await accessSheet();
  let message = `${title}\n\n`;
  let counter = 0;
  
  // Проходимо по всіх листах таблиці
  for (let i = 0; i < doc.sheetCount; i++) {
    const sheet = doc.sheetsByIndex[i];
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    rows.forEach((row) => {
      // Якщо статус не "Отримано" та рядок відповідає умові фільтрації
      if (row["Статус"] !== "Отримано" && filterFn(row)) {
        message += `🔹 ${row["Товар"]} | ${row["Розмір"]} | ${row["Тканина"]} | ${row["Дані для відправки"]} | до ${row["Крайня дата"]} | ${row["Тип оплати"]}\n`;
        counter++;
      }
    });
  }
  
  if (counter === 0) {
    return "✅ Немає замовлень за критерієм.";
  }
  
  return message;
}

// Функція допоміжного порівняння дат
function isSameDate(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

// Обробка команди /start – виводить меню з кнопками
bot.start(async (ctx) => {
  try {
    await ctx.reply("Вибери дію:", Markup.inlineKeyboard([
      [Markup.button.callback("📄 Всі замовлення", "all")],
      [Markup.button.callback("🚀 Завтра відправка", "tomorrow")],
      [Markup.button.callback("⚠️ Прострочені", "overdue")]
    ]));
  } catch (err) {
    console.error(err);
  }
});

// Обробка кнопки "all"
bot.action("all", async (ctx) => {
  ctx.answerCbQuery();
  try {
    const msg = await getOrders(() => true, "📄 Список всіх активних замовлень:");
    ctx.reply(msg);
  } catch (err) {
    console.error(err);
    ctx.reply("Сталася помилка при отриманні замовлень.");
  }
});

// Обробка кнопки "tomorrow"
bot.action("tomorrow", async (ctx) => {
  ctx.answerCbQuery();
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const msg = await getOrders(
      (row) => row["Крайня дата"] && isSameDate(new Date(row["Крайня дата"]), tomorrow),
      "🚀 Замовлення на завтра:"
    );
    ctx.reply(msg);
  } catch (err) {
    console.error(err);
    ctx.reply("Сталася помилка при отриманні завтрашніх замовлень.");
  }
});

// Обробка кнопки "overdue"
bot.action("overdue", async (ctx) => {
  ctx.answerCbQuery();
  try {
    const today = new Date();
    const msg = await getOrders(
      (row) => row["Крайня дата"] && new Date(row["Крайня дата"]) < today,
      "⚠️ Прострочені замовлення:"
    );
    ctx.reply(msg);
  } catch (err) {
    console.error(err);
    ctx.reply("Сталася помилка при отриманні прострочених замовлень.");
  }
});

// Запуск бота
bot.launch();
console.log("Bot launched!");

// ====== Express-сервер для Render ======
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Bot is running!");
});

app.listen(PORT, () => {
  console.log(`Web server is listening on port ${PORT}`);
});
