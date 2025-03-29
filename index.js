
const { Telegraf, Markup } = require("telegraf");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const fs = require("fs");
require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID);

async function accessSheet() {
  const creds = JSON.parse(process.env.KEY_JSON);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
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

bot.start((ctx) => {
  ctx.reply("Вибери дію:", Markup.inlineKeyboard([
    [Markup.button.callback("📄 Всі замовлення", "all")],
    [Markup.button.callback("🚀 Завтра відправка", "tomorrow")],
    [Markup.button.callback("⚠️ Прострочені", "overdue")],
  ]));
});

bot.action("all", async (ctx) => {
  ctx.answerCbQuery();
  const msg = await getOrders(() => true, "📄 Список всіх активних замовлень:");
  ctx.reply(msg);
});

bot.action("tomorrow", async (ctx) => {
  ctx.answerCbQuery();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const msg = await getOrders(
    (row) => row["Крайня дата"] && isSameDate(new Date(row["Крайня дата"]), tomorrow),
    "🚀 Замовлення на завтра:"
  );
  ctx.reply(msg);
});

bot.action("overdue", async (ctx) => {
  ctx.answerCbQuery();
  const today = new Date();
  const msg = await getOrders(
    (row) => row["Крайня дата"] && new Date(row["Крайня дата"]) < today,
    "⚠️ Прострочені замовлення:"
  );
  ctx.reply(msg);
});

function isSameDate(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
