// ==UserScript==
// @name         Testador Automático de Alarmes — Portal TIM
// @namespace    cleverson-noc-tools
// @version      1.2
// @description  Digita cada END_ID no chat do portal, aguarda a resposta REAL (ignora mensagens intermediárias), classifica e monta um bloco pronto para colar no testador_alarmes.html
// @match        https://tim-access-portal-prd.133e5xtaze4h.us-south.codeengine.appdomain.cloud/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  var SELECTOR_INPUT = "#btn-input";
  var SELECTOR_SEND = "#btn-chat";
  var SELECTOR_RESPONSE = ".all-copy.format-text";
  var DELAY_BETWEEN_MS = 700;
  var RESPONSE_TIMEOUT_MS = 90000;
  var POLL_INTERVAL_MS = 400;

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

  var results = [];
  var running = false;
  var stopRequested = false;

  // ---------- panel UI ----------
  var panel = document.createElement("div");
  panel.id = "tim-auto-tester-panel";
  panel.innerHTML =
    '<div id="tat-header">Testador automático de alarmes <button id="tat-toggle">–</button></div>' +
    '<div id="tat-body">' +
    '  <textarea id="tat-list" placeholder="Cole aqui a lista de END_ID, um por linha"></textarea>' +
    '  <div id="tat-row">' +
    '    <button id="tat-start">Iniciar</button>' +
    '    <button id="tat-stop" disabled>Parar</button>' +
    "  </div>" +
    '  <div id="tat-status">Pronto.</div>' +
    '  <textarea id="tat-output" placeholder="Resultados aparecem aqui (END_ID + TAB + resposta)" readonly></textarea>' +
    '  <div id="tat-row">' +
    '    <button id="tat-copy">Copiar resultados</button>' +
    '    <button id="tat-download">Baixar .txt</button>' +
    "  </div>" +
    "</div>";
  panel.querySelector("#tat-body").insertAdjacentHTML("beforeend", "<footer class=\"tlp-signoff\" aria-label=\"Créditos e licença\"><div class=\"signoff-credit\"><span class=\"signoff-tag\">Adaptação</span><div class=\"signoff-person\"><span>Adaptado por</span><strong>Cleverson Renan</strong><a href=\"mailto:cleversonrenan@gmail.com\">cleversonrenan@gmail.com</a></div></div><div class=\"signoff-meta\"><div class=\"signoff-product\">Testador de Alarmes · 2026</div><div class=\"signoff-license\">Esta obra está licenciada sob a licença <a href=\"https://creativecommons.org/publicdomain/zero/1.0/\" target=\"_blank\" rel=\"license noopener\">CC0 1.0 Universal.</a><img src=\"https://mirrors.creativecommons.org/presskit/icons/cc.svg\" alt=\"Creative Commons\"><img src=\"https://mirrors.creativecommons.org/presskit/icons/zero.svg\" alt=\"CC Zero\"></div></div></footer>");
  document.body.appendChild(panel);

  var style = document.createElement("style");
  style.textContent =
    "#tim-auto-tester-panel{position:fixed;top:8px;right:8px;width:300px;max-width:calc(100vw - 16px);max-height:65vh;overflow:auto;z-index:999999;" +
    "background:#12182a;border:1px solid #2a344a;border-radius:8px;" +
    "font-family:system-ui,sans-serif;font-size:12px;color:#e6edf5;box-shadow:0 8px 24px rgba(0,0,0,.4);}" +
    "#tat-header{padding:5px 7px;gap:4px;flex-wrap:wrap;font-weight:700;display:flex;justify-content:space-between;align-items:center;" +
    "background:#0e1424;border-bottom:1px solid #2a344a;border-radius:8px 8px 0 0;}" +
    "#tat-header button{background:none;border:none;color:#e6edf5;cursor:pointer;font-size:14px;}" +
    "#tat-body{padding:6px;display:flex;flex-direction:column;gap:5px;}" +
    "#tim-auto-tester-panel textarea{width:100%;background:#0e1424;color:#e6edf5;border:1px solid #2a344a;" +
    "border-radius:6px;padding:6px;font-family:monospace;font-size:11px;resize:vertical;box-sizing:border-box;}" +
    "#tat-list{height:42px;min-height:36px;} #tat-output{height:72px;}" +
    "#tat-row{display:flex;gap:6px;}" +
    "#tim-auto-tester-panel button{flex:1;background:#1c2740;border:1px solid #2a344a;color:#e6edf5;" +
    "border-radius:6px;padding:3px 5px;min-height:24px;font-size:11px;line-height:1.3;cursor:pointer;}" +
    "#tim-auto-tester-panel button:disabled{opacity:.4;cursor:not-allowed;}" +
    "#tim-auto-tester-panel button:hover:not(:disabled){border-color:#3E8EF7;}" +
    "#tat-status{color:#8fa1b8;}";
  style.textContent += "#tim-auto-tester-panel{box-sizing:border-box;}#tim-auto-tester-panel #tat-header{position:sticky;top:0;z-index:2;}#tim-auto-tester-panel #tat-header button{flex:none;min-width:24px;}#tim-auto-tester-panel #tat-status{font-size:11px;line-height:1.35;overflow-wrap:anywhere;}#tim-auto-tester-panel .tlp-signoff{display:grid;grid-template-columns:1fr;gap:6px;margin-top:5px;padding:8px;border:1px solid #17466e;border-left:3px solid #ff7417;border-radius:6px;background:#0a1d31;color:#93abc1;font:8px/1.3 system-ui,sans-serif;}#tim-auto-tester-panel .signoff-credit{display:flex;align-items:center;gap:7px;min-width:0;}#tim-auto-tester-panel .signoff-tag{flex:none;padding:3px 4px;border:1px solid rgba(255,116,23,.45);border-radius:4px;color:#ff7417;font-size:7px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;}#tim-auto-tester-panel .signoff-person{display:grid;grid-template-columns:auto 1fr;gap:1px 4px;min-width:0;}#tim-auto-tester-panel .signoff-person>span{font-size:8px;}#tim-auto-tester-panel .signoff-person strong{color:#f2f8ff;font-size:9px;}#tim-auto-tester-panel .signoff-person a{grid-column:1/-1;color:#19a6ff;font-size:8px;text-decoration:none;overflow-wrap:anywhere;}#tim-auto-tester-panel .signoff-meta{display:grid;gap:3px;padding-top:6px;border-top:1px solid #17466e;}#tim-auto-tester-panel .signoff-product{color:#f2f8ff;font-size:8px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;}#tim-auto-tester-panel .signoff-license{display:flex;align-items:center;flex-wrap:wrap;gap:3px;font-size:8px;}#tim-auto-tester-panel .signoff-license a{color:#19a6ff;text-decoration:none;}#tim-auto-tester-panel .signoff-license img{width:11px;height:11px;object-fit:contain;}#tim-auto-tester-panel .signoff-person a:hover,#tim-auto-tester-panel .signoff-license a:hover{text-decoration:underline;}#tim-auto-tester-panel input[type=file]{font-size:10px;padding:3px;}#tim-auto-tester-panel .tat-row{gap:4px;}";
    document.head.appendChild(style);

  var elList = panel.querySelector("#tat-list");
  var elStart = panel.querySelector("#tat-start");
  var elStop = panel.querySelector("#tat-stop");
  var elStatus = panel.querySelector("#tat-status");
  var elOutput = panel.querySelector("#tat-output");
  var elBody = panel.querySelector("#tat-body");
  var elToggle = panel.querySelector("#tat-toggle");

  elToggle.addEventListener("click", function () {
    var collapsed = elBody.style.display === "none";
    elBody.style.display = collapsed ? "flex" : "none";
    elToggle.textContent = collapsed ? "–" : "+";
  });

  // ---------- helpers ----------
  function parseList(text) {
    var lines = text.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    var seen = {};
    var out = [];
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

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function setNativeValue(el, value) {
    var proto = Object.getPrototypeOf(el);
    var setter = Object.getOwnPropertyDescriptor(proto, "value") &&
      Object.getOwnPropertyDescriptor(proto, "value").set;
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

  function classifySimple(text) {
    var lower = (text || "").toLowerCase();
    if (lower.indexOf("sem alarme") !== -1 || lower.indexOf("sem alarmes") !== -1) return "normal";
    if (lower.indexOf("alarme") !== -1) return "alarme";
    return "";
  }

  function appendResultLine(endId, text, classification) {
    var label = classification === "alarme" ? "ALARME" : (classification === "normal" ? "NORMAL" : "?");
    elOutput.value += endId + "\t[" + label + "] " + text + "\n";
    elOutput.scrollTop = elOutput.scrollHeight;
  }

  // ---------- main loop ----------
  async function runTests(list) {
    var input = document.querySelector(SELECTOR_INPUT);
    var sendBtn = document.querySelector(SELECTOR_SEND);
    if (!input || !sendBtn) {
      elStatus.textContent = "Não encontrei o campo/botão do chat nesta página.";
      return;
    }

    for (var i = 0; i < list.length; i++) {
      if (stopRequested) { elStatus.textContent = "Parado em " + i + "/" + list.length + "."; break; }

      var endId = list[i];
      elStatus.textContent = "Testando " + (i + 1) + "/" + list.length + ": " + endId + " (aguardando resposta real...)";

      setNativeValue(input, endId + " alarme");
      sendBtn.click();

      var responseEl = await waitForAlarmResult(endId);
      var text;
      if (responseEl) {
        text = flatten(responseEl);
      } else {
        text = "(sem resposta — timeout)";
      }
      var classification = classifySimple(text);
      elStatus.textContent = "Testando " + (i + 1) + "/" + list.length + ": " + endId +
        " — " + (classification === "alarme" ? "ALARME" : (classification === "normal" ? "NORMAL" : "SEM CLASSIFICAÇÃO"));
      results.push({ endId: endId, text: text, classification: classification });
      appendResultLine(endId, text, classification);

      await sleep(DELAY_BETWEEN_MS);
    }

    running = false;
    stopRequested = false;
    elStart.disabled = false;
    elStop.disabled = true;
    if (!stopRequested) elStatus.textContent = "Concluído: " + results.length + " testado(s).";
  }

  elStart.addEventListener("click", function () {
    if (running) return;
    var list = parseList(elList.value);
    if (list.length === 0) {
      elStatus.textContent = "Cole uma lista de END_ID primeiro.";
      return;
    }
    results = [];
    elOutput.value = "";
    running = true;
    stopRequested = false;
    elStart.disabled = true;
    elStop.disabled = false;
    runTests(list);
  });

  elStop.addEventListener("click", function () {
    stopRequested = true;
    elStatus.textContent = "Parando...";
  });

  panel.querySelector("#tat-copy").addEventListener("click", function () {
    navigator.clipboard.writeText(elOutput.value).then(function () {
      elStatus.textContent = "Resultados copiados (" + results.length + " linhas).";
    });
  });

  panel.querySelector("#tat-download").addEventListener("click", function () {
    var blob = new Blob([elOutput.value], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "resultados_alarmes_" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".txt";
    a.click();
  });
})();
