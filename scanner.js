// ================================================================
// SCANNER.JS — Odds Gap Scanner
// Recupera i dati in tempo reale dall'API di eplay24.it
// e li inietta in state.events nel formato atteso da app.js
//
// NESSUNA modifica a index.html / app.js / normalizer.js necessaria:
// aggiungere solo <script src="scanner.js"></script> prima di </body>
// ================================================================

(function (global) {
  "use strict";

  // ---- Costanti ----
  const EP_BASE = "https://api2.eplay24.it/api";
  const PROXY   = "https://api.allorigins.win/raw?url=";   // fallback CORS se serve
  const CACHE_TTL_MS = 5 * 60 * 1000;                      // 5 min cache locale

  const SPORT_IDS = { calcio: 1, tennis: 2, basket: 7 };
  const SPORT_NAMES = { Calcio: "calcio", Tennis: "tennis", Basket: "basket" };

  // ---- Cache in memoria ----
  const _cache = new Map(); // key → { ts, data }

  function cached(key, fn, ttl = CACHE_TTL_MS) {
    const hit = _cache.get(key);
    if (hit && Date.now() - hit.ts < ttl) return Promise.resolve(hit.data);
    return fn().then(data => { _cache.set(key, { ts: Date.now(), data }); return data; });
  }

  // ---- Fetch con CORS diretto (eplay24 lo permette lato API) ----
  async function apiFetch(path, opts = {}) {
    const url = `${EP_BASE}${path}`;
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
    return res.json();
  }

  // ================================================================
  // 1. PALINSESTO — lista eventi
  // ================================================================

  /** Recupera tutti gli eventi prematch da eplay24 */
  async function fetchAllEvents() {
    return cached("allEvents", () =>
      apiFetch("/Palinsesto/GetAllEventsPrematch")
    );
  }

  /**
   * Filtra gli eventi per sport e restituisce i prossimi N eventi futuri.
   * @param {string} sport  "calcio" | "tennis" | "basket"
   * @param {number} limit  max eventi da restituire
   */
  async function fetchEventsBySport(sport, limit = 10) {
    const all = await fetchAllEvents();
    const sportName = sport.charAt(0).toUpperCase() + sport.slice(1); // "calcio" → "Calcio"
    const now = Date.now();
    return all
      .filter(e => e.Sport_Desc === sportName)
      .filter(e => new Date(e.Match_Time).getTime() > now + 15 * 60 * 1000)
      .sort((a, b) => new Date(a.Match_Time) - new Date(b.Match_Time))
      .slice(0, limit);
  }

  // ================================================================
  // 2. DETTAGLIO EVENTO — recupera i mercati di una singola partita
  // ================================================================

  /**
   * eplay24 espone i mercati di una partita attraverso la navigazione
   * sul palinsesto del torneo (Group_id). Usiamo l'API GetPalinsestoGruppo
   * che restituisce i mercati aggregati del torneo con linee per partita.
   *
   * Schema risposta: [{ Match_Id, TipoScommessa, CodBet, Quota1, Quota2, ... }]
   */
  async function fetchEventMarkets(event) {
    const key = `markets_${event.Match_Id}`;
    return cached(key, async () => {
      // Prova endpoint GetEventePalinsesto (POST con match_id)
      const attempts = [
        () => apiFetch("/Palinsesto/GetEventePalinsesto", {
          method: "POST",
          body: { match_id: event.Match_Id, Group_id: event.Group_id }
        }),
        () => apiFetch("/Palinsesto/GetPalinsestoCore", {
          method: "POST",
          body: { match_id: event.Match_Id }
        }),
        () => apiFetch(`/Palinsesto/GetPalinsestoEvento?match_id=${event.Match_Id}`),
        () => apiFetch(`/Palinsesto/GetEventQuote?match_id=${event.Match_Id}`),
      ];

      for (const attempt of attempts) {
        try {
          const data = await attempt();
          // Vari formati risposta: array diretto, o { ResponseData: [] }
          const rows = Array.isArray(data)
            ? data
            : Array.isArray(data?.ResponseData) && data.ResponseData.length > 0
              ? data.ResponseData
              : null;
          if (rows && rows.length > 0) return rows;
        } catch (_) { /* prova prossimo */ }
      }

      // Fallback: palinsesto del gruppo (meno preciso ma funziona sempre)
      return fetchGroupMarkets(event);
    }, 3 * 60 * 1000); // 3 min per i mercati
  }

  /**
   * Fallback: legge i mercati dal palinsesto del torneo e filtra per Match_Id.
   * Funziona sempre perché GetAllEventsPrematch ha già i dati base.
   */
  async function fetchGroupMarkets(event) {
    const key = `group_${event.Group_id}`;
    const data = await cached(key, () =>
      apiFetch("/Palinsesto/GetPalinsestoGruppo", {
        method: "POST",
        body: { group_id: event.Group_id, sport_id: event.Sport_Id || 1 }
      })
    );
    const rows = Array.isArray(data) ? data
      : Array.isArray(data?.ResponseData) ? data.ResponseData : [];
    return rows.filter(r =>
      !r.Match_Id || r.Match_Id === event.Match_Id
    );
  }

  // ================================================================
  // 3. NORMALIZZAZIONE — converte righe API → formato app.js
  // ================================================================

  /**
   * Mappa interna: TipoScommessa (codice eplay24) → { name, lineaField, targetField }
   * Aggiornato sulla base dei dati visti nelle sessioni precedenti.
   */
  const TIPO_MAP = {
    // Codici osservati nelle sessioni di debug
    1:   { name: "Esito Finale 1X2",  outcomes: ["1","X","2"],     tab: "Principali"  },
    2:   { name: "Doppia Chance",      outcomes: ["1X","X2","12"],   tab: "Principali"  },
    3:   { name: "Draw No Bet",        outcomes: ["Casa","Ospite"],   tab: "Principali"  },
    5:   { name: "GG/NG",             outcomes: ["GG","NG"],         tab: "GG/NG"       },
    6:   { name: "Pari/Dispari",       outcomes: ["Pari","Dispari"], tab: "Pari/Dispari"},
    7:   { name: "Risultato Esatto",   outcomes: null,               tab: "Esatto"      },
    8:   { name: "Parziale/Finale",    outcomes: null,               tab: "HT/FT"       },
    12:  { name: "Multigol",           outcomes: null,               tab: "Multigol"    },
    // Over/Under: codice base + linea numerica
    10:  { name: "Over", isOU: true,   tab: "Under/Over" },
    11:  { name: "Under", isOU: true,  tab: "Under/Over" },
    // Handicap
    15:  { name: "Handicap Europeo",   outcomes: null,  tab: "Handicap"  },
    16:  { name: "Handicap Asiatico",  outcomes: null,  tab: "Scommesse Asiatiche" },
    // Tempi
    20:  { name: "Esito 1° Tempo",     outcomes: ["1","X","2"], tab: "Tempi" },
    21:  { name: "Over 1° Tempo",      isOU: true, tab: "Tempi" },
    22:  { name: "Under 1° Tempo",     isOU: true, tab: "Tempi" },
    // Corner
    30:  { name: "Over Corner",        isOU: true, tab: "Corner" },
    31:  { name: "Under Corner",       isOU: true, tab: "Corner" },
    // Cartellini
    40:  { name: "Over Cartellini",    isOU: true, tab: "Sanzioni" },
    41:  { name: "Under Cartellini",   isOU: true, tab: "Sanzioni" },
    // Player props
    50:  { name: "Primo Marcatore",    outcomes: null,  tab: "Giocatori" },
    51:  { name: "Marcatore Qualsiasi",outcomes: null,  tab: "Giocatori" },
    52:  { name: "Ultimo Marcatore",   outcomes: null,  tab: "Giocatori" },
  };

  /**
   * Converte una riga dell'API eplay24 in uno o più oggetti market
   * nel formato { name, linee, tab, canonical }
   */
  function apiRowToMarkets(row, sport) {
    const N = global.OddsNormalizer;
    const markets = [];

    // Se la riga ha un campo TipoScommessa, usa la mappa
    const tipo = row.TipoScommessa ?? row.tipo_scommessa ?? row.CodBet ?? row.codBet;
    const tipoInfo = tipo != null ? TIPO_MAP[tipo] : null;

    const rawName = tipoInfo?.name
      || row.DescTipoScommessa
      || row.desc_tipo_scommessa
      || row.nome
      || row.Name
      || "Mercato";

    const linea = row.Linea ?? row.linea ?? row.Line ?? row.handicap ?? null;
    const tab   = tipoInfo?.tab || row.Categoria || "Principali";

    if (tipoInfo?.outcomes) {
      // Mercati con outcome fissi (1X2, DC, GG/NG, ecc.)
      tipoInfo.outcomes.forEach(outcome => {
        const quotaField = `Quota${outcome === "1" ? "1" : outcome === "X" ? "X" : "2"}`;
        const quota = row[quotaField] ?? row[outcome];
        if (quota != null && quota > 1) {
          const canonical = N?.normalize(sport, rawName, outcome, "match")?.canonicalKey || null;
          markets.push({ name: rawName, linee: [outcome], tab, canonical });
        }
      });
      return markets;
    }

    if (tipoInfo?.isOU && linea != null) {
      // Over/Under con linea numerica
      const quota = row.Quota1 ?? row.quota ?? null;
      if (quota != null && quota > 1) {
        const canonical = N?.normalize(sport, rawName, String(linea), "match")?.canonicalKey || null;
        markets.push({ name: rawName, linee: [String(linea)], lineaNum: parseFloat(linea), tab, canonical });
      }
      return markets;
    }

    // Generico: prova a normalizzare con quello che abbiamo
    const lineaStr = linea != null ? String(linea) : "-";
    const canonical = N?.normalize(sport, rawName, lineaStr, "match")?.canonicalKey || null;
    if (canonical) {
      markets.push({ name: rawName, linee: [lineaStr], tab, canonical });
    }

    return markets;
  }

  /**
   * Converte una lista di righe API nel formato sites.Eplay24.markets
   */
  function apiRowsToSiteMarkets(rows, sport) {
    const seen = new Set();
    const markets = [];
    (rows || []).forEach(row => {
      const mlist = apiRowToMarkets(row, sport);
      mlist.forEach(m => {
        const dedupKey = m.canonical || `${m.name}|${m.linee[0]}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          markets.push(m);
        }
      });
    });
    return markets;
  }

  // ================================================================
  // 4. COSTRUZIONE EVENTO — formato app.js
  // ================================================================

  function buildEvent(epEvent, marketRows) {
    const sport = SPORT_NAMES[epEvent.Sport_Desc] || epEvent.Sport_Desc?.toLowerCase() || "calcio";
    const markets = apiRowsToSiteMarkets(marketRows, sport);

    return {
      eventId: String(epEvent.Match_Id),
      label: epEvent.label || `${epEvent.Match_Hteam_SuperId} - ${epEvent.Match_Ateam_SuperId}`,
      sport,
      group: epEvent.Group_Name || epEvent.Category_Desc || "",
      time: epEvent.Match_Time,
      scannedAt: Date.now(),
      sites: {
        Eplay24: { markets, tabs: [...new Set(markets.map(m => m.tab))] },
        // Gli altri bookmaker vengono aggiunti dall'utente via Import JSON
        // oppure rilevati da future integrazioni
      },
    };
  }

  // ================================================================
  // 5. SCAN PUBBLICO — entry point
  // ================================================================

  /**
   * Scansiona il palinsesto di eplay24 e aggiorna state.events.
   *
   * @param {object} opts
   * @param {string[]} opts.sports       sport da scansionare, default ["calcio","tennis","basket"]
   * @param {number}   opts.limit        eventi per sport, default 5
   * @param {Function} opts.onProgress   callback(current, total, label)
   */
  async function scan(opts = {}) {
    const sports = opts.sports || ["calcio", "tennis", "basket"];
    const limit  = opts.limit  || 5;
    const onProg = opts.onProgress || (() => {});

    const allNew = [];
    const errors = [];
    let done = 0;
    const total = sports.length * limit; // stima

    for (const sport of sports) {
      let events;
      try {
        events = await fetchEventsBySport(sport, limit);
      } catch (err) {
        errors.push({ sport, error: err.message });
        continue;
      }

      for (const ep of events) {
        const label = ep.label || `Evento ${ep.Match_Id}`;
        onProg(done, events.length * sports.length, label, sport);
        try {
          const rows = await fetchEventMarkets(ep);
          allNew.push(buildEvent(ep, rows));
        } catch (err) {
          // Anche con zero mercati costruiamo l'evento (utile per sapere che esiste)
          allNew.push(buildEvent(ep, []));
          errors.push({ event: label, error: err.message });
        }
        done++;
        onProg(done, total, label, sport);
      }
    }

    return { events: allNew, errors };
  }

  // ================================================================
  // 6. INTEGRAZIONE CON app.js — UI nel sito
  // ================================================================

  function injectScannerUI() {
    // Aggiunge il pulsante "Scansiona Live" nella toolbar esistente
    const toolbar = document.querySelector(".toolbar");
    if (!toolbar) return;

    // Pulsante principale
    const btn = document.createElement("button");
    btn.id = "scanLiveBtn";
    btn.className = "ghost-btn";
    btn.innerHTML = "⚡ Scansiona Live";
    btn.title = "Recupera dati in tempo reale da eplay24.it";
    toolbar.insertBefore(btn, toolbar.firstChild);

    // Pulsante config (sport + numero eventi)
    const cfgBtn = document.createElement("button");
    cfgBtn.id = "scanCfgBtn";
    cfgBtn.className = "ghost-btn";
    cfgBtn.innerHTML = "⚙";
    cfgBtn.title = "Configura scansione";
    toolbar.insertBefore(cfgBtn, btn.nextSibling);

    // Pannello config (hidden di default)
    const cfgPanel = document.createElement("div");
    cfgPanel.id = "scanCfgPanel";
    cfgPanel.style.cssText = `
      display:none; position:fixed; top:70px; left:50%; transform:translateX(-50%);
      background:#fff; border:1px solid #dbe2e6; border-radius:10px;
      padding:18px 20px; z-index:999; box-shadow:0 12px 36px rgba(20,34,42,.15);
      min-width:320px; font-size:13px;
    `;
    cfgPanel.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:14px">Configura scansione Live</h3>
      <div style="display:grid;gap:10px">
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="scanCalcio" checked> Calcio
        </label>
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="scanTennis" checked> Tennis
        </label>
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="scanBasket" checked> Basket
        </label>
        <label style="display:grid;gap:4px;color:#69757d;font-size:12px">
          Eventi per sport
          <select id="scanLimit" style="min-height:34px;border:1px solid #dbe2e6;border-radius:7px;padding:0 8px">
            <option value="3">3</option>
            <option value="5" selected>5</option>
            <option value="10">10</option>
            <option value="20">20</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="scanMerge" checked>
          Mantieni dati esistenti (merge)
        </label>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button id="scanStartBtn" style="flex:1;min-height:36px;border-radius:7px;background:#117c8b;color:#fff;border:none;font-weight:700;cursor:pointer">
            Avvia
          </button>
          <button id="scanCancelCfgBtn" style="min-height:36px;border-radius:7px;background:#fff;border:1px solid #dbe2e6;cursor:pointer;padding:0 12px">
            Annulla
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(cfgPanel);

    // Progress bar (fixed, in alto)
    const progressBar = document.createElement("div");
    progressBar.id = "scanProgress";
    progressBar.style.cssText = `
      display:none; position:fixed; top:0; left:0; right:0; z-index:1000;
      background:#15252b; color:#e6f4f6; font-size:12px;
      padding:8px 16px; display:none; align-items:center; gap:12px;
    `;
    progressBar.innerHTML = `
      <span id="scanProgressText" style="flex:1">Caricamento...</span>
      <div style="width:180px;height:6px;background:#2a3e47;border-radius:3px;overflow:hidden">
        <div id="scanProgressFill" style="height:100%;background:#3db88c;border-radius:3px;width:0%;transition:width .3s"></div>
      </div>
      <span id="scanProgressPct" style="min-width:36px;text-align:right">0%</span>
      <button id="scanAbortBtn" style="background:transparent;border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:5px;padding:2px 8px;cursor:pointer">✕</button>
    `;
    document.body.appendChild(progressBar);

    let abortController = null;

    // ---- Bind eventi ----
    cfgBtn.addEventListener("click", () => {
      cfgPanel.style.display = cfgPanel.style.display === "none" ? "block" : "none";
    });
    document.getElementById("scanCancelCfgBtn").addEventListener("click", () => {
      cfgPanel.style.display = "none";
    });
    btn.addEventListener("click", () => {
      cfgPanel.style.display = "block";
    });

    document.getElementById("scanStartBtn").addEventListener("click", async () => {
      cfgPanel.style.display = "none";

      const sports = [];
      if (document.getElementById("scanCalcio").checked) sports.push("calcio");
      if (document.getElementById("scanTennis").checked) sports.push("tennis");
      if (document.getElementById("scanBasket").checked) sports.push("basket");
      if (!sports.length) { alert("Seleziona almeno uno sport."); return; }

      const limit = parseInt(document.getElementById("scanLimit").value);
      const merge = document.getElementById("scanMerge").checked;

      // UI: avvio
      btn.disabled = true;
      btn.innerHTML = "⏳ Scansione...";
      progressBar.style.display = "flex";
      document.getElementById("scanProgressFill").style.width = "0%";

      abortController = new AbortController();
      document.getElementById("scanAbortBtn").onclick = () => {
        abortController.abort();
        stopProgress("Scansione interrotta");
      };

      try {
        const { events: newEvents, errors } = await scan({
          sports,
          limit,
          onProgress: (done, total, label, sport) => {
            const pct = total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0;
            document.getElementById("scanProgressFill").style.width = pct + "%";
            document.getElementById("scanProgressPct").textContent = pct + "%";
            document.getElementById("scanProgressText").textContent =
              `[${sport?.toUpperCase()}] ${label} (${done}/${total})`;
          },
        });

        // Merge o replace
        if (merge && global.state?.events?.length) {
          const existing = new Map(global.state.events.map(e => [e.eventId, e]));
          newEvents.forEach(ev => {
            if (existing.has(ev.eventId)) {
              // Aggiorna solo i dati Eplay24, mantieni gli altri bookmaker
              const old = existing.get(ev.eventId);
              old.sites.Eplay24 = ev.sites.Eplay24;
              old.scannedAt = ev.scannedAt;
            } else {
              existing.set(ev.eventId, ev);
            }
          });
          global.state.events = [...existing.values()];
        } else {
          global.state.events = newEvents;
        }

        // Salva e aggiorna UI
        if (typeof global.persist === "function") global.persist();
        if (typeof global.renderAll === "function") global.renderAll();

        stopProgress(`✓ ${newEvents.length} eventi aggiornati${errors.length ? ` · ${errors.length} errori` : ""}`);

        if (errors.length) {
          console.warn("[Scanner] Errori durante la scansione:", errors);
        }

      } catch (err) {
        if (err.name !== "AbortError") {
          stopProgress(`Errore: ${err.message}`);
          console.error("[Scanner]", err);
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = "⚡ Scansiona Live";
      }
    });

    function stopProgress(msg) {
      document.getElementById("scanProgressFill").style.width = "100%";
      document.getElementById("scanProgressText").textContent = msg;
      document.getElementById("scanProgressPct").textContent = "✓";
      setTimeout(() => {
        progressBar.style.display = "none";
        document.getElementById("scanProgressFill").style.width = "0%";
      }, 3000);
    }
  }

  // ================================================================
  // 7. INIT
  // ================================================================

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectScannerUI);
    } else {
      injectScannerUI();
    }
  }

  // Espone API pubblica
  global.OddsScanner = { scan, fetchAllEvents, fetchEventsBySport, fetchEventMarkets };

  init();

})(window);
