const twilio = require('twilio');
const db = require('./database');
const ai = require('./ai');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

function getPerthDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Perth' });
}

function normalizeMealType(raw) {
  const lower = (raw || '').toLowerCase();
  if (lower.includes('breakfast')) return 'breakfast';
  if (lower.includes('lunch')) return 'lunch';
  if (lower.includes('dinner') || lower.includes('tea')) return 'dinner';
  return 'snack';
}

async function sendMessage(to, body) {
  try {
    await client.messages.create({ from: FROM_NUMBER, to, body });
  } catch (err) {
    console.error(`[Twilio] Failed to send to ${to}:`, err.message);
  }
}

async function handleFoodLog(phone, extracted, date, user) {
  const description = extracted.description;
  if (!description) return "I didn't catch what you ate. Could you describe your meal again?";

  const mealType = normalizeMealType(extracted.meal_type);

  let nutrition;
  try {
    nutrition = await ai.analyzeFoodEntry(description, mealType);
  } catch (err) {
    console.error('[AI] Food analysis failed:', err.message);
    nutrition = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  }

  await db.logFood(phone, { date, meal_type: mealType, description, ...nutrition });

  const totals = await db.getDailyTotals(phone, date);
  const targetCal = user ? user.target_calories : 2200;
  const targetProtein = user ? user.target_protein : 192;
  const remaining = Math.max(0, targetCal - totals.calories);
  const proteinRemaining = Math.max(0, targetProtein - Math.round(totals.protein_g));

  let reply = `✅ Logged ${mealType}: *${description}*\n`;
  reply += `~${nutrition.calories}kcal | 💪 ${nutrition.protein_g}g protein | ${nutrition.carbs_g}g carbs | ${nutrition.fat_g}g fat\n\n`;
  reply += `📊 *Today so far:*\n`;
  reply += `🔥 ${totals.calories} of ${targetCal}kcal (${remaining}kcal left)\n`;
  reply += `💪 ${Math.round(totals.protein_g)}g of ${targetProtein}g protein (${proteinRemaining}g to go)\n\n`;

  if (remaining < 300) {
    reply += `Almost at your calorie limit for today — keep it light tonight! 🥗`;
  } else if (proteinRemaining > 100) {
    reply += `Protein is looking low — try to get a high protein lunch and dinner to hit your 192g target 💪`;
  } else {
    reply += `Good work logging that! Keep it up 👍`;
  }

  return reply;
}

async function handleWeightLog(phone, extracted, date) {
  const weight = parseFloat(extracted.weight_kg);
  if (isNaN(weight) || weight < 20 || weight > 500) {
    return "That weight doesn't look right. Please send your weight in kg (e.g. '95.5 kg').";
  }

  await db.logWeight(phone, date, weight);
  await db.upsertUser(phone, { weight_kg: weight });

  const startWeight = 181;
  const goalWeight = 120;
  const lost = (startWeight - weight).toFixed(1);
  const toGo = (weight - goalWeight).toFixed(1);

  let reply = `⚖️ Weight logged: *${weight}kg*\n\n`;
  reply += `📉 Lost so far: ${lost}kg\n`;
  reply += `🎯 Still to go: ${toGo}kg\n\n`;
  reply += lost > 0 ? `Keep going Ben, you're making progress! 💪` : `Stay consistent, results take time. You've got this!`;

  return reply;
}

async function handleCheckProgress(phone, date, user) {
  const totals = await db.getDailyTotals(phone, date);
  const targetCal = user ? user.target_calories : 2200;
  const targetProtein = user ? user.target_protein : 192;

  if (totals.entries == 0) {
    return "No food logged today yet. Start by telling me what you've eaten!";
  }

  const remaining = Math.max(0, targetCal - totals.calories);
  const proteinRemaining = Math.max(0, targetProtein - Math.round(totals.protein_g));

  let reply = `📊 *Today's Progress*\n\n`;
  reply += `🔥 Calories: ${totals.calories}/${targetCal}kcal (${remaining} left)\n`;
  reply += `💪 Protein: ${Math.round(totals.protein_g)}/${targetProtein}g (${proteinRemaining}g to go)\n`;
  reply += `🍞 Carbs: ${Math.round(totals.carbs_g)}g\n`;
  reply += `🥑 Fat: ${Math.round(totals.fat_g)}g\n\n`;

  const pct = Math.round((totals.calories / targetCal) * 100);
  if (pct < 50) reply += `You've used ${pct}% of your calories — make sure you're eating enough! 🍽️`;
  else if (pct <= 90) reply += `On track! ${pct}% of daily calories used 👍`;
  else reply += `Almost at your limit — keep the rest of the day light 🥗`;

  return reply;
}

async function handleIncomingMessage(req, res) {
  res.status(200).send('<Response></Response>');

  const phone = req.body.From;
  const messageBody = (req.body.Body || '').trim();

  if (!phone || !messageBody) return;

  console.log(`[WhatsApp] ${phone}: ${messageBody}`);

  let user = await db.getUser(phone);
  if (!user) {
    await db.upsertUser(phone, {});
    user = await db.getUser(phone);
  }

  const date = getPerthDate();
  const history = await db.getConversationHistory(phone, 8);
  await db.addMessage(phone, 'user', messageBody);

  let reply;
  try {
    const result = await ai.detectIntent(messageBody, history, user);
    const { intent, extracted, response } = result;

    console.log(`[Intent] ${intent}`, JSON.stringify(extracted));

    switch (intent) {
      case 'log_food':
        reply = await handleFoodLog(phone, extracted, date, user);
        break;
      case 'log_weight':
        reply = await handleWeightLog(phone, extracted, date);
        break;
      case 'check_progress':
        reply = await handleCheckProgress(phone, date, user);
        break;
      case 'ask_question':
        reply = await ai.answerQuestion(messageBody, user, history);
        break;
      default:
        reply = response || "I'm here to help! Log food (e.g. 'had chicken and rice for lunch'), log your weight (e.g. 'weighed 180kg'), or check progress ('how am I tracking today?').";
    }
  } catch (err) {
    console.error('[Handler] Error processing message:', err);
    reply = 'Sorry, something went wrong. Please try again in a moment.';
  }

  await db.addMessage(phone, 'assistant', reply);
  await sendMessage(phone, reply);
}

module.exports = { handleIncomingMessage, sendMessage };
