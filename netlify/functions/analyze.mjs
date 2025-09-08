
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a coatings inspector assistant. Return ONLY valid JSON.
For each image, infer: defect { type: one of [general_corrosion, pitting, blistering, delamination, mechanical_damage, fouling],
severity: [minor, moderate, severe], confidence: 0..1, notes: short explanation }.
If unsure, type=general_corrosion, severity=moderate.`;

// Demo product library; replace with your internal DB mapping.
const LIB = {
  cycles: {
    general_corrosion: ({ env }) => ({
      surfacePrep: "St 3 locale, rimozione sali/contaminanti, ripristino profili",
      products: [
        { name: "Sigmacover 350", dft: "125 µm (1x)", notes: "intermedio anticorrosivo" },
        { name: "Sigmadur 550", dft: "50 µm (1x)", notes: "finitura poliuretanica" },
      ],
    }),
    pitting: ({ env }) => ({
      surfacePrep: "St 3, stripe coat su spigoli/saldature, riempimento cavillature",
      products: [
        { name: "Sigmacover 456", dft: "100 µm (stripe)", notes: "alto solido per punti critici" },
        { name: "Sigmacover 350", dft: "125 µm (1x)", notes: "mano piena" },
        { name: "Sigmadur 550", dft: "50 µm (1x)", notes: "finitura" },
      ],
    }),
    blistering: ({ env }) => ({
      surfacePrep: "Rimozione blister, feathering bordi, lavaggio, sigillatura",
      products: [
        { name: "Sigmacover 380", dft: "125 µm (1x)", notes: "barriera/ricostruzione" },
        { name: "Sigmadur 550", dft: "50 µm (1x)", notes: "finitura" },
      ],
    }),
    delamination: ({ env }) => ({
      surfacePrep: "Asportazione rivestimento non aderente, preparazione a St 3",
      products: [
        { name: "Sigmacover 350", dft: "150 µm (1x)", notes: "ricostruzione film" },
        { name: "Sigmadur 550", dft: "50 µm (1x)", notes: "chiusura" },
      ],
    }),
    mechanical_damage: ({ env }) => ({
      surfacePrep: "Carteggiatura/irruvidimento, ripristino profilo",
      products: [
        { name: "Sigmarine 28", dft: "75 µm (1x)", notes: "primer rapida essiccazione" },
        { name: "Sigmadur 550", dft: "50 µm (1x)", notes: "finitura" },
      ],
    }),
    fouling: ({ env }) => ({
      surfacePrep: "Pulizia U/W, rimozione biofouling, levigatura leggera",
      products: [
        { name: "Ecofleet 530", dft: "seguire TDS", notes: "antivegetativa; verificare tie-coat compatibile" },
      ],
    }),
  },
};

function pickCycle(defectType, env) {
  const fn = LIB.cycles[defectType] || LIB.cycles.general_corrosion;
  return fn({ env });
}

// Very simple environment estimation from meta.location/coords (heuristic for POC)
function estimateEnvFromGeo(meta) {
  const loc = (meta?.location || "").toLowerCase();
  let distCoastKm = 10; // fallback
  if (/porto|port|marina|banchina|dock|harbor/.test(loc)) distCoastKm = 0.5;

  const isIndustrial = /zona industriale|raffineria|steel|shipyard|cantiere|impianto|plant|terminal/.test(loc);

  let env = "C3";
  if (distCoastKm <= 1) env = "C5M";
  else if (distCoastKm <= 20) env = "C4";

  if (isIndustrial) env = env === "C3" ? "C4" : env === "C4" ? "C5I" : env;

  if (/offshore|piattaforma|splash zone|frangiflutti/.test(loc)) env = "CX";
  return env;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default async (req, context) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });

  try {
    const { images, meta } = await req.json();
    if (!Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: "No images" }), { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } });
    }

    const estimatedEnv = estimateEnvFromGeo(meta);
    const effectiveEnv = (meta?.environment && meta.environment !== "Auto") ? meta.environment : estimatedEnv;

    const userContent = [
      { type: "text", text: `Analizza le immagini per difetti di corrosione o coating breakdown. Metadati: area=${meta?.area}, env=${effectiveEnv}, substrate=${meta?.substrate}, existing=${meta?.existingSystem}. Restituisci JSON compatto con items[].defect{type,severity,confidence,notes}.` },
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
      disclaimer: "Output AI non vincolante; verificare sempre TDS/PSDS e condizioni reali di cantiere.",
    };

    return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders(), "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }
};
