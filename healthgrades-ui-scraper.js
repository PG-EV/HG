(function () {
  if (window.__HG_NPI_SCRAPER_LOADED__) {
    alert("NPI scraper is already open.");
    return;
  }

  window.__HG_NPI_SCRAPER_LOADED__ = true;

  var results = [];
  var running = false;
  var startTime = null;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function normalizeUrl(u) {
    if (!u) return "";
    var url = String(u).trim();
    url = url.replace(/[?&]place-id=(?=&|$)/i, "");
    url = url.replace(/[?&]$/g, "");
    url = url.replace(/\?place-id=$/i, "");
    url = url.replace(/^http:\/\//i, "https://");
    return url;
  }

  function csvEscape(value) {
    return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  }

  function formatEta(ms) {
    if (!isFinite(ms) || ms < 0) return "--";
    var totalSeconds = Math.round(ms / 1000);
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    if (minutes <= 0) return seconds + "s";
    return minutes + "m " + seconds + "s";
  }

  function extractNpisFromHtml(html) {
    var hits = {};
    var m;

    var patterns = [
      /npi\\":\\"(\d{10})\\"/g,
      /"npi"\s*:\s*"(\d{10})"/gi,
      /"npiNumber"\s*:\s*"(\d{10})"/gi,
      /npi[^0-9]{0,50}(\d{10})/gi
    ];

    for (var i = 0; i < patterns.length; i++) {
      while ((m = patterns[i].exec(html)) !== null) {
        hits[m[1]] = true;
      }
    }

    return Object.keys(hits);
  }

  async function fetchWithRetry(url, maxRetries) {
    var attempt = 0;

    while (true) {
      var controller = new AbortController();
      var timeout = setTimeout(function () {
        controller.abort();
      }, 25000);

      try {
        var res = await fetch(url, {
          credentials: "include",
          signal: controller.signal,
          headers: {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
          }
        });

        clearTimeout(timeout);

        if (
          !res.ok &&
          [429, 500, 502, 503, 504].indexOf(res.status) !== -1 &&
          attempt < maxRetries
        ) {
          attempt++;
          await sleep(attempt * 1200 + Math.floor(Math.random() * 500));
          continue;
        }

        return res;
      } catch (e) {
        clearTimeout(timeout);

        if (attempt < maxRetries) {
          attempt++;
          await sleep(attempt * 1200 + Math.floor(Math.random() * 500));
          continue;
        }

        throw e;
      }
    }
  }

  async function scrapeOne(inputUrl, config) {
    var url = normalizeUrl(inputUrl);

    await sleep(config.delayMs + Math.floor(Math.random() * 250));

    var res = await fetchWithRetry(url, config.maxRetries);
    var statusCode = res.status;

    var html = await res.text();
    var npis = extractNpisFromHtml(html);

    return {
      URL: url,
      StatusCode: statusCode,
      NPI: npis.join("|")
    };
  }

  function makeCsv() {
    var cols = ["URL", "StatusCode", "NPI"];

    var lines = [
      cols.join(",")
    ];

    for (var i = 0; i < results.length; i++) {
      lines.push([
        csvEscape(results[i].URL),
        csvEscape(results[i].StatusCode),
        csvEscape(results[i].NPI)
      ].join(","));
    }

    return lines.join("\n");
  }

  function exportCsv() {
    if (!results.length) {
      alert("No results to export.");
      return;
    }

    var csv = makeCsv();
    var blob = new Blob([csv], {
      type: "text/csv;charset=utf-8"
    });

    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "healthgrades_npi_status_results.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function copyCsv() {
    if (!results.length) {
      alert("No results to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(makeCsv());
      alert("CSV copied to clipboard.");
    } catch (e) {
      alert("Copy failed. Use Export CSV.");
    }
  }

  function updateProgress(done, total) {
    var percent = total ? Math.floor((done / total) * 100) : 0;

    document.getElementById("hgProgressBar").style.width = percent + "%";
    document.getElementById("hgProgressText").textContent = done + "/" + total;
    document.getElementById("hgResultCount").textContent = results.length;

    if (startTime && done > 0 && done < total) {
      var elapsed = Date.now() - startTime;
      var avg = elapsed / done;
      var remaining = total - done;
      document.getElementById("hgEta").textContent = formatEta(avg * remaining);
    } else if (done >= total && total > 0) {
      document.getElementById("hgEta").textContent = "Done";
    } else {
      document.getElementById("hgEta").textContent = "--";
    }
  }

  function log(msg) {
    var box = document.getElementById("hgLog");
    var time = new Date().toLocaleTimeString();
    box.textContent = "[" + time + "] " + msg + "\n" + box.textContent;
  }

  function renderTable() {
    var tbody = document.getElementById("hgTableBody");
    tbody.innerHTML = "";

    var latest = results.slice(-15);

    for (var i = 0; i < latest.length; i++) {
      var tr = document.createElement("tr");

      var td1 = document.createElement("td");
      td1.textContent = latest[i].URL;

      var td2 = document.createElement("td");
      td2.textContent = latest[i].StatusCode;

      var td3 = document.createElement("td");
      td3.textContent = latest[i].NPI;

      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tbody.appendChild(tr);
    }
  }

  var style = document.createElement("style");
  style.textContent = `
    #hgNpiPanel {
      position: fixed;
      top: 24px;
      right: 24px;
      width: 560px;
      max-width: calc(100vw - 48px);
      background: #f8fafc;
      color: #0f172a;
      border-radius: 22px;
      box-shadow: 0 30px 90px rgba(15,23,42,.35);
      z-index: 2147483647;
      font-family: Arial, Segoe UI, sans-serif;
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }

    #hgNpiPanel * {
      box-sizing: border-box;
    }

    #hgNpiHeader {
      background: linear-gradient(135deg,#0f172a,#1e293b);
      color: white;
      padding: 18px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
    }

    #hgNpiHeader h2 {
      margin: 0;
      font-size: 18px;
    }

    #hgNpiHeader p {
      margin: 4px 0 0;
      color: #cbd5e1;
      font-size: 12px;
    }

    #hgClose {
      border: 1px solid rgba(255,255,255,.2);
      background: rgba(255,255,255,.08);
      color: white;
      border-radius: 999px;
      width: 34px;
      height: 34px;
      font-size: 22px;
      cursor: pointer;
    }

    #hgNpiBody {
      padding: 16px;
    }

    .hgCard {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 18px;
      padding: 14px;
      margin-bottom: 12px;
      box-shadow: 0 8px 24px rgba(15,23,42,.06);
    }

    #hgUrls {
      width: 100%;
      height: 180px;
      resize: vertical;
      border: 1px solid #cbd5e1;
      border-radius: 14px;
      padding: 12px;
      font-family: Consolas, monospace;
      font-size: 12px;
      outline: none;
    }

    #hgUrls:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 4px rgba(37,99,235,.13);
    }

    .hgRow {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .hgBtn {
      border: none;
      border-radius: 13px;
      padding: 11px 15px;
      font-weight: 800;
      cursor: pointer;
      font-size: 13px;
    }

    .hgBtn:disabled {
      opacity: .5;
      cursor: not-allowed;
    }

    .hgPrimary {
      background: #2563eb;
      color: white;
    }

    .hgSuccess {
      background: #16a34a;
      color: white;
    }

    .hgSecondary {
      background: #e2e8f0;
      color: #0f172a;
    }

    .hgSmallInput {
      width: 80px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 8px;
    }

    #hgProgressOuter {
      margin-top: 12px;
      width: 100%;
      height: 14px;
      background: #e2e8f0;
      border-radius: 999px;
      overflow: hidden;
    }

    #hgProgressBar {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg,#2563eb,#22c55e);
      transition: width .25s ease;
    }

    #hgStats {
      display: grid;
      grid-template-columns: repeat(3,1fr);
      gap: 8px;
      margin-top: 12px;
    }

    .hgStat {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 10px;
      font-size: 12px;
    }

    .hgStat span {
      display: block;
      color: #64748b;
      margin-bottom: 4px;
    }

    .hgStat strong {
      font-size: 14px;
    }

    #hgLog {
      height: 72px;
      overflow: auto;
      background: #020617;
      color: #dbeafe;
      border-radius: 14px;
      padding: 10px;
      font-family: Consolas, monospace;
      font-size: 11px;
      white-space: pre-wrap;
    }

    #hgTableWrap {
      max-height: 180px;
      overflow: auto;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
    }

    #hgTable {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }

    #hgTable th,
    #hgTable td {
      padding: 8px;
      border-bottom: 1px solid #e2e8f0;
      text-align: left;
      vertical-align: top;
    }

    #hgTable th {
      background: #f1f5f9;
      position: sticky;
      top: 0;
    }
  `;

  document.head.appendChild(style);

  var panel = document.createElement("div");
  panel.id = "hgNpiPanel";
  panel.innerHTML = `
    <div id="hgNpiHeader">
      <div>
        <h2>Healthgrades NPI Scraper</h2>
        <p>Outputs only Status Code and NPI</p>
      </div>
      <button id="hgClose">×</button>
    </div>

    <div id="hgNpiBody">
      <div class="hgCard">
        <textarea id="hgUrls" placeholder="Paste Healthgrades URLs here, one per line..."></textarea>
      </div>

      <div class="hgCard">
        <div class="hgRow">
          <button id="hgStart" class="hgBtn hgPrimary">Start</button>
          <button id="hgExport" class="hgBtn hgSuccess" disabled>Export CSV</button>
          <button id="hgCopy" class="hgBtn hgSecondary" disabled>Copy CSV</button>
          <button id="hgClear" class="hgBtn hgSecondary">Clear</button>
        </div>

        <div class="hgRow" style="margin-top:12px;">
          <span style="font-size:12px;">Delay</span>
          <input id="hgDelay" class="hgSmallInput" type="number" value="900" min="100">
          <span style="font-size:12px;">Batch</span>
          <input id="hgBatch" class="hgSmallInput" type="number" value="6" min="1" max="10">
        </div>

        <div id="hgProgressOuter">
          <div id="hgProgressBar"></div>
        </div>

        <div id="hgStats">
          <div class="hgStat">
            <span>Progress</span>
            <strong id="hgProgressText">0/0</strong>
          </div>
          <div class="hgStat">
            <span>ETA</span>
            <strong id="hgEta">--</strong>
          </div>
          <div class="hgStat">
            <span>Results</span>
            <strong id="hgResultCount">0</strong>
          </div>
        </div>
      </div>

      <div class="hgCard">
        <div id="hgLog">Ready.</div>
      </div>

      <div class="hgCard">
        <div id="hgTableWrap">
          <table id="hgTable">
            <thead>
              <tr>
                <th>URL</th>
                <th>Status Code</th>
                <th>NPI</th>
              </tr>
            </thead>
            <tbody id="hgTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  document.getElementById("hgStart").onclick = async function () {
    if (running) {
      alert("Already running.");
      return;
    }

    var urlsText = document.getElementById("hgUrls").value;

    var urls = urlsText
      .split(/\n+/)
      .map(function (x) {
        return normalizeUrl(x);
      })
      .filter(Boolean);

    urls = Array.from(new Set(urls));

    if (!urls.length) {
      alert("Paste at least one URL.");
      return;
    }

    var delayMs = Math.max(100, Number(document.getElementById("hgDelay").value || 900));
    var batchSize = Math.min(10, Math.max(1, Number(document.getElementById("hgBatch").value || 6)));

    var config = {
      delayMs: delayMs,
      batchSize: batchSize,
      maxRetries: 3
    };

    results = [];
    running = true;
    startTime = Date.now();

    document.getElementById("hgStart").disabled = true;
    document.getElementById("hgExport").disabled = true;
    document.getElementById("hgCopy").disabled = true;

    updateProgress(0, urls.length);
    log("Starting...");

    var done = 0;

    for (var i = 0; i < urls.length; i += batchSize) {
      var batch = urls.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async function (url) {
          try {
            log("Working: " + url);
            var row = await scrapeOne(url, config);
            results.push(row);
            log("Done: HTTP " + row.StatusCode + " | NPI: " + row.NPI);
          } catch (e) {
            results.push({
              URL: normalizeUrl(url),
              StatusCode: "ERROR",
              NPI: ""
            });
            log("Error: " + url);
          }

          done++;
          updateProgress(done, urls.length);
          renderTable();
        })
      );

      await sleep(350);
    }

    running = false;

    document.getElementById("hgStart").disabled = false;
    document.getElementById("hgExport").disabled = false;
    document.getElementById("hgCopy").disabled = false;

    log("Finished.");
    console.table(results);
  };

  document.getElementById("hgExport").onclick = exportCsv;
  document.getElementById("hgCopy").onclick = copyCsv;

  document.getElementById("hgClear").onclick = function () {
    if (running) {
      alert("Cannot clear while running.");
      return;
    }

    results = [];
    document.getElementById("hgUrls").value = "";
    document.getElementById("hgTableBody").innerHTML = "";
    document.getElementById("hgLog").textContent = "Cleared.";
    updateProgress(0, 0);

    document.getElementById("hgExport").disabled = true;
    document.getElementById("hgCopy").disabled = true;
  };

  document.getElementById("hgClose").onclick = function () {
    if (running && !confirm("Scraper is running. Close anyway?")) {
      return;
    }

    panel.remove();
    style.remove();
    window.__HG_NPI_SCRAPER_LOADED__ = false;
  };

  log("UI loaded. Paste URLs and click Start.");
})();
