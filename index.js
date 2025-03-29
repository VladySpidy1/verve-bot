// Підключаємо залежності та конфігурацію
require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const express = require("express");

const BOT_TOKEN = process.env.BOT_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const KEY_JSON = process.env.KEY_JSON;

const bot = new Telegraf(BOT_TOKEN);
const doc = new GoogleSpreadsheet(SPREADSHEET_ID);

async function accessSheet() {
  const creds = JSON.parse(KEY_JSON);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
}

function parseDate(dateString) {
  if (!dateString || dateString.trim() === "") return null;
  const parts = dateString.trim().split(".");
  if (parts.length !== 3) return null;
  const [day, month, year] = parts.map(Number);
  return new Date(year, month - 1, day);
}

function isSameDate(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

async function getOrders(filterFn, title) {
  await accessSheet();
  let message = `${title}\n\n`;
  let counter = 0;

  for (let i = 0; i < doc.sheetCount; i++) {
    const sheet = doc.sheetsByIndex[i];
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();

    rows.forEach((row) => {
      try {
        const status = row["Статус"]?.trim();
        const deadline = parseDate(row["Крайня дата"]);

        if (status !== "Отримано" && filterFn(row, deadline)) {
          message += `🔹 ${row["Товар"] || "-"} | ${row["Розмір"] || "-"} | ${row["Тканина"] || "-"} | ${row["Дані для відправки"] || "-"} | до ${row["Крайня дата"] || "-"} | ${row["Тип оплати"] || "-"}\n`;
          counter++;
        }
      } catch (err) {
        console.error(`Помилка при обробці рядка:`, row, err);
      }
    });
  }

  if (counter === 0) {
    return "✅ Немає замовлень за критерієм.";
  }

  return message;
}

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

bot.action("tomorrow", async (ctx) => {
  ctx.answerCbQuery();
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const msg = await getOrders(
      (row, deadline) => deadline instanceof Date && !isNaN(deadline) && isSameDate(deadline, tomorrow),
      "🚀 Замовлення на завтра:"
    );
    ctx.reply(msg);
  } catch (err) {
    console.error(err);
    ctx.reply("Сталася помилка при отриманні завтрашніх замовлень.");
  }
});

bot.action("overdue", async (ctx) => {
  ctx.answerCbQuery();
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const msg = await getOrders(
      (row, deadline) => {
        if (!(deadline instanceof Date) || isNaN(deadline)) return false;
        const d = new Date(deadline);
        d.setHours(0, 0, 0, 0);
        return isSameDate(d, today);
      },
      "⚠️ Прострочені замовлення:"
    );
    ctx.reply(msg);
  } catch (err) {
    console.error(err);
    ctx.reply("Сталася помилка при отриманні прострочених замовлень.");
  }
});

bot.launch({
  dropPendingUpdates: true
});
console.log("Bot launched!");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Bot is running!");
});

app.listen(PORT, () => {
  console.log(`Web server is listening on port ${PORT}`);
});
