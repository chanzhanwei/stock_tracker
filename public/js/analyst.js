(function () {
  "use strict";

  var api = null;
  var admin = false;
  var wired = false;
  var prices = {};
  var models = [];
  var defaultModel = "";
  var current = null;
  var lastRun = null;
  var tab = "url";
  var step = { extract: false, analyse: false, save: false };
  var busy = "";
  var pastedImage = "";
  var editingId = "";
  var IMAGE_MODEL = "xiaomi/mimo-v2.6-pro";
  var MINIMAX_MODEL = "minimax/minimax-m3.1-flash";
  var IMAGE_BLOCKED = {
    "deepseek/deepseek-v4.1-flash-1017": true,
    "anthropic/claude-haiku-5.5": true,
  };
  var URL_AI_HIDDEN = {
    "google/gemini-4-carbon": true,
    "google/gemini-4-argon": true,
    "google/gemini-3.8-flash": true,
    "openai/gpt-6-astra": true,
    "openai/gpt-6.1-sol": true,
    "openai/gpt-6.1-terra": true,
    "openai/gpt-6-sol": true,
    "openai/gpt-5.6-terra": true,
    "x-ai/grok-4.7": true,
    "x-ai/grok-4.6": true,
  };

  function $(id) { return document.getElementById(id); }

  function rate(value) {
    if (value == null || !isFinite(Number(value))) return "";
    var n = Number(value);
    if (n === 0) return "$0";
    if (n >= 0.01) return "$" + n.toFixed(2);
    return "$" + n.toFixed(4).replace(/0+$/, "");
  }

  function modelLabel(id) {
    var row = prices[id];
    if (!row) return id;
    return id + "    Input " + rate(row.input) + "    Output " + rate(row.output) + "    Total " + rate(row.total);
  }

  function setError(message) {
    var el = $("analyst-error");
    if (!el) return;
    el.textContent = message || "";
    if (message && el.scrollIntoView) el.scrollIntoView({ block: "center" });
  }

  function setStatus(message) {
    var el = $("analyst-status");
    if (el) el.textContent = message || "";
  }

  function explain(body) {
    if (!body) return "The Analyze desk could not complete that step.";
    if (body.error === "admin_only") return "Only the administrator can add sources, analyse, and save.";
    if (body.message) return body.message;
    if (body.error === "unauthorized") return "Sign in again.";
    return "The Analyze desk could not complete that step.";
  }

  async function post(payload) {
    var res = await api("/api/analyst", { method: "POST", body: JSON.stringify(payload) });
    var body = {};
    try { body = await res.json(); } catch (err) { body = {}; }
    return { ok: res.ok, body: body };
  }

  function selectedSourceId() {
    var select = $("analyst-source");
    return select ? select.value : "";
  }

  function kindLabel(kind) {
    if (kind === "youtube") return "YouTube channel";
    if (kind === "x") return "X user";
    if (kind === "substack") return "Substack";
    if (kind === "website") return "Website";
    return kind || "";
  }

  function canExtract() {
    if (tab === "url") return !!($("analyst-url-input") && $("analyst-url-input").value.trim());
    if (tab === "channel") return !!($("analyst-channel-input") && $("analyst-channel-input").value.trim());
    if (tab === "existing") return !!selectedSourceId();
    return false;
  }

  function applySteps() {
    var extract = $("analyst-extract");
    var paste = $("analyst-paste");
    var run = $("analyst-run");
    var save = $("analyst-save");
    var clipboard = tab === "clipboard";
    if (extract) {
      extract.hidden = clipboard;
      extract.disabled = busy === "extract" || !step.extract;
    }
    if (paste) {
      paste.hidden = !clipboard;
      paste.disabled = busy === "paste";
    }
    if (run) run.disabled = busy === "analyse" || !step.analyse;
    if (save) save.disabled = busy === "save" || !step.save;
    var aiLine = document.querySelector(".use-ai-line");
    if (aiLine) aiLine.hidden = clipboard;
    syncExtractedText();
    placeThinking();
  }

  function syncExtractedText() {
    var field = $("analyst-text-field");
    if (field) field.hidden = tab === "clipboard";
  }

  function clearAnalysis() {
    var text = $("analyst-text");
    var result = $("analyst-result");
    if (text) text.value = "";
    if (result) result.value = "";
    current = null;
    lastRun = null;
    step.analyse = false;
    step.save = false;
    setError("");
    setStatus("");
  }

  function placeThinking() {
    var mark = $("analyst-thinking");
    if (!mark) return;
    var host = busy === "extract" ? $("analyst-extract")
      : busy === "paste" ? $("analyst-paste")
      : busy === "analyse" ? $("analyst-run")
      : busy === "save" ? $("analyst-save")
      : null;
    if (!host || !host.parentNode) {
      mark.hidden = true;
      return;
    }
    host.insertAdjacentElement("afterend", mark);
    mark.hidden = false;
  }

  function useAiOn() {
    var group = $("analyst-use-ai");
    return !!(group && group.dataset.mode === "yes");
  }

  function setUseAi(on) {
    var group = $("analyst-use-ai");
    if (!group) return;
    var value = on ? "1" : "0";
    group.dataset.mode = on ? "yes" : "no";
    Array.prototype.forEach.call(group.querySelectorAll("button"), function (button) {
      button.setAttribute("aria-pressed", button.dataset.value === value ? "true" : "false");
    });
    renderModels();
  }

  function urlAiHidesModels() {
    return tab === "url" && useAiOn();
  }

  function reasoningOn() {
    var group = $("analyst-reasoning");
    return !!(group && group.dataset.mode === "on");
  }

  function setReasoning(on) {
    var group = $("analyst-reasoning");
    if (!group) return;
    var value = on ? "1" : "0";
    group.dataset.mode = on ? "on" : "off";
    Array.prototype.forEach.call(group.querySelectorAll("button"), function (button) {
      button.setAttribute("aria-pressed", button.dataset.value === value ? "true" : "false");
    });
  }

  function applyReasoningForModel(modelId) {
    setReasoning(modelId === MINIMAX_MODEL);
  }

  function selectImageModel() {
    var select = $("analyst-model");
    if (!select) return;
    select.value = IMAGE_MODEL;
    applyReasoningForModel(IMAGE_MODEL);
  }

  function syncModelOptions() {
    var select = $("analyst-model");
    if (!select) return;
    var image = !!pastedImage;
    Array.prototype.forEach.call(select.options, function (option) {
      option.disabled = !!(image && IMAGE_BLOCKED[option.value]);
    });
    if (image && IMAGE_BLOCKED[select.value]) {
      select.value = IMAGE_MODEL;
      applyReasoningForModel(IMAGE_MODEL);
    }
  }

  function showImage(url) {
    var preview = $("analyst-paste-preview");
    var previous = pastedImage;
    pastedImage = url || "";
    if (preview) {
      if (!pastedImage) {
        preview.removeAttribute("src");
        preview.hidden = true;
      } else {
        preview.src = pastedImage;
        preview.hidden = false;
      }
    }
    if (pastedImage && pastedImage !== previous) selectImageModel();
    syncModelOptions();
  }

  function resetStep() {
    step.extract = canExtract();
    step.analyse = false;
    step.save = false;
    if (tab !== "clipboard") showImage("");
    applySteps();
  }

  function showExtractFailure(message) {
    var box = $("analyst-text");
    var hiddenText = tab === "clipboard";
    if (box) box.value = hiddenText ? "" : (message || "");
    resetDebug();
    setError(hiddenText ? (message || "") : "");
    current = null;
    lastRun = null;
    step.analyse = false;
    step.save = false;
    step.extract = canExtract();
    showTranscript(null);
    syncPlaceholder();
    applySteps();
  }

  function showTranscript(item) {
    var line = $("analyst-transcript");
    var link = $("analyst-transcript-url");
    var label = $("analyst-transcript-label");
    var visible = item && item.url && (item.kind === "youtube" || item.kind === "website");
    if (!line || !link) return;
    line.hidden = !visible;
    if (!visible) {
      link.removeAttribute("href");
      link.textContent = "";
      if (label) label.hidden = false;
      return;
    }
    if (label) label.hidden = item.kind !== "youtube";
    link.href = item.url;
    link.textContent = item.url;
  }

  function syncPlaceholder() {
    var box = $("analyst-text");
    if (!box) return;
    box.placeholder = current && current.kind === "youtube"
      ? "Paste the YouTube transcript. Captions are not downloaded."
      : "";
  }

  function showTab(next) {
    var changed = tab !== next;
    tab = next;
    [
      ["url", "analyst-tab-url", "analyst-panel-url"],
      ["channel", "analyst-tab-channel", "analyst-panel-channel"],
      ["clipboard", "analyst-tab-clipboard", "analyst-panel-clipboard"],
      ["existing", "analyst-tab-existing", "analyst-panel-existing"],
    ].forEach(function (row) {
      var button = $(row[1]);
      var panel = $(row[2]);
      var active = row[0] === next;
      if (button) button.setAttribute("aria-selected", active ? "true" : "false");
      if (panel) panel.hidden = !active;
    });
    showTranscript(null);
    if (next !== "clipboard") showImage("");
    if (changed) clearAnalysis();
    resetStep();
    renderModels();
  }

  function renderModels() {
    var select = $("analyst-model");
    if (!select) return;
    var hide = urlAiHidesModels();
    var previous = select.value;
    var selected = previous || defaultModel;
    if (hide && URL_AI_HIDDEN[selected]) selected = defaultModel;
    select.textContent = "";
    models.forEach(function (id) {
      if (hide && URL_AI_HIDDEN[id]) return;
      var option = document.createElement("option");
      option.value = id;
      option.textContent = modelLabel(id);
      if (id === selected) option.selected = true;
      select.appendChild(option);
    });
    if (!select.value && select.options.length) select.value = select.options[0].value;
    if (select.value !== previous) applyReasoningForModel(select.value);
    syncModelOptions();
  }

  function renderSources(sources, preferId) {
    var select = $("analyst-source");
    if (!select) return;
    var selected = preferId || select.value;
    select.textContent = "";
    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = sources && sources.length ? "Choose a source" : "No saved sources";
    select.appendChild(empty);
    (sources || []).forEach(function (source) {
      var option = document.createElement("option");
      option.value = source.id;
      option.dataset.kind = source.kind;
      option.dataset.url = source.url || "";
      option.textContent = (source.displayName || source.name) + " — " + kindLabel(source.kind);
      if (source.id === selected) option.selected = true;
      select.appendChild(option);
    });
    showSourceUrl();
  }

  function showSourceUrl() {
    var select = $("analyst-source");
    var line = $("analyst-source-url");
    var remove = $("analyst-remove-source");
    var option = select && select.selectedOptions && select.selectedOptions[0];
    var url = option && option.dataset.url ? option.dataset.url : "";
    if (remove) remove.hidden = !admin || !select || !select.value;
    if (!line) return;
    if (!select || !select.value || !url) {
      line.hidden = true;
      line.textContent = "";
      return;
    }
    line.hidden = false;
    line.textContent = "URL: " + url;
  }

  var ICONS = {
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>',
  };

  function iconButton(label, icon, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "row-icon";
    button.setAttribute("aria-label", label);
    button.innerHTML = ICONS[icon];
    button.addEventListener("click", function (event) {
      event.preventDefault();
      onClick();
    });
    return button;
  }

  function institutionError(message) {
    var el = $("institution-error");
    if (el) el.textContent = message || "";
  }

  function textCell(tr, text) {
    var td = document.createElement("td");
    td.textContent = text == null ? "" : String(text);
    tr.appendChild(td);
  }

  function inputCell(tr, name, value, type) {
    var td = document.createElement("td");
    var input = document.createElement("input");
    input.type = type || "text";
    input.dataset.field = name;
    input.value = value == null ? "" : String(value);
    if (name === "note") {
      td.className = "analyst-note-cell";
      input.className = "note-input";
    }
    td.appendChild(input);
    tr.appendChild(td);
  }

  function httpUrl(value) {
    var text = String(value || "").trim();
    return /^https?:\/\//i.test(text) ? text : "";
  }

  function sourceCell(tr, row) {
    var td = document.createElement("td");
    var href = httpUrl(row.postUrl) || httpUrl(row.url);
    if (href) {
      var link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = row.source || href;
      td.appendChild(link);
    } else {
      td.textContent = row.source || "";
    }
    tr.appendChild(td);
  }

  async function commitEdit(row, tr) {
    var payload = { action: "update-result", id: row.id };
    tr.querySelectorAll("input[data-field]").forEach(function (input) {
      payload[input.dataset.field] = input.value;
    });
    document.body.classList.add("is-waiting");
    try {
      var result = await post(payload);
      if (!result.ok) {
        institutionError(explain(result.body));
        return;
      }
      editingId = "";
      institutionError("");
      renderInstitution(result.body.results || []);
    } finally {
      document.body.classList.remove("is-waiting");
    }
  }

  async function removeRow(row) {
    if (!window.confirm("Delete this saved analysis?")) return;
    document.body.classList.add("is-waiting");
    try {
      var result = await post({ action: "delete-result", id: row.id });
      if (!result.ok) {
        institutionError(explain(result.body));
        return;
      }
      if (editingId === row.id) editingId = "";
      institutionError("");
      renderInstitution(result.body.results || []);
    } finally {
      document.body.classList.remove("is-waiting");
    }
  }

  function byDateDesc(a, b) {
    var ad = a && a.date ? String(a.date) : "";
    var bd = b && b.date ? String(b.date) : "";
    if (ad === bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return ad < bd ? 1 : -1;
  }

  function renderInstitution(results) {
    var body = $("institution-body");
    var empty = $("institution-empty");
    if (!body) return;
    body.textContent = "";
    var rows = (results || []).slice().sort(byDateDesc);
    if (empty) empty.hidden = rows.length > 0;
    var actionHead = document.querySelector("#institution-saved th.row-actions");
    if (actionHead) actionHead.hidden = !admin;
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      var editing = admin && editingId === row.id;
      if (editing) inputCell(tr, "date", row.date, "date");
      else textCell(tr, row.date);
      sourceCell(tr, row);
      if (editing) inputCell(tr, "website", row.website);
      else textCell(tr, row.website);
      if (editing) inputCell(tr, "analystName", row.analystName);
      else textCell(tr, row.analystName);
      if (editing) inputCell(tr, "shortTermStock", row.shortTermStock);
      else textCell(tr, row.shortTermStock);
      if (editing) inputCell(tr, "longTermStock", row.longTermStock);
      else textCell(tr, row.longTermStock);
      if (editing) inputCell(tr, "shortTermIndustry", row.shortTermIndustry);
      else textCell(tr, row.shortTermIndustry);
      if (editing) inputCell(tr, "longTermIndustry", row.longTermIndustry);
      else textCell(tr, row.longTermIndustry);
      if (editing) inputCell(tr, "longTermIndustryAvoid", row.longTermIndustryAvoid);
      else textCell(tr, row.longTermIndustryAvoid);
      if (editing) inputCell(tr, "shortTermAvoid", row.shortTermAvoid);
      else textCell(tr, row.shortTermAvoid);
      if (editing) inputCell(tr, "note", row.note);
      else {
        var noteCell = document.createElement("td");
        noteCell.className = "analyst-note-cell";
        noteCell.textContent = row.note || "";
        tr.appendChild(noteCell);
      }
      if (admin) {
        var actions = document.createElement("td");
        actions.className = "row-actions";
        if (editing) {
          actions.appendChild(iconButton("Save", "check", function () { commitEdit(row, tr); }));
          actions.appendChild(iconButton("Cancel", "x", function () {
            editingId = "";
            renderInstitution(rows);
          }));
        } else {
          actions.appendChild(iconButton("Edit", "pencil", function () {
            editingId = row.id;
            renderInstitution(rows);
          }));
          actions.appendChild(iconButton("Delete", "trash", function () { removeRow(row); }));
        }
        tr.appendChild(actions);
      }
      body.appendChild(tr);
    });
  }

  function showItem(item) {
    if (!item) {
      current = null;
      lastRun = null;
      step.save = false;
      applySteps();
      showTranscript(null);
      syncPlaceholder();
      return;
    }
    var same = current && current.id === item.id;
    current = item;
    if (!same) {
      var box = $("analyst-text");
      if (box) box.value = item.text || "";
      resetDebug();
      $("analyst-result").value = "";
      lastRun = null;
      step.save = false;
      applySteps();
    }
    if (item.sourceId) {
      var select = $("analyst-source");
      if (select) select.value = item.sourceId;
    }
    showTranscript(item);
    syncPlaceholder();
  }

  function applyRole() {
    var desk = $("analyst-desk");
    var note = $("analyst-role");
    if (desk) desk.hidden = !admin;
    if (note) note.hidden = admin;
  }

  async function loadDesk() {
    if (!api) return null;
    var res = await api("/api/analyst");
    var body = {};
    try { body = await res.json(); } catch (err) { body = {}; }
    if (!res.ok) return { error: explain(body) };
    models = body.models || [];
    prices = body.prices || {};
    defaultModel = body.defaultModel || (models[0] || "");
    return body;
  }

  async function refresh() {
    var body = await loadDesk();
    if (!body) return;
    if (body.error) {
      setError(body.error);
      return;
    }
    renderModels();
    renderSources(body.sources || []);
    renderInstitution(body.results || []);
    if (body.message) setError(body.message);
    else setError("");
    applySteps();
  }

  function openDebug() {
    var details = $("analyst-debug");
    if (details) details.open = true;
  }

  function revealDebug(debug) {
    if (!debug || (!debug.prompt && !debug.response)) return;
    showDebug(debug);
    openDebug();
  }

  function postFetchDebug(body) {
    var posted = tab === "url" || tab === "channel";
    if (!posted) {
      revealDebug(body && body.debug);
      return;
    }
    var model = body && body.debug && body.debug.prompt ? body.debug : null;
    var exchange = body && body.fetch && body.fetch.request ? body.fetch : null;
    if (useAiOn()) {
      showDebug(model);
      showHttp(null);
      if (model) openDebug();
      return;
    }
    if (exchange) {
      showDebug(null);
      showHttp(exchange);
    } else if (model) {
      showDebug(model);
    }
    if (model || exchange) openDebug();
  }

  function applyExtract(result) {
    if (!result.ok) {
      showExtractFailure(explain(result.body));
      postFetchDebug(result.body);
      return;
    }
    if (result.body.sources) {
      renderSources(result.body.sources, result.body.item && result.body.item.sourceId);
    }
    if (result.body.item) {
      showItem(result.body.item);
      postFetchDebug(result.body);
      step.extract = canExtract();
      step.analyse = true;
      step.save = false;
      setError("");
      applySteps();
      if (result.body.item.pasteTranscript) setStatus("Paste the YouTube transcript. Captions are not downloaded.");
      else setStatus("");
      return;
    }
    showExtractFailure(result.body.message || "Nothing was extracted.");
  }

  async function removeSelectedSource() {
    var id = selectedSourceId();
    if (!admin || !id) return;
    if (!window.confirm("Remove this source?")) return;
    document.body.classList.add("is-waiting");
    try {
      var result = await post({ action: "remove-source", sourceId: id });
      if (!result.ok) {
        setError(explain(result.body));
        return;
      }
      if (current && current.sourceId === id) clearAnalysis();
      renderSources(result.body.sources || []);
      setError("");
      setStatus("Source removed.");
    } catch (err) {
      setError("The source was not removed.");
    } finally {
      document.body.classList.remove("is-waiting");
    }
  }

  async function extract() {
    setError("");
    setStatus("");
    if (tab === "existing" && !selectedSourceId()) {
      showExtractFailure("Choose a saved source.");
      return;
    }
    if (tab === "channel" && !$("analyst-channel-input").value.trim()) {
      showExtractFailure("Paste a channel URL.");
      return;
    }
    if (tab !== "existing" && tab !== "channel" && !$("analyst-url-input").value.trim()) {
      showExtractFailure("Paste a URL.");
      return;
    }
    busy = "extract";
    applySteps();
    try {
      var result;
      var ai = { useAi: useAiOn(), model: $("analyst-model").value };
      if (tab === "existing") {
        result = await post(Object.assign({ action: "fetch", sourceId: selectedSourceId() }, ai));
      } else if (tab === "channel") {
        result = await post(Object.assign({ action: "open-url", url: $("analyst-channel-input").value.trim(), mode: "channel" }, ai));
      } else {
        result = await post(Object.assign({ action: "open-url", url: $("analyst-url-input").value.trim(), mode: "page" }, ai));
      }
      applyExtract(result);
      var opened = result.ok && result.body && result.body.item;
      if (tab === "existing" && opened && opened.url && (opened.kind === "website" || opened.kind === "youtube")) {
        window.open(opened.url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      showExtractFailure("The text could not be extracted.");
    } finally {
      busy = "";
      applySteps();
    }
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("read")); };
      reader.readAsDataURL(blob);
    });
  }

  async function pasteClipboard() {
    setError("");
    setStatus("");
    busy = "paste";
    applySteps();
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        showExtractFailure("The clipboard could not be read.");
        return;
      }
      var items = await navigator.clipboard.read();
      var blob = null;
      items.forEach(function (item) {
        if (blob) return;
        (item.types || []).forEach(function (type) {
          if (!blob && type.indexOf("image/") === 0) blob = item.getType(type);
        });
      });
      if (!blob) {
        showImage("");
        step.analyse = false;
        step.save = false;
        showExtractFailure("The clipboard does not contain an image.");
        return;
      }
      blob = await blob;
      if (blob.size > 3 * 1024 * 1024) {
        showImage("");
        step.analyse = false;
        step.save = false;
        showExtractFailure("That image is larger than 4 MB.");
        return;
      }
      var dataUrl = await blobToDataUrl(blob);
      if (dataUrl.length > 4 * 1024 * 1024) {
        showImage("");
        step.analyse = false;
        step.save = false;
        showExtractFailure("That image is larger than 4 MB.");
        return;
      }
      showImage(dataUrl);
      var box = $("analyst-text");
      if (box) box.value = "";
      resetDebug();
      current = null;
      lastRun = null;
      step.analyse = true;
      step.save = false;
      setError("");
      setStatus("");
      applySteps();
    } catch (err) {
      showImage("");
      step.analyse = false;
      step.save = false;
      showExtractFailure("The clipboard could not be read.");
    } finally {
      busy = "";
      applySteps();
    }
  }

  function showHttp(exchange) {
    var request = $("analyst-http-request");
    var response = $("analyst-http-response");
    if (request) request.value = exchange && exchange.request ? exchange.request : "";
    if (response) response.value = exchange && exchange.response ? exchange.response : "";
  }

  function showDebug(debug) {
    var request = $("analyst-debug-request");
    var response = $("analyst-debug-response");
    if (request) request.value = debug && debug.prompt ? debug.prompt : "";
    if (response) response.value = debug && debug.response ? debug.response : "";
  }

  function resetDebug() {
    showDebug(null);
    showHttp(null);
    var details = $("analyst-debug");
    if (details) details.open = false;
  }

  async function runAnalyse() {
    setError("");
    setStatus("");
    var text = $("analyst-text").value.trim();
    var image = tab === "clipboard" ? pastedImage : "";
    if (!text && !image) {
      setError("The text box is empty.");
      return;
    }
    $("analyst-result").value = "";
    busy = "analyse";
    applySteps();
    setStatus("Analysing.");
    try {
      var model = $("analyst-model").value;
      var result = await post({
        action: "analyse",
        model: model,
        text: $("analyst-text").value,
        url: current && current.url ? current.url : "",
        image: image,
        reasoning: reasoningOn(),
        useAi: useAiOn() && tab === "url",
      });
      showDebug(result.body && result.body.debug);
      if (result.body && result.body.debug) openDebug();
      if (!result.ok) {
        $("analyst-result").value = "";
        setStatus("");
        step.save = false;
        setError(explain(result.body));
        return;
      }
      $("analyst-result").value = result.body.text || "";
      lastRun = {
        model: result.body.model || model,
        totalCost: result.body.totalCost,
        inputCost: result.body.inputCost,
        outputCost: result.body.outputCost,
      };
      renderModels();
      $("analyst-model").value = lastRun.model;
      syncModelOptions();
      step.save = true;
      setStatus("You can edit the result before saving.");
    } catch (err) {
      showDebug(null);
      $("analyst-result").value = "";
      setStatus("");
      step.save = false;
      setError("OpenRouter could not be reached.");
    } finally {
      busy = "";
      applySteps();
    }
  }

  async function saveResult() {
    setError("");
    setStatus("");
    var clipboard = tab === "clipboard" && !!pastedImage;
    if (!clipboard && (!current || !current.id)) {
      setError("Extract an item before saving.");
      step.save = false;
      applySteps();
      return;
    }
    if (!lastRun) {
      setError("Analyse the text before saving.");
      step.save = false;
      applySteps();
      return;
    }
    busy = "save";
    applySteps();
    try {
      var payload = {
        action: "save",
        resultText: $("analyst-result").value,
        model: lastRun.model,
        totalCost: lastRun.totalCost,
        inputCost: lastRun.inputCost,
        outputCost: lastRun.outputCost,
      };
      if (clipboard) payload.clipboard = true;
      else payload.itemId = current.id;
      var result = await post(payload);
      if (!result.ok) {
        setError(explain(result.body));
        step.save = true;
        return;
      }
      renderInstitution(result.body.results || []);
      current = null;
      lastRun = null;
      step.analyse = clipboard ? !!pastedImage : false;
      step.save = false;
      setStatus(clipboard ? "Saved." : "Saved. That post will not be analysed again.");
    } catch (err) {
      setError("The result was not saved.");
      step.save = true;
    } finally {
      busy = "";
      applySteps();
    }
  }

  function wire() {
    $("analyst-tab-url").addEventListener("click", function () { showTab("url"); });
    $("analyst-tab-channel").addEventListener("click", function () { showTab("channel"); });
    $("analyst-tab-clipboard").addEventListener("click", function () { showTab("clipboard"); });
    $("analyst-tab-existing").addEventListener("click", function () { showTab("existing"); });
    $("analyst-url-input").addEventListener("input", resetStep);
    $("analyst-channel-input").addEventListener("input", resetStep);
    $("analyst-source").addEventListener("change", function () {
      showSourceUrl();
      clearAnalysis();
      resetStep();
    });
    $("analyst-text").addEventListener("input", resetDebug);
    $("analyst-model").addEventListener("change", function () {
      applyReasoningForModel($("analyst-model").value);
    });
    $("analyst-reasoning").addEventListener("click", function (event) {
      var button = event.target.closest("button");
      if (!button || !button.dataset.value) return;
      setReasoning(button.dataset.value === "1");
    });
    $("analyst-use-ai").addEventListener("click", function (event) {
      var button = event.target.closest("button");
      if (!button || !button.dataset.value) return;
      setUseAi(button.dataset.value === "1");
    });
    $("analyst-extract").addEventListener("click", extract);
    $("analyst-remove-source").addEventListener("click", removeSelectedSource);
    $("analyst-paste").addEventListener("click", pasteClipboard);
    $("analyst-run").addEventListener("click", runAnalyse);
    $("analyst-save").addEventListener("click", saveResult);
    wired = true;
    applySteps();
  }

  function open(ctx) {
    api = ctx.api;
    admin = !!ctx.admin;
    applyRole();
    if (!wired) wire();
    return refresh();
  }

  async function openInstitution(ctx) {
    api = ctx.api;
    admin = !!ctx.admin;
    if (!wired) wire();
    var note = $("institution-error");
    var body = await loadDesk();
    if (!body) return;
    if (body.error) {
      if (note) note.textContent = body.error;
      return;
    }
    renderInstitution(body.results || []);
    if (note) note.textContent = body.message || "";
  }

  window.STAnalyst = { open: open, openInstitution: openInstitution };
})();
