const state = {
  catalog: [],
  events: [],
  target: "Marathonbet",
  eventFilter: "all",
  search: "",
};

const demoEvents = [
  {
    eventId: "demo-1",
    label: "Inter - Juventus",
    sport: "calcio",
    group: "Serie A",
    time: new Date(Date.now() + 86400000).toISOString(),
    scannedAt: Date.now(),
    sites: {
      Eplay24: {
        markets: [
          market("Esito Finale", ["1"], "Esito|1X2|Esito Finale|1|Match"),
          market("Esito Finale", ["X"], "Esito|1X2|Esito Finale|X|Match"),
          market("Esito Finale", ["2"], "Esito|1X2|Esito Finale|2|Match"),
          market("Over/Under Gol", ["Over"], "Goal|Totali|Over|2.5|Match"),
          market("GG/NG", ["GG"], "Goal|GG/NG|GG/NG|GG|Match"),
          market("Corner Over", ["Over"], "Statistiche|Corner|Over Corner|9.5|Match"),
        ],
      },
      Marathonbet: {
        markets: [
          market("Risultato partita", ["1"], "Esito|1X2|Esito Finale|1|Match"),
          market("Risultato partita", ["X"], "Esito|1X2|Esito Finale|X|Match"),
          market("Risultato partita", ["2"], "Esito|1X2|Esito Finale|2|Match"),
          market("Totale gol", ["Over"], "Goal|Totali|Over|2.5|Match"),
        ],
      },
    },
  },
  {
    eventId: "demo-2",
    label: "Sinner - Alcaraz",
    sport: "tennis",
    group: "ATP",
    time: new Date(Date.now() + 172800000).toISOString(),
    scannedAt: Date.now(),
    sites: {
      Eplay24: {
        markets: [
          market("Vincente Match", ["Giocatore A"], "Esito|Vincente Match|Vincente Match|Giocatore A|Match"),
          market("Vincente Match", ["Giocatore B"], "Esito|Vincente Match|Vincente Match|Giocatore B|Match"),
          market("Over Games", ["Over"], "Games|Totali Games|Over|22.5|Match"),
          market("Tie-break", ["Si"], "Speciali|Tie-break|Tie-break nel match|Sì|Match"),
        ],
      },
      Marathonbet: { markets: [], notFound: true },
    },
  },
  {
    eventId: "demo-3",
    label: "Milano - Bologna",
    sport: "basket",
    group: "LBA",
    time: new Date(Date.now() + 259200000).toISOString(),
    scannedAt: Date.now(),
    sites: {
      Goldbet: {
        markets: [
          market("Moneyline", ["Casa"], "Esito|Moneyline|Moneyline|Casa|Match"),
          market("Moneyline", ["Ospite"], "Esito|Moneyline|Moneyline|Ospite|Match"),
          market("Totale Punti", ["Over"], "Punti|Totali Partita|Over|161.5|Match"),
          market("Handicap", ["-4.5"], "Esito|Handicap Spread|Handicap|-4.5|Match"),
        ],
      },
      Marathonbet: {
        markets: [
          market("Moneyline", ["Casa"], "Esito|Moneyline|Moneyline|Casa|Match"),
          market("Moneyline", ["Ospite"], "Esito|Moneyline|Moneyline|Ospite|Match"),
        ],
      },
    },
  },
];

function market(name, linee, canonical) {
  return { name, linee, canonical, tab: "Principali" };
}

document.addEventListener("DOMContentLoaded", async () => {
  bindUI();
  await loadCatalog();
  state.events = loadStoredEvents();
  if (!state.events.length) state.events = demoEvents;
  renderAll();
});

function bindUI() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  document.getElementById("jsonFile").addEventListener("change", importJsonFile);
  document.getElementById("sampleBtn").addEventListener("click", () => {
    state.events = structuredClone(demoEvents);
    persist();
    renderAll();
  });
  document.getElementById("clearBtn").addEventListener("click", () => {
    state.events = [];
    persist();
    renderAll();
  });
  document.addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-open-event]");
    if (!detailButton) return;
    state.search = detailButton.dataset.openEvent.toLowerCase();
    document.getElementById("searchInput").value = state.search;
    switchView("markets");
    renderAll();
  });
  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
  document.getElementById("exportMissingBtn").addEventListener("click", exportMissingMarathonbetCsv);
  document.getElementById("exportMissingPanelBtn").addEventListener("click", exportMissingMarathonbetCsv);
  document.getElementById("exportJsonBtn").addEventListener("click", exportJson);
  document.getElementById("targetBookmaker").addEventListener("change", (event) => {
    state.target = event.target.value;
    renderAll();
  });
  document.getElementById("searchInput").addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderAll();
  });
  document.getElementById("sportFilter").addEventListener("change", renderDashboard);
  document.getElementById("categorySportFilter").addEventListener("change", renderDashboard);
  document.getElementById("marketSort").addEventListener("change", renderMarkets);
  document.getElementById("catalogSportFilter").addEventListener("change", renderCatalog);

  document.querySelectorAll("#eventSegment button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#eventSegment button").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      state.eventFilter = button.dataset.filter;
      renderEvents();
    });
  });

  ["normSport", "normBookmaker", "normEvent", "normName", "normLine", "normTarget"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderNormalizer);
    document.getElementById(id).addEventListener("change", renderNormalizer);
  });
  document.getElementById("addMarketBtn").addEventListener("click", addNormalizedMarket);
}

