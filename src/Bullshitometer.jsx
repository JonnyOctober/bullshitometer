import { useState, useRef, useEffect } from "react";

// ---------- makeshift brand tokens (matches tools.makeshift.so) ----------
const T = {
  bg: "#F2EDE0", // paper-warm — page
  panel: "#FBF9F3", // card
  topbar: "#16130C", // dark header
  line: "#D8D2C2", // hairline rule
  ink: "#14110B",
  inkSoft: "#46412F",
  dim: "#8A8265", // muted
  amber: "#C8870F", // accent
  // gauge zone colors — semantic, tuned to read on cream
  solid: "#2F9E5E",
  stretch: "#C9A012",
  dubious: "#D2691E",
  bs: "#C0392B",
  serif: "'Fraunces', Georgia, 'Times New Roman', serif",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
};

const RATINGS = {
  solid: { label: "SOLID", color: T.solid },
  stretch: { label: "STRETCH", color: T.stretch },
  dubious: { label: "DUBIOUS", color: T.dubious },
  bullshit: { label: "BULLSHIT", color: T.bs },
};

function ratingFor(score) {
  if (score < 25) return RATINGS.solid;
  if (score < 50) return RATINGS.stretch;
  if (score < 75) return RATINGS.dubious;
  return RATINGS.bullshit;
}

// ---------- image handling ----------
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_DIM = 2000; // downscale long edge above this to keep payload/tokens sane
const MAX_IMAGES = 8;

// Model tiers (map to Haiku / Sonnet / Opus on the server).
const TIER_OPTIONS = [
  { id: "fast", label: "Fast" },
  { id: "balanced", label: "Balanced" },
  { id: "thorough", label: "Thorough" },
];

