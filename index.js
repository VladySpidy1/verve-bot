// Підключаємо залежності та конфігурацію
require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const express = require("express");

const BOT_TOKEN = process.env.BOT_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const KEY_JSON = process.env.KEY_JSON;
const DOMAIN = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
const app = express();

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

function isRowEmpty(row) {
  const keysToCheck = ["Товар", "Дані для відправки"];
  return keysToCheck.every(key => !row[key] || row[key].toString().trim() === "");
}

function formatOrder(row) {
  return `🛒 Замовлення:

Товар: ${row["Товар"] || "-"}
Розмір: ${row["Розмір"] || "-"}
Тканина: ${row["Тканина"] || "-"}
Тип оплати: ${row["Тип оплати"] || "-"}
Дані для відправки: ${row["Дані для відправки"] || "-"}
Посилання: ${row["Посилання"] || "-"}
Сума: ${row["Сума"] || "-"}
Крайня дата: ${row["Крайня дата"] || "-"}
Залишилось днів: ${row["Залишилось днів"] || "-"}
Статус: ${row["Статус"] || "-"}`;
}

async function getOrders(filterFn, title) {
  await accessSheet();
  let message = `${title}`;
  let counter = 0;

  for (let i = 0; i < doc.sheetCount; i++) {
    const sheet = doc.sheetsByIndex[i];
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();

    for (const row of rows) {
      try {
        const status = row["Статус"]?.trim();
        const deadline = parseDate(row["Крайня дата"]);

        if (!isRowEmpty(row) && status !== "Отримано" && filterFn(row, deadline)) {
          message += `\n\n${formatOrder(row)}`;
          counter++;
        }
      } catch (err) {
        console.error(`Помилка при обробці рядка:`, row, err);
      }
    }
  }

  if (counter === 0) {
    return "✅ Немає замовлень за критерієм.";
  }

  return message;
}

async function sendMenu(ctx) {
  await ctx.reply("👋 Вітаю! Обери дію:", Markup.inlineKeyboard([
    [Markup.button.callback("📄 Всі замовлення", "all")],
    [Markup.button.callback("🚀 Завтра відправка", "tomorrow")],
    [Markup.button.callback("⚠️ Прострочені", "overdue")],
    [Markup.button.callback("➕ Нове замовлення", "new_order")],
    [Markup.button.callback("✏️ Редагувати замовлення", "edit_order")]
  ]));
}

let userOrderData = {};
let editOrderState = {};

bot.on("text", async (ctx) => {
  const data = userOrderData[ctx.from.id];
  const editState = editOrderState[ctx.from.id];

  if (data && !data.completed) {
    if (data.step === 1) {
      data.product = ctx.message.text;
      data.step++;
      await ctx.reply("📏 Введіть розмір:");
    } else if (data.step === 2) {
      data.size = ctx.message.text;
      data.step++;
      await ctx.reply("🧵 Введіть тканину:");
    } else if (data.step === 3) {
      data.material = ctx.message.text;
      data.step++;
      await ctx.reply("💳 Введіть тип оплати:");
    } else if (data.step === 4) {
      data.payment = ctx.message.text;
      data.step++;
      await ctx.reply("📦 Введіть дані для відправки:");
    } else if (data.step === 5) {
      data.delivery = ctx.message.text;
      data.step++;
      await ctx.reply("🔗 Введіть посилання:");
    } else if (data.step === 6) {
      data.link = ctx.message.text;
      data.step++;
      await ctx.reply("💰 Введіть суму:");
    } else if (data.step === 7) {
      data.amount = ctx.message.text;
      data.completed = true;

      const summary = `✅ Перевірте замовлення:\n\nТовар: ${data.product}\nРозмір: ${data.size}\nТканина: ${data.material}\nТип оплати: ${data.payment}\nДані для відправки: ${data.delivery}\nПосилання: ${data.link}\nСума: ${data.amount}`;

      await ctx.reply(summary, Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Підтвердити", "confirm_order"),
          Markup.button.callback("❌ Скасувати", "cancel_order")
        ],
        [
          Markup.button.callback("🏠 Головна", "main_menu")
        ]
      ]));
    }
  } else if (editState && editState.step === 1) {
    editState.query = ctx.message.text;
    editState.step++;
    await ctx.reply("✏️ Введіть новий статус замовлення:");
  } else if (editState && editState.step === 2) {
    editState.status = ctx.message.text;
    editState.step++;
    await ctx.reply("🚚 Введіть номер ТТН:");
  } else if (editState && editState.step === 3) {
    editState.ttn = ctx.message.text;

    try {
      await accessSheet();
      let updated = false;

      for (let i = 0; i < doc.sheetCount; i++) {
        const sheet = doc.sheetsByIndex[i];
        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();

        for (const row of rows) {
          if (row["Дані для відправки"] && row["Дані для відправки"].includes(editState.query)) {
            row["Статус"] = editState.status;
            row["ТТН"] = editState.ttn;
            await row.save();
            updated = true;
          }
        }
      }

      delete editOrderState[ctx.from.id];
      if (updated) {
        await ctx.reply("✅ Замовлення успішно оновлено!");
      } else {
        await ctx.reply("❌ Замовлення не знайдено.");
      }
    } catch (err) {
      console.error(err);
      await ctx.reply("❌ Помилка при оновленні замовлення.");
    }
  } else {
    await sendMenu(ctx);
  }
});

