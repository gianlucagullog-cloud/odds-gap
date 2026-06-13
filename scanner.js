// ================================================================
// SCANNER.JS v2 — Odds Gap Scanner
// Recupera dati reali da eplay24.it tramite proxy su Render.com
// ================================================================

(function (global) {
  "use strict";

  const PROXY_URL = (function () {
    const stored = localStorage.getItem("odds_proxy_url");
    if (stored) return stored.replace(/\/$/, "");
    return "https://odds-proxy.onrender.com"; // <-- aggiorna dopo deploy Render
  })();

  async function proxyPost(path, body) {
    const res = await fetch(PROXY_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`Proxy ${path} → HTTP ${res.status}`);
    return res.json();
  }

  async function proxyGet(path, params = {}) {
    const url = new URL(PROXY_URL + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Proxy ${path} → HTTP ${res.status}`);
    return res.json();
  }

  function normalizeMarkets(markets, sport) {
    const N = global.OddsNormalizer;
    if (!N) return markets;
    return markets.flatMap(mkt =>
      (mkt.linee || ["-"]).map(linea => ({
        name:     mkt.name,
        linee:    [linea],
        lineaNum: mkt.lineaNum ?? null,
        tab:      mkt.tab || "Principali",
        canonical: N.normalize(sport, mkt.name, linea, "match")?.canonicalKey || null,
      }))
    ).filter((m, i, arr) =>
      !m.canonical || arr.findIndex(x => x.canonical === m.canonical) === i
    );
  }

  async function scan(opts = {}) {
    const sports = opts.sports || ["calcio", "tennis", "basket"];
    const limit  = opts.limit  || 5;
    const onProg = opts.onProgress || (() => {});

    onProg(0, 1, "Connessione al proxy...", "");

    try {
      await proxyGet("/health");
    } catch {
      throw new Error(
        `Proxy non raggiungibile (${PROXY_URL}).\n\n` +
        `Se hai appena fatto il deploy su Render attendi ~1 min,\n` +
        `poi aggiorna l'URL con:\n` +
        `localStorage.setItem('odds_proxy_url', 'https://TUO-NOME.onrender.com')\n` +
        `e ricarica la pagina.`
      );
    }

    onProg(0, 1, "Recupero palinsesto...", "");
    const data = await proxyPost("/api/scan", { sports, limit });
    if (data.error) throw new Error(data.error);

    const rawEvents = data.events || [];
    const total = rawEvents.length;

    const events = rawEvents.map((ev, i) => {
      onProg(i + 1, total, ev.label, ev.sport);
      const sport = ev.sport || "calcio";
      const epMarkets = normalizeMarkets(ev.sites?.Eplay24?.markets || [], sport);
      return {
        eventId: ev.eventId,
        label:   ev.label,
        sport,
        group:   ev.group,
        time:    ev.time,
        scannedAt: ev.scannedAt || Date.now(),
        sites: {
          Eplay24: {
            markets: epMarkets,
            tabs: [...new Set(epMarkets.map(m => m.tab))],
          },
        },
      };
    });

    onProg(total, total, "Completato", "");
    return { events, errors: data.errors || [] };
  }

  // ---- UI ----
  function injectUI() {
    const toolbar = document.querySelector(".toolbar");
    if (!toolbar || document.getElementById("scanLiveBtn")) return;

    const btn = document.createElement("button");
    btn.id = "scanLiveBtn";
    btn.className = "ghost-btn";
    btn.innerHTML = "⚡ Scansiona Live";
    btn.title = "Recupera dati reali da eplay24.it";
    toolbar.insertBefore(btn, toolbar.firstChild);

    const settingsBtn = document.createElement("button");
    settingsBtn.id = "scanSettingsBtn";
    settingsBtn.className = "ghost-btn";
    settingsBtn.innerHTML = "⚙";
    settingsBtn.title = "Impostazioni scanner";
    toolbar.insertBefore(settingsBtn, btn.nextSibling);

    const panel = document.createElement("div");
    panel.id = "scanPanel";
    Object.assign(panel.style, {
      display:"none", position:"fixed", top:"70px", left:"50%",
      transform:"translateX(-50%)", background:"#fff",
      border:"1px solid #dbe2e6", borderRadius:"10px",
      padding:"18px 20px", zIndex:"999",
      boxShadow:"0 12px 36px rgba(20,34,42,.15)",
      minWidth:"340px", fontSize:"13px", lineHeight:"1.5",
    });
    panel.innerHTML = `
      <h3 style="margin:0 0 14px;font-size:14px">Scansione Live — Eplay24</h3>
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
          Mantieni dati esistenti (aggiorna solo Eplay24)
        </label>
        <details style="font-size:11px;color:#69757d">
          <summary style="cursor:pointer">URL Proxy (avanzato)</summary>
          <div style="margin-top:6px;display:grid;gap:4px">
            <input id="proxyUrlInput" type="text"
              style="min-height:32px;border:1px solid #dbe2e6;border-radius:6px;padding:0 8px;font-size:11px"
              placeholder="https://odds-proxy.onrender.com">
            <button id="saveProxyBtn"
              style="min-height:28px;border-radius:6px;background:#f0f4f5;border:1px solid #dbe2e6;cursor:pointer;font-size:11px">
              Salva URL
            </button>
          </div>
        </details>
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
      <span id="barText" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Connessione...</span>
      <div style="width:160px;height:6px;background:#2a3e47;border-radius:3px;overflow:hidden;flex-shrink:0">
        <div id="barFill" style="height:100%;background:#3db88c;border-radius:3px;width:0%;transition:width .35s"></div>
      </div>
      <span id="barPct" style="min-width:34px;text-align:right;flex-shrink:0">0%</span>
      <button id="abortBtn"
        style="background:transparent;border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:5px;padding:2px 8px;cursor:pointer;flex-shrink:0">
        ✕
      </button>`;
    document.body.appendChild(bar);

    let aborted = false;

    const togglePanel = (force) => {
      const show = force ?? (panel.style.display === "none");
      panel.style.display = show ? "block" : "none";
      if (show) {
        const inp = document.getElementById("proxyUrlInput");
        if (inp) inp.value = localStorage.getItem("odds_proxy_url") || PROXY_URL;
      }
    };

    const setBar = (text, pct, running) => {
      bar.style.display = "flex";
      document.getElementById("barText").textContent = text;
      document.getElementById("barFill").style.width = pct + "%";
      document.getElementById("barFill").style.background = running ? "#3db88c"
        : (text.startsWith("✓") ? "#1f7a45" : "#b42318");
      document.getElementById("barPct").textContent = running ? pct + "%" : "";
      if (!running) setTimeout(() => { bar.style.display = "none"; }, 4000);
    };

    btn.addEventListener("click", () => togglePanel(true));
    settingsBtn.addEventListener("click", () => togglePanel());
    document.getElementById("closePanelBtn").addEventListener("click", () => togglePanel(false));
    document.getElementById("abortBtn").addEventListener("click", () => {
      aborted = true;
      setBar("Scansione interrotta", 100, false);
    });

    document.getElementById("saveProxyBtn").addEventListener("click", () => {
      const url = (document.getElementById("proxyUrlInput").value || "").trim();
      if (!url) return;
      localStorage.setItem("odds_proxy_url", url);
      location.reload();
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

        const note = errors.length ? ` · ${errors.length} errori (vedi console)` : "";
        setBar(`✓ ${newEvents.length} eventi aggiornati${note}`, 100, false);
        if (errors.length) console.warn("[OddsScanner] errori:", errors);

      } catch (err) {
        console.error("[OddsScanner]", err);
        setBar(`❌ ${err.message.split("\n")[0]}`, 100, false);
        if (err.message.includes("Proxy non raggiungibile")) {
          setTimeout(() => alert(err.message), 100);
        }
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

  global.OddsScanner = { scan, proxyGet, proxyPost };

})(window);
