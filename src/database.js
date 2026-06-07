const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      phone TEXT PRIMARY KEY,
      name TEXT,
      goal TEXT DEFAULT 'maintain',
      target_calories INTEGER DEFAULT 2000,
      target_protein INTEGER DEFAULT 150,
      target_carbs INTEGER DEFAULT 200,
      target_fat INTEGER DEFAULT 65,
      height_cm REAL,
      weight_kg REAL,
      age INTEGER,
      onboarded INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS food_logs (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      logged_at TIMESTAMPTZ DEFAULT NOW(),
      date TEXT NOT NULL,
      meal_type TEXT DEFAULT 'snack',
      description TEXT NOT NULL,
      calories INTEGER DEFAULT 0,
      protein_g REAL DEFAULT 0,
      carbs_g REAL DEFAULT 0,
      fat_g REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS weight_logs (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      logged_at TIMESTAMPTZ DEFAULT NOW(),
      date TEXT NOT NULL,
      weight_kg REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[DB] Tables ready');
}

async function getUser(phone) {
  const res = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
  return res.rows[0] || null;
}

async function upsertUser(phone, data) {
  const existing = await getUser(phone);
  if (!existing) {
    await pool.query(`
      INSERT INTO users (phone, name, goal, target_calories, target_protein, target_carbs, target_fat, height_cm, weight_kg, age, onboarded)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      phone,
      data.name || null,
      data.goal || 'maintain',
      data.target_calories || 2000,
      data.target_protein || 150,
      data.target_carbs || 200,
      data.target_fat || 65,
      data.height_cm || null,
      data.weight_kg || null,
      data.age || null,
      data.onboarded || 0
    ]);
  } else {
    const fields = Object.keys(data).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = Object.values(data);
    await pool.query(`UPDATE users SET ${fields} WHERE phone = $1`, [phone, ...values]);
  }
  return getUser(phone);
}

async function logFood(phone, entry) {
  return pool.query(`
    INSERT INTO food_logs (phone, date, meal_type, description, calories, protein_g, carbs_g, fat_g)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [phone, entry.date, entry.meal_type || 'snack', entry.description,
      entry.calories || 0, entry.protein_g || 0, entry.carbs_g || 0, entry.fat_g || 0]);
}

async function logWeight(phone, date, weight_kg) {
  return pool.query(`
    INSERT INTO weight_logs (phone, date, weight_kg) VALUES ($1, $2, $3)
  `, [phone, date, weight_kg]);
}

async function getDailyTotals(phone, date) {
  const res = await pool.query(`
    SELECT
      COALESCE(SUM(calories), 0) as calories,
      COALESCE(SUM(protein_g), 0) as protein_g,
      COALESCE(SUM(carbs_g), 0) as carbs_g,
      COALESCE(SUM(fat_g), 0) as fat_g,
      COUNT(*) as entries
    FROM food_logs WHERE phone = $1 AND date = $2
  `, [phone, date]);
  return res.rows[0];
}

async function getDailyFoodLog(phone, date) {
  const res = await pool.query(`
    SELECT * FROM food_logs WHERE phone = $1 AND date = $2 ORDER BY logged_at ASC
  `, [phone, date]);
  return res.rows;
}

async function getWeightHistory(phone, days = 30) {
  const res = await pool.query(`
    SELECT date, weight_kg FROM weight_logs
    WHERE phone = $1
    ORDER BY date DESC
    LIMIT $2
  `, [phone, days]);
  return res.rows;
}

async function getWeeklyFoodSummary(phone, startDate, endDate) {
  const res = await pool.query(`
    SELECT
      date,
      SUM(calories) as calories,
      SUM(protein_g) as protein_g,
      SUM(carbs_g) as carbs_g,
      SUM(fat_g) as fat_g
    FROM food_logs
    WHERE phone = $1 AND date BETWEEN $2 AND $3
    GROUP BY date
    ORDER BY date ASC
  `, [phone, startDate, endDate]);
  return res.rows;
}

async function getConversationHistory(phone, limit = 10) {
  const res = await pool.query(`
    SELECT role, content FROM conversations
    WHERE phone = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [phone, limit]);
  return res.rows.reverse();
}

async function addMessage(phone, role, content) {
  await pool.query(`
    INSERT INTO conversations (phone, role, content) VALUES ($1, $2, $3)
  `, [phone, role, content]);
  await pool.query(`
    DELETE FROM conversations WHERE phone = $1 AND id NOT IN (
      SELECT id FROM conversations WHERE phone = $1 ORDER BY created_at DESC LIMIT 50
    )
  `, [phone]);
}

async function getAllUsers() {
  const res = await pool.query('SELECT phone FROM users WHERE onboarded = 1');
  return res.rows;
}

module.exports = {
  init,
  getUser, upsertUser,
  logFood, logWeight,
  getDailyTotals, getDailyFoodLog,
  getWeightHistory, getWeeklyFoodSummary,
  getConversationHistory, addMessage,
  getAllUsers,
};
