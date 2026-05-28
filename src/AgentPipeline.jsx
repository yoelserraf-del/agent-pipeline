import { useState, useEffect } from "react";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────
const C = {
  bg: "#0a0a0b", card: "#141416", cardHover: "#1a1a1d", border: "#26262b",
  text: "#f4f4f5", muted: "#71717a", mutedLight: "#a1a1aa",
  accent: "#facc15", accentDark: "#ca8a04",
  success: "#4ade80", info: "#60a5fa", warning: "#fb923c",
  danger: "#f87171", purple: "#c084fc", cyan: "#22d3ee",
};

const STAGES = [
  { id: "prospects", label: "Prospects",   color: C.muted,    desc: "Researched, not contacted" },
  { id: "pitched",   label: "Pitched",     color: C.info,     desc: "Sent initial cold email" },
  { id: "interested",label: "Interested",  color: C.purple,   desc: "Replied yes — build site" },
  { id: "feedback",  label: "Feedback",    color: C.warning,  desc: "Client reviewing draft" },
  { id: "review",    label: "Your Review", color: C.danger,   desc: "Awaiting your approval", alert: true },
  { id: "approved",  label: "Approved",    color: C.success,  desc: "Sent for final yes + payment" },
  { id: "live",      label: "Live",        color: C.cyan,     desc: "Paid and published" },
];

const BUSINESS_TYPES = [
  "Restaurant", "Café", "Bar", "Bakery", "Law Firm", "Dental", "Medical",
  "Real Estate", "Salon / Barber", "Gym", "Auto Shop", "Construction",
  "Retail", "Consulting", "Other",
];

// ─── STORAGE (localStorage — persists across sessions) ────────────────────
function loadLeads() {
  try { const r = localStorage.getItem("pipeline-leads-v2"); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function saveLeads(leads) {
  try { localStorage.setItem("pipeline-leads-v2", JSON.stringify(leads)); return true; }
  catch { return false; }
}
function loadSettings() {
  try { const r = localStorage.getItem("pipeline-settings-v1"); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}
function saveSettings(s) {
  try { localStorage.setItem("pipeline-settings-v1", JSON.stringify(s)); return true; }
  catch { return false; }
}

// ─── AI HELPERS ───────────────────────────────────────────────────────────
async function callClaude(prompt, apiKey, maxTokens = 1200) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("No Claude API key — add it in ⚙ Settings.");
  }
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey.trim(),
        "anthropic-version": "2023-06-01",
        // Required header for direct browser access to the Anthropic API
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (netErr) {
    throw new Error("Network error: " + netErr.message);
  }
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error("API error: " + msg);
  }
  const text = data.content?.find?.((b) => b.type === "text")?.text || "";
  if (!text) throw new Error("API returned an empty response.");
  return text;
}

async function generatePitchEmail(lead, settings) {
  const payment = settings.venmo
    ? `Venmo: @${settings.venmo}`
    : settings.zelle
    ? `Zelle: ${settings.zelle}`
    : "";
  return callClaude(
    `Write a short punchy cold email pitching a website to this business owner. Under 120 words.

Business: ${lead.businessName}, ${lead.businessType}, ${lead.location || ""}
Current site: ${lead.websiteStatus || "none"}
Price: $${lead.proposedPrice}
Your name: ${settings.yourName || "[YOUR NAME]"}
${payment ? `Payment: ${payment}` : ""}

Rules:
- One specific observation about this business type needing web presence
- Mention a free preview at [DRAFT_LINK]
- Soft price: "starting at $${lead.proposedPrice}"
- End with "Worth a look?" or similar
- Sign off as ${settings.yourName || "[YOUR NAME]"}
- NO "I hope this email finds you well"
- NO subject line — body only

Output ONLY the email body.`,
    settings.claudeKey,
    1000
  );
}

async function researchLeads(city, type, count, apiKey) {
  const raw = await callClaude(
    `Generate ${count} realistic small business leads in ${city} that are: ${type}.
These should likely have NO website or a very outdated one (pre-2018 design).

Return ONLY a JSON array. No markdown, no backticks, no explanation.
Each object must have exactly these fields:
{
  "businessName": string,
  "businessType": "${type}",
  "location": "${city}",
  "phone": string,
  "email": string,
  "websiteStatus": "none" | "outdated",
  "description": string,
  "services": string,
  "notes": string
}`,
    apiKey,
    2000
  );
  try {
    const clean = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    return JSON.parse(clean);
  } catch {
    throw new Error("Could not parse lead suggestions. Try again.");
  }
}

async function generateWebsite(lead, settings, withFeedback = false) {
  const feedbackLine =
    withFeedback && lead.feedback
      ? `\n\nCRITICAL — Apply this client feedback:\n"${lead.feedback}"\n`
      : "";
  const html = await callClaude(
    `You are an expert web designer. Build a complete beautiful single-page website as raw HTML.

Business:
- Name: ${lead.businessName}
- Type: ${lead.businessType}
- Location: ${lead.location || ""}
- Phone: ${lead.phone || ""}
- Email: ${lead.email || ""}
- Description: ${lead.description || `A ${lead.businessType}`}
- Services: ${lead.services || ""}${feedbackLine}

REQUIREMENTS:
1. Return ONLY a full HTML document. No markdown, no backticks.
2. All CSS in a <style> tag.
3. Design that fits this business type perfectly.
4. Google Fonts via @import.
5. Sections: Hero, About, Services, Contact/Footer.
6. Fully responsive.
7. Realistic placeholder content.
8. CSS animations on load.
9. Pure HTML+CSS only — no JS required.

Start with <!DOCTYPE html>`,
    settings.claudeKey,
    8000  // websites need more tokens
  );
  return html.replace(/^```html\s*/i, "").replace(/```\s*$/, "").trim();
}

