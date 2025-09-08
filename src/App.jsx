
import React, { useState } from "react";
import { Upload, Trash2, Send, ImageIcon, ShieldCheck, Loader2 } from "lucide-react";

const MAX_FILES = 5;

export default function App() {
  const [files, setFiles] = useState([]);
  const [meta, setMeta] = useState({
    area: "Hull/Topside",
    environment: "Auto",
    substrate: "Steel",
    existingSystem: "Unknown",
    location: "",
    coords: null,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const onDrop = (ev) => {
    ev.preventDefault();
    handleFiles(ev.dataTransfer.files);
  };

  const handleFiles = async (fileList) => {
    setError("");
    const arr = Array.from(fileList);
    if (arr.length + files.length > MAX_FILES) {
      setError(`Massimo ${MAX_FILES} immagini.`);
      return;
    }
    const supported = ["image/jpeg", "image/png", "image/webp"];
    for (const f of arr) {
      if (!supported.includes(f.type) || f.size > 6 * 1024 * 1024) {
        setError("Accetta solo JPG/PNG/WEBP fino a 6 MB per file.");
        return;
      }
    }
    const withPreview = await Promise.all(
      arr.map(
        (f) =>
          new Promise((res) => {
            const r = new FileReader();
            r.onload = () => res({ file: f, dataUrl: r.result });
            r.readAsDataURL(f);
          })
      )
    );
    setFiles((prev) => [...prev, ...withPreview]);
  };

  const removeAt = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    try {
      if (!files.length) {
        setError("Carica almeno una foto.");
        return;
      }
      setLoading(true);
      setResult(null);
      setError("");
      const payload = {
        images: files.map((f) => f.dataUrl),
        meta,
      };
      const resp = await fetch("/.netlify/functions/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const json = await resp.json();
      setResult(json);
    } catch (e) {
      setError(e.message || "Errore sconosciuto");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight">CorrosionBot <span className="text-slate-500">(demo)</span></h1>
        <p className="text-sm text-slate-600 mt-1">Supporto tecnico sperimentale. Non sostituisce un ispettore certificato.</p>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24">
        <section className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="border-2 border-dashed border-slate-300 rounded-2xl p-6 bg-white shadow-sm"
            >
              <div className="flex items-center gap-3">
                <Upload className="w-5 h-5" />
                <div>
                  <p className="font-medium">Trascina qui le immagini (JPG/PNG/WEBP)</p>
                  <p className="text-xs text-slate-500">Max {MAX_FILES} file, 6 MB ciascuno</p>
                </div>
              </div>
              <div className="mt-4">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleFiles(e.target.files)}
                  className="block w-full text-sm"
                />
              </div>
              {files.length > 0 && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                  {files.map((f, i) => (
                    <div key={i} className="relative group">
                      <img src={f.dataUrl} alt={`upload-${i}`} className="w-full h-32 object-cover rounded-xl border" />
                      <button
                        onClick={() => removeAt(i)}
                        className="absolute top-2 right-2 bg-white/90 rounded-full p-1 shadow hover:bg-white"
                        title="Rimuovi"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="bg-white border rounded-2xl p-4 shadow-sm">
              <h2 className="font-semibold mb-3">Metadati</h2>

              <label className="block text-sm mb-2">Località (indirizzo o coordinate)</label>
              <input
                className="w-full border rounded-lg p-2 mb-2"
                placeholder="es. Porto di Napoli"
                value={meta.location}
                onChange={(e) => setMeta({ ...meta, location: e.target.value })}
              />
              <button
                type="button"
                className="text-xs underline"
                onClick={() => {
                  if (!navigator.geolocation) return;
                  navigator.geolocation.getCurrentPosition((pos) => {
                    setMeta({
                      ...meta,
                      coords: { lat: pos.coords.latitude, lon: pos.coords.longitude },
                      location: `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`
                    });
                  });
                }}
              >
                Usa la mia posizione
              </button>

              <label className="block text-sm mt-3 mb-2">Area</label>
              <select
                className="w-full border rounded-lg p-2 mb-3"
                value={meta.area}
                onChange={(e) => setMeta({ ...meta, area: e.target.value })}
              >
                <option>Hull/Topside</option>
                <option>Deck</option>
                <option>Ballast Tank</option>
                <option>Superstructure</option>
                <option>Underwater Hull</option>
              </select>

              <label className="block text-sm mb-2">Ambiente (ISO 12944)</label>
              <select
                className="w-full border rounded-lg p-2 mb-3"
                value={meta.environment}
                onChange={(e) => setMeta({ ...meta, environment: e.target.value })}
              >
                <option>Auto</option>
                <option>C3</option>
                <option>C4</option>
                <option>C5M</option>
                <option>C5I</option>
                <option>CX</option>
              </select>

              <label className="block text-sm mb-2">Substrato</label>
              <select
                className="w-full border rounded-lg p-2 mb-3"
                value={meta.substrate}
                onChange={(e) => setMeta({ ...meta, substrate: e.target.value })}
              >
                <option>Steel</option>
                <option>Aluminium</option>
              </select>

              <label className="block text-sm mb-2">Sistema esistente</label>
              <select
                className="w-full border rounded-lg p-2"
                value={meta.existingSystem}
                onChange={(e) => setMeta({ ...meta, existingSystem: e.target.value })}
              >
                <option>Unknown</option>
                <option>Epoxy/PU</option>
                <option>Antifouling</option>
                <option>Silicone</option>
              </select>
            </div>

            <div className="bg-white border rounded-2xl p-4 shadow-sm">
              <button
                onClick={submit}
                className="w-full inline-flex justify-center items-center gap-2 rounded-xl px-4 py-2 font-semibold bg-slate-900 text-white hover:bg-slate-800"
                disabled={loading}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {loading ? "Analisi in corso" : "Analizza"}
              </button>
              {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            </div>

            <div className="bg-white border rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1"><ShieldCheck className="w-4 h-4"/><h3 className="font-semibold">Disclaimer</h3></div>
              <p className="text-xs text-slate-600">Strumento sperimentale di supporto. Le raccomandazioni sono indicazioni generiche basate su immagini. Confermare sempre con ispezione e schede tecniche PPG.</p>
            </div>
          </aside>
        </section>

        {result && (
          <section className="mt-8">
            <h2 className="font-semibold mb-3">Risultati</h2>
            <p className="text-xs text-slate-500">Ambiente stimato: <b>{result?.meta?.estimatedEnv || "-"}</b> · Usato per le regole: <b>{result?.meta?.effectiveEnv || "-"}</b></p>
            <div className="space-y-4 mt-2">
              {result.items?.map((it, idx) => (
                <div key={idx} className="bg-white border rounded-2xl p-4 shadow-sm">
                  <div className="flex gap-4 items-start">
                    <img src={files[idx]?.dataUrl || ""} alt="preview" className="w-32 h-32 object-cover rounded-xl border"/>
                    <div className="flex-1">
                      <p className="text-sm text-slate-500">Difetto: <span className="font-medium text-slate-800">{it.defect?.type}</span> · Gravità: <span className="font-medium">{it.defect?.severity}</span> · Confidenza: {Math.round((it.defect?.confidence||0)*100)}%</p>
                      <p className="text-sm text-slate-500">Note AI: {it.defect?.notes}</p>
                      <div className="mt-2 p-3 bg-slate-50 rounded-xl border">
                        <p className="text-sm font-semibold">Ciclo consigliato</p>
                        <ul className="text-sm list-disc pl-5">
                          {it.recommendation?.products?.map((p, i) => (
                            <li key={i}><span className="font-medium">{p.name}</span> · {p.dft} · {p.notes}</li>
                          ))}
                        </ul>
                        {it.recommendation?.surfacePrep && (
                          <p className="text-xs text-slate-600 mt-2">Preparazione: {it.recommendation.surfacePrep}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="text-center text-xs text-slate-500 py-6">
        <div className="flex items-center justify-center gap-2"><ImageIcon className="w-4 h-4"/>CorrosionBot • demo</div>
      </footer>
    </div>
  );
}
