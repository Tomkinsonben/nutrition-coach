const Anthropic = require('@anthropic-ai/sdk');
const db = require('./database');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are an expert AI nutrition coach delivered via WhatsApp. You are friendly, motivating, and evidence-based. Your role is to help users track their food intake, monitor their weight, and achieve their health goals.

You can:
- Analyze and log food entries, estimating calories and macronutrients
- Log body weight
- Answer nutrition and health questions
- Provide daily summaries and progress reports
- Offer motivating, personalized advice

When analyzing food, always provide your best estimate even if the description is vague. Return structured data when requested.

Keep responses concise and conversational — this is WhatsApp, not a medical report. Use emojis sparingly but warmly. Never give medical advice.`;

async function detectIntent(message, conversationHistory, user) {
  const userContext = user
    ? `User: ${user.name || 'Unknown'}, Goal: ${user.goal}, Daily targets: ${user.target_calories}kcal / ${user.target_protein}g protein / ${user.target_carbs}g carbs / ${user.target_fat}g fat`
    : 'New user, not yet onboarded';

  const messages = [
    ...conversationHistory,
    { role: 'user', content: message },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: `${SYSTEM_PROMPT}

Current user context: ${userContext}

IMPORTANT: Respond ONLY with a valid JSON object. No markdown, no explanation. Use this schema:
{
  "intent": "log_food" | "log_weight" | "ask_question" | "check_progress" | "onboarding" | "other",
  "confidence": 0.0-1.0,
  "extracted": {
    // For log_food: { "description": "...", "meal_type": "breakfast|lunch|dinner|snack" }
    // For log_weight: { "weight_kg": number }
    // For onboarding: { "name": "...", "goal": "lose|gain|maintain", "target_calories": number }
    // For others: {}
  },
  "response": "Your friendly WhatsApp reply to the user"
}`,
    messages,
  });

  const text = response.content[0].text.trim();
  try {
    return JSON.parse(text);
  } catch {
    // Fallback if JSON parsing fails
    return {
      intent: 'other',
      confidence: 0.5,
      extracted: {},
      response: text,
    };
  }
}

async function analyzeFoodEntry(description, mealType) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: 'You are a nutrition expert. Analyze food descriptions and return ONLY a valid JSON object with calorie and macronutrient estimates. Be realistic and use standard serving sizes when not specified.',
    messages: [{
      role: 'user',
      content: `Analyze this food entry and estimate nutrition values: "${description}" (meal type: ${mealType})

Respond ONLY with this JSON:
{
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "notes": "brief note about the estimate"
}`,
    }],
  });

  const text = response.content[0].text.trim();
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
      content: `Generate a friendly end-of-day summary for ${user.name || 'the user'}.

Their goal: ${user.goal}
Targets: ${user.target_calories}kcal / ${user.target_protein}g protein / ${user.target_carbs}g carbs / ${user.target_fat}g fat
Today's totals: ${totals.calories}kcal / ${totals.protein_g}g protein / ${totals.carbs_g}g carbs / ${totals.fat_g}g fat
${weightEntry ? `Today's weight: ${weightEntry.weight_kg}kg` : 'No weight logged today'}

Today's meals:
${foodList || 'No meals logged today'}

Keep it under 150 words. Be encouraging. Highlight what went well and one area to improve.`,
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
      content: `Generate a weekly progress report for ${user.name || 'the user'}.

Goal: ${user.goal}
Calorie target: ${user.target_calories}kcal/day
Average daily calories this week: ${avgCalories}kcal
Days logged: ${weeklySummary.length}/7
${weightTrend !== null ? `Weight change this week: ${weightTrend > 0 ? '+' : ''}${weightTrend}kg` : 'No weight data this week'}

Keep it under 200 words. Be motivating. Include a specific tip for next week.`,
    }],
  });

  return response.content[0].text;
}

async function generateMorningCheckin(user) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Write a brief, energetic good morning message for ${user.name || 'the user'} who wants to ${user.goal} weight. Their daily calorie target is ${user.target_calories}kcal. Include one small nutrition tip. Under 60 words.`,
    }],
  });

  return response.content[0].text;
}

async function answerQuestion(question, user, conversationHistory) {
  const userContext = user
    ? `User goal: ${user.goal}, Targets: ${user.target_calories}kcal / ${user.target_protein}g protein`
    : '';

  const messages = [
    ...conversationHistory,
    { role: 'user', content: question },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: `${SYSTEM_PROMPT}\n\n${userContext}`,
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