// Status lines shown while an analysis runs. Opener is fixed; the rest are
// shuffled each run (pipeline stages + personality) so they all get airtime.
const LOADING_OPENER = "Reading the material…";
const LOADING_POOL = [
  "I am a bloodhound…",
  "Pulling any linked sources…",
  "Sussing the truthiness…",
  "Searching the record…",
  "Is that true, you rascal?",
  "Cross-referencing claims…",
  "Sniffing for nonsense…",
  "Anthropomorphizing…",
  "*Sniff* *Sniff* *Sniff*",
  "What do we have here?",
  "You crazy for this one, Ye",
  "Not now Mom! I'm busy!",
  "Bruh",
  "Time is a flat circle",
  "Weighing the evidence…",
  "Scoring each claim…",
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      reject(new Error("Use PNG, JPEG, GIF, or WebP images."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load image."));
      img.onload = () => {
        const long = Math.max(img.width, img.height);
        if (long <= MAX_DIM || file.type === "image/gif") {
          resolve({
            media_type: file.type,
            data: dataUrl.split(",")[1],
            preview: dataUrl,
            name: file.name || "image",
          });
          return;
        }
        const scale = MAX_DIM / long;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const outType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const outUrl = canvas.toDataURL(outType, 0.92);
        resolve({
          media_type: outType,
          data: outUrl.split(",")[1],
          preview: outUrl,
          name: file.name || "image",
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- gauge ----------
function Gauge({ score, analyzing }) {
  const angle = score === null ? -90 : (score / 100) * 180 - 90;
  const r = 130;
  const cx = 160;
  const cy = 150;

  const polar = (deg, radius) => {
    const rad = ((deg - 180) * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };
  const arcPath = (startDeg, endDeg, radius) => {
    const [x1, y1] = polar(startDeg, radius);
    const [x2, y2] = polar(endDeg, radius);
    return `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`;
  };

  const ticks = [];
  for (let i = 0; i <= 10; i++) {
    const deg = (i / 10) * 180;
    const rad = ((deg - 180) * Math.PI) / 180;
    const major = i % 5 === 0;
    const r1 = r - (major ? 16 : 9);
    const r2 = r - 2;
    ticks.push(
      <line
        key={i}
        x1={cx + r1 * Math.cos(rad)}
        y1={cy + r1 * Math.sin(rad)}
        x2={cx + r2 * Math.cos(rad)}
        y2={cy + r2 * Math.sin(rad)}
        stroke={major ? T.ink : T.dim}
        strokeWidth={major ? 2 : 1}
        opacity={major ? 0.8 : 0.45}
      />
    );
  }

  return (
    <div style={{ position: "relative", width: 320, margin: "0 auto" }}>
      <style>{`
        @keyframes sweep {
          0% { transform: rotate(-80deg); }
          50% { transform: rotate(80deg); }
          100% { transform: rotate(-80deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .needle { transition: none !important; animation: none !important; }
        }
      `}</style>
      <svg width="320" height="180" viewBox="0 0 320 180">
        <path d={arcPath(0, 45, r)} fill="none" stroke={T.solid} strokeWidth="6" strokeLinecap="round" />
        <path d={arcPath(45, 90, r)} fill="none" stroke={T.stretch} strokeWidth="6" strokeLinecap="round" />
        <path d={arcPath(90, 135, r)} fill="none" stroke={T.dubious} strokeWidth="6" strokeLinecap="round" />
        <path d={arcPath(135, 180, r)} fill="none" stroke={T.bs} strokeWidth="6" strokeLinecap="round" />
        {ticks}
        <g
          className="needle"
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            transform: `rotate(${angle}deg)`,
            transition: "transform 1.4s cubic-bezier(.2,.9,.25,1)",
            animation: analyzing ? "sweep 1.6s ease-in-out infinite" : "none",
          }}
        >
          <line x1={cx} y1={cy} x2={cx} y2={cy - r + 26} stroke={T.ink} strokeWidth="3" strokeLinecap="round" />
          <line x1={cx} y1={cy} x2={cx} y2={cy + 14} stroke={T.dim} strokeWidth="3" opacity="0.5" />
        </g>
        <circle cx={cx} cy={cy} r="7" fill={T.panel} stroke={T.amber} strokeWidth="2.5" />
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: T.mono,
          fontSize: 10,
          letterSpacing: "0.12em",
          color: T.dim,
          padding: "2px 6px 0",
        }}
      >
        <span style={{ color: T.solid }}>SOLID</span>
        <span style={{ color: T.bs }}>BULLSHIT</span>
      </div>
    </div>
  );
}

// ---------- claim row ----------
function ClaimRow({ c }) {
  const [open, setOpen] = useState(false);
  const r = RATINGS[c.rating] || ratingFor(c.score);
  return (
    <div style={{ borderBottom: `1px solid ${T.line}` }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          padding: "14px 4px",
          cursor: "pointer",
          color: T.ink,
          fontFamily: T.sans,
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        <span
          style={{
            flexShrink: 0,
            fontFamily: T.mono,
            fontSize: 10,
            letterSpacing: "0.1em",
            color: r.color,
            border: `1px solid ${r.color}`,
            borderRadius: 3,
            padding: "3px 7px",
            minWidth: 72,
            textAlign: "center",
          }}
        >
          {r.label}
        </span>
        <span style={{ flex: 1 }}>{c.claim}</span>
        <span style={{ color: T.dim, fontSize: 14, flexShrink: 0 }}>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 4px 16px 90px", fontSize: 13, lineHeight: 1.65, color: T.inkSoft }}>
          <p style={{ margin: "0 0 10px", color: T.ink }}>{c.analysis}</p>
          {c.evidence && (
            <p style={{ margin: 0 }}>
              <span style={{ fontFamily: T.mono, color: T.amber, fontSize: 10, letterSpacing: "0.1em" }}>
                EVIDENCE{" "}
              </span>
              {c.evidence}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- main ----------
export default function Bullshitometer() {
  const [input, setInput] = useState("");
  const [images, setImages] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [tier, setTier] = useState("balanced");
  const [step, setStep] = useState(0);
  const [seq, setSeq] = useState([LOADING_OPENER]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const resultsRef = useRef(null);
  const fileInputRef = useRef(null);

  // On each run: opener first, then a fresh shuffle. Advance every 3s, hold last.
  useEffect(() => {
    if (!loading) return;
    const order = [LOADING_OPENER, ...shuffle(LOADING_POOL)];
    setSeq(order);
    setStep(0);
    const id = setInterval(
      () => setStep((s) => Math.min(s + 1, order.length - 1)),
      5000
    );
    return () => clearInterval(id);
  }, [loading]);

  const hasContent = input.trim().length > 0 || images.length > 0;

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setError(null);
    try {
      const parts = await Promise.all(files.map(readImageFile));
      setImages((prev) =>
        [
          ...prev,
          ...parts.map((p) => ({ ...p, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` })),
        ].slice(0, MAX_IMAGES)
      );
    } catch (e) {
      setError(e.message || "Could not add that image.");
    }
  };

  const removeImage = (id) => setImages((prev) => prev.filter((i) => i.id !== id));

  const onPaste = (e) => {
    const files = e.clipboardData?.files;
    if (files && files.length) {
      const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (imgs.length) {
        e.preventDefault();
        addFiles(imgs);
      }
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer?.files);
  };

  const analyze = async () => {
    if (!hasContent || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: input,
          tier,
          images: images.map(({ media_type, data }) => ({ media_type, data })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Analysis failed.");
      setResult(data);
      setTimeout(
        () => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        300
      );
    } catch (e) {
      setError(e.message || "Analysis failed.");
    } finally {
      setLoading(false);
    }
  };

  const r = result ? ratingFor(result.overall_score) : null;

  const meta = [];
  if (input.length > 0) meta.push(`${input.length.toLocaleString()} chars`);
  if (images.length > 0) meta.push(`${images.length} image${images.length > 1 ? "s" : ""}`);
  const statusLabel = meta.join(" · ");

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.sans }}>
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style>{`
        .bs-progress {
          position: relative; height: 3px; width: 200px; margin: 12px auto 0;
          background: rgba(20,17,11,0.08); border-radius: 2px; overflow: hidden;
        }
        .bs-progress > span {
          position: absolute; top: 0; height: 100%; width: 40%;
          background: ${T.amber}; border-radius: 2px;
          animation: bsslide 1.4s ease-in-out infinite;
        }
        @keyframes bsslide { 0% { left: -42%; } 100% { left: 100%; } }
        @media (prefers-reduced-motion: reduce) {
          .bs-progress > span { animation: none; left: 0; width: 100%; opacity: 0.5; }
        }
        @media (max-width: 560px) {
          .bs-bottombar { flex-direction: column; align-items: stretch !important; gap: 12px; }
          .bs-left { justify-content: space-between; }
          .bs-right { flex-direction: column; align-items: stretch !important; gap: 10px; width: 100%; }
          .bs-tiers { width: 100%; }
          .bs-tierbtn { flex: 1 1 0; }
          .bs-run { width: 100%; }
        }
      `}</style>

      {/* brand topbar (matches the hub) */}
      <header style={{ background: T.topbar, color: "#fff" }}>
        <div
          style={{
            maxWidth: 760,
            margin: "0 auto",
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
          }}
        >
          <a
            href="https://tools.makeshift.so"
            style={{ fontFamily: T.serif, fontSize: 17, fontWeight: 500, color: "#fff", textDecoration: "none", letterSpacing: "-0.01em" }}
          >
            makeshift <span style={{ fontWeight: 400, opacity: 0.6 }}>/ tools</span>
          </a>
          <a
            href="https://tools.makeshift.so"
            style={{
              fontFamily: T.mono,
              fontSize: 11,
              color: "rgba(255,255,255,0.6)",
              textDecoration: "none",
              letterSpacing: "0.04em",
            }}
          >
            ← all tools
          </a>
        </div>
      </header>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "44px 20px 80px" }}>
        {/* header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: "0.22em", color: T.amber, marginBottom: 10, textTransform: "uppercase" }}>
            Claim Analysis Instrument
          </div>
          <h1 style={{ fontFamily: T.serif, fontSize: 40, fontWeight: 500, letterSpacing: "-0.02em", margin: 0, color: T.ink }}>
            Bullshitometer
          </h1>
        </div>

        {/* gauge */}
        <Gauge score={result ? result.overall_score : null} analyzing={loading} />
        <div style={{ textAlign: "center", minHeight: 70, marginTop: 12 }}>
          {loading && (
            <div>
              <div style={{ color: T.inkSoft, fontSize: 13 }}>{seq[step] || LOADING_OPENER}</div>
              <div className="bs-progress">
                <span />
              </div>
            </div>
          )}
          {result && !loading && (
            <>
              <div style={{ fontFamily: T.serif, fontSize: 44, fontWeight: 600, color: r.color, lineHeight: 1.1 }}>
                {result.overall_score}
                <span style={{ fontFamily: T.mono, fontSize: 13, color: T.dim }}> /100</span>
              </div>
              <div style={{ fontSize: 15, color: T.ink, marginTop: 6 }}>{result.verdict}</div>
            </>
          )}
          {!result && !loading && (
            <div style={{ color: T.dim, fontSize: 13 }}>Awaiting sample.</div>
          )}
        </div>

        {/* input */}
        <div
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          style={{
            background: T.panel,
            border: `1px solid ${dragging ? T.amber : T.line}`,
            borderRadius: 10,
            padding: 16,
            marginTop: 24,
            transition: "border-color 0.15s",
          }}
        >
          {images.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {images.map((img) => (
                <div
                  key={img.id}
                  style={{
                    position: "relative",
                    width: 64,
                    height: 64,
                    borderRadius: 6,
                    overflow: "hidden",
                    border: `1px solid ${T.line}`,
                  }}
                >
                  <img
                    src={img.preview}
                    alt={img.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                  <button
                    onClick={() => removeImage(img.id)}
                    title="Remove"
                    style={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      width: 18,
                      height: 18,
                      lineHeight: "15px",
                      textAlign: "center",
                      borderRadius: 9,
                      border: "none",
                      background: "rgba(0,0,0,0.55)",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: 13,
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            placeholder="Paste text, a link, or drop in a screenshot…"
            rows={7}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "vertical",
              color: T.ink,
              fontFamily: T.sans,
              fontSize: 14,
              lineHeight: 1.6,
            }}
          />
          <div className="bs-bottombar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
            <div className="bs-left" style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: "none",
                  border: `1px solid ${T.line}`,
                  borderRadius: 6,
                  color: T.inkSoft,
                  padding: "6px 12px",
                  fontFamily: T.mono,
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  cursor: "pointer",
                }}
              >
                + IMAGE
              </button>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>{statusLabel}</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="bs-right" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="bs-tiers" style={{ display: "flex", border: `1px solid ${T.line}`, borderRadius: 6, overflow: "hidden" }}>
                {TIER_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    className="bs-tierbtn"
                    onClick={() => setTier(o.id)}
                    title={`${o.label} model`}
                    style={{
                      background: tier === o.id ? T.amber : "transparent",
                      color: tier === o.id ? "#FBF9F3" : T.dim,
                      border: "none",
                      padding: "7px 11px",
                      fontFamily: T.mono,
                      fontSize: 10,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <button
                className="bs-run"
                onClick={analyze}
                disabled={loading || !hasContent}
                style={{
                  background: loading || !hasContent ? T.line : T.amber,
                  color: loading || !hasContent ? T.dim : "#FBF9F3",
                  border: "none",
                  borderRadius: 6,
                  padding: "10px 22px",
                  fontFamily: T.mono,
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: "0.08em",
                  cursor: loading || !hasContent ? "default" : "pointer",
                }}
              >
                {loading ? "ANALYZING…" : "RUN ANALYSIS"}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 16px",
              border: `1px solid ${T.bs}`,
              borderRadius: 8,
              color: T.bs,
              fontSize: 13,
              background: "#fbecea",
            }}
          >
            {error}
          </div>
        )}

        {/* results */}
        {result && (
          <div ref={resultsRef} style={{ marginTop: 36 }}>
            <p style={{ fontSize: 15, lineHeight: 1.7, color: T.inkSoft, marginBottom: 24 }}>{result.summary}</p>
            <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: "0.18em", color: T.amber, marginBottom: 8, textTransform: "uppercase" }}>
              Claim by claim
            </div>
            <div style={{ borderTop: `1px solid ${T.line}` }}>
              {(result.claims || []).map((c, i) => (
                <ClaimRow key={i} c={c} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
