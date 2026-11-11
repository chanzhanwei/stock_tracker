(function () {
  "use strict";

  var api = null;
  var admin = false;
  var wired = false;
  var costs = {};
  var models = [];
  var defaultModel = "";
  var current = null;
  var lastRun = null;

  function $(id) { return document.getElementById(id); }

  function money(value) {
    if (value == null || value === "" || !isFinite(Number(value))) return "";
    return "$" + Number(value).toFixed(6);
  }

  function modelLabel(id) {
    var row = costs[id];
    if (!row) return id;
    return id + "    total " + money(row.totalCost) + "    in " + money(row.inputCost) + "    out " + money(row.outputCost);
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

  function selectedKind() {
    var select = $("analyst-source");
    if (!select || select.selectedIndex < 0) return "";
    var option = select.options[select.selectedIndex];
    return option ? (option.dataset.kind || "") : "";
  }

  function kindLabel(kind) {
    if (kind === "youtube") return "YouTube channel";
    if (kind === "x") return "X user";
    if (kind === "substack") return "Substack";
    if (kind === "website") return "Website";
    return kind || "";
  }

  function syncPlaceholder() {
    var box = $("analyst-text");
    if (!box) return;
    var kind = (current && current.kind) || selectedKind();
    box.placeholder = kind === "youtube"
      ? "Paste the YouTube transcript. Captions are not downloaded."
      : "";
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
      option.textContent = source.name + " — " + kindLabel(source.kind);
      if (source.id === selected) option.selected = true;
      select.appendChild(option);
    });
    syncPlaceholder();
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
      cell(row.analystName);
      cell(row.shortTermStock);
      cell(row.longTermStock);
      cell(row.shortTermIndustry);
      cell(row.longTermIndustry);
      cell(row.shortTermAvoid);
      body.appendChild(tr);
    });
  }

  function showItem(item) {
    var link = $("analyst-url");
    var title = $("analyst-title");
    if (!item) {
      current = null;
      if (link) {
        link.hidden = true;
        link.removeAttribute("href");
        link.textContent = "";
      }
      if (title) title.textContent = "";
      syncPlaceholder();
      return;
    }
    var same = current && current.id === item.id;
    current = item;
    if (!same) {
      $("analyst-text").value = item.text || "";
      $("analyst-result").value = "";
      lastRun = null;
    }
    if (title) title.textContent = item.title || "";
    if (item.sourceId) {
      var select = $("analyst-source");
      if (select) select.value = item.sourceId;
    }
    if (link) {
      link.hidden = !item.url;
      link.href = item.url || "";
      link.textContent = item.url || "";
    }
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
  }

  async function addSource(event) {
    event.preventDefault();
    setError("");
    setStatus("");
    var button = $("analyst-add-button");
    button.disabled = true;
    try {
      var result = await post({
        action: "add-source",
        name: $("analyst-name").value,
        kind: $("analyst-kind").value,
      });
      if (!result.ok) {
        setError(explain(result.body));
        return;
      }
      $("analyst-name").value = "";
      renderSources(result.body.sources || [], result.body.source && result.body.source.id);
      setStatus("Source saved.");
    } catch (err) {
      setError("The source was not saved.");
    } finally {
      button.disabled = false;
    }
  }

  async function fetchNext() {
    setError("");
    setStatus("");
    if (!selectedSourceId()) {
      setError("Choose a saved source, or paste a URL.");
      return;
    }
    var button = $("analyst-fetch");
    button.disabled = true;
    try {
      var result = await post({ action: "fetch", sourceId: selectedSourceId() });
      if (!result.ok) {
        setError(explain(result.body));
        return;
      }
      showItem(result.body.item || null);
      if (result.body.message) setStatus(result.body.message);
      else if (result.body.item && result.body.item.pasteTranscript) setStatus("Paste the transcript into the text box.");
      else setStatus("");
    } catch (err) {
      setError("The next item could not be fetched.");
    } finally {
      button.disabled = false;
    }
  }

  async function runAnalyse() {
    setError("");
    setStatus("");
    var text = $("analyst-text").value.trim();
    if (!text) {
      setError("The text box is empty.");
      return;
    }
    var button = $("analyst-run");
    button.disabled = true;
    setStatus("Analysing.");
    try {
      var model = $("analyst-model").value;
      var result = await post({ action: "analyse", model: model, text: $("analyst-text").value });
      if (!result.ok) {
        setStatus("");
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
      costs[lastRun.model] = {
        totalCost: lastRun.totalCost,
        inputCost: lastRun.inputCost,
        outputCost: lastRun.outputCost,
      };
      renderModels();
      $("analyst-model").value = lastRun.model;
      setStatus("You can edit the result before saving.");
    } catch (err) {
      setStatus("");
      setError("OpenRouter could not be reached.");
    } finally {
      button.disabled = false;
    }
  }

  async function saveResult() {
    setError("");
    setStatus("");
    if (!current || !current.id) {
      setError("Fetch an item before saving.");
      return;
    }
    if (!lastRun) {
      setError("Analyse the text before saving.");
      return;
    }
    var button = $("analyst-save");
    button.disabled = true;
    try {
      var result = await post({
        action: "save",
        itemId: current.id,
        resultText: $("analyst-result").value,
        model: lastRun.model,
        totalCost: lastRun.totalCost,
        inputCost: lastRun.inputCost,
        outputCost: lastRun.outputCost,
      });
      if (!result.ok) {
        setError(explain(result.body));
        return;
      }
      renderInstitution(result.body.results || []);
      current = null;
      lastRun = null;
      setStatus("Saved. That post will not be analysed again.");
    } catch (err) {
      setError("The result was not saved.");
    } finally {
      button.disabled = false;
    }
  }

  async function openUrl(event) {
    event.preventDefault();
    setError("");
    setStatus("");
    var url = $("analyst-url-input").value.trim();
    if (!url) {
      setError("Paste a URL, or choose a saved source.");
      return;
    }
    var button = $("analyst-open-url");
    button.disabled = true;
    try {
      var result = await post({ action: "open-url", url: url });
      if (!result.ok) {
        setError(explain(result.body));
        return;
      }
      if (result.body.sources) {
        renderSources(result.body.sources, result.body.item && result.body.item.sourceId);
      }
      if (result.body.item) {
        showItem(result.body.item);
        $("analyst-url-input").value = "";
        if (result.body.item.pasteTranscript) setStatus("Paste the transcript into the text box.");
        else setStatus("");
      } else if (result.body.message) {
        setStatus(result.body.message);
      }
    } catch (err) {
      setError("That URL could not be opened.");
    } finally {
      button.disabled = false;
    }
  }

  function wire() {
    $("analyst-add").addEventListener("submit", addSource);
    $("analyst-url-form").addEventListener("submit", openUrl);
    $("analyst-fetch").addEventListener("click", fetchNext);
    $("analyst-run").addEventListener("click", runAnalyse);
    $("analyst-save").addEventListener("click", saveResult);
    $("analyst-source").addEventListener("change", syncPlaceholder);
    wired = true;
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
