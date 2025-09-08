import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
}

// ✅ named export `handler` for Netlify
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors() };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const { question, meta, lastResult } = JSON.parse(event.body || "{}");
    if (!question) {
      return { statusCode: 400, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing question" }) };
    }

    const system = `You are a coatings technical assistant for marine environments. Answer in English only. Be concise, give numbered procedures where useful, and reference PPG generic product families mentioned in context without inventing specs. Mention ISO 8501/12944 at a high level if relevant.`;

    const contextText = JSON.stringify({ meta, lastResult });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: [
          { type: "text", text: `Context (JSON): ${contextText}` },
          { type: "text", text: `User question: ${question}` }
        ]}
      ]
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() || "";
    return { statusCode: 200, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify({ answer }) };
  } catch (err) {
    return { statusCode: 500, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify({ error: err?.message || "Internal error" }) };
  }
};
