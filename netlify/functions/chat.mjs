import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors() };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  try {
    const { messages, meta, lastResult } = JSON.parse(event.body || "{}");
    if (!Array.isArray(messages) || messages.length === 0) {
      return { statusCode: 400, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing messages" }) };
    }

    const system = `You are a coatings technical assistant for marine environments. Answer in English only. Be concise. 
Provide numbered procedures where useful. 
Use the context (area/environment/defect and cycles) to be practical. 
Do NOT invent specs; if uncertain, advise to check PPG TDS and standards (ISO 8501/12944).`;

    const contextText = JSON.stringify({ meta, lastResult });

    // Convert browser chat history to OpenAI messages
    const chat = [
      { role: "system", content: system },
      { role: "user", content: [{ type: "text", text: `Context (JSON): ${contextText}` }] },
      // then all turns
      ...messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: [{ type: "text", text: m.content }] })),
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: chat,
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() || "";
    return { statusCode: 200, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify({ answer }) };
  } catch (err) {
    return { statusCode: 500, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify({ error: err?.message || "Internal error" }) };
  }
};
