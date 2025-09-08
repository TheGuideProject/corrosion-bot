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

  // upload logic
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

  // camera live preview
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      streamRef.current = stream;
      setCameraOpen(true);
    } catch (err) {
      alert("Camera error: " + err.message);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    setFiles(prev => [...prev, { file: null, dataUrl }]);
    closeCamera();
  };

  const closeCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  };

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
              <h2 className="font-semibold">Assistant Chat</h2>
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
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <input type="file" accept="image/*" multiple
                  onChange={(e) => handleFiles(e.target.files)}
                  className="block w-full text-sm" />
                <button type="button" onClick={startCamera}
                  className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm flex items-center gap-1">
                  <Camera className="w-4 h-4" /> Take Photo
                </button>
              </div>
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

          {/* Metadata a lato */}
          <aside className="space-y-4">
            {/* … lascia come già avevi, invariato … */}
          </aside>
        </section>

        {/* Camera modal */}
        {cameraOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl p-4 shadow-lg">
              <video ref={videoRef} autoPlay playsInline className="w-80 h-auto rounded-xl mb-3" />
              <div className="flex gap-2 justify-center">
                <button onClick={capturePhoto}
                  className="px-4 py-2 bg-green-600 text-white rounded-xl">Capture</button>
                <button onClick={closeCamera}
                  className="px-4 py-2 bg-red-600 text-white rounded-xl">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <section className="mt-8">
            <h2 className="font-semibold mb-3">Results</h2>
            {/* … risultato come già avevi … */}
            <button onClick={askFromResults}
              className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white">Ask AI</button>
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
