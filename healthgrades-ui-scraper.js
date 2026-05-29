(async () => {
  if (window.__HG_UI_SCRAPER_LOADED__) {
    alert("Healthgrades scraper UI is already open.");
    return;
  }

  window.__HG_UI_SCRAPER_LOADED__ = true;

  const DEFAULTS = {
    delayMs: 900,
    batchSize: 6,
    maxRetries: 3,
    fileName: "healthgrades_results.csv"
  };

  let results = [];
  let isRunning = false;
  let startTime = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  function normalizeUrl(u) {
    if (!u) return "";
    let url = String(u).trim();
    url = url.replace(/[?&]place-id=(?=&|$)/i, "");
    url = url.replace(/[?&]$/g, "");
    url = url.replace(/\?place-id=$/i, "");
    url = url.replace(/^http:\/\//i, "https://");
    return url;
  }

  function stripNoise(s) {
    if (!s) return "";
    let t = String(s);

    t = t.replace(/(\d+(\.\d+)?)\s*Star Rating.*$/i, "");
    t = t.replace(/\(\s*\d+\s*reviews?\s*\).*$/i, "");
    t = t.replace(/\b\d+\s*reviews?\b.*$/i, "");
    t = t.replace(/\bReviewSave\b.*$/i, "");
    t = t.replace(/\bSave\b.*$/i, "");
    t = t.replace(/\bWatch\b.*$/i, "");
    t = t.replace(/\s*\*\s*$/g, "");
    t = t.replace(/reviews?\)\s*ReviewSave.*$/i, "");

    return clean(t);
  }

  function sanitize(s) {
    if (!s) return "";
    const t = String(s);

    if (t.length > 250 && t.includes("{") && t.includes("}")) {
      return "";
    }

    return clean(t);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "--";

    const secondsTotal = Math.round(ms / 1000);
    const minutes = Math.floor(secondsTotal / 60);
    const seconds = secondsTotal % 60;

    if (minutes <= 0) return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
  }

  function makeCsv(rows) {
    const cols = ["URL", "Name", "Specialty", "Address1", "City", "State", "NPI"];

    return [
      cols.join(","),
      ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(","))
    ].join("\n");
  }

  // -----------------------
  // UI
  // -----------------------
  const style = document.createElement("style");
  style.textContent = `
    #hgScraperPanel {
      position: fixed;
      top: 24px;
      right: 24px;
      width: 480px;
      max-width: calc(100vw - 48px);
      background: #ffffff;
      color: #111827;
      border: 1px solid #d1d5db;
      border-radius: 16px;
      box-shadow: 0 20px 70px rgba(0,0,0,0.3);
      z-index: 2147483647;
      font-family: Arial, sans-serif;
      overflow: hidden;
    }

    #hgScraperPanel * {
      box-sizing: border-box;
    }

    #hgScraperHeader {
      padding: 14px 16px;
      background: #111827;
      color: white;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
    }

    #hgScraperHeader h2 {
      margin: 0;
      font-size: 16px;
      line-height: 1.2;
    }

    #hgCloseBtn {
      background: transparent;
      border: 0;
      color: white;
      font-size: 24px;
      cursor: pointer;
      line-height: 1;
    }

    #hgScraperBody {
      padding: 14px;
    }

    #hgScraperBody label {
      display: block;
      font-size: 12px;
      font-weight: 700;
      color: #374151;
      margin-bottom: 6px;
    }

    #hgUrlsInput {
      width: 100%;
      height: 175px;
      resize: vertical;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      padding: 10px;
      font-size: 12px;
      line-height: 1.4;
      outline: none;
      font-family: Consolas, monospace;
    }

    #hgUrlsInput:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37,99,235,0.15);
    }

    .hgRow {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 10px;
      flex-wrap: wrap;
    }

    .hgBtn {
      border: 0;
      border-radius: 10px;
      padding: 10px 13px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }

    .hgBtn:disabled {
      opacity: 0.55;
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
      background: #e5e7eb;
      color: #111827;
    }

    .hgDanger {
      background: #dc2626;
      color: white;
    }

    .hgSmallInput {
      width: 78px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 8px;
      font-size: 12px;
    }

    #hgProgressOuter {
      width: 100%;
      height: 15px;
      border-radius: 999px;
      overflow: hidden;
      background: #e5e7eb;
      margin-top: 12px;
    }

    #hgProgressInner {
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #2563eb, #22c55e);
      transition: width 0.25s ease;
    }

    #hgStats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px 10px;
      margin-top: 9px;
      font-size: 12px;
      color: #374151;
    }

    #hgLog {
      height: 78px;
      overflow: auto;
      margin-top: 10px;
      padding: 8px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #f9fafb;
      color: #374151;
      white-space: pre-wrap;
      font-size: 11px;
      font-family: Consolas, monospace;
    }

    #hgPreview {
      margin-top: 10px;
      max-height: 160px;
      overflow: auto;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      font-size: 11px;
    }

    #hgPreview table {
      width: 100%;
      border-collapse: collapse;
    }

    #hgPreview th,
    #hgPreview td {
      padding: 6px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
    }

    #hgPreview th {
      position: sticky;
      top: 0;
      background: #f3f4f6;
      z-index: 1;
    }
  `;

  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = "hgScraperPanel";
  panel.innerHTML = `
    <div id="hgScraperHeader">
      <h2>Healthgrades Scraper</h2>
      <button id="hgCloseBtn" title="Close">×</button>
    </div>

    <div id="hgScraperBody">
      <label for="hgUrlsInput">Input URLs, one per line</label>
      <textarea id="hgUrlsInput" placeholder="Paste Healthgrades URLs here, one per line..."></textarea>

      <div class="hgRow">
        <button id="hgStartBtn" class="hgBtn hgPrimary">Start</button>
        <button id="hgExportBtn" class="hgBtn hgSuccess" disabled>Export CSV</button>
        <button id="hgCopyBtn" class="hgBtn hgSecondary" disabled>Copy CSV</button>
        <button id="hgClearBtn" class="hgBtn hgSecondary">Clear</button>
      </div>

      <div class="hgRow">
        <label style="margin:0;">Delay ms</label>
        <input id="hgDelayInput" class="hgSmallInput" type="number" min="100" value="${DEFAULTS.delayMs}">

        <label style="margin:0;">Batch</label>
        <input id="hgBatchInput" class="hgSmallInput" type="number" min="1" max="10" value="${DEFAULTS.batchSize}">
      </div>

      <div id="hgProgressOuter">
        <div id="hgProgressInner"></div>
      </div>

      <div id="hgStats">
        <div><b>Progress:</b> <span id="hgProgressText">0/0</span></div>
        <div><b>ETA:</b> <span id="hgEtaText">--</span></div>
        <div><b>Done:</b> <span id="hgDoneText">0</span></div>
        <div><b>Results:</b> <span id="hgResultsText">0</span></div>
      </div>

      <div id="hgLog">Ready.</div>
      <div id="hgPreview"></div>
    </div>
  `;

  document.body.appendChild(panel);

  const $ = (id) => document.getElementById(id);

  const urlsInput = $("hgUrlsInput");
  const startBtn = $("hgStartBtn");
  const exportBtn = $("hgExportBtn");
  const copyBtn = $("hgCopyBtn");
  const clearBtn = $("hgClearBtn");
  const closeBtn = $("hgCloseBtn");
  const delayInput = $("hgDelayInput");
  const batchInput = $("hgBatchInput");
  const progressInner = $("hgProgressInner");
  const progressText = $("hgProgressText");
  const etaText = $("hgEtaText");
  const doneText = $("hgDoneText");
  const resultsText = $("hgResultsText");
  const logBox = $("hgLog");
  const previewBox = $("hgPreview");

  function log(message) {
    const time = new Date().toLocaleTimeString();
    logBox.textContent = `[${time}] ${message}\n` + logBox.textContent;
  }

  function updateProgress(done, total, currentUrl = "", note = "") {
    const pct = total ? Math.floor((done / total) * 100) : 0;

    progressInner.style.width = `${pct}%`;
    progressText.textContent = `${done}/${total}`;
    doneText.textContent = String(done);
    resultsText.textContent = String(results.length);

    if (startTime && done > 0 && total > done) {
      const elapsed = Date.now() - startTime;
      const avg = elapsed / done;
      etaText.textContent = formatDuration(avg * (total - done));
    } else if (total && done >= total) {
      etaText.textContent = "Done";
    } else {
      etaText.textContent = "--";
    }

    if (note || currentUrl) {
      log(`${note || "Working"}${currentUrl ? " — " + currentUrl : ""}`);
    }
  }

  function renderPreview() {
    const rows = results.slice(-8);

    if (!rows.length) {
      previewBox.innerHTML = "";
      return;
    }

    previewBox.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Specialty</th>
            <th>City</th>
            <th>State</th>
            <th>NPI</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${escapeHtml(r.Name)}</td>
              <td>${escapeHtml(r.Specialty)}</td>
              <td>${escapeHtml(r.City)}</td>
              <td>${escapeHtml(r.State)}</td>
              <td>${escapeHtml(r.NPI)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  // Drag panel
  (() => {
    const header = $("hgScraperHeader");
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startTop = 0;

    header.addEventListener("mousedown", (e) => {
      if (e.target === closeBtn) return;

      const rect = panel.getBoundingClientRect();

      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startRight = window.innerWidth - rect.right;
      startTop = rect.top;

      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      panel.style.right = `${Math.max(0, startRight - dx)}px`;
      panel.style.top = `${Math.max(0, startTop + dy)}px`;
    });

    document.addEventListener("mouseup", () => {
      dragging = false;
      document.body.style.userSelect = "";
    });
  })();

  // -----------------------
  // Object parsing helpers
  // -----------------------
  function walkObject(obj, fn, seen = new Set()) {
    if (!obj || typeof obj !== "object") return;
    if (seen.has(obj)) return;

    seen.add(obj);
    fn(obj);

    for (const k of Object.keys(obj)) {
      try {
        walkObject(obj[k], fn, seen);
      } catch {}
    }
  }

  function findFirst(obj, keyNames = []) {
    let found = null;

    walkObject(obj, (n) => {
      if (found) return;

      for (const k of keyNames) {
        if (k in n && n[k]) {
          found = n[k];
          return;
        }
      }
    });

    return found;
  }

  function tryParseJsonCandidates(html) {
    const candidates = new Set();
    let m;

    const reAssign = /(?:window|window\.)?__INITIAL_STATE__\s*=\s*({[\s\S]*?});/g;
    while ((m = reAssign.exec(html)) !== null) candidates.add(m[1]);

    const reJsonBlob = /({\s*"[^"]{1,40}"[\s\S]{10,12000}?})/g;
    while ((m = reJsonBlob.exec(html)) !== null) candidates.add(m[1]);

    const reEscaped = /"(\\{\\s*\\\\"?[^"]{1,40}[\s\S]{5,8000}?\\}+)"/g;
    while ((m = reEscaped.exec(html)) !== null) {
      let s = m[1];

      try {
        s = s
          .replace(/\\"/g, '"')
          .replace(/\\n/g, "")
          .replace(/\\t/g, "")
          .replace(/\\\//g, "/");

        candidates.add(s);
      } catch {}
    }

    candidates.add(html);

    const parsedObjects = [];

    for (const c of candidates) {
      try {
        parsedObjects.push(JSON.parse(c));
        continue;
      } catch {}

      try {
        const un = c.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16))
        );

        parsedObjects.push(JSON.parse(un));
      } catch {}
    }

    return parsedObjects;
  }

  function extractNpisFromHtml(html) {
    const hits = new Set();
    let m;

    const reEscaped = /npi\\":\\"(\d{10})\\"/g;
    while ((m = reEscaped.exec(html)) !== null) hits.add(m[1]);

    const reJson = /"npi"\s*:\s*"(\d{10})"/gi;
    while ((m = reJson.exec(html)) !== null) hits.add(m[1]);

    const reNpiNumber = /"npiNumber"\s*:\s*"(\d{10})"/gi;
    while ((m = reNpiNumber.exec(html)) !== null) hits.add(m[1]);

    const reLoose = /npi[^0-9]{0,50}(\d{10})/gi;
    while ((m = reLoose.exec(html)) !== null) hits.add(m[1]);

    return [...hits];
  }

  function extractFromParsedObjects(parsedObjects) {
    const out = {
      name: "",
      specialty: "",
      address1: "",
      city: "",
      state: "",
      npi: ""
    };

    const getAddr = (o) => {
      if (!o || typeof o !== "object") return {};

      return {
        streetAddress: o.streetAddress || o.addressLine1 || o.address || o.address1 || "",
        city: o.addressLocality || o.city || "",
        state: o.addressRegion || o.state || ""
      };
    };

    for (const obj of parsedObjects) {
      if (!out.name) {
        const n = findFirst(obj, [
          "fullName",
          "providerDisplayFullName",
          "name",
          "displayName",
          "providerName",
          "providerFullName"
        ]);

        if (typeof n === "string" && n.trim()) {
          out.name = n;
        }
      }

      if (!out.specialty) {
        const s = findFirst(obj, [
          "primarySpecialty",
          "practicingSpecialty",
          "practicingSpecialityName",
          "specialty",
          "specialties"
        ]);

        if (s) {
          if (typeof s === "object" && s.name) {
            out.specialty = s.name;
          } else if (Array.isArray(s) && s.length) {
            const first = s[0];
            out.specialty = typeof first === "string" ? first : first.name || "";
          } else if (typeof s === "string") {
            out.specialty = s;
          }
        }
      }

      if (!out.address1 || !out.city || !out.state) {
        const addrObj = findFirst(obj, [
          "address",
          "location",
          "address1",
          "streetAddress",
          "addressLine1",
          "practiceAddress",
          "facilityAddress"
        ]);

        const a = getAddr(addrObj);

        if (a.streetAddress && !out.address1) out.address1 = a.streetAddress;
        if (a.city && !out.city) out.city = a.city;
        if (a.state && !out.state) out.state = a.state;
      }

      if (!out.npi) {
        const n = findFirst(obj, ["npi", "npiNumber", "identifier", "identifiers"]);

        if (n) {
          if (typeof n === "string" && /\d{10}/.test(n)) {
            out.npi = (n.match(/\d{10}/) || [""])[0];
          } else if (Array.isArray(n)) {
            for (const it of n) {
              const cand = typeof it === "string"
                ? it
                : String(it?.value || it?.identifier || "");

              if (/\d{10}/.test(cand)) {
                out.npi = cand.match(/\d{10}/)[0];
                break;
              }
            }
          } else if (typeof n === "object") {
            if (n.value && /\d{10}/.test(String(n.value))) {
              out.npi = String(n.value).match(/\d{10}/)[0];
            }

            if (!out.npi && n.identifier && /\d{10}/.test(String(n.identifier))) {
              out.npi = String(n.identifier).match(/\d{10}/)[0];
            }
          }
        }
      }

      if (
        out.name &&
        out.specialty &&
        out.address1 &&
        out.city &&
        out.state &&
        out.npi
      ) {
        break;
      }
    }

    return out;
  }

  function extractFromDom(doc) {
    const out = {
      name: "",
      specialty: "",
      address1: "",
      city: "",
      state: ""
    };

    const nameSelectors = [
      "h1",
      "[data-test='provider-name']",
      ".provider-name",
      ".providerHeader__name",
      ".physician-name"
    ];

    for (const sel of nameSelectors) {
      const el = doc.querySelector(sel);
      const t = el?.textContent?.trim();

      if (t) {
        out.name = clean(t);
        break;
      }
    }

    const specialtySelectors = [
      "[data-test*='specialty']",
      "[class*='specialty']"
    ];

    for (const sel of specialtySelectors) {
      const el = doc.querySelector(sel);
      const t = el?.textContent?.trim();

      if (t && t.length < 120) {
        out.specialty = clean(t);
        break;
      }
    }

    const addressSelectors = [
      "[data-test='address']",
      ".address",
      ".provider-address",
      "[class*='address']"
    ];

    for (const sel of addressSelectors) {
      const el = doc.querySelector(sel);
      const t = el?.textContent;

      if (!t) continue;

      const normalized = t.replace(/\u00A0/g, " ");

      let m = normalized.match(/([0-9][^\n·•]{5,120}?)\s*[·•]\s*([^,\n]+),\s*([A-Z]{2})\s*\d{5}/);

      if (m) {
        out.address1 = clean(m[1]);
        out.city = clean(m[2]);
        out.state = clean(m[3]);
        break;
      }

      const lines = normalized
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);

      for (const line of lines) {
        const mm = line.match(/([^,]+),\s*([A-Z]{2})\s*\d{5}?/);

        if (mm) {
          out.city = out.city || clean(mm[1]);
          out.state = out.state || clean(mm[2]);
        }
      }

      const addrLine = lines.find((l) => /^[0-9]/.test(l));
      if (addrLine) out.address1 = out.address1 || clean(addrLine);

      if (out.address1 || out.city || out.state) break;
    }

    if (!out.address1 || !out.city || !out.state) {
      const bodyText = (doc.body?.innerText || "").replace(/\u00A0/g, " ");
      const m2 = bodyText.match(/([0-9][^\n·•]{5,120}?)\s*[·•]\s*([^,\n]+),\s*([A-Z]{2})\s*\d{5}/);

      if (m2) {
        out.address1 = out.address1 || clean(m2[1]);
        out.city = out.city || clean(m2[2]);
        out.state = out.state || clean(m2[3]);
      }
    }

    return out;
  }

  async function fetchWithRetry(url, config, attempt = 0) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const res = await fetch(url, {
        credentials: "include",
        signal: controller.signal,
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        }
      });

      if (!res.ok) {
        const retryable = [429, 500, 502, 503, 504].includes(res.status);

        if (retryable && attempt < config.maxRetries) {
          const backoff = (attempt + 1) * 1200 + Math.floor(Math.random() * 500);
          await sleep(backoff);
          return fetchWithRetry(url, config, attempt + 1);
        }
      }

      return res;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function scrapeOne(inputUrl, config) {
    const url = normalizeUrl(inputUrl);

    await sleep(config.delayMs + Math.floor(Math.random() * 250));

    const res = await fetchWithRetry(url, config);
    const statusNote = `HTTP ${res.status}${res.ok ? "" : " not ok"}`;

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    const npisFromHtml = extractNpisFromHtml(html);
    const parsedObjects = tryParseJsonCandidates(html);
    const parsed = extractFromParsedObjects(parsedObjects);
    const dom = extractFromDom(doc);

    const inlineName =
      (html.match(/"fullName"\s*:\s*"([^"]+)"/) ||
        html.match(/"providerDisplayFullName"\s*:\s*"([^"]+)"/) ||
        [])[1] || "";

    const inlineSpecialty =
      (html.match(/"primarySpecialty"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/) ||
        html.match(/"practicingSpecialityName"\s*:\s*"([^"]+)"/) ||
        [])[1] || "";

    let name = sanitize(parsed.name || inlineName || dom.name || "");

    if (!name) {
      const h1 = doc.querySelector("h1");
      if (h1?.textContent) name = sanitize(h1.textContent);
    }

    let specialty = sanitize(parsed.specialty || inlineSpecialty || dom.specialty || "");
    let address1 = sanitize(parsed.address1 || dom.address1 || "");
    let city = sanitize(parsed.city || dom.city || "");
    let state = sanitize(parsed.state || dom.state || "");
    let npi = sanitize(parsed.npi || npisFromHtml[0] || "");

    specialty = stripNoise(specialty);
    address1 = stripNoise(address1);

    if (address1 && (!city || !state)) {
      const m = address1.match(/^(.*?)([A-Za-z .'-]+),\s*([A-Z]{2})(\s*\d{5})?$/);

      if (m) {
        address1 = clean(m[1]);
        city = city || clean(m[2]);
        state = state || clean(m[3]);
      }
    }

    return {
      URL: url,
      Name: name,
      Specialty: specialty,
      Address1: address1,
      City: city,
      State: state,
      NPI: npi,
      _http: statusNote,
      _raw_npis_found: npisFromHtml.join("|")
    };
  }

  async function runInBatches(urls, config) {
    results = [];
    let done = 0;

    for (let i = 0; i < urls.length; i += config.batchSize) {
      const batch = urls.slice(i, i + config.batchSize);

      const batchResults = await Promise.all(
        batch.map(async (url) => {
          updateProgress(done, urls.length, normalizeUrl(url), "Working");

          try {
            const row = await scrapeOne(url, config);
            done++;

            results.push(row);
            updateProgress(done, urls.length, row.URL, row._http || "Done");
            renderPreview();

            return row;
          } catch (e) {
            done++;

            const failRow = {
              URL: normalizeUrl(url),
              Name: "",
              Specialty: "",
              Address1: "",
              City: "",
              State: "",
              NPI: "",
              _error: String(e)
            };

            results.push(failRow);
            updateProgress(done, urls.length, normalizeUrl(url), "Error");
            renderPreview();

            return failRow;
          }
        })
      );

      await sleep(350);
    }

    return results;
  }

  function exportCsv() {
    if (!results.length) {
      alert("No results to export.");
      return;
    }

    const csv = makeCsv(results);
    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8"
    });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = DEFAULTS.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    log(`CSV exported: ${DEFAULTS.fileName}`);
  }

  async function copyCsv() {
    if (!results.length) {
      alert("No results to copy.");
      return;
    }

    const csv = makeCsv(results);

    try {
      await navigator.clipboard.writeText(csv);
      log("CSV copied to clipboard.");
      alert("CSV copied to clipboard.");
    } catch (e) {
      console.error(e);
      alert("Could not copy CSV. Use Export CSV instead.");
    }
  }

  startBtn.addEventListener("click", async () => {
    if (isRunning) {
      alert("Scraper is already running.");
      return;
    }

    const urls = [
      ...new Set(
        urlsInput.value
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map(normalizeUrl)
      )
    ];

    if (!urls.length) {
      alert("Paste at least one Healthgrades URL.");
      return;
    }

    const delayMs = Math.max(100, Number(delayInput.value || DEFAULTS.delayMs));
    const batchSize = Math.min(10, Math.max(1, Number(batchInput.value || DEFAULTS.batchSize)));

    const config = {
      ...DEFAULTS,
      delayMs,
      batchSize
    };

    results = [];
    isRunning = true;
    startTime = Date.now();

    startBtn.disabled = true;
    exportBtn.disabled = true;
    copyBtn.disabled = true;
    urlsInput.disabled = true;
    delayInput.disabled = true;
    batchInput.disabled = true;

    progressInner.style.width = "0%";
    progressText.textContent = `0/${urls.length}`;
    doneText.textContent = "0";
    resultsText.textContent = "0";
    etaText.textContent = "--";
    logBox.textContent = "Starting...\n";
    previewBox.innerHTML = "";

    try {
      updateProgress(0, urls.length, "", "Starting");
      await runInBatches(urls, config);

      log("Finished.");
      exportBtn.disabled = false;
      copyBtn.disabled = false;

      console.log("Healthgrades scraper results:");
      console.table(
        results.map((r) => {
