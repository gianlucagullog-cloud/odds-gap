// ================================================================
// SCANNER.JS v3 — Odds Gap Scanner
// Chiama api2.eplay24.it direttamente dal browser (no proxy, no CORS)
// ================================================================

(function (global) {
  "use strict";

  const EP = "https://api2.eplay24.it/api";
  const SPORT_MAP = { calcio: "Calcio", tennis: "Tennis", basket: "Basket" };

  // Cache in memoria (5 min)
  const _cache = new Map();
  async function cached(key, fn, ttl = 300000) {
    const h = _cache.get(key);
    if (h && Date.now() - h.ts < ttl) return h.data;
    const data = await fn();
    _cache.set(key, { ts: Date.now(), data });
    return data;
  }

  // Fetch verso eplay24 — dal browser non ha problemi CORS
  async function epFetch(path, opts = {}) {
    const url = EP + path;
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`eplay24 ${path} → HTTP ${res.status}`);
    return res.json();
  }

  // Lista eventi prematch
  async function getAllEvents() {
    return cached("allEvents", () => epFetch("/Palinsesto/GetAllEventsPrematch"));
  }

  // Mercati di una singola partita
  async function getMarkets(ev) {
    return cached(`mkts_${ev.Match_Id}`, async () => {
      // Prova più endpoint
      for (const [path, body] of [
        ["/Palinsesto/GetEventePalinsesto",
         { match_id: ev.Match_Id, Group_id: ev.Group_id || 0 }],
        ["/Palinsesto/GetPalinsestoCore",
         { match_id: ev.Match_Id }],
      ]) {
        try {
          const data = await epFetch(path, { method: "POST", body });
          const rows = Array.isArray(data) ? data
            : Array.isArray(data?.ResponseData) ? data.ResponseData : [];
          if (rows.length > 0) return rows;
        } catch (_) {}
      }
      return []; // fallback: nessun mercato extra
    }, 180000);
  }

  // Converte righe API → lista mercati {name, linee, tab, lineaNum}
  function parseMarkets(rows) {
    const seen = new Set();
    const out = [];
    for (const row of rows) {
      const name = (row.DescTipoScommessa || row.Nome || row.name || "").trim();
      if (!name) continue;
      const linea = String(row.Linea ?? row.linea ?? "-");
      const tab = row.Categoria || "Principali";
      const key = `${name}|${linea}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const outcomes = [];
      for (const k of ["Quota1", "QuotaX", "Quota2"]) {
        try { if (parseFloat(row[k]) > 1) outcomes.push(k.replace("Quota", "")); }
        catch (_) {}
      }

      out.push({
        name, tab,
        linee: outcomes.length ? outcomes : [linea],
        lineaNum: isNaN(parseFloat(linea)) ? null : parseFloat(linea),
      });
    }
    // Garantisce sempre almeno 1X2
    if (!out.length) {
      out.push({ name: "Esito Finale 1X2", linee: ["1","X","2"], tab: "Principali", lineaNum: null });
    }
    return out;
  }

  // Normalizza con OddsNormalizer
  function normalizeMarkets(markets, sport) {
    const N = global.OddsNormalizer;
    if (!N) return markets;
    return markets.flatMap(m =>
      m.linee.map(linea => ({
        ...m,
        linee: [linea],
        canonical: N.normalize(sport, m.name, linea, "match")?.canonicalKey || null,
      }))
    ).filter((m, i, arr) =>
      !m.canonical || arr.findIndex(x => x.canonical === m.canonical) === i
    );
  }

  // ---- SCAN PRINCIPALE ----
  async function scan(opts = {}) {
    const sports = opts.sports || ["calcio", "tennis", "basket"];
    const limit  = opts.limit  || 5;
    const onProg = opts.onProgress || (() => {});

    onProg(0, 1, "Caricamento palinsesto...", "");

    const allEvents = await getAllEvents();
    const now = Date.now();
    const queue = [];

    for (const sport of sports) {
      const sportName = SPORT_MAP[sport] || "Calcio";
      const evs = allEvents
        .filter(e => e.Sport_Desc === sportName)
        .filter(e => new Date(e.Match_Time).getTime() > now + 900000)
        .sort((a, b) => new Date(a.Match_Time) - new Date(b.Match_Time))
        .slice(0, limit);
      evs.forEach(e => queue.push({ e, sport }));
    }

    const total = queue.length;
    const events = [];
    const errors = [];

    for (let i = 0; i < queue.length; i++) {
      const { e, sport } = queue[i];
      onProg(i, total, e.label || `Evento ${e.Match_Id}`, sport);

      try {
        const rows    = await getMarkets(e);
        const markets = normalizeMarkets(parseMarkets(rows), sport);
        events.push({
          eventId:   String(e.Match_Id),
          label:     e.label || "",
          sport,
          group:     e.Group_Name || "",
          time:      e.Match_Time || "",
          scannedAt: Date.now(),
          sites: {
            Eplay24: {
              markets,
              tabs: [...new Set(markets.map(m => m.tab))],
            },
          },
        });
      } catch (err) {
        errors.push({ event: e.label, error: err.message });
        // Aggiungi evento senza mercati
        events.push({
          eventId: String(e.Match_Id),
          label: e.label || "",
          sport, group: e.Group_Name || "",
          time: e.Match_Time || "",
          scannedAt: Date.now(),
          sites: { Eplay24: { markets: [], tabs: [] } },
        });
      }
    }

    onProg(total, total, "Completato", "");
    return { events, errors };
  }

  // ---- UI ----
  function injectUI() {
    const toolbar = document.querySelector(".toolbar");
    if (!toolbar || document.getElementById("scanLiveBtn")) return;

    // Pulsante principale
    const btn = document.createElement("button");
    btn.id = "scanLiveBtn";
    btn.className = "ghost-btn";
    btn.innerHTML = "⚡ Scansiona Live";
    btn.title = "Recupera dati reali da eplay24.it";
    toolbar.insertBefore(btn, toolbar.firstChild);

    // Pulsante config
    const cfgBtn = document.createElement("button");
    cfgBtn.id = "scanCfgBtn";
    cfgBtn.className = "ghost-btn";
    cfgBtn.innerHTML = "⚙";
    cfgBtn.title = "Configura scansione";
    toolbar.insertBefore(cfgBtn, btn.nextSibling);

    // Pannello config
    const panel = document.createElement("div");
    panel.id = "scanPanel";
    Object.assign(panel.style, {
      display: "none", position: "fixed", top: "70px", left: "50%",
      transform: "translateX(-50%)", background: "#fff",
      border: "1px solid #dbe2e6", borderRadius: "10px",
      padding: "18px 20px", zIndex: "999",
      boxShadow: "0 12px 36px rgba(20,34,42,.15)",
      minWidth: "320px", fontSize: "13px", lineHeight: "1.6",
    });
    panel.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:14px">Scansione Live — Eplay24</h3>
      <div style="display:grid;gap:10px">
        <div style="display:flex;gap:16px">
          <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="chkCalcio" checked> Calcio</label>
          <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="chkTennis" checked> Tennis</label>
          <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="chkBasket" checked> Basket</label>
        </div>
        <label style="display:grid;gap:4px;color:#69757d;font-size:12px">
          Numero eventi per sport
          <select id="selLimit" style="min-height:34px;border:1px solid #dbe2e6;border-radius:7px;padding:0 9px">
            <option value="3">3 eventi</option>
            <option value="5" selected>5 eventi</option>
            <option value="10">10 eventi</option>
            <option value="20">20 eventi</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px">
          <input type="checkbox" id="chkMerge" checked>
          Mantieni dati esistenti (merge)
        </label>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button id="startScanBtn"
            style="flex:1;min-height:36px;border-radius:7px;background:#117c8b;color:#fff;border:none;font-weight:700;cursor:pointer">
            ▶ Avvia
          </button>
          <button id="closePanelBtn"
            style="min-height:36px;border-radius:7px;background:#fff;border:1px solid #dbe2e6;cursor:pointer;padding:0 12px">
            Chiudi
          </button>
        </div>
      </div>`;
    document.body.appendChild(panel);

    // Barra progresso
    const bar = document.createElement("div");
    bar.id = "scanBar";
    Object.assign(bar.style, {
      display: "none", position: "fixed", top: "0", left: "0", right: "0",
      zIndex: "1000", background: "#15252b", color: "#e6f4f6",
      fontSize: "12px", padding: "8px 16px", alignItems: "center", gap: "12px",
    });
    bar.innerHTML = `
      <span id="barText" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Caricamento...</span>
      <div style="width:160px;height:6px;background:#2a3e47;border-radius:3px;overflow:hidden;flex-shrink:0">
        <div id="barFill" style="height:100%;background:#3db88c;border-radius:3px;width:0%;transition:width .3s"></div>
      </div>
      <span id="barPct" style="min-width:34px;text-align:right;flex-shrink:0">0%</span>
      <button id="abortBtn"
        style="background:transparent;border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:5px;padding:2px 8px;cursor:pointer;flex-shrink:0">✕</button>`;
    document.body.appendChild(bar);

    let aborted = false;

    const togglePanel = (force) => {
      panel.style.display = (force ?? panel.style.display === "none") ? "block" : "none";
    };

    const setBar = (text, pct, running) => {
      bar.style.display = "flex";
      document.getElementById("barText").textContent = text;
      document.getElementById("barFill").style.width = pct + "%";
      document.getElementById("barFill").style.background =
        running ? "#3db88c" : (text.startsWith("✓") ? "#1f7a45" : "#b42318");
      document.getElementById("barPct").textContent = running ? pct + "%" : "";
      if (!running) setTimeout(() => { bar.style.display = "none"; }, 4000);
    };

    btn.addEventListener("click", () => togglePanel(true));
    cfgBtn.addEventListener("click", () => togglePanel());
    document.getElementById("closePanelBtn").addEventListener("click", () => togglePanel(false));
    document.getElementById("abortBtn").addEventListener("click", () => {
      aborted = true;
      setBar("Scansione interrotta", 100, false);
    });

    document.getElementById("startScanBtn").addEventListener("click", async () => {
      const sports = [];
      if (document.getElementById("chkCalcio").checked) sports.push("calcio");
      if (document.getElementById("chkTennis").checked) sports.push("tennis");
      if (document.getElementById("chkBasket").checked) sports.push("basket");
      if (!sports.length) { alert("Seleziona almeno uno sport."); return; }

      const limit = parseInt(document.getElementById("selLimit").value);
      const merge = document.getElementById("chkMerge").checked;

      togglePanel(false);
      aborted = false;
      btn.disabled = true;
      btn.innerHTML = "⏳ Scansione...";
      bar.style.display = "flex";
      document.getElementById("barFill").style.width = "0%";

      try {
        const { events: newEvents, errors } = await scan({
          sports, limit,
          onProgress(done, total, label, sport) {
            if (aborted) return;
            const pct = total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 5;
            setBar(`${sport ? "[" + sport.toUpperCase() + "] " : ""}${label}`, pct, true);
          },
        });

        if (aborted) return;

        if (merge && global.state?.events?.length) {
          const map = new Map(global.state.events.map(e => [String(e.eventId), e]));
          newEvents.forEach(ev => {
            const id = String(ev.eventId);
            if (map.has(id)) {
              map.get(id).sites.Eplay24 = ev.sites.Eplay24;
              map.get(id).scannedAt = ev.scannedAt;
            } else {
              map.set(id, ev);
            }
          });
          global.state.events = [...map.values()];
        } else {
          global.state.events = newEvents;
        }

        if (typeof global.persist   === "function") global.persist();
        if (typeof global.renderAll === "function") global.renderAll();

        const note = errors.length ? ` · ${errors.length} errori` : "";
        setBar(`✓ ${newEvents.length} eventi caricati${note}`, 100, false);
        if (errors.length) console.warn("[OddsScanner]", errors);

      } catch (err) {
        console.error("[OddsScanner]", err);
        setBar(`❌ ${err.message}`, 100, false);
      } finally {
        btn.disabled = false;
        btn.innerHTML = "⚡ Scansiona Live";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectUI);
  } else {
    injectUI();
  }

  global.OddsScanner = { scan, getAllEvents };

})(window);
