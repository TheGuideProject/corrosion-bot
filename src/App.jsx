import React, { useEffect, useState } from "react";
import { Upload, Trash2, Send, ImageIcon, ShieldCheck, Loader2 } from "lucide-react";
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

  // --- chat persistente ---
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

  // --- upload logic ---
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
        <p className="text-sm text-slate-600 mt-1">
          Experimental support tool. Does not replace certified inspectors.
        </p>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24">
        {/* --- Chat persistente --- */}
        <section className="mb-6">
          <div className="bg-white border rounded-2xl shadow-sm">
            <div className="flex items-center justify-between p-4">
              <h2 className="font-semibold">Assistant Chat (English)</h2>
              <div className="flex items-center gap-2">
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
                  {messages.length === 0 && (
                    <p className="text-sm text-slate-500">Start a conversation...</p>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} className={`mb-2 ${m.role === "assistant" ? "" : "text-right"}`}>
                      <div className={`inline-block px-3 py-2 rounded-xl text-sm max-w-[90%] ${m.role === "assistant" ? "bg-white border text-left" : "bg-slate-900 text-white text-right"}`}>
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
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800"
                  >
                    {sending ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* --- Upload + Metadata (uguale a prima) --- */}
        {/* ... qui rimane invariato, per brevità lo lascio fuori ... */}

        {/* --- Results --- */}
        {result && (
          <section className="mt-8">
            <h2 className="font-semibold mb-3">Results</h2>
            <p className="text-xs text-slate-500">
              Estimated environment: <b>{result?.meta?.estimatedEnv || "-"}</b> · Used for rules:{" "}
              <b>{result?.meta?.effectiveEnv || "-"}</b>
            </p>
            {/* risultati come prima */}
            <div className="mt-4">
              <button
                onClick={askFromResults}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800"
              >
                Ask AI
              </button>
            </div>
          </section>
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
