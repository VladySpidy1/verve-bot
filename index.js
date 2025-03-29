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

function sendLongMessage(ctx, text) {
  const chunkSize = 4000;
  const chunks = text.match(new RegExp(`.{1,${chunkSize}}`, "gs"));
  return Promise.all(chunks.map(chunk => ctx.reply(chunk)));
}

function isRowEmpty(row) {
  const keysToCheck = ["Товар", "Дані для відправки"];
  return keysToCheck.every(key => !row[key] || row[key].toString().trim() === "");
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

        if (!isRowEmpty(row) && status !== "Отримано" && filterFn(row, deadline)) {
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

async function sendMenu(ctx) {
  await ctx.reply("👋 Вітаю! Обери дію:", Markup.inlineKeyboard([
    [
      Markup.button.callback("📄 Всі замовлення", "all")
    ],
    [
      Markup.button.callback("🚀 Завтра відправка", "tomorrow")
    ],
    [
      Markup.button.callback("⚠️ Прострочені", "overdue")
    ],
    [
      Markup.button.callback("➕ Нове замовлення", "new_order")
    ]
  ]));
}

let userOrderData = {};

bot.start(async (ctx) => {
  try {
    await sendMenu(ctx);
  } catch (err) {
    console.error(err);
  }
});

bot.hears("/start", async (ctx) => {
  try {
    await sendMenu(ctx);
  } catch (err) {
    console.error(err);
  }
});

bot.on("message", async (ctx) => {
  try {
    await sendMenu(ctx);
  } catch (err) {
    console.error(err);
  }
});

bot.action("all", async (ctx) => {
  ctx.answerCbQuery();
  try {
    const msg = await getOrders(() => true, "📄 Список всіх активних замовлень:");
    await sendLongMessage(ctx, msg);
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
    await sendLongMessage(ctx, msg);
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
    await sendLongMessage(ctx, msg);
  } catch (err) {
    console.error(err);
    ctx.reply("Сталася помилка при отриманні прострочених замовлень.");
  }
});

bot.action("new_order", async (ctx) => {
  ctx.answerCbQuery();
  userOrderData[ctx.from.id] = {};
  await ctx.reply("✏️ Введіть назву товару:");
  bot.on("text", async (ctx2) => {
    const data = userOrderData[ctx2.from.id];
    if (!data) return;

    if (!data.product) {
      data.product = ctx2.message.text;
      await ctx2.reply("📏 Введіть розмір:");
      return;
    }

    if (!data.size) {
      data.size = ctx2.message.text;
      await ctx2.reply("🧵 Введіть тканину:");
      return;
    }

    if (!data.material) {
      data.material = ctx2.message.text;
      await ctx2.reply("💳 Введіть тип оплати:");
      return;
    }

    if (!data.payment) {
      data.payment = ctx2.message.text;
      await ctx2.reply("📦 Введіть дані для відправки:");
      return;
    }

    if (!data.delivery) {
      data.delivery = ctx2.message.text;
      await ctx2.reply("🔗 Введіть посилання:");
      return;
    }

    if (!data.link) {
      data.link = ctx2.message.text;
      await ctx2.reply("💰 Введіть суму:");
      return;
    }

    if (!data.amount) {
      data.amount = ctx2.message.text;

      const summary = `✅ Перевірте замовлення:\n\nТовар: ${data.product}\nРозмір: ${data.size}\nТканина: ${data.material}\nТип оплати: ${data.payment}\nДані для відправки: ${data.delivery}\nПосилання: ${data.link}\nСума: ${data.amount}`;

      await ctx2.reply(summary, Markup.inlineKeyboard([
        [Markup.button.callback("✅ Підтвердити", "confirm_order"), Markup.button.callback("❌ Скасувати", "cancel_order")]
      ]));
    }
  });
});

bot.action("confirm_order", async (ctx) => {
  ctx.answerCbQuery();
  const data = userOrderData[ctx.from.id];
  if (!data) return ctx.reply("Дані замовлення не знайдено.");

  try {
    await accessSheet();
    const monthName = new Date().toLocaleString("uk-UA", { month: "long" });
    const sheet = doc.sheetsByTitle[monthName.charAt(0).toUpperCase() + month
