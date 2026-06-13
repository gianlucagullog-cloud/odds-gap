// ================================================================
// NORMALIZER.JS — mappa nomi grezzi siti → chiave canonica
// chiave canonica: "Categoria|Sottocategoria|Mercato|Linea|Target"
// ================================================================

const Normalizer = (() => {

  // ---- HELPER ----
  const clean = s => (s || '').toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-');

  const parseNum = s => {
    const n = parseFloat(String(s).replace(',', '.'));
    return isNaN(n) ? null : n;
  };

  // Estrae numero da stringa tipo "over 2.5", "u/o 2.5", "2.5"
  const extractLine = s => {
    const m = String(s).match(/([+-]?\d+(?:[.,]\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  };

  // ================================================================
  // CALCIO
  // ================================================================
  function normalizeCalcio(rawName, rawLine, rawTarget) {
    const name = clean(rawName);
    const line = extractLine(rawLine);
    const target = clean(rawTarget || 'match');

    // ---------- ESITO 1X2 ----------
    if (/^(esito finale?|1x2|match result|full.?time result|risultato finale)/.test(name)) {
      const l = String(rawLine).trim();
      if (['1','casa','home'].includes(clean(l))) return key('Esito','1X2','Esito Finale','1','Match');
      if (['x','pareggio','draw'].includes(clean(l)))  return key('Esito','1X2','Esito Finale','X','Match');
      if (['2','ospite','away'].includes(clean(l)))    return key('Esito','1X2','Esito Finale','2','Match');
    }

    // ---------- DOPPIA CHANCE ----------
    if (/doppia chance|double chance/.test(name)) {
      const l = clean(String(rawLine));
      const lMap = {'1x':'1X','x2':'X2','12':'12','1 o x':'1X','x o 2':'X2','1 o 2':'12'};
      const mapped = lMap[l] || l.toUpperCase();
      return key('Esito','Doppia Chance','Doppia Chance', mapped, 'Match');
    }

    // ---------- DRAW NO BET ----------
    if (/draw.?no.?bet|rimborso.*pareggio/.test(name)) {
      const l = clean(String(rawLine));
      const t = (['1','casa','home'].includes(l)) ? 'Casa' :
                (['2','ospite','away'].includes(l)) ? 'Ospite' : rawLine;
      return key('Esito','Draw No Bet','Draw No Bet', t, 'Match');
    }

    // ---------- HANDICAP EUROPEO ----------
    if (/handicap\s*(europeo)?/.test(name) && !/asiatico|asian|spread/.test(name)) {
      if (line !== null) return key('Esito','Handicap Europeo','Handicap Europeo', line, 'Match');
    }

    // ---------- OVER / UNDER GOAL (TOTALI) ----------
    const ouGol = /^(over|under|o\/u|u\/o|totale\s*gol|gol\s*totali|goals?\s*(over|under)|total\s*goals?)/.test(name)
                  || /^u\/o\s*\d/.test(name);
    if (ouGol && !(/corner|angol|cartell|falli|tiri|fuorigioco|punt|game|set|rimbalz|assist/.test(name))) {
      if (line === null) return null;
      const mercato = /under/.test(name) ? 'Under' : 'Over';
      const tgt = /casa|home/.test(target) ? 'Casa' :
                  /ospite|away/.test(target) ? 'Ospite' : 'Match';
      return key('Goal','Totali', mercato, line, tgt);
    }

    // ---------- GG / NG ----------
    if (/gg\s*\/?\s*ng|goal.?no.?goal|entrambe.*segnano|both.*score/.test(name)) {
      const periodo = /1.?\s*tempo|primo\s*tempo|1st\s*half/.test(name) ? '1° Tempo' :
                      /2.?\s*tempo|second[o]?\s*tempo|2nd\s*half/.test(name) ? '2° Tempo' : '';
      const mkt = periodo ? `GG/NG ${periodo}` : 'GG/NG';
      const sub = periodo ? 'GG/NG' : 'GG/NG';
      const l = /gg|goal|si|yes|sì/.test(clean(String(rawLine))) ? 'GG' : 'NG';
      return key('Goal', sub, mkt, l, 'Match');
    }

    // ---------- MULTIGOL ----------
    if (/multigol|multi.?gol|fascia.?gol/.test(name)) {
      const fascia = String(rawLine).trim();
      const tgt = /casa|home/.test(target) ? 'Casa' :
                  /ospite|away/.test(target) ? 'Ospite' : 'Match';
      const mkt = tgt === 'Match' ? 'Multigol' : `Multigol ${tgt}`;
      return key('Goal','Multigol', mkt, fascia, tgt);
    }

    // ---------- PARI / DISPARI GOL ----------
    if (/pari.?dispari|odd.?even/.test(name) && !/corner|cartell|cartellini/.test(name)) {
      const l = /pari|even/.test(clean(String(rawLine))) ? 'Pari' : 'Dispari';
      const tgt = /casa|home/.test(target) ? 'Casa' :
                  /ospite|away/.test(target) ? 'Ospite' : 'Match';
      return key('Goal','Pari/Dispari','Pari/Dispari', l, tgt);
    }

    // ---------- RISULTATO ESATTO ----------
    if (/risultato\s*esatto|correct\s*score|esatto$/.test(name) && !/tempo|half/.test(name)) {
      return key('Risultato','Risultato Esatto','Risultato Esatto', String(rawLine).trim(), 'Match');
    }

    // ---------- HT / FT (PARZIALE/FINALE) ----------
    if (/ht.?ft|parziale.?finale|intervallo.?finale|half.?time.?full.?time/.test(name)) {
      return key('Risultato','HT/FT','Parziale/Finale', String(rawLine).trim(), 'Match');
    }

    // ---------- PRIMO TEMPO ----------
    const is1T = /1.?\s*tempo|primo\s*tempo|1st\s*half|ht\b/.test(name);
    const is2T = /2.?\s*tempo|second[o]?\s*tempo|2nd\s*half/.test(name);

    if (is1T && /esito|1x2|result/.test(name)) {
      const l = ['1','x','2'].includes(clean(String(rawLine))) ? String(rawLine).toUpperCase() : rawLine;
      return key('Tempo','1° Tempo','Esito 1° Tempo', l, 'Match');
    }
    if (is1T && /doppia/.test(name)) {
      return key('Tempo','1° Tempo','Doppia Chance 1° Tempo', String(rawLine).toUpperCase(), 'Match');
    }
    if (is1T && /over|under|u\/o/.test(name) && line !== null) {
      const m = /under/.test(name) ? 'Under' : 'Over';
      return key('Tempo','1° Tempo',`${m} 1° Tempo`, line, 'Match');
    }
    if (is1T && /gg|ng/.test(name)) {
      const l = /gg|si|yes/.test(clean(String(rawLine))) ? 'GG' : 'NG';
      return key('Tempo','1° Tempo','GG/NG 1° Tempo', l, 'Match');
    }
    if (is1T && /esatto|correct/.test(name)) {
      return key('Tempo','1° Tempo','Risultato Esatto 1° Tempo', String(rawLine).trim(), 'Match');
    }
    if (is2T && /esito|1x2/.test(name)) {
      return key('Tempo','2° Tempo','Esito 2° Tempo', String(rawLine).toUpperCase(), 'Match');
    }
    if (is2T && /over|under/.test(name) && line !== null) {
      const m = /under/.test(name) ? 'Under' : 'Over';
      return key('Tempo','2° Tempo',`${m} 2° Tempo`, line, 'Match');
    }

    // ---------- HANDICAP ASIATICO ----------
    if (/asiatico|asian\s*handicap/.test(name) && line !== null) {
      const tgt = /ospite|away/.test(target) ? 'Ospite' : 'Casa';
      return key('Handicap','Handicap Asiatico', tgt, line, 'Match');
    }

    // ---------- CORNER ----------
    if (/corner|angol/.test(name)) {
      if (/over|under/.test(name) && line !== null) {
        const m = /under/.test(name) ? 'Under' : 'Over';
        return key('Statistiche','Corner',`${m} Corner`, line, 'Match');
      }
      if (/handicap/.test(name) && line !== null)
        return key('Statistiche','Corner','Handicap Corner', line, 'Match');
      if (/pari|dispari/.test(name)) {
        const l = /pari/.test(clean(String(rawLine))) ? 'Pari' : 'Dispari';
        return key('Statistiche','Corner','Pari/Dispari Corner', l, 'Match');
      }
      if (/primo|first/.test(name)) {
        const tgt = /ospite|away/.test(clean(String(rawLine))) ? 'Ospite' : 'Casa';
        return key('Statistiche','Corner','Corner Primo', tgt, 'Match');
      }
    }

    // ---------- CARTELLINI ----------
    if (/cartell|card|sanzioni/.test(name) && !/giocatore|player/.test(name)) {
      if (/over|under/.test(name) && line !== null) {
        const m = /under/.test(name) ? 'Under' : 'Over';
        return key('Statistiche','Cartellini',`${m} Cartellini`, line, 'Match');
      }
      if (/pari|dispari/.test(name)) {
        const l = /pari/.test(clean(String(rawLine))) ? 'Pari' : 'Dispari';
        return key('Statistiche','Cartellini','Pari/Dispari Cartellini', l, 'Match');
      }
    }

    // ---------- FALLI ----------
    if (/falli?\b/.test(name) && !/giocatore|player/.test(name)) {
      if (/over|under/.test(name) && line !== null) {
        const m = /under/.test(name) ? 'Under' : 'Over';
        return key('Statistiche','Falli',`${m} Falli`, line, 'Match');
      }
    }

    // ---------- TIRI IN PORTA ----------
    if (/tiri?\s*in\s*porta|shots?\s*on\s*target/.test(name) && !/giocatore|player/.test(name)) {
      if (/over|under/.test(name) && line !== null) {
        const m = /under/.test(name) ? 'Under' : 'Over';
        return key('Statistiche','Tiri in Porta',`${m} Tiri in Porta`, line, 'Match');
      }
    }

    // ---------- TIRI ----------
    if (/tiri?\b/.test(name) && !/porta|target|giocatore/.test(name)) {
      if (/over|under/.test(name) && line !== null) {
        const m = /under/.test(name) ? 'Under' : 'Over';
        return key('Statistiche','Tiri',`${m} Tiri`, line, 'Match');
      }
    }

    // ---------- FUORIGIOCO ----------
    if (/fuorigioco|offsid/.test(name)) {
      if (/over|under/.test(name) && line !== null) {
        const m = /under/.test(name) ? 'Under' : 'Over';
        return key('Statistiche','Fuorigioco',`${m} Fuorigioco`, line, 'Match');
      }
    }

    // ---------- PLAYER PROPS CALCIO ----------
    if (/primo\s*marcator/.test(name))  return key('Player Props','Marcatore','Primo Marcatore','-','Giocatore');
    if (/ultimo\s*marcator/.test(name)) return key('Player Props','Marcatore','Ultimo Marcatore','-','Giocatore');
    if (/marcator.*qualsiasi|anytime.*scorer|marcatore/.test(name) && !/primo|ultimo/.test(name))
      return key('Player Props','Marcatore','Marcatore Qualsiasi','-','Giocatore');
    if (/assist/.test(name) && /giocatore|player/.test(name) && /over|under/.test(name) && line !== null) {
      const m = /under/.test(name) ? 'Under' : 'Over';
      return key('Player Props','Assist',`${m} Assist`, line, 'Giocatore');
    }
    if (/cartell.*giocatore|player.*card/.test(name)) {
      if (/giallo|yellow/.test(name)) return key('Player Props','Cartellini','Cartellino Giallo SI/NO','-','Giocatore');
      if (/rosso|red/.test(name))     return key('Player Props','Cartellini','Cartellino Rosso SI/NO','-','Giocatore');
      if ((/over|under/.test(name)) && line !== null) {
        const m = /under/.test(name) ? 'Under' : 'Over';
        return key('Player Props','Cartellini',`${m} Cartellini Giocatore`, line, 'Giocatore');
      }
    }

    // ---------- SPECIALI ----------
    if (/gol.*palo|palo.*traversa/.test(name))    return key('Speciali','Speciali Partita','Gol/Palo/Traversa','SI/NO','Match');
    if (/clean.?sheet.*casa|no\s*gol.*casa/.test(name)) return key('Speciali','Speciali Partita','Clean Sheet Casa','SI/NO','Match');
    if (/clean.?sheet.*ospite|no\s*gol.*ospite/.test(name)) return key('Speciali','Speciali Partita','Clean Sheet Ospite','SI/NO','Match');
    if (/rigore/.test(name)) return key('Speciali','Speciali Partita','Rigore nel match','SI/NO','Match');
    if (/var/.test(name))    return key('Speciali','Speciali Partita','VAR nel match','SI/NO','Match');
    if (/espulsion|rosso/.test(name) && !/cartellino/.test(name)) return key('Speciali','Speciali Partita','Espulsione nel match','SI/NO','Match');

    // ---------- ANTEPOST ----------
    if (/vincitore.*torneo|vince.*campionato|winner.*tournament/.test(name))
      return key('Antepost','Antepost','Vincitore Torneo','-','Match');
    if (/capocannoniere|top.*scorer/.test(name))
      return key('Antepost','Antepost','Capocannoniere','-','Match');

    // ---------- BET BUILDER / COMBO ----------
    if (/bet.?builder|betbuilder|costruttore/.test(name))
      return key('Combo','Bet Builder','Bet Builder','libero','Match');

    return null; // non riconosciuto
  }

  // ================================================================
  // TENNIS
  // ================================================================
  function normalizeTennis(rawName, rawLine, rawTarget) {
    const name = clean(rawName);
    const line = extractLine(rawLine);

    if (/vincente\s*match|match\s*winner|winner/.test(name) && !/set|game/.test(name))
      return key('Esito','Vincente Match','Vincente Match',
        /giocatore\s*a|player\s*1|home/.test(clean(String(rawLine))) ? 'Giocatore A' : 'Giocatore B', 'Match');

    if (/handicap\s*set|set\s*handicap/.test(name) && line !== null)
      return key('Esito','Handicap Set','Handicap Set', line, 'Match');

    if (/risultato\s*esatto\s*set|correct\s*score\s*set/.test(name))
      return key('Risultato','Risultato Esatto Set','Risultato Esatto Set', String(rawLine).trim(), 'Match');

    // Games Over/Under
    if (/game[s]?\s*(over|under|totali|o\/u)|over.*game|under.*game/.test(name) && line !== null) {
      const m = /under/.test(name) ? 'Under' : 'Over';
      const setNum = name.match(/set\s*(\d)/)?.[1];
      if (setNum) return key('Set','Games per Set',`${m} Games Set ${setNum}`, line, 'Match');
      return key('Games','Totali Games', m, line, 'Match');
    }

    // Totali Set
    if (/set[s]?\s*(over|under|total)|over.*set|under.*set/.test(name) && line !== null) {
      const m = /under/.test(name) ? 'Under' : 'Over';
      return key('Set','Totali Set',`${m} Set`, line, 'Match');
    }

    // Vincente Set
    if (/vincente\s*set\s*(\d)|set\s*(\d)\s*vincente/.test(name)) {
      const setNum = name.match(/set\s*(\d)|(\d)\s*set/)?.[1] || '1';
      const gioc = /giocatore\s*a|player\s*1|home/.test(clean(String(rawLine))) ? 'Giocatore A' : 'Giocatore B';
      return key('Set','Vincente Set',`Vincente Set ${setNum}`, gioc, 'Match');
    }

    // Handicap Games
    if (/handicap\s*game|game\s*handicap/.test(name) && line !== null)
      return key('Games','Handicap Games','Handicap Games', line, 'Match');

    // Tie-break
    if (/tie.?break/.test(name)) {
      const setNum = name.match(/set\s*(\d)/)?.[1];
      if (setNum) return key('Speciali','Tie-break',`Tie-break Set ${setNum}`,'Sì/No','Match');
      return key('Speciali','Tie-break','Tie-break nel match',
        /sì|si|yes/.test(clean(String(rawLine))) ? 'Sì' : 'No', 'Match');
    }

    // Ace
    if (/ace/.test(name) && !/doppio|double/.test(name)) {
      const m = /under/.test(name) ? 'Under' : 'Over';
      if (/giocatore\s*a|player\s*1/.test(name))
        return key('Player Props','Ace Giocatore',`${m} Ace - Gioc A`, line, 'Giocatore A');
      if (/giocatore\s*b|player\s*2/.test(name))
        return key('Player Props','Ace Giocatore',`${m} Ace - Gioc B`, line, 'Giocatore B');
      return key('Statistiche','Ace',`${m} Ace`, line, 'Match');
    }

    // Doppi Falli
    if (/doppi?\s*falli?|double\s*fault/.test(name)) {
      const m = /under/.test(name) ? 'Under' : 'Over';
      if (/giocatore\s*a|player\s*1/.test(name))
        return key('Player Props','DF Giocatore',`${m} Doppi Falli - Gioc A`, line, 'Giocatore A');
      if (/giocatore\s*b|player\s*2/.test(name))
        return key('Player Props','DF Giocatore',`${m} Doppi Falli - Gioc B`, line, 'Giocatore B');
      return key('Statistiche','Doppi Falli',`${m} Doppi Falli`, line, 'Match');
    }

    // Break
    if (/break\b/.test(name) && !/tie/.test(name) && line !== null) {
      const m = /under/.test(name) ? 'Under' : 'Over';
      return key('Statistiche','Break',`${m} Break`, line, 'Match');
    }

    if (/bet.?builder/.test(name)) return key('Combo','Bet Builder','Bet Builder','libero','Match');

    return null;
  }

  // ================================================================
  // BASKET
  // ================================================================
  function normalizeBasket(rawName, rawLine, rawTarget) {
    const name = clean(rawName);
    const line = extractLine(rawLine);
    const target = clean(rawTarget || 'match');

    if (/moneyline|vincente\s*match|1x2/.test(name)) {
      const l = /casa|home/.test(target) ? 'Casa' : 'Ospite';
      return key('Esito','Moneyline','Moneyline', l, 'Match');
    }

    if (/handicap|spread/.test(name) && !/periodo|quarto|tempo/.test(name) && line !== null)
      return key('Esito','Handicap Spread','Handicap', line, 'Match');

    // Totali partita
    if (/total[ei]?\s*(punt[i]?|poin|match)|punt[i]?\s*(over|under|total)|over.*punt|under.*punt/.test(name)
        && !/periodo|quarto|tempo|team|squadra/.test(name) && line !== null) {
      const m = /under/.test(name) ? 'Under' : 'Over';
      return key('Punti','Totali Partita', m, line, 'Match');
    }

    // Team totals
    if (/team\s*total|totale\s*squadra|total.*casa|total.*ospite/.test(name) && line !== null) {
      const m = /under/.test(name) ? 'Under' : 'Over';
      const tgt = /ospite|away/.test(name) || /ospite|away/.test(target) ? 'Ospite' : 'Casa';
      return key('Punti',`Team Total ${tgt}`, m, line, tgt);
    }

    // Pari/Dispari
    if (/pari.?dispari|odd.?even/.test(name)) {
      const l = /pari|even/.test(clean(String(rawLine))) ? 'Pari' : 'Dispari';
      const tgt = /ospite|away/.test(name) ? 'Ospite' : /casa|home/.test(name) ? 'Casa' : 'Match';
      const mkt = tgt === 'Match' ? 'Pari/Dispari' : `Pari/Dispari ${tgt}`;
      return key('Punti','Pari/Dispari', mkt, l, tgt);
    }

    // Periodi: Quarti e Tempi
    const periodoMap = {
      q1: 'Q1', q2: 'Q2', q3: 'Q3', q4: 'Q4',
      '1° quarto': 'Q1', '2° quarto': 'Q2', '3° quarto': 'Q3', '4° quarto': 'Q4',
      '1t': '1T', '2t': '2T', 'primo tempo': '1T', 'secondo tempo': '2T',
      '1° tempo': '1T', '2° tempo': '2T'
    };
    for (const [pat, periodo] of Object.entries(periodoMap)) {
      if (name.includes(pat)) {
        if (/over|under/.test(name) && line !== null) {
          const m = /under/.test(name) ? 'Under' : 'Over';
          return key('Periodi',`Totali ${periodo}`,`${m} ${periodo}`, line, 'Match');
        }
        if (/vincente|winner|moneyline/.test(name)) {
          const l = /ospite|away/.test(name) || /ospite/.test(target) ? 'Ospite' : 'Casa';
          return key('Periodi',`Vincente ${periodo}`,`Vincente ${periodo}`, l, 'Match');
        }
        if (/pari|dispari/.test(name)) {
          const l = /pari/.test(clean(String(rawLine))) ? 'Pari' : 'Dispari';
          return key('Periodi',`Pari/Dispari ${periodo}`,`Pari/Dispari ${periodo}`, l, 'Match');
        }
        if (/handicap|spread/.test(name) && line !== null)
          return key('Periodi',`Handicap ${periodo}`,`Handicap ${periodo}`, line, 'Match');
      }
    }

    // Player Props Basket
    const propsMap = {
      'pra|punti.*rimbalzi.*assist': 'PRA',
      'pr|punti.*rimbalzi': 'PR',
      'pa|punti.*assist': 'PA',
      'triple\s*double|tripla\s*doppia': 'Triple Double',
      'double\s*double|doppia\s*doppia': 'Double Double',
      'punti|points|scoring': 'Punti',
      'rimbalzi|rebounds': 'Rimbalzi',
      'assist': 'Assist',
      'triple|threes|3pt': 'Triple',
      'stea[l]|recuperi': 'Steal',
      'bloc[k]|stoppate': 'Block',
    };
    for (const [pat, stat] of Object.entries(propsMap)) {
      if (new RegExp(pat).test(name)) {
        if (['Double Double','Triple Double'].includes(stat))
          return key('Player Props', stat, `${stat} SI/NO`, 'SI/NO', 'Giocatore');
        if (/over|under/.test(name) && line !== null) {
          const m = /under/.test(name) ? 'Under' : 'Over';
          return key('Player Props', stat, `${m} ${stat}`, line, 'Giocatore');
        }
      }
    }

    if (/bet.?builder/.test(name)) return key('Combo','Bet Builder','Bet Builder','libero','Match');

    return null;
  }

  // ================================================================
  // CHIAVE CANONICA
  // ================================================================
  function key(cat, sub, mercato, linea, target) {
    return {
      categoria: cat, sottocategoria: sub, mercato, linea: String(linea), target,
      canonicalKey: `${cat}|${sub}|${mercato}|${linea}|${target}`
    };
  }

  // ================================================================
  // ENTRY POINT
  // ================================================================
  function normalize(sport, rawName, rawLine, rawTarget) {
    const s = (sport || '').toLowerCase();
    try {
      if (s === 'calcio' || s === 'football' || s === 'soccer')
        return normalizeCalcio(rawName, rawLine, rawTarget);
      if (s === 'tennis')
        return normalizeTennis(rawName, rawLine, rawTarget);
      if (s === 'basket' || s === 'basketball' || s === 'nba')
        return normalizeBasket(rawName, rawLine, rawTarget);
    } catch(e) {}
    return null;
  }

  return { normalize, key };
})();

// Export per Node.js e per content script
if (typeof module !== 'undefined') module.exports = Normalizer;

// Content script wrapper — espone Normalizer globalmente
window.OddsNormalizer = Normalizer;