async function loadCatalog() {
  try {
    const response = await fetch("catalog.json");
    state.catalog = await response.json();
  } catch {
    state.catalog = [];
  }
}

function loadStoredEvents() {
  try {
    return JSON.parse(localStorage.getItem("oddsGapEvents") || "[]");
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem("oddsGapEvents", JSON.stringify(state.events));
}

function switchView(viewId) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewId);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
}

async function importJsonFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    state.events = normalizeImport(parsed);
    persist();
    renderAll();
  } catch (error) {
    alert(`Import non riuscito: ${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function normalizeImport(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.events)) return input.events;
  if (input.scan_results) return Object.values(input.scan_results);
  if (input.eventsById) return Object.values(input.eventsById);
  if (typeof input === "object" && input !== null) {
    const values = Object.values(input);
    if (values.every((item) => item && item.sites)) return values;
  }
  throw new Error("Formato JSON non riconosciuto");
}

function enrichEvent(event) {
  const sites = event.sites || {};
  const targetSite = sites[state.target] || { markets: [], notFound: true };
  const targetKeys = keysForSite(targetSite);
  const otherSiteNames = Object.keys(sites).filter((name) => name !== state.target);
  const otherKeys = new Map();

  otherSiteNames.forEach((siteName) => {
    (sites[siteName]?.markets || []).forEach((mkt) => {
      const key = mkt.canonical || mkt.canonicalKey;
      if (!key) return;
      if (!otherKeys.has(key)) otherKeys.set(key, new Set());
      otherKeys.get(key).add(siteName);
    });
  });

  const missing = [...otherKeys.keys()]
    .filter((key) => !targetKeys.has(key))
    .map((key) => ({ key, sources: [...otherKeys.get(key)] }));

  const targetCount = targetKeys.size;
  const otherCount = otherKeys.size;
  const coverage = otherCount ? Math.round(((otherCount - missing.length) / otherCount) * 100) : 0;

  return {
    ...event,
    targetSite,
    targetCount,
    otherCount,
    missing,
    coverage,
    notFound: Boolean(targetSite.notFound),
  };
}

function keysForSite(site) {
  return new Set((site?.markets || []).map((mkt) => mkt.canonical || mkt.canonicalKey).filter(Boolean));
}

function filteredEvents() {
  return enrichedEvents(true);
}

function enrichedEvents(applySearch) {
  return state.events
    .map(enrichEvent)
    .filter((event) => {
      if (!applySearch || !state.search) return true;
      const haystack = [
        event.label,
        event.group,
        event.sport,
        ...event.missing.map((item) => item.key),
      ].join(" ").toLowerCase();
      return haystack.includes(state.search);
    });
}

function renderAll() {
  const bookmakerNames = new Set(["Marathonbet"]);
  state.events.forEach((event) => Object.keys(event.sites || {}).forEach((site) => bookmakerNames.add(site)));
  const targetSelect = document.getElementById("targetBookmaker");
  targetSelect.innerHTML = [...bookmakerNames].sort().map((name) => {
    return `<option ${name === state.target ? "selected" : ""}>${escapeHtml(name)}</option>`;
  }).join("");

  document.getElementById("catalogCount").textContent = `${state.catalog.length.toLocaleString("it-IT")} mercati`;
  renderDashboard();
  renderEvents();
  renderMarkets();
  renderCatalog();
  renderNormalizer();
}

function renderDashboard() {
  const events = filteredEvents();
  const totals = events.reduce((acc, event) => {
    acc.missing += event.missing.length;
    acc.others += event.otherCount;
    acc.target += event.targetCount;
    return acc;
  }, { missing: 0, others: 0, target: 0 });

  const coverage = totals.others ? Math.round(((totals.others - totals.missing) / totals.others) * 100) : 0;
  document.getElementById("kpiEvents").textContent = events.length.toLocaleString("it-IT");
  document.getElementById("kpiMissing").textContent = totals.missing.toLocaleString("it-IT");
  document.getElementById("kpiOthers").textContent = totals.others.toLocaleString("it-IT");
  document.getElementById("kpiCoverage").textContent = `${coverage}%`;

  const sport = document.getElementById("sportFilter").value;
  const priority = events
    .filter((event) => sport === "all" || event.sport === sport)
    .sort((a, b) => b.missing.length - a.missing.length)
    .slice(0, 8);

  document.getElementById("priorityList").innerHTML = priority.length
    ? priority.map(renderEventRow).join("")
    : `<div class="empty">Nessun evento da mostrare</div>`;

  const categorySport = document.getElementById("categorySportFilter").value;
  const categoryCounts = new Map();
  events
    .filter((event) => categorySport === "all" || event.sport === categorySport)
    .forEach((event) => event.missing.forEach((item) => {
      const category = splitKey(item.key).categoria || "Altro";
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }));

  const max = Math.max(1, ...categoryCounts.values());
  const rows = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  document.getElementById("categoryBreakdown").innerHTML = rows.length
    ? rows.map(([category, count]) => `
      <div class="bar-row">
        <div class="bar-head"><strong>${escapeHtml(category)}</strong><span>${count}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (count / max) * 100)}%"></div></div>
      </div>
    `).join("")
    : `<div class="empty">Nessun gap calcolato</div>`;
}

function renderEvents() {
  let events = filteredEvents();
  if (state.eventFilter === "gap") events = events.filter((event) => event.missing.length > 0);
  if (state.eventFilter === "notFound") events = events.filter((event) => event.notFound);
  events.sort((a, b) => b.missing.length - a.missing.length);

  document.getElementById("eventsList").innerHTML = events.length
    ? events.map(renderEventRow).join("")
    : `<div class="empty">Nessun evento disponibile</div>`;
}

function renderEventRow(event) {
  const level = event.notFound || event.missing.length > 10 ? "high" : event.missing.length > 3 ? "medium" : "low";
  const date = event.time ? new Date(event.time).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "Orario non disponibile";
  return `
    <article class="event-row">
      <div>
        <div class="event-title">
          <span>${escapeHtml(event.label || "Evento senza nome")}</span>
          <span class="pill sport">${escapeHtml(event.sport || "sport")}</span>
          <span class="pill ${level}">${event.notFound ? "Target assente" : `${event.missing.length} gap`}</span>
        </div>
        <div class="event-meta">${escapeHtml(event.group || "Torneo non disponibile")} · ${date} · altri ${event.otherCount} / target ${event.targetCount}</div>
      </div>
      <div class="event-actions">
        <button class="mini-btn" data-open-event="${escapeAttr(event.label || event.eventId)}">Dettagli</button>
      </div>
    </article>
  `;
}

function renderMarkets() {
  const sort = document.getElementById("marketSort").value;
  const rows = [];
  filteredEvents().forEach((event) => {
    event.missing.forEach((item) => {
      const parts = splitKey(item.key);
      rows.push({ event, item, parts });
    });
  });

  rows.sort((a, b) => {
    if (sort === "category") return `${a.parts.categoria}${a.parts.mercato}`.localeCompare(`${b.parts.categoria}${b.parts.mercato}`);
    if (sort === "sport") return `${a.event.sport}${a.event.label}`.localeCompare(`${b.event.sport}${b.event.label}`);
    return `${a.event.label}${a.parts.categoria}`.localeCompare(`${b.event.label}${b.parts.categoria}`);
  });

  document.getElementById("marketsTable").innerHTML = rows.length ? `
    <table>
      <thead>
        <tr>
          <th>Sport</th><th>Evento</th><th>Categoria</th><th>Mercato</th><th>Linea</th><th>Target</th><th>Fonti</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ event, item, parts }) => `
          <tr>
            <td>${escapeHtml(event.sport || "")}</td>
            <td><strong>${escapeHtml(event.label || "")}</strong><div class="event-meta">${escapeHtml(event.group || "")}</div></td>
            <td>${escapeHtml(parts.categoria)}<div class="market-key">${escapeHtml(parts.sottocategoria)}</div></td>
            <td>${escapeHtml(parts.mercato)}<div class="market-key">${escapeHtml(item.key)}</div></td>
            <td>${escapeHtml(parts.linea)}</td>
            <td>${escapeHtml(parts.target)}</td>
            <td>${escapeHtml(item.sources.join(", "))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : `<div class="empty">Nessun mercato mancante</div>`;
}

function renderCatalog() {
  const sport = document.getElementById("catalogSportFilter").value;
  const rows = state.catalog
    .filter((row) => sport === "all" || row.sport === sport)
    .filter((row) => {
      if (!state.search) return true;
      return Object.values(row).join(" ").toLowerCase().includes(state.search);
    })
    .slice(0, 500);

  document.getElementById("catalogTable").innerHTML = rows.length ? `
    <table>
      <thead>
        <tr>
          <th>Sport</th><th>Categoria</th><th>Sottocategoria</th><th>Mercato</th><th>Linea</th><th>Target</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.sport)}</td>
            <td>${escapeHtml(row.categoria)}</td>
            <td>${escapeHtml(row.sottocategoria)}</td>
            <td>${escapeHtml(row.mercato)}<div class="market-key">${escapeHtml(row.canonical)}</div></td>
            <td>${escapeHtml(row.linea)}</td>
            <td>${escapeHtml(row.target)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : `<div class="empty">Nessun mercato nel catalogo</div>`;
}