// ─── RESEND EMAIL ─────────────────────────────────────────────────────────
async function sendViaResend(resendKey, from, to, subject, body) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${body}</pre>`,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || "Resend error");
  return data.id;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
function makeLead(input) {
  return {
    id: uid(),
    stage: "prospects",
    businessName: input.businessName || "",
    businessType: input.businessType || "Restaurant",
    location: input.location || "",
    phone: input.phone || "",
    email: input.email || "",
    website: input.website || "",
    websiteStatus: input.websiteStatus || "none",
    description: input.description || "",
    services: input.services || "",
    notes: input.notes || "",
    proposedPrice: input.proposedPrice || 400,
    draftHTML: "",
    finalHTML: "",
    pitchEmail: "",
    feedback: "",
    history: [{ ts: now(), action: "Created" }],
  };
}
function stageMeta(id) { return STAGES.find((s) => s.id === id) || STAGES[0]; }

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────
function Btn({ children, onClick, variant = "default", disabled, style = {}, size = "md" }) {
  const vs = {
    default: { background: "transparent", color: C.text,    border: `1px solid ${C.border}` },
    primary: { background: C.accent,       color: "#0a0a0b", border: "none", fontWeight: 700 },
    success: { background: C.success,      color: "#0a0a0b", border: "none", fontWeight: 700 },
    danger:  { background: "transparent",  color: C.danger,  border: `1px solid ${C.danger}40` },
    ghost:   { background: "transparent",  color: C.muted,   border: "none" },
    info:    { background: C.info + "22",  color: C.info,    border: `1px solid ${C.info}44` },
  };
  const ss = {
    sm: { padding: "5px 10px", fontSize: "12px" },
    md: { padding: "8px 14px", fontSize: "13px" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...vs[variant], ...ss[size],
        borderRadius: "6px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "all 0.15s",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function Input({ value, onChange, placeholder, type = "text", style = {} }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%",
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: "6px",
        padding: "9px 11px",
        color: C.text,
        fontSize: "13px",
        fontFamily: "inherit",
        outline: "none",
        boxSizing: "border-box",
        ...style,
      }}
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: "100%",
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: "6px",
        padding: "9px 11px",
        color: C.text,
        fontSize: "13px",
        fontFamily: "inherit",
        outline: "none",
        resize: "vertical",
        boxSizing: "border-box",
      }}
    />
  );
}

function Label({ children }) {
  return (
    <div style={{
      fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em",
      textTransform: "uppercase", color: C.muted, marginBottom: "5px",
    }}>
      {children}
    </div>
  );
}

function Pill({ color, children }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: "4px",
      background: `${color}1a`, color, border: `1px solid ${color}33`,
      fontSize: "10px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase",
    }}>
      {children}
    </span>
  );
}

function Section({ title, children, accent, style = {} }) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${accent ? accent + "66" : C.border}`,
      borderRadius: "12px", padding: "18px", marginBottom: "14px", ...style,
    }}>
      <div style={{
        fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em",
        textTransform: "uppercase", color: accent || C.muted, marginBottom: "12px",
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function BusyBar({ msg }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.accent}66`,
      borderRadius: "8px", padding: "12px 16px", marginBottom: "16px",
      display: "flex", alignItems: "center", gap: "10px",
    }}>
      <div style={{
        width: "14px", height: "14px",
        border: `2px solid ${C.border}`, borderTop: `2px solid ${C.accent}`,
        borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0,
      }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ fontSize: "13px", color: C.accent }}>{msg}</span>
    </div>
  );
}

function ErrorBar({ msg, onClose }) {
  if (!msg) return null;
  return (
    <div style={{
      background: C.danger + "1a", border: `1px solid ${C.danger}66`,
      borderRadius: "8px", padding: "12px 16px", marginBottom: "16px",
      display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px",
    }}>
      <div style={{ fontSize: "13px", color: C.danger, lineHeight: 1.5, wordBreak: "break-word" }}>
        {msg}
      </div>
      <button
        onClick={onClose}
        style={{ background: "transparent", border: "none", color: C.danger, cursor: "pointer", fontSize: "16px", padding: 0, lineHeight: 1 }}
      >
        ✕
      </button>
    </div>
  );
}

// ─── SETTINGS PANEL ───────────────────────────────────────────────────────
function SettingsPanel({ settings, onSave, onClose }) {
  const [s, setS] = useState({ ...settings });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const u = (k, v) => setS((p) => ({ ...p, [k]: v }));

  const testAPI = async () => {
    setTesting(true); setTestResult(null);
    try {
      const reply = await callClaude("Reply with just the word: WORKING", s.claudeKey, 20);
      setTestResult({ ok: true, msg: "✓ Claude API works! Reply: " + reply.trim().slice(0, 40) });
    } catch (e) {
      setTestResult({ ok: false, msg: "✗ " + e.message });
    }
    setTesting(false);
  };

  const handleSave = () => {
    const ok = onSave(s);
    if (ok !== false) {
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 1000);
    } else {
      setTestResult({ ok: false, msg: "✗ Could not save — storage full?" });
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "20px" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px", maxWidth: "480px", width: "100%", maxHeight: "90vh", overflow: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>Settings</h2>
          <Btn variant="ghost" size="sm" onClick={onClose}>✕</Btn>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

          {/* Claude API Key — must be first, it's the most important */}
          <div style={{ background: C.bg, border: `1px solid ${C.accent}66`, borderRadius: "8px", padding: "14px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: C.accent, marginBottom: "8px" }}>
              🔑 Claude API Key (required for all AI features)
            </div>
            <div style={{ fontSize: "11px", color: C.muted, marginBottom: "10px", lineHeight: 1.6 }}>
              Get yours free at{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" style={{ color: C.cyan }}>
                console.anthropic.com
              </a>
              . Stored only in your browser.
            </div>
            <Input
              value={s.claudeKey || ""}
              onChange={(v) => u("claudeKey", v)}
              placeholder="sk-ant-api03-..."
              type="password"
            />
          </div>

          <div><Label>Your Name / Brand</Label><Input value={s.yourName || ""} onChange={(v) => u("yourName", v)} placeholder="SerrafWeb Agency" /></div>
          <div><Label>Your Email (send from)</Label><Input value={s.fromEmail || ""} onChange={(v) => u("fromEmail", v)} placeholder="hello@yourdomain.com" /></div>

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "14px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: C.info, marginBottom: "10px" }}>📧 Resend Integration</div>
            <div style={{ fontSize: "12px", color: C.muted, marginBottom: "10px", lineHeight: 1.6 }}>
              Get your API key at{" "}
              <a href="https://resend.com" target="_blank" rel="noopener" style={{ color: C.cyan }}>resend.com</a>{" "}
              (free — 100 emails/day)
            </div>
            <div><Label>Resend API Key</Label><Input value={s.resendKey || ""} onChange={(v) => u("resendKey", v)} placeholder="re_xxxxxxxxxxxxxxxx" /></div>
          </div>

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "14px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: C.accent, marginBottom: "10px" }}>💸 Payment</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div><Label>Venmo Handle</Label><Input value={s.venmo || ""} onChange={(v) => u("venmo", v)} placeholder="your-handle" /></div>
              <div><Label>Zelle (phone/email)</Label><Input value={s.zelle || ""} onChange={(v) => u("zelle", v)} placeholder="555-000-0000" /></div>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "14px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: C.purple, marginBottom: "10px" }}>🔧 Test Connection</div>
            <Btn onClick={testAPI} disabled={testing || !s.claudeKey} style={{ width: "100%" }}>
              {testing ? "Testing..." : "🧪 Test Claude API Connection"}
            </Btn>
            {testResult && (
              <div style={{
                marginTop: "10px", padding: "10px 12px",
                background: testResult.ok ? C.success + "1a" : C.danger + "1a",
                border: `1px solid ${testResult.ok ? C.success : C.danger}66`,
                borderRadius: "6px",
                color: testResult.ok ? C.success : C.danger,
                fontSize: "12px", lineHeight: 1.5, wordBreak: "break-word",
              }}>
                {testResult.msg}
              </div>
            )}
          </div>

          <Btn variant="primary" onClick={handleSave} style={{ marginTop: "8px", padding: "11px" }}>
            {saved ? "✓ Saved!" : "Save Settings"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── RESEARCH MODAL ───────────────────────────────────────────────────────
function ResearchModal({ onClose, onAdd, settings }) {
  const [city, setCity] = useState("");
  const [type, setType] = useState("Restaurant");
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState("");

  const research = async () => {
    if (!city.trim()) return;
    setBusy(true); setError(""); setResults([]); setSelected(new Set());
    try {
      const leads = await researchLeads(city, type, count, settings.claudeKey);
      setResults(leads);
      setSelected(new Set(leads.map((_, i) => i)));
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const toggle = (i) => {
    const s = new Set(selected);
    s.has(i) ? s.delete(i) : s.add(i);
    setSelected(s);
  };

  const addSelected = () => {
    const leads = results
      .filter((_, i) => selected.has(i))
      .map((r) => makeLead({ ...r, proposedPrice: 400 }));
    onAdd(leads);
    onClose();
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "20px" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px", maxWidth: "600px", width: "100%", maxHeight: "90vh", overflow: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>🔍 Research Leads</h2>
          <Btn variant="ghost" size="sm" onClick={onClose}>✕</Btn>
        </div>

        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "12px", fontSize: "12px", color: C.muted, marginBottom: "16px", lineHeight: 1.6 }}>
          AI generates realistic targets. <strong style={{ color: C.warning }}>Verify contact details</strong> before emailing.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "12px", marginBottom: "16px" }}>
          <div>
            <Label>City / Area *</Label>
            <Input value={city} onChange={setCity} placeholder="Brooklyn, NY" />
          </div>
          <div>
            <Label>Business Type</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "9px 11px", color: C.text, fontSize: "13px", fontFamily: "inherit", outline: "none" }}
            >
              {BUSINESS_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <Label>How many</Label>
            <select
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value))}
              style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "9px 11px", color: C.text, fontSize: "13px", fontFamily: "inherit", outline: "none" }}
            >
              {[4, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <Btn
          variant="primary"
          onClick={research}
          disabled={!city.trim() || busy || !settings.claudeKey}
          style={{ width: "100%", padding: "11px", marginBottom: "16px" }}
        >
          {busy ? "Researching..." : !settings.claudeKey ? "Add API key in Settings first" : "Find Leads"}
        </Btn>

        {busy && <BusyBar msg={`Finding ${type}s in ${city}...`} />}
        {error && <div style={{ color: C.danger, fontSize: "13px", marginBottom: "12px", lineHeight: 1.5 }}>{error}</div>}

        {results.length > 0 && (
          <>
            <div style={{ fontSize: "11px", color: C.muted, marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Select leads to add ({selected.size} selected)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
              {results.map((r, i) => (
                <div
                  key={i}
                  onClick={() => toggle(i)}
                  style={{
                    background: selected.has(i) ? C.bg : C.card,
                    border: `1px solid ${selected.has(i) ? C.accent + "66" : C.border}`,
                    borderRadius: "8px", padding: "12px", cursor: "pointer",
                    display: "flex", gap: "12px", alignItems: "flex-start",
                  }}
                >
                  <div style={{
                    width: "16px", height: "16px", borderRadius: "4px",
                    border: `2px solid ${selected.has(i) ? C.accent : C.border}`,
                    background: selected.has(i) ? C.accent : "transparent",
                    flexShrink: 0, marginTop: "2px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "10px", color: "#0a0a0b", fontWeight: 700,
                  }}>
                    {selected.has(i) ? "✓" : ""}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "2px" }}>{r.businessName}</div>
                    <div style={{ fontSize: "12px", color: C.muted, marginBottom: "4px" }}>
                      {r.location} · {r.websiteStatus === "none" ? "No website" : "Outdated site"}
                    </div>
                    <div style={{ fontSize: "12px", color: C.mutedLight }}>{r.notes}</div>
                  </div>
                </div>
              ))}
            </div>
            <Btn
              variant="primary"
              onClick={addSelected}
              disabled={selected.size === 0}
              style={{ width: "100%", padding: "11px" }}
            >
              Add {selected.size} Lead{selected.size !== 1 ? "s" : ""} to Pipeline
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

// ─── ADD LEAD MODAL ───────────────────────────────────────────────────────
function AddLeadModal({ onClose, onAdd }) {
  const [mode, setMode] = useState("single");
  const [s, setS] = useState({
    businessName: "", businessType: "Restaurant", location: "",
    phone: "", email: "", website: "", websiteStatus: "none", proposedPrice: 400, notes: "",
  });
  const [bulk, setBulk] = useState("");
  const u = (k, v) => setS((p) => ({ ...p, [k]: v }));

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "20px" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px", maxWidth: "500px", width: "100%", maxHeight: "90vh", overflow: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>Add Lead Manually</h2>
          <Btn variant="ghost" size="sm" onClick={onClose}>✕</Btn>
        </div>
        <div style={{ display: "flex", gap: "6px", marginBottom: "20px", background: C.bg, padding: "4px", borderRadius: "8px" }}>
          {["single", "bulk"].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1, padding: "8px",
                background: mode === m ? C.card : "transparent",
                border: "none", borderRadius: "6px",
                color: mode === m ? C.text : C.muted,
                fontSize: "12px", fontWeight: 600, cursor: "pointer",
                textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "inherit",
              }}
            >
              {m === "single" ? "One Lead" : "Bulk Paste"}
            </button>
          ))}
        </div>

        {mode === "single" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div><Label>Business Name *</Label><Input value={s.businessName} onChange={(v) => u("businessName", v)} placeholder="Maria's Pizza" /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <Label>Type</Label>
                <select value={s.businessType} onChange={(e) => u("businessType", e.target.value)} style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "9px 11px", color: C.text, fontSize: "13px", fontFamily: "inherit", outline: "none" }}>
                  {BUSINESS_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div><Label>Location</Label><Input value={s.location} onChange={(v) => u("location", v)} placeholder="Brooklyn, NY" /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div><Label>Email</Label><Input value={s.email} onChange={(v) => u("email", v)} placeholder="hello@..." /></div>
              <div><Label>Phone</Label><Input value={s.phone} onChange={(v) => u("phone", v)} placeholder="(555) 000-0000" /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <Label>Website Status</Label>
                <select value={s.websiteStatus} onChange={(e) => u("websiteStatus", e.target.value)} style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "9px 11px", color: C.text, fontSize: "13px", fontFamily: "inherit", outline: "none" }}>
                  <option value="none">No website</option>
                  <option value="outdated">Outdated</option>
                  <option value="basic">Basic / poor</option>
                </select>
              </div>
              <div><Label>Price ($)</Label><Input type="number" value={s.proposedPrice} onChange={(v) => u("proposedPrice", parseInt(v) || 400)} /></div>
            </div>
            <Btn
              variant="primary"
              onClick={() => { if (!s.businessName) return; onAdd([makeLead(s)]); onClose(); }}
              disabled={!s.businessName}
              style={{ marginTop: "8px", padding: "11px" }}
            >
              Add Lead
            </Btn>
          </div>
        ) : (
          <div>
            <Label>One per line: Name, Type, Location, Email, Phone</Label>
            <Textarea
              value={bulk}
              onChange={setBulk}
              rows={8}
              placeholder={"Maria's Pizza, Restaurant, Brooklyn NY, maria@pizza.com, 555-1234\nJoe's Auto, Auto Shop, Queens NY, joe@auto.com,"}
            />
            <Btn
              variant="primary"
              onClick={() => {
                const leads = bulk.split("\n").filter((l) => l.trim()).map((line) => {
                  const [businessName, businessType, location, email, phone] = line.split(",").map((s) => s?.trim() || "");
                  return makeLead({ businessName, businessType: businessType || "Restaurant", location, email, phone });
                });
                if (leads.length) { onAdd(leads); onClose(); }
              }}
              disabled={!bulk.trim()}
              style={{ marginTop: "12px", padding: "11px", width: "100%" }}
            >
              Add {bulk.split("\n").filter((l) => l.trim()).length || 0} Leads
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CLIENT FEEDBACK PAGE ─────────────────────────────────────────────────
function ClientFeedbackPage({ lead, onClose }) {
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = () => {
    if (!feedback.trim()) return;
    setSubmitted(true);
    navigator.clipboard?.writeText(`FEEDBACK for ${lead.businessName}:\n\n${feedback}`);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#f8f8f6", zIndex: 300, display: "flex", flexDirection: "column", fontFamily: "Georgia, serif" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e0e0e0", padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "13px", color: "#888" }}>Client preview — {lead.businessName}</span>
        <button onClick={onClose} style={{ background: "none", border: "1px solid #ddd", borderRadius: "6px", padding: "5px 12px", cursor: "pointer", fontSize: "12px" }}>← Back to Dashboard</button>
      </div>
      {lead.finalHTML || lead.draftHTML ? (
        <iframe srcDoc={lead.finalHTML || lead.draftHTML} style={{ flex: 1, border: "none" }} sandbox="allow-same-origin" title="Client Site Preview" />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>No site generated yet</div>
      )}
      <div style={{ background: "#fff", borderTop: "1px solid #e0e0e0", padding: "16px 20px" }}>
        {submitted ? (
          <div style={{ textAlign: "center", color: "#22c55e", fontWeight: 600, fontSize: "15px" }}>
            ✓ Feedback received! Copied to clipboard — paste it into the dashboard.
          </div>
        ) : (
          <div style={{ maxWidth: "700px", margin: "0 auto", display: "flex", gap: "10px", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "12px", color: "#888", marginBottom: "6px", fontFamily: "sans-serif" }}>What would you like changed?</div>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="e.g. Change the colors to blue, add our menu, make the hero image bigger..."
                rows={2}
                style={{ width: "100%", border: "1px solid #ddd", borderRadius: "8px", padding: "10px", fontSize: "14px", fontFamily: "sans-serif", resize: "none", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <button
              onClick={submit}
              disabled={!feedback.trim()}
              style={{ padding: "12px 20px", background: "#111", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: feedback.trim() ? "pointer" : "not-allowed", opacity: feedback.trim() ? 1 : 0.4, fontFamily: "sans-serif", whiteSpace: "nowrap" }}
            >
              Send Feedback
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LEAD DETAIL ──────────────────────────────────────────────────────────
function LeadDetail({ lead, onUpdate, onDelete, onBack, settings }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(null);
  const [showClient, setShowClient] = useState(false);
  const [feedback, setFeedback] = useState(lead.feedback || "");
  const [emailSending, setEmailSending] = useState(false);
  const meta = stageMeta(lead.stage);

  const log = (action) => ({ ...lead, history: [...lead.history, { ts: now(), action }] });
  const moveTo = (stage, action) => onUpdate({ ...log(action), stage });

  const doGenerateDraft = async () => {
    setBusy("Generating draft website..."); setError("");
    try {
      const html = await generateWebsite(lead, settings);
      onUpdate({ ...log("Generated draft website"), draftHTML: html });
    } catch (e) {
      setError("Draft failed: " + e.message);
    }
    setBusy("");
  };

  const doGeneratePitch = async () => {
    setBusy("Drafting pitch email..."); setError("");
    try {
      const email = await generatePitchEmail(lead, settings);
      onUpdate({ ...log("Drafted pitch email"), pitchEmail: email });
    } catch (e) {
      setError("Email draft failed: " + e.message);
    }
    setBusy("");
  };

  const doGenerateFinal = async () => {
    setBusy("Building website" + (feedback ? " with feedback..." : "...")); setError("");
    try {
      const html = await generateWebsite({ ...lead, feedback }, settings, !!feedback);
      onUpdate({ ...log("Built website" + (feedback ? " with feedback" : "")), finalHTML: html, feedback });
    } catch (e) {
      setError("Build failed: " + e.message);
    }
    setBusy("");
  };

  const doSendEmail = async () => {
    setError("");
    if (!settings.resendKey) { setError("Add your Resend API key in Settings first."); return; }
    if (!lead.email) { setError("This lead has no email address."); return; }
    if (!lead.pitchEmail) { setError("Generate a pitch email first."); return; }
    setEmailSending(true);
    try {
      const subject = `Quick question about ${lead.businessName}'s website`;
      const from = settings.yourName
        ? `${settings.yourName} <${settings.fromEmail}>`
        : settings.fromEmail;
      await sendViaResend(settings.resendKey, from, lead.email, subject, lead.pitchEmail);
      onUpdate({ ...log("Pitch email sent via Resend"), stage: "pitched" });
    } catch (e) {
      setError("Send failed: " + e.message);
    }
    setEmailSending(false);
  };

  const downloadHTML = (html, suffix) => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lead.businessName.replace(/\s+/g, "-").toLowerCase()}-${suffix}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyEmail = () => navigator.clipboard?.writeText(lead.pitchEmail).then(() => alert("Copied!"));
  const paymentInfo = settings.venmo
    ? `Venmo @${settings.venmo}`
    : settings.zelle
    ? `Zelle ${settings.zelle}`
    : null;

  if (showClient) return <ClientFeedbackPage lead={lead} onClose={() => setShowClient(false)} />;

  if (showPreview) return (
    <div style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 200, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 20px", background: C.card, borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 600, fontSize: "14px" }}>{lead.businessName} — {showPreview.label}</div>
        <div style={{ display: "flex", gap: "8px" }}>
          <Btn size="sm" onClick={() => downloadHTML(showPreview.html, showPreview.label.toLowerCase())}>↓ Download</Btn>
          <Btn size="sm" onClick={() => setShowPreview(null)}>✕ Close</Btn>
        </div>
      </div>
      <iframe srcDoc={showPreview.html} style={{ flex: 1, border: "none", background: "white" }} sandbox="allow-same-origin" title="Preview" />
    </div>
  );

  return (
    <div style={{ padding: "20px", maxWidth: "780px", margin: "0 auto" }}>
      <Btn variant="ghost" size="sm" onClick={onBack} style={{ marginBottom: "16px" }}>← Pipeline</Btn>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "20px", marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "12px", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: 700 }}>{lead.businessName}</h2>
            <div style={{ color: C.muted, fontSize: "13px" }}>{lead.businessType}{lead.location && ` · ${lead.location}`}</div>
          </div>
          <Pill color={meta.color}>{meta.label}</Pill>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px", marginTop: "12px" }}>
          {lead.email && <div><Label>Email</Label><div style={{ fontSize: "12px", wordBreak: "break-all" }}>{lead.email}</div></div>}
          {lead.phone && <div><Label>Phone</Label><div style={{ fontSize: "12px" }}>{lead.phone}</div></div>}
          <div><Label>Price</Label><div style={{ fontSize: "13px", color: C.accent, fontWeight: 700 }}>${lead.proposedPrice}</div></div>
          {paymentInfo && <div><Label>Payment</Label><div style={{ fontSize: "12px" }}>{paymentInfo}</div></div>}
        </div>
      </div>

      {busy && <BusyBar msg={busy} />}
      <ErrorBar msg={error} onClose={() => setError("")} />

      {/* ── Stage actions ── */}
      {lead.stage === "prospects" && (
        <>
          <Section title="① Generate Draft Website">
            <p style={{ color: C.muted, fontSize: "13px", margin: "0 0 14px" }}>
              Build a quick draft to show as a preview link in your cold email.
            </p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
              <Btn variant="primary" onClick={doGenerateDraft} disabled={!!busy}>
                {lead.draftHTML ? "↺ Regenerate" : "✨ Generate Draft"}
              </Btn>
              {lead.draftHTML && (
                <>
                  <Btn onClick={() => setShowPreview({ html: lead.draftHTML, label: "Draft" })}>👁 Preview</Btn>
                  <Btn onClick={() => downloadHTML(lead.draftHTML, "draft")}>↓ Download</Btn>
                </>
              )}
            </div>
            {lead.draftHTML && (
              <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "12px", fontSize: "12px", color: C.mutedLight, lineHeight: 1.7 }}>
                <strong style={{ color: C.accent }}>To get a shareable link:</strong> Download the HTML → drag to{" "}
                <a href="https://app.netlify.com/drop" target="_blank" rel="noopener" style={{ color: C.cyan }}>netlify.com/drop</a>{" "}
                → copy the URL → paste as [DRAFT_LINK] in your email.
              </div>
            )}
          </Section>

          <Section title="② Pitch Email">
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
              <Btn variant="primary" onClick={doGeneratePitch} disabled={!!busy}>
                {lead.pitchEmail ? "↺ Redraft" : "✉ Draft Email"}
              </Btn>
              {lead.pitchEmail && (
                <>
                  <Btn size="sm" onClick={copyEmail}>📋 Copy</Btn>
                  {settings.resendKey ? (
                    <Btn variant="success" size="sm" onClick={doSendEmail} disabled={emailSending}>
                      {emailSending ? "Sending..." : "📤 Send via Resend"}
                    </Btn>
                  ) : (
                    <Btn variant="info" size="sm" onClick={() => alert("Add your Resend key in Settings to send directly.")}>⚙ Setup Resend</Btn>
                  )}
                </>
              )}
            </div>
            {lead.pitchEmail && (
              <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "14px", whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: 1.7, marginBottom: "10px" }}>
                {lead.pitchEmail}
              </div>
            )}
            {lead.pitchEmail && !settings.resendKey && (
              <Btn variant="success" size="sm" onClick={() => moveTo("pitched", "Manually marked email as sent")}>
                ✓ I sent it manually → move to Pitched
              </Btn>
            )}
          </Section>
        </>
      )}

      {lead.stage === "pitched" && (
        <Section title="② Awaiting Reply">
          <p style={{ color: C.muted, fontSize: "13px", margin: "0 0 14px" }}>
            Waiting for the business to respond to your pitch.
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Btn variant="success" onClick={() => moveTo("interested", "Client replied YES")}>✓ They said YES</Btn>
            <Btn variant="danger" onClick={() => moveTo("prospects", "No reply — moved back")}>No reply / passed</Btn>
          </div>
        </Section>
      )}

      {lead.stage === "interested" && (
        <Section title="③ Build the Real Website">
          <p style={{ color: C.muted, fontSize: "13px", margin: "0 0 14px" }}>
            Client is interested! Build the full site.
          </p>
          <div style={{ marginBottom: "12px" }}>
            <Label>Notes from their reply (optional)</Label>
            <Textarea value={feedback} onChange={setFeedback} placeholder="Anything they mentioned..." rows={2} />
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
            <Btn variant="primary" onClick={doGenerateFinal} disabled={!!busy}>
              {lead.finalHTML ? "↺ Rebuild" : "✨ Build Website"}
            </Btn>
            {lead.finalHTML && (
              <>
                <Btn onClick={() => setShowPreview({ html: lead.finalHTML, label: "Build" })}>👁 Preview</Btn>
                <Btn onClick={() => downloadHTML(lead.finalHTML, "build")}>↓ Download</Btn>
                <Btn variant="info" onClick={() => setShowClient(true)}>🔗 Client View</Btn>
              </>
            )}
          </div>
          {lead.finalHTML && (
            <Btn variant="success" onClick={() => moveTo("feedback", "Sent to client for feedback")}>
              ✓ Sent to client → Awaiting feedback
            </Btn>
          )}
        </Section>
      )}

      {lead.stage === "feedback" && (
        <Section title="④ Client Feedback">
          <p style={{ color: C.muted, fontSize: "13px", margin: "0 0 14px" }}>
            Paste what the client said and rebuild with their feedback applied.
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
            {lead.finalHTML && <Btn variant="info" onClick={() => setShowClient(true)}>🔗 Open Client View</Btn>}
          </div>
          <div style={{ marginBottom: "12px" }}>
            <Label>Paste client feedback</Label>
            <Textarea value={feedback} onChange={setFeedback} rows={4} placeholder="e.g. Make colors warmer, add a menu section, bigger hero..." />
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
            <Btn variant="primary" onClick={doGenerateFinal} disabled={!!busy || !feedback.trim()}>
              ✨ Rebuild with Feedback
            </Btn>
            {lead.finalHTML && (
              <>
                <Btn onClick={() => setShowPreview({ html: lead.finalHTML, label: "Current" })}>👁 Preview Current</Btn>
                <Btn onClick={() => downloadHTML(lead.finalHTML, "revised")}>↓ Download</Btn>
              </>
            )}
          </div>
          {lead.finalHTML && (
            <Btn variant="success" onClick={() => moveTo("review", "Ready for your review")}>
              🔔 Ready for your review
            </Btn>
          )}
        </Section>
      )}

      {lead.stage === "review" && (
        <Section title="⑤ Your Final Review" accent={C.danger}>
          <p style={{ color: C.mutedLight, fontSize: "13px", margin: "0 0 14px" }}>
            <strong style={{ color: C.danger }}>Action needed.</strong> Review the final site — if it looks good, approve it.
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
            {lead.finalHTML && (
              <>
                <Btn variant="primary" onClick={() => setShowPreview({ html: lead.finalHTML, label: "Final" })}>👁 Preview Final Site</Btn>
                <Btn onClick={() => downloadHTML(lead.finalHTML, "final")}>↓ Download</Btn>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Btn variant="success" onClick={() => moveTo("approved", "Approved — sent to client for payment")}>
              ✓ Looks good — Approve
            </Btn>
            <Btn variant="danger" onClick={() => moveTo("feedback", "Needs more work")}>Needs changes</Btn>
          </div>
        </Section>
      )}

      {lead.stage === "approved" && (
        <Section title="⑥ Awaiting Payment">
          <p style={{ color: C.muted, fontSize: "13px", margin: "0 0 14px" }}>
            Site is approved. Once they pay{paymentInfo ? ` via ${paymentInfo}` : ""} and confirm, mark it live.
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
            {lead.finalHTML && (
              <>
                <Btn onClick={() => setShowPreview({ html: lead.finalHTML, label: "Final" })}>👁 Preview</Btn>
                <Btn onClick={() => downloadHTML(lead.finalHTML, "final")}>↓ Download to Publish</Btn>
              </>
            )}
          </div>
          <Btn variant="success" onClick={() => moveTo("live", "Paid and published")}>
            💰 Paid + Published → Mark Live
          </Btn>
        </Section>
      )}

      {lead.stage === "live" && (
        <Section title="✓ Live" accent={C.cyan}>
          <p style={{ color: C.muted, fontSize: "13px", margin: 0 }}>
            🎉 Paid and live. Follow up in a few months about maintenance.
          </p>
        </Section>
      )}

      <Section title="History">
        {[...lead.history].reverse().map((h, i) => (
          <div
            key={i}
            style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: C.muted, paddingBottom: "8px", marginBottom: "8px", borderBottom: i < lead.history.length - 1 ? `1px solid ${C.border}` : "none" }}
          >
            <span>{h.action}</span>
            <span>{new Date(h.ts).toLocaleString()}</span>
          </div>
        ))}
      </Section>

      <div style={{ textAlign: "right", marginTop: "10px" }}>
        <Btn variant="danger" size="sm" onClick={() => { if (confirm("Delete this lead?")) onDelete(); }}>
          Delete Lead
        </Btn>
      </div>
    </div>
  );
}

