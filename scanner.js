// ================================================================
// SCANNER.JS v8 — legge da Supabase (scritto dall'estensione Chrome)
// ================================================================
(function (global) {
  "use strict";

  const SUPABASE_URL = "https://mpdfjanqirlgusduaovf.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wZGZqYW5xaXJsZ3VzZHVhb3ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNjc0NTUsImV4cCI6MjA5Njk0MzQ1NX0.dVKjmtGyedrV0GZosslgs8d60irduON7FRYrqDXQ3xg"; // sostituire con anon key

  // ---- Supabase fetch ----
  async function sbFetch(path, opts = {}) {
    const key = localStorage.getItem("odds_sb_key") || SUPABASE_KEY;
    const res = await fetch(SUPABASE_URL + path, {
      ...opts,
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`Supabase ${path} → HTTP ${res.status}`);
    return res.json();
  }

  // Carica gli ultimi N scan per sport dalla view odds_latest_scans
  async function loadFromSupabase(sports, limit) {
    const sportFilter = sports.map(s => `sport.eq.${s}`).join(",");
    const rows = await sbFetch(
      `/rest/v1/odds_latest_scans?select=*&or=(${sportFilter})&order=scanned_at.desc&limit=${sports.length * limit}`,
      { headers: { "Prefer": "return=representation" } }
    );
    return rows;
  }

  // Converte una riga Supabase nel formato atteso da app.js
  function rowToEvent(row) {
    return {
      eventId:   row.event_id,
      label:     row.label,
      sport:     row.sport,
      group:     row.group || "",
      time:      row.event_time || "",
      scannedAt: new Date(row.scanned_at).getTime(),
      sites:     row.sites || {},
    };
  }

  // Carica e inietta in state
  async function loadAndRender(opts = {}) {
    const sports = opts.sports || ["calcio","tennis","basket"];
    const limit  = opts.limit  || 5;

    const rows = await loadFromSupabase(sports, limit);
    const events = rows.map(rowToEvent);
    return events;
  }

  // Polling: aggiorna automaticamente ogni N secondi
  let _pollInterval = null;
  function startPolling(intervalMs = 60000) {
    stopPolling();
    _pollInterval = setInterval(async () => {
      try {
        if (!global.state) return;
        const events = await loadAndRender({
          sports: ["calcio","tennis","basket"],
          limit: 10,
        });
        if (!events.length) return;
        // Merge con dati esistenti
        const map = new Map(global.state.events.map(e => [String(e.eventId), e]));
        events.forEach(ev => map.set(String(ev.eventId), ev));
        global.state.events = [...map.values()];
        if (typeof global.persist   === "function") global.persist();
        if (typeof global.renderAll === "function") global.renderAll();
        console.log(`[OddsScanner] Supabase sync: ${events.length} eventi aggiornati`);
      } catch (e) {
        console.warn("[OddsScanner] Polling error:", e.message);
      }
    }, intervalMs);
  }
  function stopPolling() {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  }

  function waitForState(cb, n = 0) {
    if (global.state && typeof global.renderAll === "function") cb();
    else if (n < 50) setTimeout(() => waitForState(cb, n + 1), 100);
  }

  // ---- UI ----
  function injectUI() {
    const toolbar = document.querySelector(".toolbar");
    if (!toolbar || document.getElementById("scanLiveBtn")) return;

    // Pulsante "Aggiorna da Supabase"
    const btn = document.createElement("button");
    btn.id = "scanLiveBtn"; btn.className = "ghost-btn";
    btn.innerHTML = "⚡ Aggiorna Live";
    btn.title = "Carica i dati più recenti da Supabase (scritti dall'estensione Chrome)";
    toolbar.insertBefore(btn, toolbar.firstChild);

    // Pulsante config
    const cfgBtn = document.createElement("button");
    cfgBtn.id = "scanCfgBtn"; cfgBtn.className = "ghost-btn";
    cfgBtn.innerHTML = "⚙"; cfgBtn.title = "Impostazioni";
    toolbar.insertBefore(cfgBtn, btn.nextSibling);

    // Badge polling attivo
    const badge = document.createElement("span");
    badge.id = "pollBadge";
    badge.style.cssText = "display:none;background:#1f7a45;color:#fff;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:700;margin-left:4px";
    badge.textContent = "● LIVE";
    btn.after(badge);

    // Pannello config
    const panel = document.createElement("div");
    panel.id = "scanPanel";
    Object.assign(panel.style, {
      display:"none", position:"fixed", top:"70px", left:"50%",
      transform:"translateX(-50%)", background:"#fff",
      border:"1px solid #dbe2e6", borderRadius:"10px",
      padding:"18px 20px", zIndex:"999",
      boxShadow:"0 12px 36px rgba(20,34,42,.15)",
      minWidth:"320px", fontSize:"13px", lineHeight:"1.7",
    });
    panel.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:14px">Impostazioni Live Scanner</h3>
      <div style="display:grid;gap:10px">

        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 12px;font-size:12px;color:#0369a1">
          <strong>Come funziona:</strong><br>
          1. Avvia la scansione dall'estensione Chrome<br>
          2. L'estensione scrive i mercati dettagliati su Supabase<br>
          3. Questo sito li legge in automatico ogni minuto
        </div>

        <label style="display:grid;gap:4px;color:#69757d;font-size:12px">
          Supabase Anon Key
          <input id="sbKeyInput" type="password"
            style="min-height:34px;border:1px solid #dbe2e6;border-radius:7px;padding:0 9px;font-size:12px"
            placeholder="eyJhbGci...">
          <span style="font-size:11px;color:#9ca3af">Settings → API → anon public key su supabase.com</span>
        </label>

        <label style="display:grid;gap:4px;color:#69757d;font-size:12px">
          Aggiornamento automatico
          <select id="pollInterval" style="min-height:34px;border:1px solid #dbe2e6;border-radius:7px;padding:0 9px">
            <option value="0">Manuale (solo su click)</option>
            <option value="30000">Ogni 30 secondi</option>
            <option value="60000" selected>Ogni minuto</option>
            <option value="300000">Ogni 5 minuti</option>
          </select>
        </label>

        <div style="display:flex;gap:8px;margin-top:4px">
          <button id="sbSaveBtn"
            style="flex:1;min-height:36px;border-radius:7px;background:#117c8b;color:#fff;border:none;font-weight:700;cursor:pointer">
            Salva e carica
          </button>
          <button id="closePanelBtn"
            style="min-height:36px;border-radius:7px;background:#fff;border:1px solid #dbe2e6;cursor:pointer;padding:0 12px">
            Chiudi
          </button>
        </div>
      </div>`;
    document.body.appendChild(panel);

    // Barra stato
    const bar = document.createElement("div");
    bar.id = "scanBar";
    Object.assign(bar.style, {
      display:"none", position:"fixed", top:"0", left:"0", right:"0",
      zIndex:"1000", background:"#15252b", color:"#e6f4f6",
      fontSize:"12px", padding:"8px 16px", alignItems:"center", gap:"12px",
    });
    bar.innerHTML = `<span id="barText" style="flex:1">Caricamento...</span>
      <div style="width:120px;height:6px;background:#2a3e47;border-radius:3px;overflow:hidden;flex-shrink:0">
        <div id="barFill" style="height:100%;background:#3db88c;border-radius:3px;width:0%;transition:width .5s"></div>
      </div>`;
    document.body.appendChild(bar);

    const togglePanel = (f) => {
      const show = f ?? panel.style.display === "none";
      panel.style.display = show ? "block" : "none";
      if (show) {
        const inp = document.getElementById("sbKeyInput");
        if (inp) inp.value = localStorage.getItem("odds_sb_key") || "";
      }
    };

    const setBar = (text, pct, running) => {
      bar.style.display = "flex";
      document.getElementById("barText").textContent = text;
      document.getElementById("barFill").style.width = pct + "%";
      document.getElementById("barFill").style.background = running ? "#3db88c" : (text.startsWith("✓") ? "#1f7a45" : "#b42318");
      if (!running) setTimeout(() => { bar.style.display = "none"; }, 3000);
    };

    const doLoad = () => {
      setBar("Caricamento da Supabase...", 40, true);
      btn.disabled = true; btn.innerHTML = "⏳...";
      waitForState(async () => {
        try {
          const events = await loadAndRender({ sports: ["calcio","tennis","basket"], limit: 10 });
          if (!events.length) {
            setBar("⚠ Nessun dato su Supabase. Avvia prima la scansione dall'estensione Chrome.", 100, false);
            return;
          }
          const map = new Map((global.state.events||[]).map(e => [String(e.eventId), e]));
          events.forEach(ev => map.set(String(ev.eventId), ev));
          global.state.events = [...map.values()];
          if (typeof global.persist   === "function") global.persist();
          if (typeof global.renderAll === "function") global.renderAll();
          setBar(`✓ ${events.length} eventi caricati da Supabase`, 100, false);
        } catch (err) {
          console.error("[OddsScanner]", err);
          const msg = err.message.includes("401") || err.message.includes("403")
            ? "Anon key mancante o errata — clicca ⚙ per configurarla"
            : err.message;
          setBar(`❌ ${msg}`, 100, false);
        } finally {
          btn.disabled = false; btn.innerHTML = "⚡ Aggiorna Live";
        }
      });
    };

    btn.addEventListener("click", doLoad);
    cfgBtn.addEventListener("click", () => togglePanel());
    document.getElementById("closePanelBtn").addEventListener("click", () => togglePanel(false));

    document.getElementById("sbSaveBtn").addEventListener("click", () => {
      const key      = document.getElementById("sbKeyInput").value.trim();
      const interval = parseInt(document.getElementById("pollInterval").value);
      if (key) localStorage.setItem("odds_sb_key", key);

      togglePanel(false);

      if (interval > 0) {
        startPolling(interval);
        badge.style.display = "inline";
      } else {
        stopPolling();
        badge.style.display = "none";
      }

      doLoad();
    });

    // Auto-avvio se key già salvata
    const savedKey = localStorage.getItem("odds_sb_key");
    if (savedKey && savedKey !== "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wZGZqYW5xaXJsZ3VzZHVhb3ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNjc0NTUsImV4cCI6MjA5Njk0MzQ1NX0.dVKjmtGyedrV0GZosslgs8d60irduON7FRYrqDXQ3xg") {
      waitForState(() => {
        startPolling(60000);
        badge.style.display = "inline";
        doLoad();
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectUI);
  else injectUI();

  global.OddsScanner = { loadFromSupabase, startPolling, stopPolling };
})(window);
