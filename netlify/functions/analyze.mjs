import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a coatings inspector assistant. Always think and respond in English. Return ONLY valid JSON.
For each image, infer: defect { type: one of [general_corrosion, pitting, blistering, delamination, mechanical_damage, fouling],
severity: [minor, moderate, severe], confidence: 0..1, notes: short explanation }.
If unsure, type=general_corrosion, severity=moderate.`;

/* ---------- Product blocks from user's spec (PDF) ---------- */
/* Notes: values & product names reflect user's provided cycles. */
const BLOCKS = {
  // Core products
  sigmaprime200_100_200: { name: "Sigmaprime 200", dft: "100–200 µm", notes: "immersion-capable epoxy per spec" },
  sigmaprime200_320_total: { name: "Sigmaprime 200", dft: "320 µm total", notes: "IMO PSPC target; include 75–100 µm stripe per layer" },
  sigmacover350_2x125: { name: "Sigmacover 350", dft: "2×125 µm", notes: "cheaper/easier alternative per spec" },
  sigmacover350_125: { name: "Sigmacover 350", dft: "125 µm (1x)", notes: "intermediate anticorrosive" },
  sigmacover456_75: { name: "Sigmacover 456", dft: "75 µm", notes: "epoxy; choose based on existing finish compatibility" },
  sigmadur550_50_60: { name: "Sigmadur 550", dft: "50–60 µm", notes: "polyurethane; UV resistant; not for immersion" },
  sigmarine48_1x35: { name: "Sigmarine 48", dft: "35 µm (1x)", notes: "alkyd; choice depends on old finish" },
  sigmarine48_2x35: { name: "Sigmarine 48", dft: "2×35 µm", notes: "alkyd; choice depends on old finish" },
  sigmarine28_75: { name: "Sigmarine 28", dft: "75 µm", notes: "fast-dry primer for internals" },
  // Tanks
  sigmaguardCSF585_250_400: { name: "Sigmaguard CSF 585", dft: "250–400 µm", notes: "fresh/drinking water tank; white available" },
  // Heat
  sigmatherm500_25: { name: "Sigmatherm 500 Aluminium", dft: "25 µm", notes: "> 250°C service" },
  sigmatherm175_25: { name: "Sigmatherm 175", dft: "25 µm", notes: "< 175°C service" },
  // AF/immersion extras for generic underwater
  antifouling: { name: "Ecofleet 530", dft: "see TDS", notes: "antifouling; verify tie-coat" },
  immersion_build_2x200: { name: "Sigmashield 1200", dft: "2×200 µm", notes: "immersion-grade high-build epoxy" },
  stripe_456_100: { name: "Sigmacover 456", dft: "100 µm (stripe)", notes: "stripe coat edges/welds" },
};

/* ---------- Area + defect + environment logic ---------- */
/* Areas we recognize from UI: Hull/Topside, Deck, Ballast Tank, Superstructure, Underwater Hull
   We also support optional text matches for: External Deck, Main Deck, Hatch Covers, Cargo Holds, Internal Decks,
   Internal Visible Steel, Fresh/Drinking Water Tank, Heat Resistance. */

function norm(s) { return (s || "").toLowerCase(); }

function cycleFromUserSpec({ area, defectType, env }) {
  const a = norm(area);
  const t = defectType || "general_corrosion";
  const severe = ["C5M", "C5I", "CX"].includes(env);

  // --- WATER / SPECIAL TANKS (explicit keywords in "area") ---
  if (a.includes("fresh") || a.includes("drinking")) {
    return {
      surfacePrep: "Surface cleaning, salt removal, appropriate profile for tank lining.",
      products: [BLOCKS.sigmaguardCSF585_250_400],
    };
  }

  if (a.includes("ballast")) {
    // From PDF: 3× Sigmaprime 200 tot 320 µm; stripe 75–100 µm/layer
    // Small or big repairs share same approach in doc.
    const base = [
      BLOCKS.sigmaprime200_320_total
    ];
    // If you want to show layers explicitly, you can expand to three items with DFT per layer.
    if (t === "pitting") {
      return {
        surfacePrep: "Sa 2.5 where feasible or St 3 spot; soluble salts removal; stripe on edges/welds.",
        products: [BLOCKS.stripe_456_100, ...base],
      };
    }
    if (t === "blistering" || t === "delamination") {
      return {
        surfacePrep: "Remove non-adherent coating; feather edges; wash; seal; chloride check.",
        products: base,
      };
    }
    return {
      surfacePrep: "Sa 2.5 (preferable) or St 3 spot; stripe coating as needed; salts removal.",
      products: base,
    };
  }

  // --- HEAT RESISTANCE (engine/stack/etc.) ---
  if (a.includes("heat")) {
    // Let user choose temp band; here we suggest both options from doc
    return {
      surfacePrep: "Prepare according to TDS; ensure heat-stable substrate and cleanliness.",
      products: [BLOCKS.sigmatherm500_25, BLOCKS.sigmatherm175_25],
    };
  }

  // --- UNDERWATER HULL (generic AF + immersion epoxy for breakdown) ---
  if (a.includes("underwater")) {
    if (t === "fouling") {
      return {
        surfacePrep: "UW cleaning; remove biological fouling; light sanding; check AF compatibility.",
        products: [BLOCKS.antifouling],
      };
    }
    return {
      surfacePrep: "HP wash; mechanical prep; remove salts; immersion-capable build where coating breakdown exists.",
      products: [BLOCKS.immersion_build_2x200, BLOCKS.antifouling],
    };
  }

  // --- DECKS (MAIN/EXTERNAL) & HATCH COVERS per PDF ---
  if (a.includes("deck") || a.includes("hatch")) {
    // Preferred cycle (from PDF): 2× Sigmaprime 200 (100–200 µm) + finish
    const base = [BLOCKS.sigmaprime200_100_200, BLOCKS.sigmaprime200_100_200];
    // Finish choice note: PU vs Epoxy vs Alkyd depends on existing finish
    const finishChoices = [
      BLOCKS.sigmadur550_50_60,
      BLOCKS.sigmacover456_75,
      BLOCKS.sigmarine48_1x35, // or 2x35
    ];

    // Cheaper alternative: 2× Sigmacover 350 (2x125)
    const cheaper = [BLOCKS.sigmacover350_2x125];

    if (t === "mechanical_damage") {
      return {
        surfacePrep: "Sanding/roughening; degrease; local profile restoration.",
        products: [...base, finishChoices[0]],
        alt: { products: cheaper, note: "Cheaper/easier alternative" },
      };
    }
    if (t === "blistering" || t === "delamination") {
      return {
        surfacePrep: "Remove blisters/delamination; feather edges; wash; seal; compatibility disclaimer with existing finish.",
        products: [...base, finishChoices[0]],
        notes: "Finish choice depends on old finish (PU vs Epoxy vs Alkyd).",
        alternatives: [
          { products: [...base, finishChoices[1]] },
          { products: [...base, BLOCKS.sigmarine48_2x35] },
          { products: cheaper, note: "Cheaper/easier cycle" },
        ],
      };
    }
    // general_corrosion / pitting (add stripe if pitting)
    const start = t === "pitting" ? [BLOCKS.stripe_456_100, ...base] : base;
    return {
      surfacePrep: "Local St 3; remove salts; stripe on edges/welds where needed.",
      products: [...start, finishChoices[0]],
      notes: "Finish choice depends on old finish (PU vs Epoxy vs Alkyd).",
      alternatives: [
        { products: [...start, finishChoices[1]] },
        { products: [...start, BLOCKS.sigmarine48_2x35] },
        { products: cheaper, note: "Cheaper/easier cycle" },
      ],
    };
  }

  // --- SUPERSTRUCTURE esterna per PDF ---
  if (a.includes("superstructure")) {
    const base = [BLOCKS.sigmaprime200_100_200, BLOCKS.sigmaprime200_100_200];
    const finishOptions = [
      BLOCKS.sigmadur550_50_60,
      BLOCKS.sigmarine48_1x35, // or 2x35 as needed
    ];
    if (t === "pitting") {
      return {
        surfacePrep: "St 3; stripe on edges/welds; remove salts.",
        products: [BLOCKS.stripe_456_100, ...base, finishOptions[0]],
        alternatives: [{ products: [...base, BLOCKS.sigmarine48_2x35] }],
        notes: "Finish choice depends on old finish (PU vs Alkyd).",
      };
    }
    if (t === "blistering" || t === "delamination") {
      return {
        surfacePrep: "Remove defective coating; feather edges; wash; seal.",
        products: [...base, finishOptions[0]],
        alternatives: [{ products: [...base, BLOCKS.sigmarine48_2x35] }],
      };
    }
    return {
      surfacePrep: "Local St 3; salts removal.",
      products: [...base, finishOptions[0]],
      alternatives: [{ products: [...base, BLOCKS.sigmarine48_2x35] }],
    };
  }

  // --- CARGO HOLDS (dry) per PDF ---
  if (a.includes("cargo") || a.includes("hold")) {
    const base = [BLOCKS.sigmaprime200_100_200, BLOCKS.sigmaprime200_100_200];
    const finishChoices = [
      BLOCKS.sigmadur550_50_60,
      BLOCKS.sigmacover456_75,
      BLOCKS.sigmarine48_1x35,
    ];
    const cheaper = [BLOCKS.sigmacover350_2x125];
    if (t === "pitting") {
      return {
        surfacePrep: "St 3; stripe edges/welds.",
        products: [BLOCKS.stripe_456_100, ...base, finishChoices[0]],
        alternatives: [
          { products: [...base, finishChoices[1]] },
          { products: [...base, BLOCKS.sigmarine48_2x35] },
          { products: cheaper, note: "Cheaper/easier cycle" },
        ],
      };
    }
    return {
      surfacePrep: "Remove contamination; local St 3; salts removal.",
      products: [...base, finishChoices[0]],
      alternatives: [
        { products: [...base, finishChoices[1]] },
        { products: [...base, BLOCKS.sigmarine48_2x35] },
        { products: cheaper, note: "Cheaper/easier cycle" },
      ],
    };
  }

  // --- INTERNAL visible steel / internal decks per PDF ---
  if (a.includes("internal")) {
    // Visible steel:
    if (a.includes("visible")) {
      return {
        surfacePrep: "Cleaning; light abrasion as needed.",
        products: [BLOCKS.sigmarine28_75, BLOCKS.sigmarine48_1x35],
      };
    }
    // Internal decks:
    if (a.includes("deck")) {
      return {
        surfacePrep: "Clean; light sanding where needed; respect recoat windows.",
        products: [BLOCKS.sigmarine28_75, BLOCKS.sigmarine48_1x35],
        notes: "Recoat windows: Sigmarine 28 (8h/4h/3h), Sigmarine 48 (24h/16h/16h) as per doc.",
      };
    }
  }

  // --- Hull/Topside generic (fallback if user picked that) ---
  if (a.includes("hull") || a.includes("topside")) {
    // Use a conservative atmospheric cycle if not matched above
    if (t === "pitting") {
      return {
        surfacePrep: "St 3; stripe on edges/welds; remove salts.",
        products: [BLOCKS.stripe_456_100, BLOCKS.sigmacover350_125, BLOCKS.sigmadur550_50_60],
      };
    }
    if (t === "blistering" || t === "delamination") {
      return {
        surfacePrep: "Remove blisters/delamination; feather edges; wash; seal.",
        products: [BLOCKS.sigmacover350_125, BLOCKS.sigmadur550_50_60],
      };
    }
    return {
      surfacePrep: "Local St 3; remove salts/contaminants; restore profile.",
      products: [BLOCKS.sigmacover350_125, BLOCKS.sigmadur550_50_60],
    };
  }

  // Final fallback
  return {
    surfacePrep: "Surface cleaning; St 3 local; saline contamination removal.",
    products: [BLOCKS.sigmacover350_125, BLOCKS.sigmadur550_50_60],
  };
}

function pickCycle(defectType, env, area) {
  return cycleFromUserSpec({ area, defectType, env });
}

/* ---------- Helpers ---------- */
// Heuristic environment (simple; you can replace with robust async version later)
function estimateEnvFromGeo(meta) {
  const loc = (meta?.location || "").toLowerCase();
  let env = "C4";
  if (/offshore|splash zone|piattaforma|breakwater/.test(loc)) return "CX";
  if (/porto|port|marina|banchina|dock|harbor/.test(loc)) env = "C5M";
  if (/zona industriale|raffineria|steel|shipyard|cantiere|impianto|plant|terminal/.test(loc)) env = env === "C4" ? "C5I" : env;
  return env;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

/* ---------- Netlify function ---------- */
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

    const items = (parsed.items || images.map(() => ({
      defect: { type: "general_corrosion", severity: "moderate", confidence: 0.5, notes: "default" }
    })))
      .slice(0, images.length)
      .map((it) => ({
        defect: it.defect,
        recommendation: pickCycle(it.defect?.type, effectiveEnv, meta?.area),
      }));

    const payload = {
      meta: { ...meta, estimatedEnv, effectiveEnv },
      items,
      disclaimer: "AI output is non-binding; always verify with TDS/PSDS and real inspection.",
    };

    return { statusCode: 200, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify(payload) };
  } catch (err) {
    return { statusCode: 500, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify({ error: err?.message || "Internal error" }) };
  }
};
