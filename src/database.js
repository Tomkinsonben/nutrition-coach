const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || './nutrition.db';
// ':memory:' is a special SQLite keyword — don't resolve it to a file path
const resolvedPath = dbPath === ':memory:' ? ':memory:' : path.resolve(dbPath);
const db = new Database(resolvedPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
    activity_level TEXT DEFAULT 'moderate',
    onboarded INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS food_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    logged_at TEXT DEFAULT (datetime('now')),
    date TEXT NOT NULL,
    meal_type TEXT DEFAULT 'snack',
    description TEXT NOT NULL,
    calories INTEGER DEFAULT 0,
    protein_g REAL DEFAULT 0,
    carbs_g REAL DEFAULT 0,
    fat_g REAL DEFAULT 0,
    FOREIGN KEY (phone) REFERENCES users(phone)
  );

  CREATE TABLE IF NOT EXISTS weight_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    logged_at TEXT DEFAULT (datetime('now')),
    date TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    FOREIGN KEY (phone) REFERENCES users(phone)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (phone) REFERENCES users(phone)
  );
`);

function getUser(phone) {
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
}

function upsertUser(phone, data) {
  const existing = getUser(phone);
  if (!existing) {
    db.prepare(`
      INSERT INTO users (phone, name, goal, target_calories, target_protein, target_carbs, target_fat)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(phone, data.name || null, data.goal || 'maintain', data.target_calories || 2000,
        data.target_protein || 150, data.target_carbs || 200, data.target_fat || 65);
  } else {
    const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
    const values = Object.values(data);
    db.prepare(`UPDATE users SET ${fields} WHERE phone = ?`).run(...values, phone);
  }
  return getUser(phone);
}

function logFood(phone, entry) {
  return db.prepare(`
    INSERT INTO food_logs (phone, date, meal_type, description, calories, protein_g, carbs_g, fat_g)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(phone, entry.date, entry.meal_type || 'snack', entry.description,
      entry.calories || 0, entry.protein_g || 0, entry.carbs_g || 0, entry.fat_g || 0);
}

function logWeight(phone, date, weight_kg) {
  return db.prepare(`
    INSERT INTO weight_logs (phone, date, weight_kg) VALUES (?, ?, ?)
  `).run(phone, date, weight_kg);
}

function getDailyTotals(phone, date) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(calories), 0) as calories,
      COALESCE(SUM(protein_g), 0) as protein_g,
      COALESCE(SUM(carbs_g), 0) as carbs_g,
      COALESCE(SUM(fat_g), 0) as fat_g,
      COUNT(*) as entries
    FROM food_logs WHERE phone = ? AND date = ?
  `).get(phone, date);
}

function getDailyFoodLog(phone, date) {
  return db.prepare(`
    SELECT * FROM food_logs WHERE phone = ? AND date = ? ORDER BY logged_at ASC
  `).all(phone, date);
}

function getWeightHistory(phone, days = 30) {
  return db.prepare(`
    SELECT date, weight_kg FROM weight_logs
    WHERE phone = ?
    ORDER BY date DESC
    LIMIT ?
  `).all(phone, days);
}

function getWeeklyFoodSummary(phone, startDate, endDate) {
  return db.prepare(`
    SELECT
      date,
      SUM(calories) as calories,
      SUM(protein_g) as protein_g,
      SUM(carbs_g) as carbs_g,
      SUM(fat_g) as fat_g
    FROM food_logs
    WHERE phone = ? AND date BETWEEN ? AND ?
    GROUP BY date
    ORDER BY date ASC
  `).all(phone, startDate, endDate);
}

function getConversationHistory(phone, limit = 10) {
  const rows = db.prepare(`
    SELECT role, content FROM conversations
    WHERE phone = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(phone, limit);
  return rows.reverse();
}

function addMessage(phone, role, content) {
  db.prepare(`
    INSERT INTO conversations (phone, role, content) VALUES (?, ?, ?)
  `).run(phone, role, content);
  // Keep last 50 messages per user
  db.prepare(`
    DELETE FROM conversations WHERE phone = ? AND id NOT IN (
      SELECT id FROM conversations WHERE phone = ? ORDER BY created_at DESC LIMIT 50
    )
  `).run(phone, phone);
}

function getAllUsers() {
  return db.prepare('SELECT phone FROM users WHERE onboarded = 1').all();
}

module.exports = {
  getUser, upsertUser,
  logFood, logWeight,
  getDailyTotals, getDailyFoodLog,
  getWeightHistory, getWeeklyFoodSummary,
  getConversationHistory, addMessage,
  getAllUsers,
};