bot.action("edit_order", async (ctx) => {
  ctx.answerCbQuery();
  editOrderState[ctx.from.id] = { step: 1 };
  await ctx.reply("🔍 Введіть номер телефону або текст для пошуку замовлення:");
});

bot.action("all", async (ctx) => {
  ctx.answerCbQuery();
  try {
    const msg = await getOrders(() => true, "📄 Список всіх активних замовлень:");
    await ctx.reply(msg);
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
    await ctx.reply(msg);
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
    await ctx.reply(msg);
  } catch (err) {
    console.error(err);
    ctx.reply("Сталася помилка при отриманні прострочених замовлень.");
  }
});

bot.action("new_order", async (ctx) => {
  ctx.answerCbQuery();
  userOrderData[ctx.from.id] = { step: 1, completed: false };
  await ctx.reply("✏️ Введіть назву товару:");
});

bot.action("confirm_order", async (ctx) => {
  ctx.answerCbQuery();
  const data = userOrderData[ctx.from.id];
  if (!data) return ctx.reply("Дані замовлення не знайдено.");

  try {
    await accessSheet();
    const monthName = new Date().toLocaleString("uk-UA", { month: "long" });
    const sheetTitle = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    const sheet = doc.sheetsByTitle[sheetTitle];
    if (!sheet) return ctx.reply(`Не знайдено листа "${sheetTitle}".`);

    const today = new Date();
    const deadline = new Date(today);
    deadline.setDate(today.getDate() + 5);
    const diffDays = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));

    await sheet.addRow({
      "Товар": data.product,
      "Розмір": data.size,
      "Тканина": data.material,
      "Тип оплати": data.payment,
      "Дані для відправки": data.delivery,
      "Посилання": data.link,
      "Сума": data.amount,
      "Дата оформлення": today.toLocaleDateString("uk-UA"),
      "Крайня дата": deadline.toLocaleDateString("uk-UA"),
      "Залишилось днів": diffDays,
      "Статус": "Нове замовлення"
    });

    delete userOrderData[ctx.from.id];
    await ctx.reply("✅ Замовлення успішно додано!");
  } catch (err) {
    console.error(err);
    ctx.reply("❌ Помилка при збереженні замовлення.");
  }
});

bot.action("cancel_order", async (ctx) => {
  ctx.answerCbQuery();
  delete userOrderData[ctx.from.id];
  await ctx.reply("❌ Створення замовлення скасовано.");
});

bot.action("main_menu", async (ctx) => {
  ctx.answerCbQuery();
  await sendMenu(ctx);
});

// === ТІЛЬКИ Webhook (без polling) ===
bot.telegram.setWebhook(`${DOMAIN}/bot${BOT_TOKEN}`);
app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));

app.get("/", (req, res) => res.send("🤖 VERVE бот працює через Webhook!"));

app.listen(PORT, () => {
  console.log(`✅ Webhook активовано на порту ${PORT}`);
});

// === graceful stop ===
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
