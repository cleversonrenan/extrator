// ==UserScript==
// @name         Testador de Alarmes — Automático (Portal TIM)
// @namespace    cleverson-noc-tools
// @version      1.5
// @description  Cola a lista de END_ID, testa cada um automaticamente no chat do portal, aguarda a resposta real, classifica e exporta planilha (alarme sai apenas com o nome do alarme, normal sai "Normalizado")
// @match        https://tim-access-portal-prd.133e5xtaze4h.us-south.codeengine.appdomain.cloud/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ---------- config ----------
  var SELECTOR_INPUT = "#btn-input";
  var SELECTOR_SEND = "#btn-chat";
  var SELECTOR_RESPONSE = ".all-copy.format-text";
  var DELAY_BETWEEN_MS = 700;
  var RESPONSE_TIMEOUT_MS = 90000;
  var POLL_INTERVAL_MS = 400;
  var RETRY_ROUNDS = 2;

  // Mensagens do portal que devem ser IGNORADAS (aguardo/feedback)
  var IGNORE_PATTERNS = [
    "vou verificar",
    "vou consultar",
    "aguarde",
    "pode levar um tempo",
    "te informo assim que",
    "feedbacks",
    "feedback",
    "minha ajuda foi",
    "foi util",
    "duvidas clique",
    "repetir a consulta",
    "inserir o log na tarefa"
  ];

  var LS_KEYWORDS = "alarmTester.keywords.v2";
  var LS_SESSION = "alarmTester.session.v2";

  var DEFAULT_KEYWORDS = {
    alarme: ["alarme", "alarmado", "alarmando", "critico", "falha", "indisponivel", "offline", "rompimento"],
    normal: ["normalizado", "sem alarme", "restabelecido", "comunicando", "ativo"]
  };

  var STOPWORDS = {};
  ["de","da","do","das","dos","com","sem","para","por","em","no","na","nos","nas",
   "o","a","os","as","e","ou","um","uma","que","foi","esta","está","ja","já",
   "status","end_id","endid","code","codigo","código","portal","teste","testado",
   "site","link","resposta","id"].forEach(function (w) { STOPWORDS[w] = true; });

  var keywords = loadKeywords();
  var rows = loadSession();
  var running = false;
  var stopRequested = false;

  // ---------- storage ----------
  function loadKeywords() {
    try { var raw = localStorage.getItem(LS_KEYWORDS); if (raw) return JSON.parse(raw); } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULT_KEYWORDS));
  }
  function saveKeywords() { localStorage.setItem(LS_KEYWORDS, JSON.stringify(keywords)); renderKeywords(); }
  function loadSession() {
    try { var raw = localStorage.getItem(LS_SESSION); if (raw) return JSON.parse(raw); } catch (e) {}
    return [];
  }
  function saveSession() { localStorage.setItem(LS_SESSION, JSON.stringify(rows)); }

  // ---------- text helpers ----------
  function normalize(str) {
    return (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }
  function parseList(text) {
    var lines = text.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    var seen = {}; var out = [];
    lines.forEach(function (l) {
      var key = l.toUpperCase();
      if (!seen[key]) { seen[key] = true; out.push(l); }
    });
    return out;
  }
  function flatten(el) {
    var text = el.innerText || el.textContent || "";
    return text.trim().replace(/\s*\n+\s*/g, " | ").replace(/\s{2,}/g, " ");
  }
  function safeFlatten(node) {
    var direct = flatten(node);
    var parent = node.parentElement;
    if (parent && parent !== document.body) {
      var siblings = parent.querySelectorAll(SELECTOR_RESPONSE);
      if (siblings.length === 1) {
        var whole = flatten(parent);
        if (whole.length > direct.length) return whole;
      }
    }
    return direct;
  }
  function cryptoId() { return "r" + Math.random().toString(36).slice(2, 10); }

  // ---------- classification ----------
  function classify(responseText) {
    var norm = normalize(responseText);
    if (!norm) return null;
    // Regras estruturais valem mais que palavras aprendidas
    if (norm.indexOf("sem alarme") !== -1) return "normal";
    if (norm.indexOf("alarmes netcool") !== -1) return "alarme";
    var phrases = [];
    keywords.alarme.forEach(function (k) { phrases.push({ label: "alarme", phrase: normalize(k) }); });
    keywords.normal.forEach(function (k) { phrases.push({ label: "normal", phrase: normalize(k) }); });
    phrases.sort(function (a, b) { return b.phrase.length - a.phrase.length; });
    for (var i = 0; i < phrases.length; i++) {
      if (phrases[i].phrase && norm.indexOf(phrases[i].phrase) !== -1) return phrases[i].label;
    }
    return null;
  }
  function extractAlarmNames(text) {
    var re = /(?:^|\n|\s*\|\s*)Alarme\s*:\s*([^\n|]+)/gi;
    var names = [];
    var m;
    while ((m = re.exec(text || "")) !== null) {
      var name = (m[1] || "").trim();
      if (name && names.indexOf(name) === -1) names.push(name);
    }
    return names;
  }
  function displayResponse(text, status) {
    if (status === "normal") return "Normalizado";
    if (status === "alarme") {
      var names = extractAlarmNames(text);
      return names.length ? "Alarme: " + names.join(" | ") : "Alarme";
    }
    return (text || "").trim();
  }
  function extractCandidateWords(responseText, endId) {
    var norm = normalize(responseText);
    var endIdNorm = normalize(endId);
    var words = norm.split(/[^a-z0-9çãõáéíóúâêô_]+/i).filter(Boolean);
    var out = [];
    words.forEach(function (w) {
      if (w.length < 4) return;
      if (w === endIdNorm) return;
      if (STOPWORDS[w]) return;
      if (/^\d+$/.test(w)) return;
      if (out.indexOf(w) === -1) out.push(w);
    });
    return out;
  }
  function learn(label, responseText, endId) {
    if (!responseText) return [];
    var opposite = label === "alarme" ? "normal" : "alarme";
    var candidates = extractCandidateWords(responseText, endId);
    var added = [];
    candidates.forEach(function (w) {
      if (w.indexOf("alarm") !== -1) return;
      var inSame = keywords[label].some(function (k) { return normalize(k) === w; });
      var inOpp = keywords[opposite].some(function (k) { return normalize(k) === w; });
      if (!inSame && !inOpp) { keywords[label].push(w); added.push(w); }
    });
    if (added.length) saveKeywords();
    return added;
  }

  // ---------- DOM automation ----------
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function setNativeValue(el, value) {
    var proto = Object.getPrototypeOf(el);
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    var setter = desc && desc.set;
    if (setter) { setter.call(el, value); } else { el.value = value; }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isIntermediateMessage(text) {
    var lower = (text || "").toLowerCase();
    for (var i = 0; i < IGNORE_PATTERNS.length; i++) {
      if (lower.indexOf(IGNORE_PATTERNS[i]) !== -1) return true;
    }
    return false;
  }

  function isAlarmResult(text, endId) {
    var t = (text || "").toUpperCase();
    var id = (endId || "").toUpperCase();
    if (!id) return false;
    return t.indexOf(id) !== -1 && t.indexOf("ALARMES NETCOOL") !== -1;
  }

  // Espera a resposta que realmente contém "ALARMES NETCOOL PARA O END_ID <endId>".
  // Mensagens de aguardo ("Vou verificar...") e feedback são ignoradas.
  function waitForAlarmResult(endId) {
    return new Promise(function (resolve) {
      var waited = 0;
      var iv = setInterval(function () {
        var nodes = document.querySelectorAll(SELECTOR_RESPONSE);
        waited += POLL_INTERVAL_MS;

        for (var i = nodes.length - 1; i >= 0; i--) {
          var text = flatten(nodes[i]);
          if (!text) continue;
          if (isIntermediateMessage(text)) continue;
          if (isAlarmResult(text, endId)) {
            clearInterval(iv);
            resolve(nodes[i]);
            return;
          }
        }

        if (waited >= RESPONSE_TIMEOUT_MS) {
          clearInterval(iv);
          resolve(null);
        }
      }, POLL_INTERVAL_MS);
    });
  }

  // ---------- UI ----------
  var panel = document.createElement("div");
  panel.id = "tat-panel";
  panel.innerHTML =
    '<div id="tat-header">Testador de Alarmes <button id="tat-toggle">–</button></div>' +
    '<div id="tat-body">' +
    '  <textarea id="tat-list" placeholder="Cole aqui a lista de END_ID, um por linha"></textarea>' +
    '  <div class="tat-row"><button id="tat-start">Iniciar</button><button id="tat-stop" disabled>Parar</button></div>' +
    '  <div id="tat-status">Pronto.</div>' +
    '  <div id="tat-stats">' +
    '    <div class="tat-stat" id="stat-alarme"><b>0</b><span>Alarme</span></div>' +
    '    <div class="tat-stat" id="stat-normal"><b>0</b><span>Normal.</span></div>' +
    '    <div class="tat-stat" id="stat-pendente"><b>0</b><span>Pendente</span></div>' +
    '    <div class="tat-stat" id="stat-total"><b>0</b><span>Total</span></div>' +
    "  </div>" +
    '  <div id="tat-table"></div>' +
    '  <div class="tat-row"><button id="tat-export">Exportar planilha (.xlsx)</button><button id="tat-clear">Limpar tabela</button></div>' +
    '  <div id="tat-kw-toggle">Palavras aprendidas ▾</div>' +
    '  <div id="tat-kw-body" style="display:none;">' +
    '    <div class="tat-kw-title alarme">Indicam ALARME</div><div id="kw-alarme" class="tat-kw-list"></div>' +
    '    <div class="tat-kw-title normal">Indicam NORMALIZADO</div><div id="kw-normal" class="tat-kw-list"></div>' +
    '    <div class="tat-row"><select id="kw-type"><option value="alarme">Alarme</option><option value="normal">Normalizado</option></select>' +
    '    <input type="text" id="kw-input" placeholder="palavra..."><button id="kw-add">+</button></div>' +
    "  </div>" +
    "</div>";
  panel.querySelector("#tat-body").insertAdjacentHTML("beforeend", "<footer class=\"tat-signature\" aria-label=\"Créditos e licença\"><div class=\"tat-signature-top\"><span class=\"tat-signature-product\">Testador de Alarmes · 2026</span><a class=\"tat-signature-license\" href=\"https://creativecommons.org/publicdomain/zero/1.0/\" target=\"_blank\" rel=\"license noopener noreferrer\">CC0</a></div><div class=\"tat-signature-credit\"><span>Adaptado por</span> <strong>Cleverson Renan</strong></div><div class=\"tat-signature-contact\"><a href=\"mailto:cleversonrenan@gmail.com\">cleversonrenan@gmail.com</a><span aria-hidden=\"true\">/</span><a href=\"https://wa.me/5521983600686\" target=\"_blank\" rel=\"noopener noreferrer\" aria-label=\"WhatsApp: (21) 98360-0686\">WhatsApp (21) 98360-0686</a></div></footer>");
  document.body.appendChild(panel);

  var style = document.createElement("style");
  style.textContent =
    "#tat-panel{position:fixed;top:8px;right:8px;width:300px;max-width:calc(100vw - 16px);max-height:65vh;overflow:auto;z-index:999999;" +
    "background:#0e1424;border:1px solid #2a344a;border-radius:8px;font-family:system-ui,sans-serif;" +
    "font-size:12px;color:#e6edf5;box-shadow:0 8px 24px rgba(0,0,0,.5);}" +
    "#tat-header{padding:5px 7px;gap:4px;flex-wrap:wrap;font-weight:700;display:flex;justify-content:space-between;align-items:center;" +
    "background:#0a0f1c;border-bottom:1px solid #2a344a;border-radius:8px 8px 0 0;position:sticky;top:0;z-index:2;}" +
    "#tat-header button{background:none;border:none;color:#e6edf5;cursor:pointer;font-size:14px;}" +
    "#tat-body{padding:6px;display:flex;flex-direction:column;gap:5px;}" +
    "#tat-panel textarea,#tat-panel input,#tat-panel select{width:100%;background:#121b2e;color:#e6edf5;" +
    "border:1px solid #2a344a;border-radius:6px;padding:6px;font-family:inherit;font-size:11px;box-sizing:border-box;}" +
    "#tat-list{height:42px;min-height:36px;resize:vertical;font-family:monospace;}" +
    ".tat-row{display:flex;gap:6px;}" +
    "#tat-panel button{flex:1;background:#1c2740;border:1px solid #2a344a;color:#e6edf5;border-radius:6px;" +
    "padding:3px 5px;min-height:24px;font-size:11px;line-height:1.3;cursor:pointer;}" +
    "#tat-panel button:disabled{opacity:.4;cursor:not-allowed;}" +
    "#tat-panel button:hover:not(:disabled){border-color:#3E8EF7;}" +
    "#tat-status{color:#8fa1b8;}" +
    "#tat-stats{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;}" +
    ".tat-stat{background:#121b2e;border:1px solid #2a344a;border-radius:4px;padding:2px;text-align:center;}" +
    ".tat-stat b{display:inline;font-size:12px;margin-right:3px;} .tat-stat span{color:#8fa1b8;font-size:9px;}" +
    "#stat-alarme b{color:#E4483C;} #stat-normal b{color:#33C481;} #stat-pendente b{color:#F2B90C;}" +
    "#tat-table{max-height:120px;overflow:auto;border:1px solid #2a344a;border-radius:6px;}" +
    ".tat-row-item{border-bottom:1px solid #22304A;padding:4px 5px;}" +
    ".tat-row-item:last-child{border-bottom:none;}" +
    ".tat-row-top{display:flex;justify-content:space-between;align-items:center;gap:6px;}" +
    ".tat-endid{font-family:monospace;font-weight:700;}" +
    ".tat-badge{padding:1px 7px;border-radius:999px;font-size:9px;font-weight:700;}" +
    ".tat-badge.alarme{background:#3A1616;color:#E4483C;} .tat-badge.normal{background:#0F2B22;color:#33C481;}" +
    ".tat-badge.pendente{background:#332A0C;color:#F2B90C;}" +
    ".tat-resp{color:#8fa1b8;font-size:10px;margin-top:3px;max-height:34px;overflow:hidden;}" +
    ".tat-resp.expanded{max-height:none;}" +
    ".tat-mini-actions{display:flex;gap:4px;margin-top:4px;}" +
    ".tat-mini-actions button{padding:2px 6px;font-size:10px;flex:none;}" +
    "#tat-kw-toggle{cursor:pointer;color:#8fa1b8;}" +
    ".tat-kw-title{font-size:10px;font-weight:700;margin-top:4px;}" +
    ".tat-kw-title.alarme{color:#E4483C;} .tat-kw-title.normal{color:#33C481;}" +
    ".tat-kw-list{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0;}" +
    ".tat-kw{display:flex;align-items:center;gap:4px;background:#121b2e;border:1px solid #2a344a;" +
    "border-radius:999px;padding:2px 6px;font-size:10px;}" +
    ".tat-kw button{background:none;border:none;color:inherit;padding:0;font-size:11px;flex:none;}";
  style.textContent += "#tat-panel{box-sizing:border-box;}#tat-panel #tat-header{position:sticky;top:0;z-index:2;}#tat-panel #tat-header button{flex:none;min-width:24px;}#tat-panel #tat-status{font-size:11px;line-height:1.35;overflow-wrap:anywhere;}#tat-panel .tat-signature{position:relative;margin-top:5px;padding:7px 8px 6px 10px;overflow:hidden;border:1px solid rgba(62,142,247,.28);border-left:3px solid #3e8ef7;border-radius:6px 2px 6px 2px;background:linear-gradient(112deg,rgba(62,142,247,.12) 0 68%,rgba(242,139,45,.11) 68% 100%);color:#8fa1b8;font:9px/1.35 system-ui,sans-serif;}#tat-panel .tat-signature:after{content:\"\";position:absolute;right:0;bottom:0;width:42px;height:2px;background:#f28b2d;}#tat-panel .tat-signature-top{display:flex;align-items:center;justify-content:space-between;gap:6px;}#tat-panel .tat-signature-product{color:#9cc6ff;font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;}#tat-panel .tat-signature-license{color:#f6a657;font-weight:700;text-decoration:none;}#tat-panel .tat-signature-credit{margin-top:2px;}#tat-panel .tat-signature-credit span{color:#f6a657;font-size:8px;letter-spacing:.07em;text-transform:uppercase;}#tat-panel .tat-signature-credit strong{color:#e6edf5;font-weight:650;}#tat-panel .tat-signature-contact{display:flex;gap:5px;flex-wrap:wrap;margin-top:2px;}#tat-panel .tat-signature-contact>span{color:#f28b2d;}#tat-panel .tat-signature-contact a{color:inherit;text-decoration:none;}#tat-panel input[type=file]{font-size:10px;padding:3px;}#tat-panel .tat-row{gap:4px;}";
    document.head.appendChild(style);

  var elList = panel.querySelector("#tat-list");
  var elStart = panel.querySelector("#tat-start");
  var elStop = panel.querySelector("#tat-stop");
  var elStatus = panel.querySelector("#tat-status");
  var elTable = panel.querySelector("#tat-table");
  var elBody = panel.querySelector("#tat-body");
  var elToggle = panel.querySelector("#tat-toggle");
  var elKwToggle = panel.querySelector("#tat-kw-toggle");
  var elKwBody = panel.querySelector("#tat-kw-body");

  elToggle.addEventListener("click", function () {
    var collapsed = elBody.style.display === "none";
    elBody.style.display = collapsed ? "flex" : "none";
    elToggle.textContent = collapsed ? "–" : "+";
  });
  elKwToggle.addEventListener("click", function () {
    var hidden = elKwBody.style.display === "none";
    elKwBody.style.display = hidden ? "block" : "none";
    elKwToggle.textContent = "Palavras aprendidas " + (hidden ? "▴" : "▾");
  });

  function renderKeywords() {
    renderKwList("kw-alarme", "alarme");
    renderKwList("kw-normal", "normal");
  }
  function renderKwList(elId, type) {
    var el = panel.querySelector("#" + elId);
    el.innerHTML = "";
    keywords[type].forEach(function (word) {
      var span = document.createElement("span");
      span.className = "tat-kw";
      span.innerHTML = "<span></span><button>×</button>";
      span.querySelector("span").textContent = word;
      span.querySelector("button").addEventListener("click", function () {
        keywords[type] = keywords[type].filter(function (w) { return w !== word; });
        saveKeywords();
      });
      el.appendChild(span);
    });
  }

  function badgeHtml(row) {
    if (row.status) {
      var label = row.status === "alarme" ? "ALARME" : "NORMALIZADO";
      return '<span class="tat-badge ' + row.status + '">' + label + "</span>";
    }
    return '<span class="tat-badge pendente">PENDENTE</span>';
  }

  function renderTable() {
    elTable.innerHTML = "";
    rows.forEach(function (row) {
      var item = document.createElement("div");
      item.className = "tat-row-item";

      var top = document.createElement("div");
      top.className = "tat-row-top";
      top.innerHTML = '<span class="tat-endid">' + row.endId + "</span>" + badgeHtml(row);
      item.appendChild(top);

      var resp = document.createElement("div");
      resp.className = "tat-resp";
      var displayText = displayResponse(row.response, row.status) || "(sem resposta ainda)";
      var rawText = row.response || displayText;
      resp.textContent = displayText;
      resp.title = "clique para ver texto original";
      resp.addEventListener("click", function () {
        resp.classList.toggle("expanded");
        resp.textContent = resp.textContent === rawText ? displayText : rawText;
      });
      item.appendChild(resp);

      var actions = document.createElement("div");
      actions.className = "tat-mini-actions";
      var btnA = document.createElement("button");
      btnA.textContent = "✓ Alarme";
      btnA.addEventListener("click", function () { confirmStatus(row.id, "alarme"); });
      var btnN = document.createElement("button");
      btnN.textContent = "✓ Normal.";
      btnN.addEventListener("click", function () { confirmStatus(row.id, "normal"); });
      var btnDel = document.createElement("button");
      btnDel.textContent = "×";
      btnDel.addEventListener("click", function () {
        rows = rows.filter(function (r) { return r.id !== row.id; });
        saveSession(); renderTable();
      });
      actions.appendChild(btnA); actions.appendChild(btnN); actions.appendChild(btnDel);
      item.appendChild(actions);

      elTable.appendChild(item);
    });
    renderStats();
  }
  function renderStats() {
    var alarme = rows.filter(function (r) { return r.status === "alarme"; }).length;
    var normal = rows.filter(function (r) { return r.status === "normal"; }).length;
    var pendente = rows.length - alarme - normal;
    panel.querySelector("#stat-alarme b").textContent = alarme;
    panel.querySelector("#stat-normal b").textContent = normal;
    panel.querySelector("#stat-pendente b").textContent = pendente;
    panel.querySelector("#stat-total b").textContent = rows.length;
  }

  function confirmStatus(rowId, label) {
    var row = rows.find(function (r) { return r.id === rowId; });
    if (!row) return;
    row.status = label;
    var added = learn(label, row.response, row.endId);
    saveSession(); renderTable();
    if (added.length) elStatus.textContent = "Aprendido: " + added.join(", ");
  }

  function upsertRow(endId, responseText) {
    var row = rows.find(function (r) { return r.endId.toUpperCase() === endId.toUpperCase(); });
    if (!row) { row = { id: cryptoId(), endId: endId, response: "", status: null }; rows.push(row); }
    row.response = responseText;
    var suggested = classify(responseText);
    if (suggested) {
      row.status = suggested;
      learn(suggested, responseText, endId);
    } else {
      row.status = null;
    }
    saveSession();
  }

  // ---------- main automation loop ----------
  async function runSingleTest(endId, label) {
    var input = document.querySelector(SELECTOR_INPUT);
    var sendBtn = document.querySelector(SELECTOR_SEND);
    if (!input || !sendBtn) {
      elStatus.textContent = "Não encontrei o campo/botão do chat nesta página.";
      return false;
    }
    setNativeValue(input, endId + " alarme");
    sendBtn.click();

    var responseEl = await waitForAlarmResult(endId);
    var text = responseEl ? safeFlatten(responseEl) : "(sem resposta — timeout)";
    var suggested = classify(text);
    elStatus.textContent = label + " — " +
      (suggested === "alarme" ? "ALARME" : (suggested === "normal" ? "NORMAL" : "SEM CLASSIFICAÇÃO"));
    upsertRow(endId, text);
    renderTable();
    return suggested;
  }

  async function retryPending(rounds) {
    var attempts = rounds || RETRY_ROUNDS;
    for (var r = 0; r < attempts; r++) {
      if (stopRequested) break;
      var pendentes = rows.filter(function (row) { return !row.status; });
      if (pendentes.length === 0) break;
      elStatus.textContent = "Retentativa " + (r + 1) + "/" + attempts + ": " + pendentes.length + " pendente(s)...";
      for (var i = 0; i < pendentes.length; i++) {
        if (stopRequested) break;
        var endId = pendentes[i].endId;
        elStatus.textContent = "Repetindo " + endId + " (" + (i + 1) + "/" + pendentes.length + ", tentativa " + (r + 2) + ")...";
        await runSingleTest(endId, "Repetindo " + endId);
        await sleep(DELAY_BETWEEN_MS);
      }
    }
  }

  async function runTests(list) {
    var input = document.querySelector(SELECTOR_INPUT);
    var sendBtn = document.querySelector(SELECTOR_SEND);
    if (!input || !sendBtn) {
      elStatus.textContent = "Não encontrei o campo/botão do chat nesta página.";
      running = false; elStart.disabled = false; elStop.disabled = true;
      return;
    }
    for (var i = 0; i < list.length; i++) {
      if (stopRequested) { elStatus.textContent = "Parado em " + i + "/" + list.length + "."; break; }
      var endId = list[i];
      await runSingleTest(endId, "Testando " + (i + 1) + "/" + list.length + ": " + endId);
      await sleep(DELAY_BETWEEN_MS);
    }

    if (!stopRequested) {
      var pendBefore = rows.filter(function (row) { return !row.status; }).length;
      if (pendBefore > 0) {
        elStatus.textContent = pendBefore + " pendente(s). Re-testando " + RETRY_ROUNDS + "x...";
        await retryPending(RETRY_ROUNDS);
      }
    }

    running = false; stopRequested = false;
    elStart.disabled = false; elStop.disabled = true;
    var pend = rows.filter(function (row) { return !row.status; }).length;
    elStatus.textContent = "Concluído: " + rows.length + " na tabela, " + pend + " pendente(s) após retentativas.";
  }

  elStart.addEventListener("click", function () {
    if (running) return;
    var list = parseList(elList.value);
    if (list.length === 0) { elStatus.textContent = "Cole uma lista de END_ID primeiro."; return; }
    running = true; stopRequested = false;
    elStart.disabled = true; elStop.disabled = false;
    runTests(list);
  });
  elStop.addEventListener("click", function () { stopRequested = true; elStatus.textContent = "Parando..."; });

  elTable && renderTable();

  panel.querySelector("#tat-clear").addEventListener("click", function () {
    if (rows.length === 0) return;
    if (confirm("Limpar a tabela atual? As palavras aprendidas não serão apagadas.")) {
      rows = []; saveSession(); renderTable();
    }
  });

  panel.querySelector("#tat-export").addEventListener("click", function () {
    if (rows.length === 0) { elStatus.textContent = "Nada para exportar."; return; }
    var wb = XLSX.utils.book_new();
    function sheetFor(filterFn) {
      var data = rows.filter(filterFn).map(function (r) {
        return {
          "END_ID": r.endId,
          "Status": r.status === "alarme" ? "ALARME" : (r.status === "normal" ? "NORMALIZADO" : "PENDENTE"),
          "Resposta do portal": displayResponse(r.response, r.status)
        };
      });
      return XLSX.utils.json_to_sheet(data);
    }
    XLSX.utils.book_append_sheet(wb, sheetFor(function () { return true; }), "Todos");
    XLSX.utils.book_append_sheet(wb, sheetFor(function (r) { return r.status === "alarme"; }), "Com Alarme");
    XLSX.utils.book_append_sheet(wb, sheetFor(function (r) { return r.status === "normal"; }), "Normalizados");
    var pend = rows.filter(function (r) { return !r.status; });
    if (pend.length) XLSX.utils.book_append_sheet(wb, sheetFor(function (r) { return !r.status; }), "Pendentes");
    var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    XLSX.writeFile(wb, "teste_alarmes_" + stamp + ".xlsx");
  });

  panel.querySelector("#kw-add").addEventListener("click", function () {
    var type = panel.querySelector("#kw-type").value;
    var input = panel.querySelector("#kw-input");
    var val = input.value.trim();
    if (!val) return;
    if (!keywords[type].some(function (k) { return normalize(k) === normalize(val); })) {
      keywords[type].push(val); saveKeywords();
    }
    input.value = "";
  });
  panel.querySelector("#kw-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") panel.querySelector("#kw-add").click();
  });

  renderKeywords();
  renderTable();
})();
