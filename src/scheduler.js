const cron = require('node-cron');
const db = require('./database');
const ai = require('./ai');
const { sendMessage } = require('./whatsapp');

const TIMEZONE = process.env.TIMEZONE || 'Australia/Perth';

function getPerthDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

function getDateDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

async function sendMorningCheckins() {
  console.log('[Scheduler] Sending morning check-ins...');
  const users = db.getAllUsers();

  for (const { phone } of users) {
    const user = db.getUser(phone);
    if (!user) continue;

    try {
      const message = await ai.generateMorningCheckin(user);
      await sendMessage(phone, message);
    } catch (err) {
      console.error(`[Scheduler] Morning check-in failed for ${phone}:`, err.message);
    }
  }
}

async function sendEveningSummaries() {
  console.log('[Scheduler] Sending evening summaries...');
  const users = db.getAllUsers();
  const date = getPerthDate();

  for (const { phone } of users) {
    const user = db.getUser(phone);
    if (!user) continue;

    const totals = db.getDailyTotals(phone, date);
    if (totals.entries === 0) {
      // Gentle nudge if nothing logged
      try {
        await sendMessage(phone, `Hey ${user.name || 'there'}! Don't forget to log your meals today. How has your eating been? 🥗`);
      } catch (err) {
        console.error(`[Scheduler] Evening nudge failed for ${phone}:`, err.message);
      }
      continue;
    }

    const weightHistory = db.getWeightHistory(phone, 1);
    const weightEntry = weightHistory[0] && weightHistory[0].date === date ? weightHistory[0] : null;

    try {
      const summary = await ai.generateDailySummary(phone, date, totals, user, weightEntry);
      await sendMessage(phone, `📊 *Daily Summary*\n\n${summary}`);
    } catch (err) {
      console.error(`[Scheduler] Evening summary failed for ${phone}:`, err.message);
    }
  }
}

async function sendWeeklyReports() {
  console.log('[Scheduler] Sending weekly reports...');
  const users = db.getAllUsers();
  const endDate = getPerthDate();
  const startDate = getDateDaysAgo(6);

  for (const { phone } of users) {
    const user = db.getUser(phone);
    if (!user) continue;

    const weeklySummary = db.getWeeklyFoodSummary(phone, startDate, endDate);
    const weightHistory = db.getWeightHistory(phone, 7);

    try {
      const report = await ai.generateWeeklyReport(phone, user, weeklySummary, weightHistory);
      await sendMessage(phone, `📈 *Weekly Report*\n\n${report}`);
    } catch (err) {
      console.error(`[Scheduler] Weekly report failed for ${phone}:`, err.message);
    }
  }
}

function initScheduler() {
  // 8:00 AM Perth time — morning check-in (Mon–Sun)
  cron.schedule('0 8 * * *', sendMorningCheckins, { timezone: TIMEZONE });

  // 8:00 PM Perth time — evening summary (Mon–Sun)
  cron.schedule('0 20 * * *', sendEveningSummaries, { timezone: TIMEZONE });

  // 9:00 AM Perth time Sunday — weekly report
  cron.schedule('0 9 * * 0', sendWeeklyReports, { timezone: TIMEZONE });

  console.log(`[Scheduler] Cron jobs scheduled (timezone: ${TIMEZONE})`);
}

module.exports = { initScheduler };
