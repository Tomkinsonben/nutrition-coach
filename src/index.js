require('dotenv').config();
const express = require('express');
const { handleIncomingMessage } = require('./whatsapp');
const { initScheduler } = require('./scheduler');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

async function seedProfile() {
  const phone = 'whatsapp:+61490037541';
  const existing = await db.getUser(phone);
  if (!existing || !existing.onboarded) {
    await db.upsertUser(phone, {
      name: 'Ben',
      goal: 'lose',
      target_calories: 2200,
      target_protein: 192,
      target_carbs: 220,
      target_fat: 73,
      weight_kg: 181,
      height_cm: 196,
      age: 37,
      onboarded: 1
    });
    console.log('[Setup] Ben profile seeded');
  } else {
    console.log('[Setup] Ben profile already exists');
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/webhook', handleIncomingMessage);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('[Express] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await db.init();
  await seedProfile();
  app.listen(PORT, () => {
    console.log(`[Server] Nutrition coach running on port ${PORT}`);
    initScheduler();
  });
}

start().catch(console.error);
