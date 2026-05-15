import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
  try {
    const raw = readFileSync(path.join(__dirname, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      if (!process.env[key]) {
        process.env[key] = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // Local env files are optional. Vercel injects environment variables itself.
  }
}

loadLocalEnv();

const publicDir = path.join(__dirname, "public");
const assetsDir = path.join(__dirname, "assets");
const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "entries.json");
const rateCacheFile = path.join(dataDir, "rates.json");
const profileFile = path.join(dataDir, "profile.json");
const port = Number(process.env.PORT || 3000);
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(supabaseUrl && supabaseKey);
const defaultClientId = "local";

const incomeCurrencies = new Set(["USD", "EUR"]);
const countryConfigs = {
  GE: {
    code: "GE",
    name: "Грузия",
    localCurrency: "GEL",
    taxRate: 0.01,
    provider: "nbg",
  },
  BY: {
    code: "BY",
    name: "Беларусь",
    localCurrency: "BYN",
    taxRate: 0.1,
    provider: "nbrb",
  },
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function ensureJsonFile(filePath, initialValue) {
  await mkdir(dataDir, { recursive: true });
  try {
    await stat(filePath);
  } catch {
    await writeFile(filePath, `${JSON.stringify(initialValue, null, 2)}\n`, "utf8");
  }
}

function normalizeClientId(value) {
  const clientId = String(value || "").trim();
  if (/^[a-zA-Z0-9_-]{12,100}$/.test(clientId)) return clientId;
  return defaultClientId;
}

function getClientId(req) {
  return useSupabase ? normalizeClientId(req.headers["x-eztax-client-id"]) : defaultClientId;
}

async function supabaseRequest(pathname, options = {}) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase is not configured.");
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      ...(supabaseKey.includes(".") ? { authorization: `Bearer ${supabaseKey}` } : {}),
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`Supabase request failed with HTTP ${response.status}: ${details}`);
    error.status = 502;
    throw error;
  }

  if (response.status === 204) return null;
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

function toDbProfile(profile, clientId) {
  return {
    client_id: clientId,
    name: profile.name,
    country: profile.country,
    income_currency: profile.incomeCurrency,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };
}

