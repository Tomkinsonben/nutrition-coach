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

async function handleOnboarding(phone, extracted, response) {
  const updates = {};
  if (extracted.name) updates.name = extracted.name;
  if (extracted.goal) updates.goal = extracted.goal;
  if (extracted.target_calories) updates.target_calories = extracted.target_calories;

  if (Object.keys(updates).length > 0) {
    db.upsertUser(phone, updates);
  }

  const user = db.getUser(phone);
  if (user && user.name && !user.onboarded) {
    db.upsertUser(phone, { onboarded: 1 });
  }

  return response;
}

async function handleFoodLog(phone, extracted, date, user) {
  const description = extracted.description;
  if (!description) return 'I didn\'t catch what you ate. Could you describe your meal again?';

  const mealType = normalizeMealType(extracted.meal_type);

  let nutrition;
  try {
    nutrition = await ai.analyzeFoodEntry(description, mealType);
  } catch (err) {
    console.error('[AI] Food analysis failed:', err.message);
    nutrition = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  }

  db.logFood(phone, {
    date,
    meal_type: mealType,
    description,
    ...nutrition,
  });

  const totals = db.getDailyTotals(phone, date);
  const remaining = user ? Math.max(0, user.target_calories - totals.calories) : null;

  let reply = `Logged ${mealType}: *${description}*\n`;
  reply += `~${nutrition.calories}kcal | P: ${nutrition.protein_g}g | C: ${nutrition.carbs_g}g | F: ${nutrition.fat_g}g\n\n`;
  reply += `Today so far: *${totals.calories}kcal*`;
  if (remaining !== null) {
    reply += ` (${remaining}kcal remaining)`;
  }

  return reply;
}

async function handleWeightLog(phone, extracted, date) {
  const weight = parseFloat(extracted.weight_kg);
  if (isNaN(weight) || weight < 20 || weight > 500) {
    return 'That weight doesn\'t look right. Please send your weight in kg (e.g., "75.5 kg").';
  }

  db.logWeight(phone, date, weight);
  db.upsertUser(phone, { weight_kg: weight });

  const history = db.getWeightHistory(phone, 7);
  if (history.length >= 2) {
    const oldest = history[history.length - 1].weight_kg;
    const diff = (weight - oldest).toFixed(1);
    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
    return `Weight logged: *${weight}kg* ${arrow}\n7-day change: ${diff > 0 ? '+' : ''}${diff}kg`;
  }

  return `Weight logged: *${weight}kg* ✓`;
}

async function handleCheckProgress(phone, date, user) {
  const totals = db.getDailyTotals(phone, date);
  const weightHistory = db.getWeightHistory(phone, 7);
  const latestWeight = weightHistory[0];

  if (totals.entries === 0) {
    return 'No food logged today yet. Start by telling me what you\'ve eaten!';
  }

  let reply = `*Today\'s Progress (${date})*\n\n`;
  reply += `Calories: ${totals.calories}`;
  if (user) reply += `/${user.target_calories}kcal`;
  reply += `\nProtein: ${Math.round(totals.protein_g)}g`;
  if (user) reply += `/${user.target_protein}g`;
  reply += `\nCarbs: ${Math.round(totals.carbs_g)}g`;
  if (user) reply += `/${user.target_carbs}g`;
  reply += `\nFat: ${Math.round(totals.fat_g)}g`;
  if (user) reply += `/${user.target_fat}g`;

  if (latestWeight) {
    reply += `\n\nLatest weight: ${latestWeight.weight_kg}kg (${latestWeight.date})`;
  }

  return reply;
}

async function handleIncomingMessage(req, res) {
  // Respond immediately to Twilio
  res.status(200).send('<Response></Response>');

  const phone = req.body.From;
  const messageBody = (req.body.Body || '').trim();

  if (!phone || !messageBody) return;

  console.log(`[WhatsApp] ${phone}: ${messageBody}`);

  let user = db.getUser(phone);
  if (!user) {
    db.upsertUser(phone, {});
    user = db.getUser(phone);
  }

  const date = getPerthDate();
  const history = db.getConversationHistory(phone, 8);
  db.addMessage(phone, 'user', messageBody);

  let reply;
  try {
    const result = await ai.detectIntent(messageBody, history, user);
    const { intent, extracted, response } = result;

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

      case 'onboarding':
        reply = await handleOnboarding(phone, extracted, response);
        break;

      case 'ask_question':
        reply = await ai.answerQuestion(messageBody, user, history);
        break;

      default:
        if (!user.onboarded) {
          reply = `Hi! I'm your AI nutrition coach. 👋\n\nI can help you track meals, log your weight, and reach your health goals.\n\nWhat's your name, and what's your goal? (lose weight / gain muscle / maintain)`;
        } else {
          reply = response || 'I\'m here to help! You can log food ("had oats for breakfast"), log your weight ("weigh 75kg"), or check your progress ("how am I doing today?").';
        }
    }
  } catch (err) {
    console.error('[Handler] Error processing message:', err);
    reply = 'Sorry, something went wrong. Please try again in a moment.';
  }

  db.addMessage(phone, 'assistant', reply);
  await sendMessage(phone, reply);
}

module.exports = { handleIncomingMessage, sendMessage };
