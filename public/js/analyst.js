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

  function selectedKind() {
    var select = $("analyst-source");
    if (!select || select.selectedIndex < 0) return "";
    var option = select.options[select.selectedIndex];
    return option && option.dataset ? option.dataset.kind || "" : "";
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
  }

  function showImage(url) {
    var preview = $("analyst-paste-preview");
    pastedImage = url || "";
    if (!preview) return;
    if (!pastedImage) {
      preview.removeAttribute("src");
      preview.hidden = true;
      return;
    }
    preview.src = pastedImage;
    preview.hidden = false;
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
    if (box) box.value = message || "";
    setError("");
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
    var youtube = item && item.kind === "youtube" && item.url;
    if (!line || !link) return;
    line.hidden = !youtube;
    if (!youtube) {
      link.removeAttribute("href");
      link.textContent = "";
      return;
    }
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
    if (next !== "clipboard") showImage("");
    resetStep();
  }

  function renderModels() {
    var select = $("analyst-model");
    if (!select) return;
    var selected = select.value || defaultModel;
    select.textContent = "";
    models.forEach(function (id) {
      var option = document.createElement("option");
      option.value = id;
      option.textContent = modelLabel(id);
      if (id === selected) option.selected = true;
      select.appendChild(option);
    });
    if (!select.value && models.length) select.value = defaultModel || models[0];
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
      option.textContent = (source.displayName || source.name) + " — " + kindLabel(source.kind);
      if (source.id === selected) option.selected = true;
      select.appendChild(option);
    });
  }

  function renderInstitution(results) {
    var body = $("institution-body");
    var empty = $("institution-empty");
    if (!body) return;
    body.textContent = "";
    var rows = results || [];
    if (empty) empty.hidden = rows.length > 0;
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      function cell(text) {
        var td = document.createElement("td");
        td.textContent = text == null ? "" : String(text);
        tr.appendChild(td);
      }
      cell(row.date);
      var sourceCell = document.createElement("td");
      if (row.postUrl) {
        var link = document.createElement("a");
        link.href = row.postUrl;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = row.source || row.postUrl;
        sourceCell.appendChild(link);
      } else {
        sourceCell.textContent = row.source || "";
      }
      tr.appendChild(sourceCell);
      cell(row.website);
      cell(row.analystName);
      cell(row.shortTermStock);
      cell(row.longTermStock);
      cell(row.shortTermIndustry);
      cell(row.longTermIndustry);
      cell(row.longTermIndustryAvoid);
      cell(row.shortTermAvoid);
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
      $("analyst-text").value = item.text || "";
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

  function applyExtract(result) {
    if (!result.ok) {
      showExtractFailure(explain(result.body));
      return;
    }
    if (result.body.sources) {
      renderSources(result.body.sources, result.body.item && result.body.item.sourceId);
    }
    if (result.body.item) {
      showItem(result.body.item);
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

  function pointPopup(popup, url) {
    if (!popup) return;
    if (!url) {
      popup.close();
      return;
    }
    try { popup.opener = null; } catch (err) { /* a blocked popup has no window */ }
    popup.location.href = url;
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
    var popup = null;
    if (tab === "existing" && (selectedKind() === "website" || selectedKind() === "youtube")) {
      popup = window.open("about:blank", "_blank");
    }
    busy = "extract";
    applySteps();
    try {
      var result;
      if (tab === "existing") {
        result = await post({ action: "fetch", sourceId: selectedSourceId() });
      } else if (tab === "channel") {
        result = await post({ action: "open-url", url: $("analyst-channel-input").value.trim(), mode: "channel" });
      } else {
        result = await post({ action: "open-url", url: $("analyst-url-input").value.trim(), mode: "page" });
      }
      applyExtract(result);
      pointPopup(popup, result.ok && result.body.item ? result.body.item.url : "");
    } catch (err) {
      showExtractFailure("The text could not be extracted.");
      pointPopup(popup, "");
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

  async function runAnalyse() {
    setError("");
    setStatus("");
    var text = $("analyst-text").value.trim();
    var image = tab === "clipboard" ? pastedImage : "";
    if (!text && !image) {
      setError("The text box is empty.");
      return;
    }
    var thinking = $("analyst-thinking");
    busy = "analyse";
    applySteps();
    if (thinking) thinking.hidden = false;
    setStatus("Analysing.");
    try {
      var model = $("analyst-model").value;
      var result = await post({
        action: "analyse",
        model: model,
        text: $("analyst-text").value,
        url: current && current.url ? current.url : "",
        image: image,
      });
      if (!result.ok) {
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
      step.save = true;
      setStatus("You can edit the result before saving.");
    } catch (err) {
      setStatus("");
      step.save = false;
      setError("OpenRouter could not be reached.");
    } finally {
      busy = "";
      applySteps();
      if (thinking) thinking.hidden = true;
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
    $("analyst-source").addEventListener("change", resetStep);
    $("analyst-extract").addEventListener("click", extract);
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
