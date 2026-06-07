require('dotenv').config();
const express = require('express');
const { handleIncomingMessage } = require('./whatsapp');
const { initScheduler } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/setup', (req, res) => {
  const db = require('./database');
  db.db.prepare(`
    INSERT OR REPLACE INTO users (phone, name, goal, target_calories, target_protein, target_carbs, target_fat, onboarded)
    VALUES ('whatsapp:+61490037541', 'Ben', 'lose', 2200, 192, 220, 73, 1)
  `).run();
  res.json({ status: 'Profile created for Ben' });
});

app.post('/webhook', handleIncomingMessage);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('[Express] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[Server] Nutrition coach running on port ${PORT}`);
  initScheduler();
});
