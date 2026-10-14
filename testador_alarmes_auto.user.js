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
    '<div id="tat-header"><span class="tat-brand"><span class="tat-logo"><img src="https://cleversonrenan.github.io/extrator/TLP.PNG" alt="TLP"></span><span class="tat-title"><strong>Testador de Alarmes</strong><small>Portal TLP</small></span></span><button id="tat-toggle" type="button" aria-label="Recolher painel" title="Recolher painel">–</button></div>' +
    '<div id="tat-body">' +
    '  <section class="tat-section"><span class="tat-section-title">Consulta manual</span><textarea id="tat-list" placeholder="Cole aqui a lista de END_ID, um por linha"></textarea><div class="tat-row"><button id="tat-start">Iniciar</button><button id="tat-stop" disabled>Parar</button></div></section>' +
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
  panel.querySelector("#tat-body").insertAdjacentHTML("beforeend", "<footer class=\"tlp-signoff\" aria-label=\"Créditos e licença\"><div class=\"signoff-credit\"><span class=\"signoff-tag\">Adaptação</span><div class=\"signoff-person\"><span>Adaptado por</span><strong>Cleverson Renan</strong><a href=\"mailto:cleversonrenan@gmail.com\">cleversonrenan@gmail.com</a></div></div><div class=\"signoff-meta\"><div class=\"signoff-product\">Testador de Alarmes · 2026</div><div class=\"signoff-license\">Esta obra está licenciada sob a licença <a href=\"https://creativecommons.org/publicdomain/zero/1.0/\" target=\"_blank\" rel=\"license noopener\">CC0 1.0 Universal.</a><img src=\"https://mirrors.creativecommons.org/presskit/icons/cc.svg\" alt=\"Creative Commons\"><img src=\"https://mirrors.creativecommons.org/presskit/icons/zero.svg\" alt=\"CC Zero\"></div></div></footer>");
  document.body.appendChild(panel);

    var style = document.createElement("style");
    style.textContent = `
      #tat-panel{--tat-bg:#061423;--tat-surface:#0a1d31;--tat-surface-2:#0d253e;--tat-line:#17466e;--tat-line-soft:rgba(39,126,190,.28);--tat-text:#f2f8ff;--tat-muted:#93abc1;--tat-blue:#19a6ff;--tat-blue-strong:#007de5;--tat-orange:#ff7417;--tat-green:#2be19d;--tat-red:#ff5364;--tat-yellow:#ffd02e;position:fixed;top:8px;right:8px;width:390px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;z-index:999999;background:var(--tat-bg);border:1px solid var(--tat-line);border-radius:14px;color:var(--tat-text);font:500 12px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 16px 42px rgba(0,0,0,.34);color-scheme:dark;isolation:isolate;scrollbar-color:var(--tat-blue-strong) transparent}
      #tat-panel,#tat-panel *{box-sizing:border-box}
      #tat-panel #tat-header{position:sticky;top:0;z-index:3;display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;min-height:58px;padding:7px 8px 7px 11px;border-bottom:1px solid var(--tat-line);background:var(--tat-surface);overflow:hidden}
      #tat-panel #tat-header::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:linear-gradient(var(--tat-blue),var(--tat-orange))}
      #tat-panel .tat-brand{display:flex;align-items:center;gap:8px;min-width:0}
      #tat-panel .tat-logo{display:grid;place-items:center;width:48px;height:31px;flex:0 0 48px}
      #tat-panel .tat-logo img{display:block;width:100%;height:100%;object-fit:contain}
      #tat-panel .tat-title{display:grid;min-width:0;line-height:1.05}
      #tat-panel .tat-title strong{overflow:hidden;color:var(--tat-text);font-size:13px;letter-spacing:-.02em;text-overflow:ellipsis;white-space:nowrap}
      #tat-panel .tat-title small{margin-top:4px;color:var(--tat-orange);font-size:7px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
      #tat-panel #tat-connectivity-host{display:inline-flex;align-items:center;min-width:0}
      #tat-panel #tat-toggle{display:grid;place-items:center;min-width:30px;width:30px;height:30px;flex:none;padding:0;border:1px solid var(--tat-line);border-radius:9px;background:var(--tat-surface-2);color:var(--tat-blue);font-size:16px;line-height:1;cursor:pointer}
      #tat-panel #tat-toggle:hover{border-color:var(--tat-blue)}
      #tat-panel #tat-body{display:flex;flex-direction:column;gap:7px;padding:8px}
      #tat-panel .tat-section{display:grid;gap:6px;padding:8px;border:1px solid var(--tat-line-soft);border-radius:10px;background:var(--tat-surface)}
      #tat-panel .tat-section-title{color:var(--tat-orange);font-size:8px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}
      #tat-panel textarea,#tat-panel input,#tat-panel select{width:100%;margin:0;padding:7px 8px;border:1px solid var(--tat-line);border-radius:7px;background:var(--tat-surface-2);color:var(--tat-text);font:500 11px/1.35 Inter,system-ui,sans-serif;outline:none}
      #tat-panel textarea:focus,#tat-panel input:focus,#tat-panel select:focus{border-color:var(--tat-blue);box-shadow:0 0 0 2px rgba(25,166,255,.12)}
      #tat-panel #tat-list{height:58px;min-height:42px;resize:vertical;font-family:"SFMono-Regular",Consolas,monospace}
      #tat-panel #tat-import-label{display:grid;gap:4px;color:var(--tat-muted);font-size:9px}
      #tat-panel #tat-import{padding:5px;font-size:9px}
      #tat-panel #tat-sheet-info{align-self:center;min-width:0;color:var(--tat-muted);font-size:9px;overflow-wrap:anywhere}
      #tat-panel .tat-row{display:flex;gap:5px;align-items:stretch}
      #tat-panel button{min-height:30px;flex:1;padding:5px 8px;border:1px solid var(--tat-line);border-radius:7px;background:var(--tat-surface-2);color:var(--tat-text);font:800 10px/1.2 Inter,system-ui,sans-serif;cursor:pointer}
      #tat-panel button:hover:not(:disabled){border-color:var(--tat-blue)}
      #tat-panel button:disabled{opacity:.42;cursor:not-allowed}
      #tat-panel #tat-start,#tat-panel #tat-sheet-start,#tat-panel #tat-export{border-color:var(--tat-blue);background:linear-gradient(115deg,var(--tat-blue-strong),var(--tat-blue));color:#fff}
      #tat-panel #tat-stop{border-color:rgba(255,116,23,.55);color:var(--tat-orange)}
      #tat-panel #tat-status{min-height:30px;padding:7px 9px;border-left:3px solid var(--tat-blue);border-radius:6px;background:var(--tat-surface);color:var(--tat-muted);font-size:10px;line-height:1.35;overflow-wrap:anywhere}
      #tat-panel #tat-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}
      #tat-panel .tat-stat{position:relative;display:grid;gap:1px;min-width:0;padding:7px 4px;border:1px solid var(--tat-line);border-radius:9px;background:var(--tat-surface);text-align:center;overflow:hidden}
      #tat-panel .tat-stat::after{content:"";position:absolute;right:5px;bottom:0;left:5px;height:2px;border-radius:2px;background:var(--tat-blue)}
      #tat-panel .tat-stat b{color:var(--tat-text);font-size:17px;line-height:1}
      #tat-panel .tat-stat span{color:var(--tat-muted);font-size:8px;white-space:nowrap}
      #tat-panel #stat-alarme::after{background:var(--tat-red)}#tat-panel #stat-alarme b{color:var(--tat-red)}
      #tat-panel #stat-normal::after{background:var(--tat-green)}#tat-panel #stat-normal b{color:var(--tat-green)}
      #tat-panel #stat-pendente::after{background:var(--tat-yellow)}#tat-panel #stat-pendente b{color:var(--tat-yellow)}
      #tat-panel #tat-table{max-height:210px;overflow:auto;border:1px solid var(--tat-line);border-radius:9px;background:var(--tat-surface)}
      #tat-panel .tat-row-item{padding:7px 8px;border-left:3px solid transparent;border-bottom:1px solid var(--tat-line-soft)}
      #tat-panel .tat-row-item:last-child{border-bottom:0}
      #tat-panel .tat-row-item.normal{border-left-color:var(--tat-green);background:rgba(43,225,157,.07)}
      #tat-panel .tat-row-item.alarme{border-left-color:var(--tat-red);background:rgba(255,83,100,.07)}
      #tat-panel .tat-row-item.pendente{border-left-color:var(--tat-yellow);background:rgba(255,208,46,.07)}
      #tat-panel .tat-row-top{display:flex;justify-content:space-between;align-items:center;gap:6px}
      #tat-panel .tat-endid{font-family:"SFMono-Regular",Consolas,monospace;font-weight:800}
      #tat-panel .tat-badge{padding:2px 7px;border:1px solid currentColor;border-radius:999px;font-size:8px;font-weight:900;text-transform:uppercase}
      #tat-panel .tat-badge.alarme{color:var(--tat-red);background:rgba(255,83,100,.1)}
      #tat-panel .tat-badge.normal{color:var(--tat-green);background:rgba(43,225,157,.1)}
      #tat-panel .tat-badge.pendente{color:var(--tat-yellow);background:rgba(255,208,46,.1)}
      #tat-panel .tat-resp{max-height:38px;margin-top:3px;overflow:hidden;color:var(--tat-muted);font-size:9px}
      #tat-panel .tat-resp.expanded{max-height:none}
      #tat-panel .tat-mini-actions{display:flex;gap:4px;margin-top:5px}
      #tat-panel .tat-mini-actions button{min-height:24px;padding:2px 6px;flex:none;background:transparent;font-size:9px}
      #tat-panel #tat-kw-toggle{padding:7px 9px;border:1px solid var(--tat-line-soft);border-radius:8px;background:var(--tat-surface);color:var(--tat-muted);font-size:9px;font-weight:800;cursor:pointer}
      #tat-panel #tat-kw-body{padding:7px;border:1px solid var(--tat-line-soft);border-radius:8px;background:var(--tat-surface)}
      #tat-panel .tat-kw-title{margin-top:4px;font-size:9px;font-weight:800}#tat-panel .tat-kw-title.alarme{color:var(--tat-red)}#tat-panel .tat-kw-title.normal{color:var(--tat-green)}
      #tat-panel .tat-kw-list{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
      #tat-panel .tat-kw{display:flex;align-items:center;gap:4px;padding:2px 6px;border:1px solid var(--tat-line);border-radius:999px;background:var(--tat-surface-2);font-size:9px}
      #tat-panel .tat-kw button{min-height:0;padding:0;border:0;background:none;color:inherit;font-size:10px;flex:none}
      #tat-panel .tlp-signoff{display:grid;grid-template-columns:1fr;gap:6px;margin-top:2px;padding:8px;border:1px solid var(--tat-line);border-left:3px solid var(--tat-orange);border-radius:8px;background:var(--tat-surface);color:var(--tat-muted);font:8px/1.3 system-ui,sans-serif}
      #tat-panel .signoff-credit{display:flex;align-items:center;gap:7px;min-width:0}#tat-panel .signoff-tag{flex:none;padding:3px 4px;border:1px solid rgba(255,116,23,.45);border-radius:4px;color:var(--tat-orange);font-size:7px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
      #tat-panel .signoff-person{display:grid;grid-template-columns:auto 1fr;gap:1px 4px;min-width:0}#tat-panel .signoff-person>span{font-size:8px}#tat-panel .signoff-person strong{color:var(--tat-text);font-size:9px}#tat-panel .signoff-person a{grid-column:1/-1;color:var(--tat-blue);font-size:8px;text-decoration:none;overflow-wrap:anywhere}
      #tat-panel .signoff-meta{display:grid;gap:3px;padding-top:6px;border-top:1px solid var(--tat-line)}#tat-panel .signoff-product{color:var(--tat-text);font-size:8px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}#tat-panel .signoff-license{display:flex;align-items:center;flex-wrap:wrap;gap:3px;font-size:8px}#tat-panel .signoff-license a{color:var(--tat-blue);text-decoration:none}#tat-panel .signoff-license img{width:11px;height:11px;object-fit:contain}
      @media(max-width:430px){#tat-panel{top:4px;right:4px;max-width:calc(100vw - 8px);max-height:calc(100vh - 8px)}#tat-panel .tat-logo{width:39px;flex-basis:39px}#tat-panel .tat-title small{display:none}}
      @media(prefers-reduced-motion:reduce){#tat-panel *,#tat-panel *::before,#tat-panel *::after{animation:none!important;transition:none!important}}
    `;
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
