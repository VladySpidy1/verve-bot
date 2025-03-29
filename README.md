
# Verve Reminder Bot

## 🚀 Як розгорнути

1. Поклади свій Google Cloud Service Account ключ у папку `credentials/` під ім'ям `credentials.json`.

2. Створи `.env` файл та заповни:
```
BOT_TOKEN=токен_твого_бота
SPREADSHEET_ID=ID_твоєї_таблиці
```

3. Завантаж проєкт на Railway:
- Створи новий проект → Deploy from GitHub → або завантаж ZIP.
- В налаштуваннях → Variables → додай змінні з `.env`.

4. Натисни **Deploy**

Бот буде працювати 24/7.
