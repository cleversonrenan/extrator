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
    '<div id="tat-header"><span class="tat-brand"><span class="tat-logo"><img src="https://cleversonrenan.github.io/extrator/TLP.PNG" alt="TLP"></span><span class="tat-title"><strong>Testador automático</strong><small>Portal TLP</small></span></span><button id="tat-toggle" type="button" aria-label="Recolher painel" title="Recolher painel">–</button></div>' +
    '<div id="tat-body">' +
    '  <section class="tat-section"><span class="tat-section-title">Consulta manual</span><textarea id="tat-list" placeholder="Cole aqui a lista de END_ID, um por linha"></textarea>' +
    '  <div class="tat-row">' +
    '    <button id="tat-start">Iniciar</button>' +
    '    <button id="tat-stop" disabled>Parar</button>' +
    "  </div></section>" +
    '  <div id="tat-status">Pronto.</div>' +
    '  <section class="tat-section"><span class="tat-section-title">Resultados</span><textarea id="tat-output" placeholder="Resultados aparecem aqui (END_ID + TAB + resposta)" readonly></textarea>' +
    '  <div class="tat-row">' +
    '    <button id="tat-copy">Copiar resultados</button>' +
    '    <button id="tat-download">Baixar .txt</button>' +
    "  </div></section>" +
    "</div>";
  panel.querySelector("#tat-body").insertAdjacentHTML("beforeend", "<footer class=\"tlp-signoff\" aria-label=\"Créditos e licença\"><div class=\"signoff-credit\"><span class=\"signoff-tag\">Adaptação</span><div class=\"signoff-person\"><span>Adaptado por</span><strong>Cleverson Renan</strong><a href=\"mailto:cleversonrenan@gmail.com\">cleversonrenan@gmail.com</a></div></div><div class=\"signoff-meta\"><div class=\"signoff-product\">Testador de Alarmes · 2026</div><div class=\"signoff-license\">Esta obra está licenciada sob a licença <a href=\"https://creativecommons.org/publicdomain/zero/1.0/\" target=\"_blank\" rel=\"license noopener\">CC0 1.0 Universal.</a><img src=\"https://mirrors.creativecommons.org/presskit/icons/cc.svg\" alt=\"Creative Commons\"><img src=\"https://mirrors.creativecommons.org/presskit/icons/zero.svg\" alt=\"CC Zero\"></div></div></footer>");
  document.body.appendChild(panel);

    var style = document.createElement("style");
    style.textContent = `
      #tim-auto-tester-panel{--tat-bg:#061423;--tat-surface:#0a1d31;--tat-surface-2:#0d253e;--tat-line:#17466e;--tat-line-soft:rgba(39,126,190,.28);--tat-text:#f2f8ff;--tat-muted:#93abc1;--tat-blue:#19a6ff;--tat-blue-strong:#007de5;--tat-orange:#ff7417;--tat-green:#2be19d;--tat-red:#ff5364;--tat-yellow:#ffd02e;position:fixed;top:8px;right:8px;width:390px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;z-index:999999;background:var(--tat-bg);border:1px solid var(--tat-line);border-radius:14px;color:var(--tat-text);font:500 12px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 16px 42px rgba(0,0,0,.34);color-scheme:dark;isolation:isolate;scrollbar-color:var(--tat-blue-strong) transparent}
      #tim-auto-tester-panel,#tim-auto-tester-panel *{box-sizing:border-box}
      #tim-auto-tester-panel #tat-header{position:sticky;top:0;z-index:3;display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;min-height:58px;padding:7px 8px 7px 11px;border-bottom:1px solid var(--tat-line);background:var(--tat-surface);overflow:hidden}
      #tim-auto-tester-panel #tat-header::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:linear-gradient(var(--tat-blue),var(--tat-orange))}
      #tim-auto-tester-panel .tat-brand{display:flex;align-items:center;gap:8px;min-width:0}
      #tim-auto-tester-panel .tat-logo{display:grid;place-items:center;width:48px;height:31px;flex:0 0 48px}
      #tim-auto-tester-panel .tat-logo img{display:block;width:100%;height:100%;object-fit:contain}
      #tim-auto-tester-panel .tat-title{display:grid;min-width:0;line-height:1.05}
      #tim-auto-tester-panel .tat-title strong{overflow:hidden;color:var(--tat-text);font-size:13px;letter-spacing:-.02em;text-overflow:ellipsis;white-space:nowrap}
      #tim-auto-tester-panel .tat-title small{margin-top:4px;color:var(--tat-orange);font-size:7px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
      #tim-auto-tester-panel #tat-connectivity-host{display:inline-flex;align-items:center;min-width:0}
      #tim-auto-tester-panel #tat-toggle{display:grid;place-items:center;min-width:30px;width:30px;height:30px;flex:none;padding:0;border:1px solid var(--tat-line);border-radius:9px;background:var(--tat-surface-2);color:var(--tat-blue);font-size:16px;line-height:1;cursor:pointer}
      #tim-auto-tester-panel #tat-toggle:hover{border-color:var(--tat-blue)}
      #tim-auto-tester-panel #tat-body{display:flex;flex-direction:column;gap:7px;padding:8px}
      #tim-auto-tester-panel .tat-section{display:grid;gap:6px;padding:8px;border:1px solid var(--tat-line-soft);border-radius:10px;background:var(--tat-surface)}
      #tim-auto-tester-panel .tat-section-title{color:var(--tat-orange);font-size:8px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}
      #tim-auto-tester-panel textarea,#tim-auto-tester-panel input,#tim-auto-tester-panel select{width:100%;margin:0;padding:7px 8px;border:1px solid var(--tat-line);border-radius:7px;background:var(--tat-surface-2);color:var(--tat-text);font:500 11px/1.35 Inter,system-ui,sans-serif;outline:none}
      #tim-auto-tester-panel textarea:focus,#tim-auto-tester-panel input:focus,#tim-auto-tester-panel select:focus{border-color:var(--tat-blue);box-shadow:0 0 0 2px rgba(25,166,255,.12)}
      #tim-auto-tester-panel #tat-list{height:58px;min-height:42px;resize:vertical;font-family:"SFMono-Regular",Consolas,monospace}
      #tim-auto-tester-panel #tat-import-label{display:grid;gap:4px;color:var(--tat-muted);font-size:9px}
      #tim-auto-tester-panel #tat-import{padding:5px;font-size:9px}
      #tim-auto-tester-panel #tat-sheet-info{align-self:center;min-width:0;color:var(--tat-muted);font-size:9px;overflow-wrap:anywhere}
      #tim-auto-tester-panel .tat-row{display:flex;gap:5px;align-items:stretch}
      #tim-auto-tester-panel button{min-height:30px;flex:1;padding:5px 8px;border:1px solid var(--tat-line);border-radius:7px;background:var(--tat-surface-2);color:var(--tat-text);font:800 10px/1.2 Inter,system-ui,sans-serif;cursor:pointer}
      #tim-auto-tester-panel button:hover:not(:disabled){border-color:var(--tat-blue)}
      #tim-auto-tester-panel button:disabled{opacity:.42;cursor:not-allowed}
      #tim-auto-tester-panel #tat-start,#tim-auto-tester-panel #tat-sheet-start,#tim-auto-tester-panel #tat-export{border-color:var(--tat-blue);background:linear-gradient(115deg,var(--tat-blue-strong),var(--tat-blue));color:#fff}
      #tim-auto-tester-panel #tat-stop{border-color:rgba(255,116,23,.55);color:var(--tat-orange)}
      #tim-auto-tester-panel #tat-status{min-height:30px;padding:7px 9px;border-left:3px solid var(--tat-blue);border-radius:6px;background:var(--tat-surface);color:var(--tat-muted);font-size:10px;line-height:1.35;overflow-wrap:anywhere}
      #tim-auto-tester-panel #tat-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}
      #tim-auto-tester-panel .tat-stat{position:relative;display:grid;gap:1px;min-width:0;padding:7px 4px;border:1px solid var(--tat-line);border-radius:9px;background:var(--tat-surface);text-align:center;overflow:hidden}
      #tim-auto-tester-panel .tat-stat::after{content:"";position:absolute;right:5px;bottom:0;left:5px;height:2px;border-radius:2px;background:var(--tat-blue)}
      #tim-auto-tester-panel .tat-stat b{color:var(--tat-text);font-size:17px;line-height:1}
      #tim-auto-tester-panel .tat-stat span{color:var(--tat-muted);font-size:8px;white-space:nowrap}
      #tim-auto-tester-panel #stat-alarme::after{background:var(--tat-red)}#tim-auto-tester-panel #stat-alarme b{color:var(--tat-red)}
      #tim-auto-tester-panel #stat-normal::after{background:var(--tat-green)}#tim-auto-tester-panel #stat-normal b{color:var(--tat-green)}
      #tim-auto-tester-panel #stat-pendente::after{background:var(--tat-yellow)}#tim-auto-tester-panel #stat-pendente b{color:var(--tat-yellow)}
      #tim-auto-tester-panel #tat-table{max-height:210px;overflow:auto;border:1px solid var(--tat-line);border-radius:9px;background:var(--tat-surface)}
      #tim-auto-tester-panel .tat-row-item{padding:7px 8px;border-left:3px solid transparent;border-bottom:1px solid var(--tat-line-soft)}
      #tim-auto-tester-panel .tat-row-item:last-child{border-bottom:0}
      #tim-auto-tester-panel .tat-row-item.normal{border-left-color:var(--tat-green);background:rgba(43,225,157,.07)}
      #tim-auto-tester-panel .tat-row-item.alarme{border-left-color:var(--tat-red);background:rgba(255,83,100,.07)}
      #tim-auto-tester-panel .tat-row-item.pendente{border-left-color:var(--tat-yellow);background:rgba(255,208,46,.07)}
      #tim-auto-tester-panel .tat-row-top{display:flex;justify-content:space-between;align-items:center;gap:6px}
      #tim-auto-tester-panel .tat-endid{font-family:"SFMono-Regular",Consolas,monospace;font-weight:800}
      #tim-auto-tester-panel .tat-badge{padding:2px 7px;border:1px solid currentColor;border-radius:999px;font-size:8px;font-weight:900;text-transform:uppercase}
      #tim-auto-tester-panel .tat-badge.alarme{color:var(--tat-red);background:rgba(255,83,100,.1)}
      #tim-auto-tester-panel .tat-badge.normal{color:var(--tat-green);background:rgba(43,225,157,.1)}
      #tim-auto-tester-panel .tat-badge.pendente{color:var(--tat-yellow);background:rgba(255,208,46,.1)}
      #tim-auto-tester-panel .tat-resp{max-height:38px;margin-top:3px;overflow:hidden;color:var(--tat-muted);font-size:9px}
      #tim-auto-tester-panel .tat-resp.expanded{max-height:none}
      #tim-auto-tester-panel .tat-mini-actions{display:flex;gap:4px;margin-top:5px}
      #tim-auto-tester-panel .tat-mini-actions button{min-height:24px;padding:2px 6px;flex:none;background:transparent;font-size:9px}
      #tim-auto-tester-panel #tat-kw-toggle{padding:7px 9px;border:1px solid var(--tat-line-soft);border-radius:8px;background:var(--tat-surface);color:var(--tat-muted);font-size:9px;font-weight:800;cursor:pointer}
      #tim-auto-tester-panel #tat-kw-body{padding:7px;border:1px solid var(--tat-line-soft);border-radius:8px;background:var(--tat-surface)}
      #tim-auto-tester-panel .tat-kw-title{margin-top:4px;font-size:9px;font-weight:800}#tim-auto-tester-panel .tat-kw-title.alarme{color:var(--tat-red)}#tim-auto-tester-panel .tat-kw-title.normal{color:var(--tat-green)}
      #tim-auto-tester-panel .tat-kw-list{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
      #tim-auto-tester-panel .tat-kw{display:flex;align-items:center;gap:4px;padding:2px 6px;border:1px solid var(--tat-line);border-radius:999px;background:var(--tat-surface-2);font-size:9px}
      #tim-auto-tester-panel .tat-kw button{min-height:0;padding:0;border:0;background:none;color:inherit;font-size:10px;flex:none}
      #tim-auto-tester-panel .tlp-signoff{display:grid;grid-template-columns:1fr;gap:6px;margin-top:2px;padding:8px;border:1px solid var(--tat-line);border-left:3px solid var(--tat-orange);border-radius:8px;background:var(--tat-surface);color:var(--tat-muted);font:8px/1.3 system-ui,sans-serif}
      #tim-auto-tester-panel .signoff-credit{display:flex;align-items:center;gap:7px;min-width:0}#tim-auto-tester-panel .signoff-tag{flex:none;padding:3px 4px;border:1px solid rgba(255,116,23,.45);border-radius:4px;color:var(--tat-orange);font-size:7px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
      #tim-auto-tester-panel .signoff-person{display:grid;grid-template-columns:auto 1fr;gap:1px 4px;min-width:0}#tim-auto-tester-panel .signoff-person>span{font-size:8px}#tim-auto-tester-panel .signoff-person strong{color:var(--tat-text);font-size:9px}#tim-auto-tester-panel .signoff-person a{grid-column:1/-1;color:var(--tat-blue);font-size:8px;text-decoration:none;overflow-wrap:anywhere}
      #tim-auto-tester-panel .signoff-meta{display:grid;gap:3px;padding-top:6px;border-top:1px solid var(--tat-line)}#tim-auto-tester-panel .signoff-product{color:var(--tat-text);font-size:8px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}#tim-auto-tester-panel .signoff-license{display:flex;align-items:center;flex-wrap:wrap;gap:3px;font-size:8px}#tim-auto-tester-panel .signoff-license a{color:var(--tat-blue);text-decoration:none}#tim-auto-tester-panel .signoff-license img{width:11px;height:11px;object-fit:contain}
      @media(max-width:430px){#tim-auto-tester-panel{top:4px;right:4px;max-width:calc(100vw - 8px);max-height:calc(100vh - 8px)}#tim-auto-tester-panel .tat-logo{width:39px;flex-basis:39px}#tim-auto-tester-panel .tat-title small{display:none}}
      @media(prefers-reduced-motion:reduce){#tim-auto-tester-panel *,#tim-auto-tester-panel *::before,#tim-auto-tester-panel *::after{animation:none!important;transition:none!important}}
    `;
    style.textContent += "#tim-auto-tester-panel #tat-output{height:110px;min-height:72px;resize:vertical;font-family:\"SFMono-Regular\",Consolas,monospace}#tim-auto-tester-panel #tat-copy{border-color:var(--tat-blue);background:linear-gradient(115deg,var(--tat-blue-strong),var(--tat-blue));color:#fff}";
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
