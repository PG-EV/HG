(async () => {
  // Prevent loading multiple times
  if (window.__HG_SCRAPER_UI_LOADED__) {
    alert("Healthgrades scraper UI is already open.");
    return;
  }
  window.__HG_SCRAPER_UI_LOADED__ = true;

  // -----------------------
  // Config
  // -----------------------
  const defaultConfig = {
    delayMs: 900,
    batchSize: 6,
    maxRetries: 3,
    fileName: "healthgrades_results.csv"
  };

  let results = [];
  let isRunning = false;
  let startedAt = null;

  // -----------------------
  // Utilities
  // -----------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

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

  const sanitize = (s) => {
    if (!s) return "";
    const t = String(s);
    if (t.length > 250 && t.includes("{") && t.includes("}")) return "";
    return clean(t);
  };

  function normalizeUrl(u) {
    if (!u) return "";
    let url = u.trim();

    url = url.replace(/[?&]place-id=(?=&|$)/i, "");
    url = url.replace(/[?&]$/g, "");
    url = url.replace(/\?place-id=$/i, "");
    url = url.replace(/^http:\/\//i, "https://");

    return url;
  }

  function formatDuration(ms) {
    if (!ms || ms < 0 || !Number.isFinite(ms)) return "--";
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
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

  // -----------------------
  // Create UI
  // -----------------------
  const style = document.createElement("style");
  style.textContent = `
    #hgScraperPanel {
      position: fixed;
      top: 24px;
      right: 24px;
      width: 460px;
      max-width: calc(100vw - 48px);
      z-index: 2147483647;
      background: #ffffff;
      color: #111827;
      border: 1px solid #d1d5db;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
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
      align-items: center;
      justify-content: space-between;
      cursor: move;
    }

    #hgScraperHeader h2 {
      margin: 0;
      font-size: 16px;
      line-height: 1.2;
    }

    #hgScraperClose {
      border: none;
      background: transparent;
      color: white;
      font-size: 22px;
      cursor: pointer;
      line-height: 1;
    }

    #hgScraperBody {
      padding: 14px;
    }

    #hgScraperBody label {
      display: block;
      font-size: 12px;
      font-weight: bold;
      margin-bottom: 6px;
      color: #374151;
    }

    #hgUrls {
      width: 100%;
      height: 180px;
      resize: vertical;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      padding: 10px;
      font-size: 12px;
      line-height: 1.4;
      outline: none;
    }

    #hgUrls:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37,99,235,0.15);
    }

    .hgRow {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      align-items: center;
    }

    .hgBtn {
      border: none;
      border-radius: 10px;
      padding: 10px 12px;
      font-weight: bold;
      cursor: pointer;
      font-size: 13px;
    }

    .hgBtnPrimary {
      background: #2563eb;
      color: white;
    }

    .hgBtnSuccess {
      background: #16a34a;
      color: white;
    }

    .hgBtnSecondary {
      background: #e5e7eb;
      color: #111827;
    }

    .hgBtnDanger {
      background: #dc2626;
      color: white;
    }

    .hgBtn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .hgSmallInput {
      width: 72px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 8px;
      font-size: 12px;
    }

    #hgProgressWrap {
      margin-top: 12px;
      background: #e5e7eb;
      height: 14px;
      border-radius: 999px;
      overflow: hidden;
    }

    #hgProgressBar {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #2563eb, #22c55e);
      transition: width 0.25s ease;
    }

    #hgStats {
      margin-top: 8px;
      font-size: 12px;
      color: #374151;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 8px;
    }

    #hgStatus {
      margin-top: 10px;
      padding: 8px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      height: 72px;
      overflow: auto;
      font-size: 11px;
      color: #374151;
      white-space: pre-wrap;
    }

    #hgPreview {
      margin-top: 10px;
      max-height: 150px;
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
      background: #f3f4f6;
      position: sticky;
      top: 0;
    }
  `;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = "hgScraperPanel";
  panel.innerHTML = `
    <div id="hgScraperHeader">
      <h2>Healthgrades Scraper</h2>
      <button id="hgScraperClose" title="Close">×</button>
    </div>

    <div id="hgScraperBody">
      <label for="hgUrls">Input URLs, one per line</label>
      <textarea id="hgUrls" placeholder="Paste Healthgrades URLs here, one per line..."></textarea>

      <div class="hgRow">
        <button id="hgStartBtn" class="hgBtn hgBtnPrimary">Start</button>
        <button id="hgExportBtn" class="hgBtn hgBtnSuccess" disabled>Export CSV</button>
        <button id="hgClearBtn" class="hgBtn hgBtnSecondary">Clear</button>
      </div>

      <div class="hgRow">
        <label style="margin:0;">Delay ms</label>
        <input id="hgDelayMs" class="hgSmallInput" type="number" value="${defaultConfig.delayMs}" min="100">

        <label style="margin:0;">Batch</label>
        <input id="hgBatchSize" class="hgSmallInput" type="number" value="${defaultConfig.batchSize}" min="1" max="10">
      </div>

      <div id="hgProgressWrap">
        <div id="hgProgressBar"></div>
      </div>

      <div id="hgStats">
        <div><b>Progress:</b> <span id="hgProgressText">0/0</span></div>
        <div><b>ETA:</b> <span id="hgEtaText">--</span></div>
        <div><b>Completed:</b> <span id="hgDoneText">0</span></div>
        <div><b>Results:</b> <span id="hgResultCount">0</span></div>
      </div>

      <div id="hgStatus">Ready.</div>

      <div id="hgPreview"></div>
    </div>
  `;

  document.body.appendChild(panel);

  const $ = (id) => document.getElementById(id);

  const urlsBox = $("hgUrls");
  const startBtn = $("hgStartBtn");
  const exportBtn = $("hgExportBtn");
  const clearBtn = $("hgClearBtn");
  const closeBtn = $("hgScraperClose");
  const delayInput = $("hgDelayMs");
  const batchInput = $("hgBatchSize");
  const progressBar = $("hgProgressBar");
  const progressText = $("hgProgressText");
  const etaText = $("hgEtaText");
  const doneText = $("hgDoneText");
  const resultCount = $("hgResultCount");
  const statusBox = $("hgStatus");
  const previewBox = $("hgPreview");

  function logStatus(message) {
    const time = new Date().toLocaleTimeString();
    statusBox.textContent = `[${time}] ${message}\n` + statusBox.textContent;
  }

  function updateProgress(done, total, currentUrl = "", note = "") {
    const pct = total ? Math.floor((done / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `${done}/${total}`;
    doneText.textContent = String(done);
    resultCount.textContent = String(results.length);

    if (startedAt && done > 0 && total > done) {
      const elapsed = Date.now() - startedAt;
      const avgPerItem = elapsed / done;
      const remaining = total - done;
      etaText.textContent = formatDuration(avgPerItem * remaining);
    } else if (total && done >= total) {
      etaText.textContent = "Done";
    } else {
      etaText.textContent = "--";
    }

    if (currentUrl || note) {
      logStatus(`${note || "Working"} ${currentUrl ? "— " + currentUrl : ""}`);
    }
  }

  function renderPreview() {
    const lastRows = results.slice(-8);

    if (!lastRows.length) {
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
          ${lastRows.map(r => `
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

  // -----------------------
  // Draggable panel
  // -----------------------
  (() => {
    const header = $("hgScraperHeader");
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startTop = 0;

    header.addEventListener("mousedown", (e) => {
      if (e.target === closeBtn) return;

      const rect = panel.getBoundingClientRect();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startRight = window.innerWidth - rect.right;
      startTop = rect.top;

      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      panel.style.right = `${Math.max(0, startRight - dx)}px`;
      panel.style.top = `${Math.max(0, startTop + dy)}px`;
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
      document.body.style.userSelect = "";
    });
  })();

  // -----------------------
  // Deep walk and find
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

  // -----------------------
  // Parse JSON-like strings
  // -----------------------
  function tryParseJsonCandidates(html) {
    const candidates = new Set();

    const reAssign = /(?:window|window\.)?__INITIAL_STATE__\s*=\s*({[\s\S]*?});/g;
    let m;

    while ((m = reAssign.exec(html)) !== null) {
      candidates.add(m[1]);
    }

    const reJsonBlob = /({\s*"[^"]{1,40}"[\s\S]{10,12000}?})/g;
    while ((m = reJsonBlob.exec(html)) !== null) {
      candidates.add(m[1]);
    }

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

  // -----------------------
  // Extractors
  // -----------------------
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

        if (typeof n === "string" && n.trim()) out.name = n;
      }

      if (!out.specialty) {
        let s = findFirst(obj, [
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
          } else if (typeof n === "object") {
            if (n.value && /\d{10}/.test(String(n.value))) {
              out.npi = String(n.value).match(/\d{10}/)[0];
            }

            if (!out.npi && n.identifier && /\d{10}/.test(String(n.identifier))) {
              out.npi = String(n.identifier).match(/\d{10}/)[0];
            }
          } else if (Array.isArray(n)) {
            for (const it of n) {
              const cand = typeof it === "string" ? it : String(it?.value || it?.identifier || "");

              if (/\d{10}/.test(cand)) {
                out.npi = cand.match(/\d{10}/)[0];
                break;
              }
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

      if (lines.length) {
        for (const line of lines) {
          const mm = line.match(/([^,]+),\s*([A-Z]{2})\s*\d{5}?/);

          if (mm) {
            out.city = out.city || clean(mm[1]);
            out.state = out.state || clean(mm[2]);
          }
        }

        const addrLine = lines.find((l) => /^[0-9]/.test(l));
        if (addrLine) out.address1 = out.address1 || clean(addrLine);
      }

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

  // -----------------------
  // Fetch with retries
  // -----------------------
  async function fetchWithRetry(url, attempt = 0) {
    const maxRetries = defaultConfig.maxRetries;
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

        if (retryable && attempt < maxRetries) {
          const backoff = (attempt + 1) * 1200 + Math.floor(Math.random() * 500);
          await sleep(backoff);
          return fetchWithRetry(url, attempt + 1);
        }
      }

      return res;
    } finally {
      clearTimeout(timeout);
    }
  }

  // -----------------------
  // Scrape one URL
  // -----------------------
  async function scrapeOne(inputUrl, config) {
    const url = normalizeUrl(inputUrl);

    await sleep(config.delayMs + Math.floor(Math.random() * 250));

    const res = await fetchWithRetry(url);
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

  // -----------------------
  // Batch runner
  // -----------------------
  async function runInBatches(urls, config) {
    results = [];
    let done = 0;

    for (let i = 0; i < urls.length; i += config.batchSize) {
      const batch = urls.slice(i, i + config.batchSize);

      const batchResults = await Promise.all(
        batch.map(async (url) => {
          updateProgress(done, urls.length, normalizeUrl(url), "Working");

          try {
            const r = await scrapeOne(url, config);
            done++;

            results.push(r);
            updateProgress(done, urls.length, r.URL, r._http || "Done");
            renderPreview();

            return r;
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

  // -----------------------
  // Export CSV
  // -----------------------
  function exportCsv() {
    if (!results.length) {
      alert("No results to export yet.");
      return;
    }

    const cols = ["URL", "Name", "Specialty", "Address1", "City", "State", "NPI"];

    const csv = [
      cols.join(","),
      ...results.map((r) => cols.map((c) => csvEscape(r[c])).join(","))
    ].join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8"
    });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = defaultConfig.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    logStatus(`CSV exported: ${defaultConfig.fileName}`);
  }

  // -----------------------
  // Event handlers
  // -----------------------
  startBtn.addEventListener("click", async () => {
    if (isRunning) {
      alert("Scraper is already running.");
      return;
    }

    const urls = [
      ...new Set(
        urlsBox.value
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map(normalizeUrl)
      )
    ];

    if (!urls.length) {
      alert("Please paste at least one Healthgrades URL.");
      return;
    }

    const delayMs = Math.max(100, Number(delayInput.value || defaultConfig.delayMs));
    const batchSize = Math.min(10, Math.max(1, Number(batchInput.value || defaultConfig.batchSize)));

    const config = {
      ...defaultConfig,
      delayMs,
      batchSize
    };

    results = [];
    isRunning = true;
    startedAt = Date.now();

    startBtn.disabled = true;
    exportBtn.disabled = true;
    urlsBox.disabled = true;
    delayInput.disabled = true;
    batchInput.disabled = true;

    progressBar.style.width = "0%";
    etaText.textContent = "--";
    statusBox.textContent = "Starting...\n";
    previewBox.innerHTML = "";

    try {
      updateProgress(0, urls.length, "", "Starting");
      await runInBatches(urls, config);

      logStatus("Finished.");
      exportBtn.disabled = false;
    } catch (e) {
      console.error(e);
      logStatus(`Fatal error: ${String(e)}`);
      alert("Scraper stopped because of an error. Check the status box or console.");
    } finally {
      isRunning = false;
      startBtn.disabled = false;
      urlsBox.disabled = false;
      delayInput.disabled = false;
      batchInput.disabled = false;

      if (results.length) exportBtn.disabled = false;
    }
  });

  exportBtn.addEventListener("click", exportCsv);

  clearBtn.addEventListener("click", () => {
    if (isRunning) {
      alert("Cannot clear while scraper is running.");
      return;
    }

    urlsBox.value = "";
    results = [];
    progressBar.style.width = "0%";
    progressText.textContent = "0/0";
    doneText.textContent = "0";
    resultCount.textContent = "0";
    etaText.textContent = "--";
    statusBox.textContent = "Cleared.\n";
    previewBox.innerHTML = "";
    exportBtn.disabled = true;
  });

  closeBtn.addEventListener("click", () => {
    if (isRunning) {
      const ok = confirm("Scraper is running. Close panel anyway?");
      if (!ok) return;
    }

    panel.remove();
    style.remove();
    window.__HG_SCRAPER_UI_LOADED__ = false;
  });

  logStatus("UI loaded. Paste URLs and click Start.");
})();
