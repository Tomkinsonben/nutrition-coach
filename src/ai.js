const Anthropic = require('@anthropic-ai/sdk');
const db = require('./database');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are a supportive nutrition coach for Ben. Age 37, 175kg, 196cm, goal weight 120kg. Daily targets: 2200 kcal, 192g protein. Be direct and practical, not patronising. Suggest real whole foods available at Coles/Woolworths in Perth, Australia. When estimating macros be specific with numbers. Keep responses concise and friendly — this is WhatsApp not a medical report.`;

async function detectIntent(message, conversationHistory, user) {
  const userContext = user
    ? `User: ${user.name || 'Ben'}, Goal: lose weight, Daily targets: ${user.target_calories || 2200}kcal / ${user.target_protein || 192}g protein`
    : 'User: Ben, Goal: lose weight, Daily targets: 2200kcal / 192g protein';

  const messages = [
    ...conversationHistory,
    { role: 'user', content: message },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: `${SYSTEM_PROMPT}

Current user context: ${userContext}

IMPORTANT: Respond ONLY with a valid JSON object. No markdown, no explanation, no code blocks. Raw JSON only. Use this schema:
{
  "intent": "log_food" | "log_weight" | "ask_question" | "check_progress" | "other",
  "confidence": 0.0-1.0,
  "extracted": {
    "description": "food description if log_food",
    "meal_type": "breakfast|lunch|dinner|snack if log_food",
    "weight_kg": 0
  },
  "response": "Your friendly conversational WhatsApp reply to Ben — plain text only, no JSON"
}`,
    messages,
  });

  const text = response.content[0].text.trim()
    .replace(/^```json\n?/, '')
    .replace(/^```\n?/, '')
    .replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(text);
    if (parsed.response && parsed.response.includes('"intent"')) {
      parsed.response = "Got it! I'm tracking that for you.";
    }
    return parsed;
  } catch {
    return {
      intent: 'other',
      confidence: 0.5,
      extracted: {},
      response: text.includes('{') ? "Got it! How can I help?" : text,
    };
  }
}

async function analyzeFoodEntry(description, mealType) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: 'You are a nutrition expert. Analyze food descriptions and return ONLY a valid JSON object with calorie and macronutrient estimates. No markdown, no code blocks. Raw JSON only.',
    messages: [{
      role: 'user',
      content: `Analyze this food entry: "${description}" (meal type: ${mealType})

Respond ONLY with this JSON:
{
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "notes": "brief note"
}`,
    }],
  });

  const text = response.content[0].text.trim()
    .replace(/^```json\n?/, '')
    .replace(/^```\n?/, '')
    .replace(/\n?```$/, '');

  try {
    return JSON.parse(text);
  } catch {
    return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, notes: 'Could not parse nutrition data' };
  }
}

async function generateDailySummary(phone, date, totals, user, weightEntry) {
  const foodLog = db.getDailyFoodLog(phone, date);
  const foodList = foodLog.map(f => `- ${f.meal_type}: ${f.description} (${f.calories}kcal)`).join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Generate a friendly end-of-day WhatsApp summary for Ben.

Targets: 2200kcal / 192g protein
Today's totals: ${totals.calories}kcal / ${totals.protein_g}g protein / ${totals.carbs_g}g carbs / ${totals.fat_g}g fat
${weightEntry ? `Today's weight: ${weightEntry.weight_kg}kg` : 'No weight logged today'}

Today's meals:
${foodList || 'No meals logged today'}

Keep it under 150 words. Be encouraging. Plain text only, no JSON.`,
    }],
  });

  return response.content[0].text;
}

async function generateWeeklyReport(phone, user, weeklySummary, weightHistory) {
  const avgCalories = weeklySummary.length > 0
    ? Math.round(weeklySummary.reduce((s, d) => s + d.calories, 0) / weeklySummary.length)
    : 0;

  const weightTrend = weightHistory.length >= 2
    ? (weightHistory[0].weight_kg - weightHistory[weightHistory.length - 1].weight_kg).toFixed(1)
    : null;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Generate a weekly progress report for Ben.

Goal: lose weight
Calorie target: 2200kcal/day
Average daily calories this week: ${avgCalories}kcal
Days logged: ${weeklySummary.length}/7
${weightTrend !== null ? `Weight change this week: ${weightTrend > 0 ? '+' : ''}${weightTrend}kg` : 'No weight data this week'}

Keep it under 200 words. Be motivating. Plain text only, no JSON.`,
    }],
  });

  return response.content[0].text;
}

async function generateMorningCheckin(user) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Write a brief energetic good morning message for Ben who wants to lose weight and reach 120kg. His daily calorie target is 2200kcal. Suggest a high protein breakfast option available at Coles/Woolworths Perth. Under 80 words. Plain text only.`,
    }],
  });

  return response.content[0].text;
}

async function answerQuestion(question, user, conversationHistory) {
  const messages = [
    ...conversationHistory,
    { role: 'user', content: question },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages,
  });

  return response.content[0].text;
}

module.exports = {
  detectIntent,
  analyzeFoodEntry,
  generateDailySummary,
  generateWeeklyReport,
  generateMorningCheckin,
  answerQuestion,
};
