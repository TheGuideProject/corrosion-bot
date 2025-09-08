import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a coatings inspector assistant. Always think and respond in English. Return ONLY valid JSON.
For each image, infer: defect { type: one of [general_corrosion, pitting, blistering, delamination, mechanical_damage, fouling],
severity: [minor, moderate, severe], confidence: 0..1, notes: short explanation }.
If unsure, type=general_corrosion, severity=moderate.`;

/* ---------- Area-aware rule engine ---------- */

// Reusable product blocks
const BLOCKS = {
  stripe: { name: "Sigmacover 456", dft: "100 µm (stripe)", notes: "stripe coat edges/welds" },
  intermedio350: { name: "Sigmacover 350", dft: "125 µm (1x)", notes: "anticorrosive intermediate" },
  intermedio380: { name: "Sigmacover 380", dft: "125 µm (1x)", notes: "barrier/rebuild" },
  finitura550: { name: "Sigmadur 550", dft: "50 µm (1x)", notes: "polyurethane finish" },
  primerRapido28: { name: "Sigmarine 28", dft: "75 µm (1x)", notes: "fast drying primer" },
  antifouling: { name: "Ecofleet 530", dft: "see TDS", notes: "antifouling; verify tie-coat" },
  immersionEpoxy: { name: "Sigmashield 1200", dft: "2×200 µm", notes: "immersion-grade epoxy" },
  deckNonSkid: { name: "Aggregate broadcast", dft: "—", notes: "non-skid system with aggregate" },
};

// Decide cycle from area + defect + env
function cycleFor({ area, defectType, env }) {
  area = (area || "").toLowerCase();
  const atm = ["C3", "C4", "C5I", "C5M", "CX"].includes(env) ? env : "C4";

  // UNDERWATER HULL (immersion + AF)
  if (area.includes("underwater")) {
    if (defectType === "fouling") {
      return {
        surfacePrep: "UW cleaning, remove biological fouling; light sanding; ensure compatibility.",
        products: [BLOCKS.antifouling],
      };
    }
    return {
      surfacePrep: "High-pressure wash; mechanical prep; remove salts; ISO 8501 profile.",
      products: [BLOCKS.immersionEpoxy, BLOCKS.antifouling],
    };
  }

  // BALLAST TANK (immersion-like)
  if (area.includes("ballast")) {
    return {
      surfacePrep: "Sa 2.5 blasting (if feasible) or St 3 spot; chloride removal; stripe on edges/welds.",
      products: defectType === "pitting" ? [BLOCKS.stripe, BLOCKS.immersionEpoxy] : [BLOCKS.immersionEpoxy],
    };
  }

  // DECK (robust + optional non-skid)
  if (area.includes("deck")) {
    if (defectType === "mechanical_damage") {
      return {
        surfacePrep: "Sanding/roughening; restore profile; clean and degrease.",
        products: [BLOCKS.primerRapido28, BLOCKS.finitura550, BLOCKS.deckNonSkid],
      };
    }
    if (defectType === "blistering" || defectType === "delamination") {
      return {
        surfacePrep: "Remove defective coating; feather edges; wash; seal; stripe where needed.",
        products: [BLOCKS.intermedio380, BLOCKS.finitura550, BLOCKS.deckNonSkid],
      };
    }
    return {
      surfacePrep: "Local St 3; stripe on edges/welds; salt removal; restore profile.",
      products:
        defectType === "pitting"
          ? [BLOCKS.stripe, BLOCKS.intermedio350, BLOCKS.finitura550, BLOCKS.deckNonSkid]
          : [BLOCKS.intermedio350, BLOCKS.finitura550, BLOCKS.deckNonSkid],
    };
  }

  // HULL/TOPSIDE or SUPERSTRUCTURE (atmospheric C3..CX)
  if (area.includes("hull") || area.includes("topside") || area.includes("superstructure")) {
    const useBarrier = atm === "C5M" || atm === "C5I" || atm === "CX";

    if (defectType === "blistering" || defectType === "delamination") {
      return {
        surfacePrep: "Remove blisters/delamination; feather edges; wash; seal.",
        products: [useBarrier ? BLOCKS.intermedio380 : BLOCKS.intermedio350, BLOCKS.finitura550],
      };
    }
    if (defectType === "mechanical_damage") {
      return { surfacePrep: "Sanding/roughening; spot repair; clean.", products: [BLOCKS.primerRapido28, BLOCKS.finitura550] };
    }
    if (defectType === "pitting") {
      return {
        surfacePrep: "St 3; stripe on edges/welds; salt removal.",
        products: [BLOCKS.stripe, useBarrier ? BLOCKS.intermedio380 : BLOCKS.intermedio350, BLOCKS.finitura550],
      };
    }
    return {
      surfacePrep: "Local St 3; remove salts/contaminants; restore profiles.",
      products: [useBarrier ? BLOCKS.intermedio380 : BLOCKS.intermedio350, BLOCKS.finitura550],
    };
  }

  // Fallback
  return { surfacePrep: "Surface cleaning; St 3 local; remove salts.", products: [BLOCKS.intermedio350, BLOCKS.finitura550] };
}

function pickCycle(defectType, env, area) {
  return cycleFor({ area, defectType, env });
}

/* ---------- Helpers ---------- */

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

/* ---------- Netlify function (Lambda style) ---------- */
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors() };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  try {
    const { images, meta } = JSON.parse(event.body || "{}");
    if (!Array.isArray(images) || images.length === 0) {
      return { statusCode: 400, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify({ error: "No images" }) };
    }

    const estimatedEnv = estimateEnvFromGeo(meta);
    const effectiveEnv = meta?.environment && meta.environment !== "Auto" ? meta.environment : estimatedEnv;

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
        recommendation: pickCycle(it.defect?.type, effectiveEnv, meta?.area),
      }));

    const payload = { meta: { ...meta, estimatedEnv, effectiveEnv }, items, disclaimer: "AI output is non-binding; always verify with TDS/PSDS and real inspection." };

    return { statusCode: 200, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify(payload) };
  } catch (err) {
    return { statusCode: 500, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify({ error: err?.message || "Internal error" }) };
  }
};