function renderNormalizer() {
  const sport = document.getElementById("normSport").value;
  const rawName = document.getElementById("normName").value;
  const rawLine = document.getElementById("normLine").value;
  const rawTarget = document.getElementById("normTarget").value;
  const normalized = window.OddsNormalizer?.normalize(sport, rawName, rawLine, rawTarget);
  document.getElementById("normResult").textContent = normalized
    ? JSON.stringify(normalized, null, 2)
    : "Mercato non riconosciuto dal normalizzatore.";
}

function addNormalizedMarket() {
  const sport = document.getElementById("normSport").value;
  const bookmaker = document.getElementById("normBookmaker").value.trim() || "Eplay24";
  const label = document.getElementById("normEvent").value.trim() || "Evento manuale";
  const rawName = document.getElementById("normName").value;
  const rawLine = document.getElementById("normLine").value;
  const rawTarget = document.getElementById("normTarget").value;
  const normalized = window.OddsNormalizer?.normalize(sport, rawName, rawLine, rawTarget);
  if (!normalized) return;

  const eventId = `manual-${slug(label)}-${sport}`;
  let event = state.events.find((item) => item.eventId === eventId);
  if (!event) {
    event = { eventId, label, sport, group: "Manuale", scannedAt: Date.now(), sites: {} };
    state.events.push(event);
  }
  event.sites[bookmaker] ||= { markets: [] };
  event.sites[bookmaker].markets.push({
    name: rawName,
    linee: [rawLine],
    tab: "Manuale",
    canonical: normalized.canonicalKey,
  });
  persist();
  renderAll();
}