// ─── PIPELINE VIEW ────────────────────────────────────────────────────────
function Pipeline({ leads, activeStage, setActiveStage, onSelectLead, onAddClick, onResearchClick }) {
  const counts = STAGES.reduce((a, s) => ({ ...a, [s.id]: leads.filter((l) => l.stage === s.id).length }), {});
  const visible = leads.filter((l) => l.stage === activeStage);
  const meta = stageMeta(activeStage);

  return (
    <div>
      <div style={{ display: "flex", gap: "6px", padding: "16px 16px 0", overflowX: "auto", scrollbarWidth: "thin" }}>
        {STAGES.map((s) => {
          const active = activeStage === s.id;
          const n = counts[s.id];
          return (
            <button
              key={s.id}
              onClick={() => setActiveStage(s.id)}
              style={{
                background: active ? C.card : "transparent",
                border: `1px solid ${active ? s.color + "66" : C.border}`,
                borderRadius: "8px", padding: "10px 14px",
                color: active ? s.color : C.mutedLight,
                fontSize: "12px", fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit", whiteSpace: "nowrap",
                display: "flex", alignItems: "center", gap: "8px",
                transition: "all 0.15s",
                boxShadow: s.alert && n > 0 && !active ? `0 0 0 1px ${s.color}` : "none",
              }}
            >
              <span>{s.label}</span>
              {n > 0 && (
                <span style={{
                  background: active ? s.color : C.border,
                  color: active ? "#0a0a0b" : C.text,
                  borderRadius: "10px", padding: "1px 7px", fontSize: "10px",
                }}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: "20px", fontWeight: 700, color: meta.color }}>{meta.label}</h2>
          <div style={{ color: C.muted, fontSize: "13px" }}>{meta.desc}</div>
        </div>
        {activeStage === "prospects" && (
          <div style={{ display: "flex", gap: "8px" }}>
            <Btn variant="info" onClick={onResearchClick}>🔍 Research</Btn>
            <Btn variant="primary" onClick={onAddClick}>+ Add</Btn>
          </div>
        )}
      </div>

      <div style={{ padding: "0 16px 80px" }}>
        {visible.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted, border: `1px dashed ${C.border}`, borderRadius: "12px" }}>
            <div style={{ fontSize: "32px", marginBottom: "8px", opacity: 0.4 }}>○</div>
            <div style={{ fontSize: "14px" }}>No leads in this stage</div>
            {activeStage === "prospects" && (
              <div style={{ display: "flex", gap: "10px", justifyContent: "center", marginTop: "16px" }}>
                <Btn variant="info" onClick={onResearchClick}>🔍 Research Leads</Btn>
                <Btn variant="primary" onClick={onAddClick}>+ Add Manually</Btn>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {visible.map((lead) => (
              <button
                key={lead.id}
                onClick={() => onSelectLead(lead.id)}
                style={{ textAlign: "left", background: C.card, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "14px 16px", cursor: "pointer", fontFamily: "inherit", color: C.text, transition: "all 0.15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = C.card)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "6px" }}>
                  <div style={{ fontWeight: 600, fontSize: "15px" }}>{lead.businessName}</div>
                  <div style={{ color: C.accent, fontSize: "13px", fontWeight: 700 }}>${lead.proposedPrice}</div>
                </div>
                <div style={{ color: C.muted, fontSize: "12px" }}>
                  {lead.businessType}{lead.location && ` · ${lead.location}`}
                </div>
                {lead.email && <div style={{ color: C.mutedLight, fontSize: "11px", marginTop: "4px" }}>{lead.email}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────
export default function AgentPipeline() {
  const [leads, setLeads] = useState(() => loadLeads());
  const [settings, setSettings] = useState(() => loadSettings());
  const [activeStage, setActiveStage] = useState("prospects");
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Persist on every change (synchronous localStorage — no race conditions)
  useEffect(() => { saveLeads(leads); }, [leads]);
  useEffect(() => { saveSettings(settings); }, [settings]);

  const selected = leads.find((l) => l.id === selectedId);
  const reviewCount = leads.filter((l) => l.stage === "review").length;
  const liveCount = leads.filter((l) => l.stage === "live").length;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        * { box-sizing: border-box; }
      `}</style>

      {/* Top bar */}
      <div style={{ padding: "12px 16px", background: C.card, borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 10, gap: "10px" }}>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 700 }}>Agent Pipeline</div>
          <div style={{ fontSize: "11px", color: C.muted }}>
            {leads.length} leads · {liveCount > 0 ? `${liveCount} live` : "no closed deals yet"}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {reviewCount > 0 && !selected && (
            <button
              onClick={() => { setActiveStage("review"); setSelectedId(null); }}
              style={{ background: C.danger + "22", border: `1px solid ${C.danger}`, color: C.danger, padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px" }}
            >
              <span style={{ width: "6px", height: "6px", background: C.danger, borderRadius: "50%", animation: "pulse 1.5s infinite" }} />
              {reviewCount} to review
            </button>
          )}
          {!settings.claudeKey && (
            <button
              onClick={() => setShowSettings(true)}
              style={{ background: C.accent + "22", border: `1px solid ${C.accent}`, color: C.accent, padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              ⚠ Add API key
            </button>
          )}
          <Btn size="sm" onClick={() => setShowSettings(true)}>⚙ Settings</Btn>
        </div>
      </div>

      {selected ? (
        <LeadDetail
          lead={selected}
          settings={settings}
          onUpdate={(u) => setLeads((ls) => ls.map((l) => (l.id === u.id ? u : l)))}
          onDelete={() => { setLeads((ls) => ls.filter((l) => l.id !== selectedId)); setSelectedId(null); }}
          onBack={() => setSelectedId(null)}
        />
      ) : (
        <Pipeline
          leads={leads}
          activeStage={activeStage}
          setActiveStage={setActiveStage}
          onSelectLead={setSelectedId}
          onAddClick={() => setShowAdd(true)}
          onResearchClick={() => setShowResearch(true)}
        />
      )}

      {showAdd && <AddLeadModal onClose={() => setShowAdd(false)} onAdd={(nl) => setLeads((ls) => [...nl, ...ls])} />}
      {showResearch && <ResearchModal onClose={() => setShowResearch(false)} onAdd={(nl) => setLeads((ls) => [...nl, ...ls])} settings={settings} />}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSave={(s) => { setSettings(s); return saveSettings(s); }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
