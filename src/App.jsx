import React, { useEffect, useState, useRef } from "react";
import { Upload, Trash2, Send, ImageIcon, ShieldCheck, Loader2, Camera } from "lucide-react";
import ReactMarkdown from "react-markdown";

const MAX_FILES = 5;
const STORAGE_KEY = "corrosionbot_chat_history_v1";

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

  // chat persistente
  const [chatOpen, setChatOpen] = useState(true);
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  const sendChat = async () => {
    if (!input.trim()) return;
    const next = [...messages, { role: "user", content: input.trim() }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const resp = await fetch("/.netlify/functions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, meta, lastResult: result }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      setMessages([...next, { role: "assistant", content: json.answer || "" }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setSending(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  // upload
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

  // fotocamera con anteprima live
  const [cameraOpen, setCameraOpen] = useState(false);
  const [camError, setCamError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  async function getStreamWithFallback() {
    // 1) prova posteriore
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch {}
    // 2) prova senza facingMode
    try {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (err) {
      throw err;
    }
  }

  const startCamera = async () => {
    setCamError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API not supported in this browser.");
      }
      const stream = await getStreamWithFallback();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // iOS: serve loadedmetadata prima di play, con playsInline + muted
        await new Promise((resolve) => {
          const onLoaded = () => { videoRef.current.removeEventListener("loadedmetadata", onLoaded); resolve(); };
          videoRef.current.addEventListener("loadedmetadata", onLoaded);
        });
        await videoRef.current.play().catch(() => {}); // in caso iOS sia schizzinoso
      }
      setCameraOpen(true);
    } catch (err) {
      setCamError(err.message || String(err));
      setCameraOpen(true); // mostriamo il modal comunque, con l’errore
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCamError("Camera not ready. Wait a moment and try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    // riduci a 1280 max per non generare mostri
    const maxW = 1280;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png"); // "image/png" va benissimo per il backend
    if (!dataUrl.startsWith("data:image/")) {
      setCamError("Capture failed.");
      return;
    }
    setFiles((prev) => [...prev, { file: null, dataUrl }]);
    closeCamera();
  };

  const closeCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
    setCamError("");
  };

  useEffect(() => {
    // cleanup se il componente viene smontato con camera aperta
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

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

  const askFromResults = () => {
    setChatOpen(true);
    if (!input) setInput("Can you summarize the recommended cycle and surface prep steps?");
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight">
          CorrosionBot <span className="text-slate-500">(demo)</span>
        </h1>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24">
        {/* Chat persistente */}
        <section className="mb-6">
          <div className="bg-white border rounded-2xl shadow-sm">
            <div className="flex items-center justify-between p-4">
              <h2 className="font-semibold">Assistant Chat (English)</h2>
              <div className="flex gap-2">
                <button onClick={() => setChatOpen(!chatOpen)} className="text-sm underline">
                  {chatOpen ? "Hide" : "Show"}
                </button>
                <button onClick={clearChat} className="text-sm underline text-slate-600">
                  Clear
                </button>
              </div>
            </div>
            {chatOpen && (
              <div className="px-4 pb-4">
                <div className="h-48 overflow-auto border rounded-xl p-3 bg-slate-50 prose prose-sm">
                  {messages.length === 0 && <p className="text-sm text-slate-500">Start a conversation…</p>}
                  {messages.map((m, i) => (
                    <div key={i} className={`mb-2 ${m.role === "assistant" ? "" : "text-right"}`}>
                      <div className={`inline-block px-3 py-2 rounded-xl text-sm max-w-[90%] ${
                        m.role === "assistant" ? "bg-white border text-left" : "bg-slate-900 text-white text-right"
                      }`}>
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    className="flex-1 border rounded-xl px-3 py-2 text-sm"
                    placeholder="Ask the assistant..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendChat()}
                  />
                  <button
                    onClick={sendChat}
                    disabled={sending}
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white"
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Upload + Metadata */}
        <section className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
              className="border-2 border-dashed border-slate-300 rounded-2xl p-6 bg-white shadow-sm">
              <div className="flex items-center gap-3">
                <Upload className="w-5 h-5" />
                <div>
                  <p className="font-medium">Upload or Take Photos</p>
                  <p className="text-xs text-slate-500">Max {MAX_FILES} files, 6 MB each</p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleFiles(e.target.files)}
                  className="block w-full text-sm"
                />
                <button type="button" onClick={startCamera}
                  className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm flex items-center gap-1">
                  <Camera className="w-4 h-4" /> Take Photo
                </button>
              </div>

              {/* Anteprima live camera */}
              {cameraOpen && (
                <div className="mt-4 border rounded-2xl p-3 bg-slate-50">
                  {camError ? (
                    <p className="text-sm text-red-600">{camError}</p>
                  ) : (
                    <>
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full max-w-md rounded-xl border mx-auto"
                      />
                      <div className="flex gap-2 justify-center mt-3">
                        <button onClick={capturePhoto} className="px-4 py-2 bg-green-600 text-white rounded-xl">Capture</button>
                        <button onClick={closeCamera} className="px-4 py-2 bg-red-600 text-white rounded-xl">Cancel</button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {files.length > 0 && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                  {files.map((f, i) => (
                    <div key={i} className="relative group">
                      <img src={f.dataUrl} alt={`upload-${i}`}
                        className="w-full h-32 object-cover rounded-xl border" />
                      <button onClick={() => removeAt(i)}
                        className="absolute top-2 right-2 bg-white/90 rounded-full p-1 shadow">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Metadata */}
          <aside className="space-y-4">
            <div className="bg-white border rounded-2xl p-4 shadow-sm">
              <h2 className="font-semibold mb-3">Metadata</h2>

              <label className="block text-sm mb-2">Location</label>
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
                <option>Hatch Covers</option>
                <option>Cargo Holds Dry</option>
                <option>Internal Visible Steel</option>
                <option>Internal Decks</option>
                <option>Fresh/Drinking Water Tank</option>
                <option>Heat Resistance</option>
              </select>

              <label className="block text-sm mb-2">Environment</label>
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
                Experimental support tool. Always confirm with inspection and PPG TDS.
              </p>
            </div>
          </aside>
        </section>

        {/* Results */}
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
                      <div className="mt-2 p-3 bg-slate-50 rounded-2xl border">
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
              <button onClick={askFromResults} className="px-4 py-2 rounded-xl bg-slate-900 text-white">
                Ask AI
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="text-center text-xs text-slate-500 py-6">
        <div className="flex items-center justify-center gap-2">
          <ImageIcon className="w-4 h-4" /> CorrosionBot • demo
        </div>
      </footer>
    </div>
  );
}

