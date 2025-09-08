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

  // Ask AI modal state
  const [askOpen, setAskOpen] = useState(false);
  const [askInput, setAskInput] = useState("");
  const [askAnswer, setAskAnswer] = useState("");

  const onDrop = (ev) => {
    ev.preventDefault();
    handleFiles(ev.dataTransfer.files);
  };

  const handleFiles = async (fileList) => {
    setError("");
    const arr = Array.from(fileList);
    if (arr.length + files.length > MAX_FILES) {
      setError(`Max ${MAX_FILES} images.`);
      return;
    }
    const supported = ["image/jpeg", "image/png", "image/webp"];
    for (const f of arr) {
      if (!supported.includes(f.type) || f.size > 6 * 1024 * 1024) {
        setError("Only JPG/PNG/WEBP up to 6 MB each.");
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
        setError("Upload at least one photo.");
        return;
      }
      setLoading(true);
      setResult(null);
      setError("");
      const payload = { images: files.map((f) => f.dataUrl), meta };
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
      setError(e.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const askAI = async () => {
    try {
      setAskAnswer("Asking...");
      const resp = await fetch("/.netlify/functions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: askInput, meta, lastResult: result }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      setAskAnswer(json.answer || "");
    } catch (e) {
      setAskAnswer(`Error: ${e.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight">
          CorrosionBot <span className="text-slate-500">(demo)</span>
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Experimental support tool. Does not replace certified inspectors.
        </p>
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
                  <p className="font-medium">Drag images here (JPG/PNG/WEBP)</p>
                  <p className="text-xs text-slate-500">Max {MAX_FILES} files, 6 MB each</p>
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
                      <img
                        src={f.dataUrl}
                        alt={`upload-${i}`}
                        className="w-full h-32 object-cover rounded-xl border"
                      />
                      <button
                        onClick={() => removeAt(i)}
                        className="absolute top-2 right-2 bg-white/90 rounded-full p-1 shadow hover:bg-white"
                        title="Remove"
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
              <h2 className="font-semibold mb-3">Metadata</h2>

              <label className="block text-sm mb-2">Location (address or coordinates)</label>
              <input
                className="w-full border rounded-lg p-2 mb-2"
                placeholder="e.g. Port of Naples"
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
                      location: `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
                    });
                  });
                }}
              >
                Use my position
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

              <label className="block text-sm mb-2">Environment (ISO 12944)</label>
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

              <label className="block text-sm mb-2">Substrate</label>
              <select
                className="w-full border rounded-lg p-2 mb-3"
                value={meta.substrate}
                onChange={(e) => setMeta({ ...meta, substrate: e.target.value })}
              >
                <option>Steel</option>
                <option>Aluminium</option>
              </select>

              <label className="block text-sm mb-2">Existing system</label>
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
                {loading ? "Analyzing" : "Analyze"}
              </button>
              {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            </div>

            <div className="bg-white border rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-4 h-4" />
                <h3 className="font-semibold">Disclaimer</h3>
              </div>
              <p className="text-xs text-slate-600">
                Experimental support tool. Recommendations are generic. Always confirm with inspection and PPG TDS.
              </p>
            </div>
          </aside>
        </section>

        {result && (
          <section className="mt-8">
            <h2 className="font-semibold mb-3">Results</h2>
            <p className="text-xs text-slate-500">
              Estimated environment: <b>{result?.meta?.estimatedEnv || "-"}</b> · Used for rules:{" "}
              <b>{result?.meta?.effectiveEnv || "-"}</b>
            </p>
            <div className="space-y-4 mt-2">
              {result.items?.map((it, idx) => (
                <div key={idx} className="bg-white border rounded-2xl p-4 shadow-sm">
                  <div className="flex gap-4 items-start">
                    <img
                      src={files[idx]?.dataUrl || ""}
                      alt="preview"
                      className="w-32 h-32 object-cover rounded-xl border"
                    />
                    <div className="flex-1">
                      <p className="text-sm text-slate-500">
                        Defect: <span className="font-medium text-slate-800">{it.defect?.type}</span> · Severity:{" "}
                        <span className="font-medium">{it.defect?.severity}</span> · Confidence:{" "}
                        {Math.round((it.defect?.confidence || 0) * 100)}%
                      </p>
                      <p className="text-sm text-slate-500">AI Notes: {it.defect?.notes}</p>
                      <div className="mt-2 p-3 bg-slate-50 rounded-xl border">
                        <p className="text-sm font-semibold">Recommended cycle</p>
                        <ul className="text-sm list-disc pl-5">
                          {it.recommendation?.products?.map((p, i) => (
                            <li key={i}>
                              <span className="font-medium">{p.name}</span> · {p.dft} · {p.notes}
                            </li>
                          ))}
                        </ul>
                        {it.recommendation?.surfacePrep && (
                          <p className="text-xs text-slate-600 mt-2">
                            Surface prep: {it.recommendation.surfacePrep}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <button
                onClick={() => {
                  setAskOpen(true);
                  setAskAnswer("");
                }}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800"
              >
                Ask AI
              </button>
            </div>
          </section>
        )}

        {askOpen && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Ask AI (English)</h3>
                <button onClick={() => setAskOpen(false)} className="text-slate-500">
                  ✕
                </button>
              </div>
              <textarea
                className="w-full border rounded-lg p-2 h-28"
                placeholder="Ask about procedures, surface prep, safety, overcoating windows..."
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={askAI}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800"
                >
                  Send
                </button>
                <button
                  onClick={() => {
                    setAskInput("");
                    setAskAnswer("");
                  }}
                  className="px-4 py-2 rounded-xl border"
                >
                  Clear
                </button>
              </div>
              {askAnswer && (
                <pre className="mt-3 whitespace-pre-wrap text-sm bg-slate-50 p-3 rounded-xl border">
                  {askAnswer}
                </pre>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="text-center text-xs text-slate-500 py-6">
        <div className="flex items-center justify-center gap-2">
          <ImageIcon className="w-4 h-4" />
          CorrosionBot • demo
        </div>
      </footer>
    </div>
  );
}