function fromDbProfile(profile) {
  return {
    name: profile.name,
    country: profile.country,
    incomeCurrency: profile.income_currency,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

function toDbEntry(entry, clientId) {
  return {
    id: entry.id,
    client_id: clientId,
    month: entry.month,
    received_date: entry.receivedDate,
    country: entry.country,
    income_currency: entry.incomeCurrency,
    local_currency: entry.localCurrency,
    income_amount: entry.incomeAmount,
    local_amount: entry.localAmount,
    tax_local: entry.taxLocal,
    tax_rate: entry.taxRate,
    usd_amount: entry.usdAmount,
    gel_amount: entry.gelAmount,
    tax_gel: entry.taxGel,
    rate: entry.rate,
    rate_date: entry.rateDate,
    source: entry.source,
    source_url: entry.sourceUrl,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function fromDbEntry(entry) {
  return {
    id: entry.id,
    month: entry.month,
    receivedDate: entry.received_date,
    country: entry.country,
    incomeCurrency: entry.income_currency,
    localCurrency: entry.local_currency,
    incomeAmount: entry.income_amount,
    localAmount: entry.local_amount,
    taxLocal: entry.tax_local,
    taxRate: entry.tax_rate,
    usdAmount: entry.usd_amount,
    gelAmount: entry.gel_amount,
    taxGel: entry.tax_gel,
    rate: entry.rate,
    rateDate: entry.rate_date,
    source: entry.source,
    sourceUrl: entry.source_url,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}

async function readEntries(clientId = defaultClientId) {
  if (useSupabase) {
    const rows = await supabaseRequest(
      `entries?client_id=eq.${encodeURIComponent(clientId)}&select=*&order=month.asc`,
    );
    return rows.map(fromDbEntry);
  }

  await ensureJsonFile(dataFile, []);
  const raw = await readFile(dataFile, "utf8");
  return JSON.parse(raw);
}

async function writeEntries(entries, clientId = defaultClientId) {
  const sorted = [...entries].sort((a, b) => a.month.localeCompare(b.month));

  if (useSupabase) {
    await supabaseRequest(`entries?client_id=eq.${encodeURIComponent(clientId)}`, {
      method: "DELETE",
    });

    if (sorted.length === 0) return [];

    const rows = await supabaseRequest("entries", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(sorted.map((entry) => toDbEntry(entry, clientId))),
    });
    return rows.map(fromDbEntry).sort((a, b) => a.month.localeCompare(b.month));
  }

  await ensureJsonFile(dataFile, []);
  await writeFile(dataFile, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  return sorted;
}

async function readRateCache() {
  if (useSupabase) {
    const rows = await supabaseRequest("rate_cache?select=cache_key,payload");
    return Object.fromEntries(rows.map((row) => [row.cache_key, row.payload]));
  }

  await ensureJsonFile(rateCacheFile, {});
  const raw = await readFile(rateCacheFile, "utf8");
  return JSON.parse(raw);
}

async function writeRateCache(cache) {
  if (useSupabase) {
    const rows = Object.entries(cache).map(([cacheKey, payload]) => ({
      cache_key: cacheKey,
      payload,
      cached_at: new Date().toISOString(),
    }));
    if (rows.length === 0) return;
    await supabaseRequest("rate_cache?on_conflict=cache_key", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows),
    });
    return;
  }

  await ensureJsonFile(rateCacheFile, {});
  await writeFile(rateCacheFile, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

async function readProfile(clientId = defaultClientId) {
  if (useSupabase) {
    const rows = await supabaseRequest(
      `profiles?client_id=eq.${encodeURIComponent(clientId)}&select=*&limit=1`,
    );
    return rows[0] ? normalizeProfile(fromDbProfile(rows[0])) : null;
  }

  await ensureJsonFile(profileFile, null);
  const raw = await readFile(profileFile, "utf8");
  const profile = JSON.parse(raw);
  return profile ? normalizeProfile(profile) : null;
}

async function writeProfile(profile, clientId = defaultClientId) {
  const saved = normalizeProfile(profile);

  if (useSupabase) {
    const rows = await supabaseRequest("profiles?on_conflict=client_id", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(toDbProfile(saved, clientId)),
    });
    return normalizeProfile(fromDbProfile(rows[0]));
  }

  await ensureJsonFile(profileFile, null);
  await writeFile(profileFile, `${JSON.stringify(saved, null, 2)}\n`, "utf8");
  return saved;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function isValidMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function todayLocalDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function toMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function toRate(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function validateAmount(value, fieldName) {
  const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return numeric;
}

function normalizeCountry(value) {
  const country = String(value || "").trim().toUpperCase();
  if (!countryConfigs[country]) {
    throw new Error("Country must be GE or BY.");
  }
  return country;
}

function normalizeIncomeCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  if (!incomeCurrencies.has(currency)) {
    throw new Error("Income currency must be USD or EUR.");
  }
  return currency;
}

function normalizeProfile(profile) {
  const name = String(profile?.name || "").trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  return {
    name,
    country: normalizeCountry(profile.country),
    incomeCurrency: normalizeIncomeCurrency(profile.incomeCurrency),
    createdAt: profile.createdAt || new Date().toISOString(),
    updatedAt: profile.updatedAt || new Date().toISOString(),
  };
}

function rateCacheKey(country, incomeCurrency, receivedDate) {
  return `${country}:${incomeCurrency}:${receivedDate}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

async function resolveHostViaDoh(hostname) {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", "A");

  const response = await fetch(url, { headers: { accept: "application/dns-json" } });
  if (!response.ok) {
    throw new Error(`DNS fallback responded with HTTP ${response.status}.`);
  }

  const payload = await response.json();
  const address = payload?.Answer?.find((answer) => answer.type === 1 && answer.data)?.data;
  if (!address) {
    throw new Error(`DNS fallback did not return an A record for ${hostname}.`);
  }
  return address;
}

function httpsGetJsonWithLookup(url, address) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: { accept: "application/json" },
        lookup: (hostname, options, callback) => {
          if (options?.all) {
            callback(null, [{ address, family: 4 }]);
            return;
          }
          callback(null, address, 4);
        },
        timeout: 10000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`NBG API responded with HTTP ${response.statusCode || "unknown"}.`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("NBG API returned invalid JSON."));
          }
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("NBG API request timed out."));
    });
    request.on("error", reject);
  });
}

async function fetchNbgJson(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`NBG API responded with HTTP ${response.status}.`);
    }
    return { payload: await response.json(), transport: "direct" };
  } catch (directError) {
    const address = await resolveHostViaDoh(url.hostname);
    try {
      const payload = await httpsGetJsonWithLookup(url, address);
      return { payload, transport: "dns-over-https" };
    } catch (fallbackError) {
      const directMessage = directError instanceof Error ? directError.message : "direct request failed";
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "DNS fallback failed";
      throw new Error(`${directMessage}; DNS fallback failed: ${fallbackMessage}`);
    }
  }
}

async function fetchNbgRate(incomeCurrency, receivedDate) {
  const url = new URL("https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/");
  url.searchParams.set("currencies", incomeCurrency);
  url.searchParams.set("date", receivedDate);

  let result;
  try {
    result = await fetchNbgJson(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown network error";
    const wrapped = new Error(`Could not reach NBG API: ${message}`);
    wrapped.status = 502;
    throw wrapped;
  }

  const payload = result.payload;
  const rateDate = payload?.[0]?.date?.slice(0, 10);
  const currency = payload?.[0]?.currencies?.find((item) => item.code === incomeCurrency);
  const rawRate = Number(currency?.rate);

  if (!Number.isFinite(rawRate) || rawRate <= 0) {
    const wrapped = new Error(`NBG API did not return ${incomeCurrency} rate for ${receivedDate}.`);
    wrapped.status = 502;
    throw wrapped;
  }

  return {
    rate: toRate(rawRate / Number(currency.quantity || 1)),
    rateDate: rateDate || receivedDate,
    sourceUrl: url.toString(),
    source: "nbg",
    transport: result.transport,
  };
}

async function fetchNbrbRate(incomeCurrency, receivedDate) {
  const url = new URL(`https://api.nbrb.by/exrates/rates/${incomeCurrency}`);
  url.searchParams.set("parammode", "2");
  url.searchParams.set("ondate", receivedDate);

  let payload;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`NBRB API responded with HTTP ${response.status}.`);
    }
    payload = await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown network error";
    const wrapped = new Error(`Could not reach NBRB API: ${message}`);
    wrapped.status = 502;
    throw wrapped;
  }

  const rawRate = Number(payload?.Cur_OfficialRate);
  const scale = Number(payload?.Cur_Scale || 1);
  const rateDate = payload?.Date?.slice(0, 10);

  if (!Number.isFinite(rawRate) || rawRate <= 0 || !Number.isFinite(scale) || scale <= 0) {
    const wrapped = new Error(`NBRB API did not return ${incomeCurrency} rate for ${receivedDate}.`);
    wrapped.status = 502;
    throw wrapped;
  }

  return {
    rate: toRate(rawRate / scale),
    rateDate: rateDate || receivedDate,
    sourceUrl: url.toString(),
    source: "nbrb",
    transport: "direct",
  };
}

async function getRate(country, incomeCurrency, receivedDate, options = {}) {
  const normalizedCountry = normalizeCountry(country);
  const normalizedCurrency = normalizeIncomeCurrency(incomeCurrency);
  const cache = await readRateCache();
  const cacheKey = rateCacheKey(normalizedCountry, normalizedCurrency, receivedDate);

  if (!options.refresh && cache[cacheKey]) {
    return cache[cacheKey];
  }

  if (
    !options.refresh &&
    normalizedCountry === "GE" &&
    normalizedCurrency === "USD" &&
    cache[receivedDate]
  ) {
    return cache[receivedDate];
  }

  const countryConfig = countryConfigs[normalizedCountry];
  const fetched =
    countryConfig.provider === "nbg"
      ? await fetchNbgRate(normalizedCurrency, receivedDate)
      : await fetchNbrbRate(normalizedCurrency, receivedDate);

  const rate = {
    ...fetched,
    country: normalizedCountry,
    incomeCurrency: normalizedCurrency,
    localCurrency: countryConfig.localCurrency,
    cachedAt: new Date().toISOString(),
  };
  cache[cacheKey] = rate;
  await writeRateCache(cache);
  return rate;
}

async function getUsdRate(receivedDate, options = {}) {
  return getRate("GE", "USD", receivedDate, options);
}

async function getProfileRate(clientId, receivedDate, options = {}) {
  const profile = await readProfile(clientId);
  if (!profile) {
    const error = new Error("Complete signup before requesting exchange rates.");
    error.status = 409;
    throw error;
  }
  return getRate(profile.country, profile.incomeCurrency, receivedDate, options);
}

function normalizeEntry(entry) {
  const legacyCountry = entry.localCurrency === "BYN" ? "BY" : "GE";
  const country = entry.country || legacyCountry;
  const config = countryConfigs[country] || countryConfigs.GE;
  const incomeCurrency = entry.incomeCurrency || "USD";
  const localCurrency = entry.localCurrency || config.localCurrency;
  const incomeAmount = entry.incomeAmount ?? entry.usdAmount;
  const localAmount = entry.localAmount ?? entry.gelAmount;
  const taxLocal = entry.taxLocal ?? entry.taxGel;

  return {
    id: entry.id,
    month: entry.month,
    receivedDate: entry.receivedDate,
    country,
    incomeCurrency,
    localCurrency,
    incomeAmount: incomeAmount == null ? null : toMoney(incomeAmount),
    localAmount: toMoney(localAmount),
    taxLocal: toMoney(taxLocal),
    taxRate: Number(entry.taxRate ?? config.taxRate),
    usdAmount: entry.usdAmount == null ? (incomeCurrency === "USD" && incomeAmount != null ? toMoney(incomeAmount) : null) : toMoney(entry.usdAmount),
    gelAmount: entry.gelAmount == null ? (localCurrency === "GEL" ? toMoney(localAmount) : null) : toMoney(entry.gelAmount),
    taxGel: entry.taxGel == null ? (localCurrency === "GEL" ? toMoney(taxLocal) : null) : toMoney(entry.taxGel),
    rate: entry.rate == null ? null : toRate(entry.rate),
    rateDate: entry.rateDate || entry.receivedDate,
    source: entry.source || "manual",
    sourceUrl: entry.sourceUrl,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

async function handleApi(req, res, pathname) {
  const clientId = getClientId(req);

  if (req.method === "GET" && pathname === "/api/profile") {
    const profile = await readProfile(clientId);
    sendJson(res, 200, { profile, countries: countryConfigs, incomeCurrencies: [...incomeCurrencies] });
    return;
  }

  if ((req.method === "POST" || req.method === "PATCH") && pathname === "/api/profile") {
    const current = await readProfile(clientId);
    const body = await readBody(req);
    try {
      const profile = await writeProfile({
        ...body,
        createdAt: current?.createdAt,
        updatedAt: new Date().toISOString(),
      }, clientId);
      sendJson(res, current ? 200 : 201, { profile, countries: countryConfigs, incomeCurrencies: [...incomeCurrencies] });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/entries") {
    const entries = await readEntries(clientId);
    sendJson(res, 200, { entries: entries.map(normalizeEntry) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/rates/latest") {
    const rate = await getProfileRate(clientId, todayLocalDate(), { refresh: true });
    sendJson(res, 200, { rate });
    return;
  }

  if (req.method === "GET" && pathname === "/api/rates") {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const date = url.searchParams.get("date");
    if (!isValidDate(date)) {
      sendJson(res, 400, { error: "Date must use YYYY-MM-DD format." });
      return;
    }

    const rate = await getProfileRate(clientId, date);
    sendJson(res, 200, { rate });
    return;
  }

  if (req.method === "GET" && pathname === "/api/rates/usd/latest") {
    const rate = await getUsdRate(todayLocalDate(), { refresh: true });
    sendJson(res, 200, { rate });
    return;
  }

  if (req.method === "GET" && pathname === "/api/rates/usd") {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const date = url.searchParams.get("date");
    if (!isValidDate(date)) {
      sendJson(res, 400, { error: "Date must use YYYY-MM-DD format." });
      return;
    }

    const rate = await getUsdRate(date);
    sendJson(res, 200, { rate });
    return;
  }

  if (req.method === "POST" && pathname === "/api/entries") {
    const profile = await readProfile(clientId);
    if (!profile) {
      sendJson(res, 409, { error: "Complete signup before adding entries." });
      return;
    }
    const body = await readBody(req);
    if (!isValidDate(body.receivedDate)) {
      sendJson(res, 400, { error: "Received date must use YYYY-MM-DD format." });
      return;
    }

    let incomeAmount;
    try {
      incomeAmount = validateAmount(body.incomeAmount ?? body.usdAmount, `${profile.incomeCurrency} amount`);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }

    const entries = await readEntries(clientId);
    const month = body.receivedDate.slice(0, 7);
    if (entries.map(normalizeEntry).some((entry) => entry.country === profile.country && entry.month === month)) {
      sendJson(res, 409, { error: `Entry for ${month} already exists.` });
      return;
    }

    const rate = await getRate(profile.country, profile.incomeCurrency, body.receivedDate);
    const localAmount = toMoney(incomeAmount * rate.rate);
    const taxLocal = toMoney(localAmount * countryConfigs[profile.country].taxRate);
    const entry = normalizeEntry({
      id: crypto.randomUUID(),
      month,
      receivedDate: body.receivedDate,
      country: profile.country,
      incomeCurrency: profile.incomeCurrency,
      localCurrency: countryConfigs[profile.country].localCurrency,
      incomeAmount,
      localAmount,
      taxLocal,
      taxRate: countryConfigs[profile.country].taxRate,
      rate: rate.rate,
      rateDate: rate.rateDate,
      source: rate.source,
      sourceUrl: rate.sourceUrl,
      createdAt: new Date().toISOString(),
    });

    const nextEntries = await writeEntries([...entries, entry], clientId);
    sendJson(res, 201, { entry, entries: nextEntries.map(normalizeEntry) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/entries/manual") {
    const profile = await readProfile(clientId);
    if (!profile) {
      sendJson(res, 409, { error: "Complete signup before adding entries." });
      return;
    }
    const body = await readBody(req);
    if (!isValidMonth(body.month)) {
      sendJson(res, 400, { error: "Month must use YYYY-MM format." });
      return;
    }
    if (!isValidDate(body.receivedDate)) {
      sendJson(res, 400, { error: "Received date must use YYYY-MM-DD format." });
      return;
    }

    let localAmount;
    try {
      localAmount = validateAmount(body.localAmount ?? body.gelAmount, `${countryConfigs[profile.country].localCurrency} amount`);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }

    const entries = await readEntries(clientId);
    if (entries.map(normalizeEntry).some((entry) => entry.country === profile.country && entry.month === body.month)) {
      sendJson(res, 409, { error: `Entry for ${body.month} already exists.` });
      return;
    }

    const taxLocal = toMoney(localAmount * countryConfigs[profile.country].taxRate);
    const entry = normalizeEntry({
      id: crypto.randomUUID(),
      month: body.month,
      receivedDate: body.receivedDate,
      country: profile.country,
      incomeCurrency: profile.incomeCurrency,
      localCurrency: countryConfigs[profile.country].localCurrency,
      incomeAmount: body.incomeAmount || body.usdAmount ? Number(body.incomeAmount ?? body.usdAmount) : null,
      localAmount,
      taxLocal,
      taxRate: countryConfigs[profile.country].taxRate,
      rate: body.rate ? Number(body.rate) : null,
      rateDate: body.receivedDate,
      source: "manual",
      createdAt: new Date().toISOString(),
    });

    const nextEntries = await writeEntries([...entries, entry], clientId);
    sendJson(res, 201, { entry, entries: nextEntries.map(normalizeEntry) });
    return;
  }

  const updateMatch = pathname.match(/^\/api\/entries\/([^/]+)$/);
  if (req.method === "PATCH" && updateMatch) {
    const profile = await readProfile(clientId);
    if (!profile) {
      sendJson(res, 409, { error: "Complete signup before editing entries." });
      return;
    }
    const id = decodeURIComponent(updateMatch[1]);
    const body = await readBody(req);
    if (!isValidDate(body.receivedDate)) {
      sendJson(res, 400, { error: "Received date must use YYYY-MM-DD format." });
      return;
    }

    const entries = await readEntries(clientId);
    const current = entries.find((entry) => entry.id === id);
    if (!current) {
      sendJson(res, 404, { error: "Entry not found." });
      return;
    }

    const month = body.receivedDate.slice(0, 7);
    if (entries.map(normalizeEntry).some((entry) => entry.id !== id && entry.country === profile.country && entry.month === month)) {
      sendJson(res, 409, { error: `Entry for ${month} already exists.` });
      return;
    }

    let incomeAmount;
    try {
      incomeAmount = validateAmount(body.incomeAmount ?? body.usdAmount, `${profile.incomeCurrency} amount`);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }

    const rate = await getRate(profile.country, profile.incomeCurrency, body.receivedDate);
    const localAmount = toMoney(incomeAmount * rate.rate);
    const taxLocal = toMoney(localAmount * countryConfigs[profile.country].taxRate);
    const updated = normalizeEntry({
      ...current,
      month,
      receivedDate: body.receivedDate,
      country: profile.country,
      incomeCurrency: profile.incomeCurrency,
      localCurrency: countryConfigs[profile.country].localCurrency,
      incomeAmount,
      localAmount,
      taxLocal,
      taxRate: countryConfigs[profile.country].taxRate,
      rate: rate.rate,
      rateDate: rate.rateDate,
      source: rate.source,
      sourceUrl: rate.sourceUrl,
      updatedAt: new Date().toISOString(),
    });

    const saved = await writeEntries(entries.map((entry) => (entry.id === id ? updated : entry)), clientId);
    sendJson(res, 200, { entry: updated, entries: saved.map(normalizeEntry) });
    return;
  }

  const deleteMatch = pathname.match(/^\/api\/entries\/([^/]+)$/);
  if (req.method === "DELETE" && deleteMatch) {
    const id = decodeURIComponent(deleteMatch[1]);
    const entries = await readEntries(clientId);
    const nextEntries = entries.filter((entry) => entry.id !== id);
    if (nextEntries.length === entries.length) {
      sendJson(res, 404, { error: "Entry not found." });
      return;
    }
    const saved = await writeEntries(nextEntries, clientId);
    sendJson(res, 200, { entries: saved.map(normalizeEntry) });
    return;
  }

  sendJson(res, 404, { error: "API route not found." });
}

async function serveStatic(req, res, pathname) {
  const isAsset = pathname.startsWith("/assets/");
  const baseDir = isAsset ? assetsDir : publicDir;
  const requestedPath = pathname === "/" ? "/index.html" : isAsset ? pathname.replace(/^\/assets/, "") : pathname;
  const resolvedPath = path.normalize(path.join(baseDir, requestedPath));
  if (!resolvedPath.startsWith(baseDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(resolvedPath);
    const ext = path.extname(resolvedPath);
    res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(res, status, {
      error: error instanceof Error ? error.message : "Unexpected server error.",
    });
  }
}

const server = http.createServer(handleRequest);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(port, () => {
    console.log(`Eztax is running at http://localhost:${port}`);
  });
}

export default handleRequest;
