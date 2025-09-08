import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a coatings inspector assistant. Always think and respond in English. Return ONLY valid JSON.
For each image, infer: defect { type: one of [general_corrosion, pitting, blistering, delamination, mechanical_damage, fouling],
severity: [minor, moderate, severe], confidence: 0..1, notes: short explanation }.
If unsure, type=general_corrosion, severity=moderate.`;

// Demo product library; replace with your internal DB mapping.
const LIB = {
  cycles: {
    general_corrosion: ({ env }) => ({
      surfacePrep: "Local St 3, removal of salts/contaminants, restore profiles",
      products: [
        { name: "Sigmacover 350", dft: "125 µm (1x)", notes: "anticorrosive intermediate" },
        { name: "Sigmadur 550", dft: "50 µm (1x)", notes: "polyurethane finish" },
      ],
    }),
    pitting: ({ env }) => ({
      surfacePrep: "St 3, stripe coat on edges/welds, fill cavities",
      products: [
        { name: "Sigmacover 456", dft: "100 µm (stripe)", notes: "high solids for critical points" },
        { name: "Sigmacover 350", dft: "125 µm (1x)", notes: "full coat" },
        { name: "Sigmadur 550", dft: "50 µm (1x)", notes: "finish" },
      ],
    }),
    blistering: ({ env }) => ({
      surfacePrep: "Remove blisters, feather edges, wash, seal",
      products: [
        { name: "Sigmacover 380", dft: "125 µm (1x)", notes: "barrier/rebuild" },
        { name: "Sigmadur 550", dft: "50 µm (1x)", notes: "finish" },
      ],
    }),
    delamination: ({ env }) => ({
      surfacePrep: "Remove non-adherent coating, St 3 prep",
      products: [
        { name: "Sigmacover 350", dft: "150 µm (1x)", notes: "film rebuild" },
        { name: "Sigmadur 550", dft: "50 µm (1x)", notes: "finish" },
      ],
    }),
    mechanical_damage: ({ env }) => ({
      surfacePrep: "Sanding/roughening, restore profile",
      products: [
        { name: "Sigmarine 28", dft: "75 µm (1x)", notes: "fast drying primer" },
        { name: "Sigmadur 550", dft: "50 µm (1x)", notes: "finish" },
      ],
    }),
    fouling: ({ env }) => ({
      surfacePrep: "UW cleaning, remove fouling, light sanding",
      products: [
        { name: "Ecofleet 530", dft: "see TDS", notes: "antifouling; verify tie-coat compatibility" },
      ],
    }),
  },
};

function pickCycle(defectType, env) {
  const fn = LIB.cycles[defectType] || LIB.cycles.general_corrosion;
  return fn({ env });
}

// simple geo heuristic for demo
function estimateEnvFromGeo(meta) {
  const loc = (meta?.location || "").toLowerCase();
  let distCoastKm = 10;
  if (/porto|port|marina|banchina|dock|harbor/.test(loc)) distCoastKm = 0.5;

  const isIndustrial = /zona industriale|raffineria|steel|shipyard|cantiere|impianto|plant|terminal/.test(loc);

  let env = "C3";
  if (distCoastKm <= 1) env = "C5M";
  else if (distCoastKm <= 20) env = "C4";

  if (isIndustrial) env = env === "C3" ? "C4" : env === "C4" ? "C5I" : env;

  if (/offshore|piattaforma|splash zone|breakwater/.test(loc)) env = "CX";
  return env;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// ✅ Netlify expects a named export called `handler`
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors() };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const { images, meta } = JSON.parse(event.body || "{}");
    if (!Array.isArray(images) || images.length === 0) {
      return {
        statusCode: 400,
        headers: { ...cors(), "Content-Type": "application/json" },
        body: JSON.stringify({ error: "No images" }),
      };
    }

    const estimatedEnv = estimateEnvFromGeo(meta);
    const effectiveEnv = (meta?.environment && meta.environment !== "Auto") ? meta.environment : estimatedEnv;

    const userContent = [
      { type: "text", text: `Analyze the images for corrosion or coating breakdown. Metadata: area=${meta?.area}, env=${effectiveEnv}, substrate=${meta?.substrate}, existing=${meta?.existingSystem}. Return a compact JSON with items[].defect{type,severity,confidence,notes}. Respond in English only.` },
      ...images.map((dataUrl) => ({ type: "image_url", image_url: { url: dataUrl } })),
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 700,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "{}";
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { items: [] };
    }

    const items = (parsed.items || images.map(() => ({ defect: { type: "general_corrosion", severity: "moderate", confidence: 0.5, notes: "default" } })))
      .slice(0, images.length)
      .map((it) => ({
        defect: it.defect,
        recommendation: pickCycle(it.defect?.type, effectiveEnv),
      }));

    const payload = {
      meta: { ...meta, estimatedEnv, effectiveEnv },
      items,
      disclaimer: "AI output is non-binding; always verify with TDS/PSDS and real inspection.",
    };

    return {
      statusCode: 200,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: err?.message || "Internal error" }),
    };
  }
};
