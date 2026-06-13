// ================================================================
// SCANNER.JS v7 — parallelo, veloce
// ================================================================
(function (global) {
  "use strict";

  const EP = "https://api2.eplay24.it/api";
  const SPORT_MAP = { calcio: "Calcio", tennis: "Tennis", basket: "Basket" };

  // Cache semplice
  let _eventsCache = null;
  let _eventsCacheTs = 0;

  async function getAllEvents() {
    if (_eventsCache && Date.now() - _eventsCacheTs < 300000) return _eventsCache;
    const res = await fetch(EP + "/Palinsesto/GetAllEventsPrematch", {
      credentials: "omit", signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _eventsCache = await res.json();
    _eventsCacheTs = Date.now();
    return _eventsCache;
  }

  function buildMarkets(sport) {
    const N = global.OddsNormalizer;
    const mk = (name, linee, tab) => linee.map(l => ({
      name, linee: [l], tab, lineaNum: isNaN(+l) ? null : +l,
      canonical: N?.normalize(sport, name, l, "match")?.canonicalKey || null,
    }));
    if (sport === "tennis") return [
      ...mk("Vincente Match", ["Giocatore A","Giocatore B"], "Principali"),
      ...mk("Over Games", ["20.5","21.5","22.5","23.5"], "Games"),
      ...mk("Under Games", ["20.5","21.5","22.5","23.5"], "Games"),
    ];
    if (sport === "basket") return [
      ...mk("Moneyline", ["Casa","Ospite"], "Principali"),
      ...mk("Over Punti", ["170.5","180.5","190.5","200.5"], "Totali"),
      ...mk("Under Punti", ["170.5","180.5","190.5","200.5"], "Totali"),
    ];
    return [
      ...mk("Esito Finale 1X2", ["1","X","2"], "Principali"),
      ...mk("Over", ["0.5","1.5","2.5","3.5","4.5"], "Under/Over"),
      ...mk("Under", ["0.5","1.5","2.5","3.5","4.5"], "Under/Over"),
      ...mk("GG/NG", ["GG","NG"], "GG/NG"),
      ...mk("Doppia Chance", ["1X","X2","12"], "Principali"),
      ...mk("Draw No Bet", ["Casa","Ospite"], "Principali"),
    ];
  }

  async function scan(opts = {}) {
    const sports = opts.sports || ["calcio","tennis","basket"];
    const limit  = opts.limit  || 5;
    const onProg = opts.onProgress || (() => {});

    onProg(0, 1, "Caricamento palinsesto...", "");

    // Unica chiamata API — tutto il palinsesto in una volta
    const allEvents = await getAllEvents();
    const now = Date.now();

    const events = [];
    for (const sport of sports) {
      const evs = allEvents
        .filter(e => e.Sport_Desc === SPORT_MAP[sport])
        .filter(e => new Date(e.Match_Time).getTime() > now + 900000)
        .sort((a, b) => new Date(a.Match_Time) - new Date(b.Match_Time))
        .slice(0, limit);

      const markets = buildMarkets(sport);
      const seen = new Set();
      const dedup = markets.filter(m => {
        const k = m.canonical || `${m.name}|${m.linee[0]}`;
        return seen.has(k) ? false : !!seen.add(k);
      });

      evs.forEach(e => events.push({
        eventId: String(e.Match_Id),
        label: e.label || "",
        sport, group: e.Group_Name || "",
        time: e.Match_Time || "",
        scannedAt: Date.now(),
        sites: { Eplay24: { markets: dedup, tabs: [...new Set(dedup.map(m => m.tab))] } },
      }));
    }

    onProg(1, 1, "Completato", "");
    return { events };
  }

  function waitForState(cb, n = 0) {
    if (global.state && typeof global.renderAll === "function") cb();
    else if (n < 50) setTimeout(() => waitForState(cb, n + 1), 100);
  }

  function injectUI() {
    const toolbar = document.querySelector(".toolbar");
    if (!toolbar || document.getElementById("scanLiveBtn")) return;

    const btn = document.createElement("button");
    btn.id = "scanLiveBtn"; btn.className = "ghost-btn";
    btn.innerHTML = "⚡ Scansiona Live";
    toolbar.insertBefore(btn, toolbar.firstChild);

    const cfgBtn = document.createElement("button");
    cfgBtn.id = "scanCfgBtn"; cfgBtn.className = "ghost-btn";
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
      minWidth:"300px", fontSize:"13px", lineHeight:"1.6",
    });
    panel.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:14px">Scansiona Live — Eplay24</h3>
      <div style="display:grid;gap:10px">
        <div style="display:flex;gap:16px">
          <label><input type="checkbox" id="chkCalcio" checked> Calcio</label>
          <label><input type="checkbox" id="chkTennis" checked> Tennis</label>
          <label><input type="checkbox" id="chkBasket" checked> Basket</label>
        </div>
        <label style="display:grid;gap:4px;color:#69757d;font-size:12px">
          Numero eventi per sport
          <select id="selLimit" style="min-height:34px;border:1px solid #dbe2e6;border-radius:7px;padding:0 8px">
            <option value="3">3</option><option value="5" selected>5</option>
            <option value="10">10</option><option value="20">20</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px">
          <input type="checkbox" id="chkMerge" checked> Mantieni dati esistenti
        </label>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button id="startScanBtn" style="flex:1;min-height:36px;border-radius:7px;background:#117c8b;color:#fff;border:none;font-weight:700;cursor:pointer">▶ Avvia</button>
          <button id="closePanelBtn" style="min-height:36px;border-radius:7px;background:#fff;border:1px solid #dbe2e6;cursor:pointer;padding:0 12px">Chiudi</button>
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
      <span id="barText" style="flex:1">Caricamento...</span>
      <div style="width:160px;height:6px;background:#2a3e47;border-radius:3px;overflow:hidden;flex-shrink:0">
        <div id="barFill" style="height:100%;background:#3db88c;border-radius:3px;width:0%;transition:width .3s"></div>
      </div>
      <button id="abortBtn" style="background:transparent;border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:5px;padding:2px 8px;cursor:pointer">✕</button>`;
    document.body.appendChild(bar);

    const togglePanel = (f) => { panel.style.display = (f ?? panel.style.display==="none") ? "block" : "none"; };
    const setBar = (text, pct, running) => {
      bar.style.display = "flex";
      document.getElementById("barText").textContent = text;
      document.getElementById("barFill").style.width = pct + "%";
      document.getElementById("barFill").style.background = running ? "#3db88c" : (text.startsWith("✓") ? "#1f7a45" : "#b42318");
      if (!running) setTimeout(() => { bar.style.display = "none"; }, 3000);
    };

    btn.addEventListener("click", () => togglePanel(true));
    cfgBtn.addEventListener("click", () => togglePanel());
    document.getElementById("closePanelBtn").addEventListener("click", () => togglePanel(false));
    document.getElementById("abortBtn").addEventListener("click", () => setBar("Interrotta", 100, false));

    document.getElementById("startScanBtn").addEventListener("click", () => {
      const sports = [];
      if (document.getElementById("chkCalcio").checked) sports.push("calcio");
      if (document.getElementById("chkTennis").checked) sports.push("tennis");
      if (document.getElementById("chkBasket").checked) sports.push("basket");
      if (!sports.length) { alert("Seleziona almeno uno sport."); return; }

      const limit = parseInt(document.getElementById("selLimit").value);
      const merge = document.getElementById("chkMerge").checked;

      togglePanel(false);
      btn.disabled = true; btn.innerHTML = "⏳...";
      setBar("Caricamento palinsesto...", 30, true);

      waitForState(async () => {
        try {
          const { events: newEvents } = await scan({ sports, limit });

          if (merge && global.state.events?.length) {
            const map = new Map(global.state.events.map(e => [String(e.eventId), e]));
            newEvents.forEach(ev => {
              const id = String(ev.eventId);
              if (map.has(id)) { map.get(id).sites.Eplay24 = ev.sites.Eplay24; map.get(id).scannedAt = ev.scannedAt; }
              else map.set(id, ev);
            });
            global.state.events = [...map.values()];
          } else {
            global.state.events = newEvents;
          }

          if (typeof global.persist   === "function") global.persist();
          if (typeof global.renderAll === "function") global.renderAll();
          setBar(`✓ ${newEvents.length} eventi caricati`, 100, false);

        } catch (err) {
          console.error("[OddsScanner]", err);
          setBar(`❌ ${err.message}`, 100, false);
        } finally {
          btn.disabled = false; btn.innerHTML = "⚡ Scansiona Live";
        }
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectUI);
  else injectUI();

  global.OddsScanner = { scan, getAllEvents };
})(window);
