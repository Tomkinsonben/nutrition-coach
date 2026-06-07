# WhatsApp AI Nutrition Coach

A WhatsApp chatbot that tracks meals, logs weight, and delivers daily/weekly nutrition summaries — powered by Claude and Twilio.

## Features

- **Food logging** — Describe any meal in plain English; Claude estimates calories, protein, carbs, and fat
- **Weight tracking** — Log your weight with a simple message
- **Daily summaries** — Automated 8 PM Perth-time recap with progress vs. targets
- **Morning check-ins** — Motivating 8 AM nudge with a daily nutrition tip
- **Weekly reports** — Sunday 9 AM progress overview with trends
- **Conversational** — Answers general nutrition questions in context

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Fill in `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
PORT=3000
DATABASE_PATH=./nutrition.db
TIMEZONE=Australia/Perth
```

### 3. Run locally
```bash
npm run dev
```

### 4. Expose with ngrok (for Twilio webhook)
```bash
ngrok http 3000
```
Set Twilio WhatsApp sandbox webhook to: `https://<your-ngrok>.ngrok.io/webhook`

## Deploy to Railway

1. Push to GitHub
2. Create new Railway project from repo
3. Add environment variables in Railway dashboard
4. Railway auto-deploys; copy the public URL
5. Set Twilio webhook to `https://<railway-url>/webhook`

## Project Structure

```
src/
  index.js       # Express entry point, server setup
  database.js    # SQLite schema, all DB queries
  ai.js          # Claude API — intent detection, food analysis, summaries
  whatsapp.js    # Twilio webhook handler, message routing
  scheduler.js   # node-cron jobs (morning, evening, weekly)
```

## How It Works

1. User sends WhatsApp message → Twilio posts to `/webhook`
2. Claude detects intent (food log / weight / question / progress check)
3. For food: Claude estimates nutrition → stored in SQLite
4. User gets an instant reply with logged data + running daily total
5. Cron jobs fire daily/weekly to send proactive summaries

## Example Messages

| User says | Bot does |
|---|---|
| `had 2 eggs and toast for breakfast` | Logs food, returns calories + daily total |
| `weigh 78.5kg` | Logs weight, shows 7-day trend |
| `how am I doing today?` | Shows today's totals vs. targets |
| `is protein important for fat loss?` | Answers the nutrition question |
