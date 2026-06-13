// ================================================================
// SCANNER.JS v5 — Odds Gap Scanner
// Usa solo GetAllEventsPrematch (GET, niente CORS)
// I mercati dettagliati vengono skippati (richiedono POST+JSON)
// ================================================================
(function (global) {
  "use strict";

  const EP = "https://api2.eplay24.it/api";
  const SPORT_MAP = { calcio: "Calcio", tennis: "Tennis", basket: "Basket" };

  // Cache 5 min
  const _cache = new Map();
  async function cached(key, fn, ttl = 300000) {
    const h = _cache.get(key);
    if (h && Date.now() - h.ts < ttl) return h.data;
    const data = await fn();
    _cache.set(key, { ts: Date.now(), data });
    return data;
  }

  // GET semplice senza header custom — niente preflight CORS
  async function epGet(path) {
    const res = await fetch(EP + path, {
      method: "GET",
      credentials: "omit",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`eplay24 ${path} → HTTP ${res.status}`);
    return res.json();
  }

  async function getAllEvents() {
    return cached("allEvents", () => epGet("/Palinsesto/GetAllEventsPrematch"));
  }

  // Costruisce mercati base dall'evento palinsesto (senza chiamate extra)
  function buildBaseMarkets(ev, sport) {
    const N = global.OddsNormalizer;
    const mkts = [];

    // 1X2 sempre disponibile
    const outcomes1x2 = ["1", "X", "2"];
    outcomes1x2.forEach(o => {
      const canonical = N?.normalize(sport, "Esito Finale 1X2", o, "match")?.canonicalKey || null;
      mkts.push({ name: "Esito Finale 1X2", linee: [o], tab: "Principali", lineaNum: null, canonical });
    });

    // Over/Under base (linee standard sempre offerte)
    [0.5, 1.5, 2.5, 3.5, 4.5].forEach(linea => {
      ["Over", "Under"].forEach(dir => {
        const name = `${dir} ${linea}`;
        const canonical = N?.normalize(sport, `U/O ${linea}`, dir, "match")?.canonicalKey || null;
        mkts.push({ name, linee: [String(linea)], tab: "Under/Over", lineaNum: linea, canonical });
      });
    });

    // GG/NG
    ["GG", "NG"].forEach(o => {
      const canonical = N?.normalize(sport, "GG/NG", o, "match")?.canonicalKey || null;
      mkts.push({ name: "GG/NG", linee: [o], tab: "GG/NG", lineaNum: null, canonical });
    });

    // Dedup per canonical
    const seen = new Set();
    return mkts.filter(m => {
      const k = m.canonical || `${m.name}|${m.linee[0]}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function buildTennisMarkets() {
    const N = global.OddsNormalizer;
    const mkts = [];
    ["Giocatore A", "Giocatore B"].forEach(g => {
      const canonical = N?.normalize("tennis", "Vincente Match", g, "match")?.canonicalKey || null;
      mkts.push({ name: "Vincente Match", linee: [g], tab: "Principali", lineaNum: null, canonical });
    });
    [20.5, 21.5, 22.5, 23.5, 24.5].forEach(linea => {
      ["Over", "Under"].forEach(dir => {
        const canonical = N?.normalize("tennis", `Over Games`, String(linea), "match")?.canonicalKey || null;
        mkts.push({ name: `${dir} Games ${linea}`, linee: [String(linea)], tab: "Games", lineaNum: linea, canonical });
      });
    });
    return mkts;
  }

  function buildBasketMarkets() {
    const N = global.OddsNormalizer;
    const mkts = [];
    ["Casa", "Ospite"].forEach(t => {
      const canonical = N?.normalize("basket", "Moneyline", t, "match")?.canonicalKey || null;
      mkts.push({ name: "Moneyline", linee: [t], tab: "Principali", lineaNum: null, canonical });
    });
    [160.5, 170.5, 180.5, 190.5, 200.5, 210.5].forEach(linea => {
      ["Over", "Under"].forEach(dir => {
        const canonical = N?.normalize("basket", `Over Punti`, String(linea), "match")?.canonicalKey || null;
        mkts.push({ name: `${dir} Punti ${linea}`, linee: [String(linea)], tab: "Totali", lineaNum: linea, canonical });
      });
    });
    return mkts;
  }

  function getMarketsForSport(ev, sport) {
    if (sport === "tennis") return buildTennisMarkets();
    if (sport === "basket") return buildBasketMarkets();
    return buildBaseMarkets(ev, sport);
  }

  async function scan(opts = {}) {
    const sports = opts.sports || ["calcio", "tennis", "basket"];
    const limit  = opts.limit  || 5;
    const onProg = opts.onProgress || (() => {});

    onProg(0, 1, "Caricamento palinsesto Eplay24...", "");
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

    const events = [];
    for (let i = 0; i < queue.length; i++) {
      const { e, sport } = queue[i];
      onProg(i, queue.length, e.label || `Evento ${e.Match_Id}`, sport);
      const markets = getMarketsForSport(e, sport);
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
    }

    onProg(queue.length, queue.length, "Completato", "");
    return { events, errors: [] };
  }

  // ---- UI ----
  function injectUI() {
    const toolbar = document.querySelector(".toolbar");
    if (!toolbar || document.getElementById("scanLiveBtn")) return;

    const btn = document.createElement("button");
    btn.id = "scanLiveBtn";
    btn.className = "ghost-btn";
    btn.innerHTML = "⚡ Scansiona Live";
    toolbar.insertBefore(btn, toolbar.firstChild);

    const cfgBtn = document.createElement("button");
    cfgBtn.id = "scanCfgBtn";
    cfgBtn.className = "ghost-btn";
    cfgBtn.innerHTML = "⚙";
    toolbar.insertBefore(cfgBtn, btn.nextSibling);

    const panel = document.createElement("div");
    panel.id = "scanPanel";
    Object.assign(panel.style, {
      display:"none", position:"fixed", top:"70px", left:"50%",
      transform:"translateX(-50%)", background:"#fff",
      border:"1px solid #dbe2e6", borderRadius:"10px",
      padding:"18px 20px", zIndex:"999",
      boxShadow:"0 12px 36px rgba(20,34,42,.15)",
      minWidth:"320px", fontSize:"13px", lineHeight:"1.6",
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
          <input type="checkbox" id="chkMerge" checked> Mantieni dati esistenti (merge)
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

    const bar = document.createElement("div");
    bar.id = "scanBar";
    Object.assign(bar.style, {
      display:"none", position:"fixed", top:"0", left:"0", right:"0",
      zIndex:"1000", background:"#15252b", color:"#e6f4f6",
      fontSize:"12px", padding:"8px 16px", alignItems:"center", gap:"12px",
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
        const { events: newEvents } = await scan({
          sports, limit,
          onProgress(done, total, label, sport) {
            if (aborted) return;
            const pct = total > 0 ? Math.min(99, Math.round((done/total)*100)) : 5;
            setBar(`${sport ? "["+sport.toUpperCase()+"] " : ""}${label}`, pct, true);
          },
        });

        if (aborted) return;

        // Accede a state in modo sicuro — app.js lo definisce su window
        const appState = global.state;
        if (!appState) throw new Error("app.js non ancora caricato");

        if (merge && appState.events?.length) {
          const map = new Map(appState.events.map(e => [String(e.eventId), e]));
          newEvents.forEach(ev => {
            const id = String(ev.eventId);
            if (map.has(id)) {
              map.get(id).sites.Eplay24 = ev.sites.Eplay24;
              map.get(id).scannedAt = ev.scannedAt;
            } else {
              map.set(id, ev);
            }
          });
          appState.events = [...map.values()];
        } else {
          appState.events = newEvents;
        }

        if (typeof global.persist   === "function") global.persist();
        if (typeof global.renderAll === "function") global.renderAll();

        setBar(`✓ ${newEvents.length} eventi caricati da Eplay24`, 100, false);

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