function exportCsv() {
  const rows = buildMissingRows(state.target, true);
  downloadCsv(`gap_mercati_${slug(state.target)}_${today()}.csv`, rows);
}

function exportMissingMarathonbetCsv() {
  const previousTarget = state.target;
  state.target = "Marathonbet";
  const rows = buildMissingRows("Marathonbet", false);
  state.target = previousTarget;

  if (rows.length === 1) {
    alert("Non ci sono mercati mancanti su Marathonbet da esportare.");
    return;
  }

  downloadCsv(`mercati_mancanti_marathonbet_${today()}.csv`, rows);
}

function buildMissingRows(targetName, applySearch) {
  const rows = [[
    "Sport",
    "Evento",
    "Torneo",
    "Data evento",
    "Categoria",
    "Sottocategoria",
    "Mercato",
    "Linea",
    "Target quota",
    "Canonical Key",
    "Presente su",
    "Assente su",
    "Event ID",
  ]];

  enrichedEvents(applySearch).forEach((event) => {
    event.missing.forEach((item) => {
      const p = splitKey(item.key);
      rows.push([
        event.sport || "",
        event.label || "",
        event.group || "",
        event.time ? new Date(event.time).toLocaleString("it-IT") : "",
        p.categoria,
        p.sottocategoria,
        p.mercato,
        p.linea,
        p.target,
        item.key,
        item.sources.join(" | "),
        targetName,
        event.eventId || "",
      ]);
    });
  });

  return rows;
}

function downloadCsv(filename, rows) {
  const content = "\ufeff" + rows.map((row) => row.map(csvCell).join(";")).join("\n");
  download(filename, content, "text/csv;charset=utf-8");
}

function exportJson() {
  const output = {
    meta: { exportedAt: new Date().toISOString(), target: state.target, totalEvents: state.events.length },
    events: state.events,
    gaps: filteredEvents().map((event) => ({
      eventId: event.eventId,
      label: event.label,
      sport: event.sport,
      missingOnTarget: event.missing,
      targetCount: event.targetCount,
      otherCount: event.otherCount,
    })),
  };
  download(`odds_gap_${today()}.json`, JSON.stringify(output, null, 2), "application/json");
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function splitKey(key) {
  const [categoria = "", sottocategoria = "", mercato = "", linea = "", target = ""] = String(key).split("|");
  return { categoria, sottocategoria, mercato, linea, target };
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
