const monthNames = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const rowBatchSize = 14;
const clientIdStorageKey = "eztax.clientId";
const backupStoragePrefix = "eztax.backup.v1.";
const authSessionStorageKey = "eztax.auth.session.v1";
const fallbackClientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const state = {
  profile: null,
  countries: {
    GE: { code: "GE", name: "Грузия", localCurrency: "GEL", taxRate: 0.01 },
    BY: { code: "BY", name: "Беларусь", localCurrency: "BYN", taxRate: 0.1 },
  },
  incomeCurrencies: ["USD", "EUR"],
  entries: [],
  currentRate: null,
  editingEntry: null,
  pendingDelete: null,
  chartMetric: null,
  filters: {
    year: "all",
    month: "all",
  },
  visibleRows: rowBatchSize,
  chartFilters: {
    year: "all",
    month: "all",
  },
  authSession: null,
};

const els = {
  appNav: document.querySelector("#appNav"),
  brandCountry: document.querySelector("#brandCountry"),
  toastStack: document.querySelector("#toastStack"),
  homeView: document.querySelector("#homeView"),
  chartView: document.querySelector("#chartView"),
  entriesBody: document.querySelector("#entriesBody"),
  emptyState: document.querySelector("#emptyState"),
  totalUsd: document.querySelector("#totalUsd"),
  totalGel: document.querySelector("#totalGel"),
  totalTax: document.querySelector("#totalTax"),
  currentRateNote: document.querySelector("#currentRateNote"),
  incomeMetricLabel: document.querySelector("#incomeMetricLabel"),
  localMetricIcon: document.querySelector("#localMetricIcon"),
  localMetricLabel: document.querySelector("#localMetricLabel"),
  taxMetricLabel: document.querySelector("#taxMetricLabel"),
  incomeTableHead: document.querySelector("#incomeTableHead"),
  localTableHead: document.querySelector("#localTableHead"),
  usdSparkline: document.querySelector("#usdSparkline"),
  gelSparkline: document.querySelector("#gelSparkline"),
  taxSparkline: document.querySelector("#taxSparkline"),
  yearFilter: document.querySelector("#yearFilter"),
  monthFilter: document.querySelector("#monthFilter"),
  loadMore: document.querySelector("#loadMore"),
  loadMoreStatus: document.querySelector("#loadMoreStatus"),
  loadMoreButton: document.querySelector("#loadMoreButton"),
  backToHome: document.querySelector("#backToHome"),
  chartTitle: document.querySelector("#chartTitle"),
  chartSummary: document.querySelector("#chartSummary"),
  chartYearFilter: document.querySelector("#chartYearFilter"),
  chartMonthFilter: document.querySelector("#chartMonthFilter"),
  resetChartFilters: document.querySelector("#resetChartFilters"),
  detailChart: document.querySelector("#detailChart"),
  dialog: document.querySelector("#entryDialog"),
  deleteDialog: document.querySelector("#deleteDialog"),
  form: document.querySelector("#entryForm"),
  deleteForm: document.querySelector("#deleteForm"),
  entryDialogTitle: document.querySelector("#entryDialogTitle"),
  amountLabel: document.querySelector("#amountLabel"),
  localPreviewLabel: document.querySelector("#localPreviewLabel"),
  openAddDialog: document.querySelector("#openAddDialog"),
  emptyAddDialog: document.querySelector("#emptyAddDialog"),
  closeDialog: document.querySelector("#closeDialog"),
  cancelDialog: document.querySelector("#cancelDialog"),
  closeDeleteDialog: document.querySelector("#closeDeleteDialog"),
  cancelDelete: document.querySelector("#cancelDelete"),
  exportButton: document.querySelector("#exportButton"),
  profileButton: document.querySelector("#profileButton"),
  signInButton: document.querySelector("#signInButton"),
  signOutButton: document.querySelector("#signOutButton"),
  avatarInitial: document.querySelector("#avatarInitial"),
  profileDialog: document.querySelector("#profileDialog"),
  profileForm: document.querySelector("#profileForm"),
  profileDialogTitle: document.querySelector("#profileDialogTitle"),
  profileNameInput: document.querySelector("#profileNameInput"),
  profileCountryInput: document.querySelector("#profileCountryInput"),
  profileCurrencyInput: document.querySelector("#profileCurrencyInput"),
  profileFormError: document.querySelector("#profileFormError"),
  closeProfileDialog: document.querySelector("#closeProfileDialog"),
  cancelProfileDialog: document.querySelector("#cancelProfileDialog"),
  saveProfile: document.querySelector("#saveProfile"),
  dateInput: document.querySelector("#dateInput"),
  usdInput: document.querySelector("#usdInput"),
  gelPreviewInput: document.querySelector("#gelPreviewInput"),
  refreshGel: document.querySelector("#refreshGel"),
  importDropzone: document.querySelector("#importDropzone"),
  historyImportInput: document.querySelector("#historyImportInput"),
  historyImportStatus: document.querySelector("#historyImportStatus"),
  formError: document.querySelector("#formError"),
  submitEntry: document.querySelector("#submitEntry"),
  deleteMessage: document.querySelector("#deleteMessage"),
  confirmDelete: document.querySelector("#confirmDelete"),
};

let loadMoreObserver = null;

function floatingControl(label) {
  return label.querySelector("input:not([type='hidden']), select");
}

function syncFloatingField(label) {
  const control = floatingControl(label);
  if (!control) return;
  label.classList.add("floating-field");
  label.classList.toggle("is-filled", Boolean(control.value));
}

function syncFloatingFields() {
  document.querySelectorAll("label").forEach(syncFloatingField);
}

function initFloatingFields() {
  document.querySelectorAll("label").forEach((label) => {
    const control = floatingControl(label);
    if (!control) return;
    syncFloatingField(label);
    control.addEventListener("input", () => syncFloatingField(label));
    control.addEventListener("change", () => syncFloatingField(label));
    control.addEventListener("blur", () => syncFloatingField(label));
    control.addEventListener("focus", () => syncFloatingField(label));
  });
}

const formatters = {
  currency: {},
  decimal: new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  compact: new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }),
  monthShort: new Intl.DateTimeFormat("ru-RU", { month: "short" }),
  month: new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }),
  date: new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }),
};

const currencySymbols = {
  USD: "$",
  EUR: "€",
  GEL: "₾",
  BYN: "Br",
};

const metricConfigs = {
  usd: {
    title: () => `Всего в ${profileIncomeCurrency()}`,
    shortTitle: () => profileIncomeCurrency(),
    color: "#13885d",
    softColor: "rgba(19, 136, 93, 0.14)",
    value: (entry) => estimatedIncome(entry),
    format: (value) => money(value, profileIncomeCurrency()),
    sparkline: null,
  },
  gel: {
    title: () => `Всего в ${profileLocalCurrency()}`,
    shortTitle: () => profileLocalCurrency(),
    color: "#0b5f42",
    softColor: "rgba(11, 95, 66, 0.14)",
    value: (entry) => entry.localAmount,
    format: (value) => money(value, profileLocalCurrency()),
    sparkline: null,
  },
  tax: {
    title: "Всего налогов",
    shortTitle: () => `Налог ${taxPercent()}%`,
    color: "#9eb224",
    softColor: "rgba(201, 220, 81, 0.22)",
    value: (entry) => entry.taxLocal,
    format: (value) => money(value, profileLocalCurrency()),
    sparkline: null,
  },
};

function getClientId() {
  try {
    const existing = localStorage.getItem(clientIdStorageKey);
    if (existing) return existing;
    const generated =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(clientIdStorageKey, generated);
    return generated;
  } catch {
    return fallbackClientId;
  }
}

function backupStorageKey() {
  return `${backupStoragePrefix}${getClientId()}`;
}

function readAuthSession() {
  try {
    const session = JSON.parse(localStorage.getItem(authSessionStorageKey) || "null");
    return session?.access_token && session?.refresh_token ? session : null;
  } catch {
    return null;
  }
}

function saveAuthSession(session) {
  state.authSession = session;
  if (session) localStorage.setItem(authSessionStorageKey, JSON.stringify(session));
  else localStorage.removeItem(authSessionStorageKey);
}

function captureAuthSessionFromUrl() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return false;
  saveAuthSession({ access_token: accessToken, refresh_token: refreshToken });
  window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
  return true;
}

async function exchangeOAuthCodeFromUrl() {
  const code = new URLSearchParams(window.location.search).get("code");
  if (!code || state.authSession) return false;
  const response = await fetch(`/api/auth/exchange?code=${encodeURIComponent(code)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not complete Google sign-in.");
  saveAuthSession(payload.session);
  window.history.replaceState({}, document.title, window.location.pathname);
  return true;
}

function readBrowserBackup() {
  try {
    const backup = JSON.parse(localStorage.getItem(backupStorageKey()) || "null");
    if (!backup?.profile || !Array.isArray(backup.entries)) return null;
    return backup;
  } catch {
    return null;
  }
}

function saveBrowserBackup() {
  if (!state.profile || !Array.isArray(state.entries)) return;
  try {
    localStorage.setItem(
      backupStorageKey(),
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        profile: state.profile,
        entries: state.entries,
      }),
    );
  } catch (error) {
    // The online copy remains authoritative; a full storage quota must not
    // interrupt tax entry creation.
    console.warn("Could not save the local backup", error);
  }
}

function money(value, currency) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const normalized = String(currency || "").toUpperCase();
  if (normalized === "GEL") return `₾ ${formatters.decimal.format(Number(value))}`;
  if (!formatters.currency[normalized]) {
    formatters.currency[normalized] = new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: normalized,
      currencyDisplay: "narrowSymbol",
    });
  }
  return formatters.currency[normalized].format(Number(value));
}

function profileCountryConfig() {
  const country = state.profile?.country || "GE";
  return state.countries[country] || state.countries.GE;
}

function profileIncomeCurrency() {
  return state.profile?.incomeCurrency || "USD";
}

function profileLocalCurrency() {
  return profileCountryConfig().localCurrency;
}

function taxPercent() {
  return Math.round(Number(profileCountryConfig().taxRate || 0) * 100);
}

function showToast(message, tone = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.innerHTML = `
    <span class="toast-dot" aria-hidden="true"></span>
    <span>${message}</span>
  `;
  els.toastStack.append(toast);

  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 5000);
}

function metricTitle(metric) {
  const value = metricConfigs[metric].title;
  return typeof value === "function" ? value() : value;
}

function formatMonth(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  return formatters.month.format(new Date(Date.UTC(year, monthIndex - 1, 1)));
}

function formatShortMonth(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  return formatters.monthShort.format(new Date(Date.UTC(year, monthIndex - 1, 1))).replace(".", "");
}

function formatDate(date) {
  return formatters.date.format(new Date(`${date}T00:00:00.000Z`));
}

function sourceLabel(entry) {
  if (entry.source === "nbg") return `НБГ, ${formatDate(entry.rateDate)}`;
  if (entry.source === "nbrb") return `НБРБ, ${formatDate(entry.rateDate)}`;
  if (entry.source === "legacy-xlsx") return "импорт";
  if (entry.source === "import") return "импорт";
  return "вручную";
}

function nextMonth(entries) {
  const scopedEntries = entries.filter((entry) => !state.profile || entry.country === state.profile.country);
  if (scopedEntries.length === 0) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  const last = [...scopedEntries].sort((a, b) => a.month.localeCompare(b.month)).at(-1).month;
  const [year, month] = last.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function estimatedIncome(entry) {
  if (entry.incomeAmount != null) return Number(entry.incomeAmount);
  if (!entry.rate || entry.localCurrency !== profileLocalCurrency() || entry.incomeCurrency !== profileIncomeCurrency()) {
    return null;
  }
  return Number(entry.localAmount) / Number(entry.rate);
}

function activeEntries() {
  const country = state.profile?.country || "GE";
  const incomeCurrency = profileIncomeCurrency();
  return state.entries.filter(
    (entry) => (entry.country || "GE") === country && (entry.incomeCurrency || "USD") === incomeCurrency,
  );
}

function entriesForFilters(filters, order = "auto") {
  const sortDirection = order === "auto" ? (filters.year === "all" ? "desc" : "asc") : order;
  return activeEntries()
    .filter((entry) => filters.year === "all" || entry.month.startsWith(`${filters.year}-`))
    .filter((entry) => filters.month === "all" || entry.month.endsWith(`-${filters.month}`))
    .sort((a, b) => {
      const monthOrder =
        sortDirection === "desc" ? b.month.localeCompare(a.month) : a.month.localeCompare(b.month);
      if (monthOrder !== 0) return monthOrder;
      return sortDirection === "desc"
        ? b.receivedDate.localeCompare(a.receivedDate)
        : a.receivedDate.localeCompare(b.receivedDate);
    });
}

function filteredEntries() {
  return entriesForFilters(state.filters);
}

function chartEntries() {
  return entriesForFilters(state.chartFilters, "asc");
}

function resetVisibleRows() {
  state.visibleRows = rowBatchSize;
}

function showMoreRows() {
  const entries = filteredEntries();
  state.visibleRows = Math.min(state.visibleRows + rowBatchSize, entries.length);
  render();
}

function populateFilterControls(yearEl, monthEl, filters) {
  const years = [...new Set(activeEntries().map((entry) => entry.month.slice(0, 4)))].sort();
  const currentYear = filters.year;
  const currentMonth = filters.month;

  yearEl.replaceChildren(
    new Option("Все годы", "all"),
    ...years.map((year) => new Option(year, year)),
  );
  monthEl.replaceChildren(
    new Option("Все месяцы", "all"),
    ...monthNames.map((name, index) => new Option(name, String(index + 1).padStart(2, "0"))),
  );

  yearEl.value = years.includes(currentYear) ? currentYear : "all";
  monthEl.value = currentMonth === "all" || monthNames[Number(currentMonth) - 1] ? currentMonth : "all";
  filters.year = yearEl.value;
  filters.month = monthEl.value;
}

function populateFilters() {
  populateFilterControls(els.yearFilter, els.monthFilter, state.filters);
  populateFilterControls(els.chartYearFilter, els.chartMonthFilter, state.chartFilters);
}

function rowTemplate(entry) {
  const income = estimatedIncome(entry);
  const incomeNote = entry.incomeAmount == null && entry.rate ? "по курсу на дату" : "";
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>
      <strong>${formatMonth(entry.month)}</strong>
      <span class="cell-note">${formatDate(entry.receivedDate)}</span>
    </td>
    <td>
      <strong>${money(income, entry.incomeCurrency || profileIncomeCurrency())}</strong>
      ${incomeNote ? `<span class="cell-note">${incomeNote}</span>` : ""}
    </td>
    <td><strong>${money(entry.localAmount, entry.localCurrency || profileLocalCurrency())}</strong></td>
    <td><strong>${money(entry.taxLocal, entry.localCurrency || profileLocalCurrency())}</strong></td>
    <td class="meta-column">
      <strong>${entry.rate ? entry.rate.toFixed(4) : "—"}</strong>
      <span class="cell-note">${sourceLabel(entry)}</span>
    </td>
    <td class="row-actions">
      <span class="row-action-group">
        <button class="edit-button" type="button" title="Редактировать" aria-label="Редактировать запись">✎</button>
        <button class="delete-button" type="button" title="Удалить" aria-label="Удалить запись">×</button>
      </span>
    </td>
  `;
  tr.querySelector(".edit-button").addEventListener("click", () => openEditDialog(entry));
  tr.querySelector(".delete-button").addEventListener("click", () => openDeleteDialog(entry));
  return tr;
}

function valuesForMetric(entries, metric) {
  const config = metricConfigs[metric];
  return entries.map((entry) => ({
    entry,
    value: Number(config.value(entry) || 0),
  }));
}

function smoothedValues(values, targetCount) {
  if (values.length <= targetCount) {
    return values.map((item) => item.value);
  }

  const bucketSize = values.length / targetCount;
  const bucketed = Array.from({ length: targetCount }, (_, index) => {
    const start = Math.floor(index * bucketSize);
    const end = Math.max(start + 1, Math.floor((index + 1) * bucketSize));
    const slice = values.slice(start, end);
    return slice.reduce((sum, item) => sum + item.value, 0) / slice.length;
  });

  return bucketed.map((value, index, source) => {
    const previous = source[index - 1] ?? value;
    const next = source[index + 1] ?? value;
    return previous * 0.22 + value * 0.56 + next * 0.22;
  });
}

function movingAverageValues(values, radius = 2) {
  return values.map((item, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length, index + radius + 1);
    const slice = values.slice(start, end);
    return slice.reduce((sum, current) => sum + current.value, 0) / slice.length;
  });
}

function sparklineSvg(entries, metric) {
  const config = metricConfigs[metric];
  const values = valuesForMetric(entries, metric);
  const displayValues = smoothedValues(values, 6);
  const width = 132;
  const height = 74;
  const padding = 10;
  const max = Math.max(...displayValues, 0);
  const min = Math.min(...displayValues, 0);
  const range = Math.max(max - min, max, 1);

  if (values.length === 0) {
    return `<span class="sparkline-empty">Нет данных</span>`;
  }

  if (displayValues.length === 1) {
    const y = height / 2;
    return `
      <svg class="sparkline-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${metricTitle(metric)}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spark-${metric}-single" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="${config.color}" stop-opacity="0.18"></stop>
            <stop offset="100%" stop-color="${config.color}" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <path d="M ${padding} ${y} C ${width * 0.34} ${y - 14}, ${width * 0.66} ${y + 14}, ${width - padding} ${y}" fill="none" stroke="${config.color}" stroke-width="3.2" stroke-linecap="round"></path>
        <path d="M ${padding} ${y} C ${width * 0.34} ${y - 14}, ${width * 0.66} ${y + 14}, ${width - padding} ${y} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z" fill="url(#spark-${metric}-single)"></path>
      </svg>
      <span class="sparkline-more">Подробнее</span>
    `;
  }

  const step = (width - padding * 2) / (displayValues.length - 1);
  const points = displayValues
    .map((value, index) => {
      const x = padding + index * step;
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const pointList = points.split(" ").map((point) => point.split(",").map(Number));
  const path = pointList
    .map(([x, y], index) => {
      if (index === 0) return `M ${x.toFixed(2)} ${y.toFixed(2)}`;
      const [prevX, prevY] = pointList[index - 1];
      const cp1X = prevX + (x - prevX) * 0.42;
      const cp2X = prevX + (x - prevX) * 0.58;
      return `C ${cp1X.toFixed(2)} ${prevY.toFixed(2)}, ${cp2X.toFixed(2)} ${y.toFixed(2)}, ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const first = pointList[0];
  const last = pointList[pointList.length - 1];
  const areaPath = `${path} L ${last[0].toFixed(2)} ${height - padding} L ${first[0].toFixed(2)} ${height - padding} Z`;
  const gradientId = `spark-${metric}`;

  return `
    <svg class="sparkline-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${metricTitle(metric)}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${config.color}" stop-opacity="0.2"></stop>
          <stop offset="100%" stop-color="${config.color}" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#${gradientId})"></path>
      <path d="${path}" fill="none" stroke="${config.color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
    <span class="sparkline-more">Подробнее</span>
  `;
}

function renderSparklines(entries) {
  els.usdSparkline.innerHTML = sparklineSvg(entries, "usd");
  els.gelSparkline.innerHTML = sparklineSvg(entries, "gel");
  els.taxSparkline.innerHTML = sparklineSvg(entries, "tax");
}

function chartSvg(entries, metric) {
  const config = metricConfigs[metric];
  const values = valuesForMetric(entries, metric);
  const isMobileChart = window.matchMedia("(max-width: 640px)").matches;
  const displayValues = movingAverageValues(values, values.length > 18 ? 2 : 1);
  const width = isMobileChart ? Math.max(560, Math.min(1120, values.length * 18 + 120)) : 820;
  const height = isMobileChart ? 250 : 360;
  const singleYear = state.chartFilters.year !== "all";
  const pad = isMobileChart
    ? { top: 20, right: 24, bottom: singleYear ? 36 : 46, left: 74 }
    : { top: 28, right: 34, bottom: singleYear ? 48 : 68, left: 90 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const max = Math.max(...displayValues, 0);
  const scaleMax = Math.max(max * 1.12, 1);
  const axisCurrency = metric === "usd" ? profileIncomeCurrency() : profileLocalCurrency();
  const axisSymbol = currencySymbols[axisCurrency] || axisCurrency;

  if (values.length === 0) {
    return `<div class="chart-empty"><strong>Нет данных</strong><span>Выбери другой период.</span></div>`;
  }

  const step = values.length > 1 ? innerWidth / (values.length - 1) : innerWidth;
  const points = values
    .map((item, index) => {
      const x = values.length > 1 ? pad.left + index * step : pad.left + innerWidth / 2;
      const y = pad.top + innerHeight - (displayValues[index] / scaleMax) * innerHeight;
      return { x, y, item };
    });
  const linePath = points
    .map((point, index) => {
      if (index === 0) return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
      const previous = points[index - 1];
      const cp1X = previous.x + (point.x - previous.x) * 0.42;
      const cp2X = previous.x + (point.x - previous.x) * 0.58;
      return `C ${cp1X.toFixed(2)} ${previous.y.toFixed(2)}, ${cp2X.toFixed(2)} ${point.y.toFixed(2)}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    })
    .join(" ");
  const first = points[0];
  const last = points.at(-1);
  const areaPath = `${linePath} L ${last.x.toFixed(2)} ${pad.top + innerHeight} L ${first.x.toFixed(2)} ${pad.top + innerHeight} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = singleYear
    ? (isMobileChart ? Math.max(1, Math.ceil(values.length / 6)) : 1)
    : Math.max(1, Math.ceil(values.length / (isMobileChart ? 5 : 8)));
  const gradientId = `detail-${metric}`;
  const hitWidth = values.length > 1 ? Math.max(18, step * 0.92) : innerWidth;
  const tooltipWidth = isMobileChart ? 132 : 156;
  const tooltipHeight = isMobileChart ? 54 : 58;
  const strokeWidth = isMobileChart ? 3.4 : 4.5;
  const markerRadius = isMobileChart ? 4.5 : 5.5;

  const axisLabel = (value) => `${axisSymbol} ${formatters.compact.format(value)}`;
  const xLabel = (entry) => {
    const [year] = entry.month.split("-");
    if (singleYear) {
      return `<text x="{x}" y="${height - (isMobileChart ? 14 : 20)}" class="chart-x-label" text-anchor="middle">${formatShortMonth(entry.month)}</text>`;
    }
    return `
      <text x="{x}" y="${height - (isMobileChart ? 28 : 36)}" class="chart-x-label" text-anchor="middle">${formatShortMonth(entry.month)}</text>
      <text x="{x}" y="${height - (isMobileChart ? 12 : 18)}" class="chart-x-year" text-anchor="middle">${year}</text>
    `;
  };

  return `
    <svg class="detail-chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${metricTitle(metric)}">
      <defs>
        <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${config.color}" stop-opacity="0.22"></stop>
          <stop offset="100%" stop-color="${config.color}" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      ${ticks
        .map((tick) => {
          const y = pad.top + innerHeight - tick * innerHeight;
          const value = scaleMax * tick;
          return `
            <line x1="${pad.left}" y1="${y.toFixed(2)}" x2="${pad.left + innerWidth}" y2="${y.toFixed(2)}" class="chart-grid"></line>
            <text x="${pad.left - 12}" y="${(y + 4).toFixed(2)}" class="chart-y-label" text-anchor="end">${axisLabel(value)}</text>
          `;
        })
        .join("")}
      ${points
        .map((point, index) => {
          const label = xLabel(point.item.entry).replaceAll("{x}", point.x.toFixed(2));
          return `
            ${
              index % labelEvery === 0
                ? label
                : ""
            }
          `;
        })
        .join("")}
      <path d="${areaPath}" fill="url(#${gradientId})"></path>
      <path d="${linePath}" fill="none" stroke="${config.color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"></path>
      ${points
        .map((point, index) => {
          const hitX = Math.max(pad.left, point.x - hitWidth / 2);
          const constrainedHitWidth = Math.min(hitWidth, pad.left + innerWidth - hitX);
          const tooltipLeft = point.x > width - tooltipWidth - 24 ? point.x - tooltipWidth - 14 : point.x + 14;
          const tooltipX = Math.min(Math.max(tooltipLeft, pad.left), width - tooltipWidth - 8);
          const tooltipY = Math.max(pad.top + 8, point.y - tooltipHeight - 14);
          return `
            <g class="chart-hover-node">
              <rect class="chart-hit-area" x="${hitX.toFixed(2)}" y="${pad.top}" width="${constrainedHitWidth.toFixed(2)}" height="${innerHeight}"></rect>
              <line class="chart-cursor" x1="${point.x.toFixed(2)}" y1="${pad.top}" x2="${point.x.toFixed(2)}" y2="${pad.top + innerHeight}"></line>
              <circle class="chart-marker" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${markerRadius}"></circle>
              <g class="chart-tooltip" transform="translate(${tooltipX.toFixed(2)} ${tooltipY.toFixed(2)})">
                <rect width="${tooltipWidth}" height="${tooltipHeight}" rx="8"></rect>
                <text x="12" y="${isMobileChart ? 20 : 22}" class="chart-tooltip-title">${formatMonth(point.item.entry.month)}</text>
                <text x="12" y="${isMobileChart ? 40 : 43}" class="chart-tooltip-value">${config.format(point.item.value)}</text>
              </g>
            </g>
          `;
        })
        .join("")}
    </svg>
  `;
}

function renderChartView() {
  if (!state.chartMetric) return;
  populateFilterControls(els.chartYearFilter, els.chartMonthFilter, state.chartFilters);
  const entries = chartEntries();
  const config = metricConfigs[state.chartMetric];
  const total = valuesForMetric(entries, state.chartMetric).reduce((sum, item) => sum + item.value, 0);

  els.chartTitle.textContent = metricTitle(state.chartMetric);
  els.chartSummary.textContent = `${config.format(total)} за выбранный период`;
  els.detailChart.innerHTML = chartSvg(entries, state.chartMetric);
  syncFloatingFields();
}

function openChart(metric) {
  state.chartMetric = metric;
  state.chartFilters = { ...state.filters };
  els.appNav.hidden = true;
  els.homeView.hidden = true;
  els.chartView.hidden = false;
  renderChartView();
}

function closeChart() {
  state.chartMetric = null;
  els.appNav.hidden = false;
  els.chartView.hidden = true;
  els.homeView.hidden = false;
}

function renderRateNote() {
  if (!state.currentRate) {
    els.currentRateNote.textContent = `Курс недоступен, ${profileIncomeCurrency()} посчитан только для новых записей`;
    return;
  }

  els.currentRateNote.textContent = `Текущий курс: ${state.currentRate.rate.toFixed(4)} ${profileLocalCurrency()} за 1 ${profileIncomeCurrency()}, ${formatDate(state.currentRate.rateDate)}`;
}

function renderProfileUi() {
  const incomeCurrency = profileIncomeCurrency();
  const localCurrency = profileLocalCurrency();
  const localSymbol = currencySymbols[localCurrency] || localCurrency;
  const country = state.profile?.country || "GE";

  els.brandCountry.textContent = country;
  els.incomeMetricLabel.textContent = incomeCurrency;
  els.localMetricIcon.textContent = localSymbol;
  els.localMetricLabel.textContent = localCurrency;
  els.taxMetricLabel.textContent = `Налог ${taxPercent()}%`;
  els.incomeTableHead.textContent = incomeCurrency;
  els.localTableHead.textContent = localCurrency;
  els.localPreviewLabel.textContent = localCurrency;
  els.amountLabel.textContent = `Сумма в ${incomeCurrency}`;
  els.usdInput.name = "incomeAmount";
  els.usdSparkline.setAttribute("aria-label", `Открыть график ${incomeCurrency}`);
  els.gelSparkline.setAttribute("aria-label", `Открыть график ${localCurrency}`);
  els.profileButton.hidden = !state.profile && !state.authSession;
  els.signInButton.hidden = Boolean(state.authSession);
  els.signOutButton.hidden = !state.authSession;
  els.avatarInitial.textContent = state.profile?.name?.trim()?.[0]?.toUpperCase() || "?";
}

function renderLazyControls(totalEntries, visibleEntries) {
  const hasMore = visibleEntries < totalEntries;
  els.loadMore.hidden = !hasMore;
  if (!hasMore) {
    loadMoreObserver?.disconnect();
    return;
  }

  els.loadMoreStatus.textContent = `Показано ${visibleEntries} из ${totalEntries}`;
  loadMoreObserver?.disconnect();

  if ("IntersectionObserver" in window) {
    loadMoreObserver = new IntersectionObserver(
      (items) => {
        if (items.some((item) => item.isIntersecting)) {
          showMoreRows();
        }
      },
      { rootMargin: "160px 0px" },
    );
    loadMoreObserver.observe(els.loadMore);
  }
}

function render() {
  renderProfileUi();
  populateFilters();
  const entries = filteredEntries();
  const visibleEntries = entries.slice(0, state.visibleRows);
  const chronologicalEntries = entriesForFilters(state.filters, "asc");
  els.entriesBody.replaceChildren(...visibleEntries.map(rowTemplate));
  els.emptyState.classList.toggle("visible", entries.length === 0);
  els.emptyState.querySelector("strong").textContent =
    activeEntries().length === 0 ? "Пока нет записей" : "Нет записей по фильтру";
  els.emptyState.querySelector("span").textContent =
    activeEntries().length === 0
      ? "Добавь первый месяц, и следующий будет подставляться автоматически."
      : "Сбрось фильтры или выбери другой период.";
  els.emptyAddDialog.hidden = activeEntries().length !== 0;

  const totals = entries.reduce(
    (acc, entry) => {
      acc.usd += Number(estimatedIncome(entry) || 0);
      acc.gel += Number(entry.localAmount || 0);
      acc.tax += Number(entry.taxLocal || 0);
      return acc;
    },
    { usd: 0, gel: 0, tax: 0 },
  );

  els.totalUsd.textContent = money(totals.usd, profileIncomeCurrency());
  els.totalGel.textContent = money(totals.gel, profileLocalCurrency());
  els.totalTax.textContent = money(totals.tax, profileLocalCurrency());
  renderLazyControls(entries.length, visibleEntries.length);
  renderSparklines(chronologicalEntries);
  renderRateNote();
  renderChartView();
  syncFloatingFields();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-eztax-client-id": getClientId(),
      ...(state.authSession?.access_token ? { authorization: `Bearer ${state.authSession.access_token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

async function refreshAuthSession() {
  const saved = readAuthSession();
  if (!saved) return;
  try {
    const payload = await requestJson("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: saved.refresh_token }),
    });
    saveAuthSession(payload.session);
  } catch {
    saveAuthSession(null);
  }
}

function signInWithGoogle() {
  window.location.assign("/api/auth/google");
}

function signOut() {
  saveAuthSession(null);
  window.location.assign("/");
}

async function claimBrowserDataForAccount() {
  if (!state.authSession) return false;
  const backup = readBrowserBackup();
  const payload = await requestJson("/api/auth/claim", {
    method: "POST",
    body: JSON.stringify({ backup }),
  });
  if (payload.claimed) showToast("История привязана к Google-аккаунту");
  return payload.claimed;
}

async function loadEntries() {
  const payload = await requestJson("/api/entries");
  state.entries = payload.entries;
}

async function loadProfile() {
  const payload = await requestJson("/api/profile");
  state.profile = payload.profile;
  state.countries = payload.countries || state.countries;
  state.incomeCurrencies = payload.incomeCurrencies || state.incomeCurrencies;
}

async function restoreBrowserBackupIfNeeded() {
  const backup = readBrowserBackup();
  if (state.entries.length > 0 || !backup || backup.entries.length === 0) return false;

  const payload = await requestJson("/api/backup/restore", {
    method: "POST",
    body: JSON.stringify({ profile: backup.profile, entries: backup.entries }),
  });
  state.profile = payload.profile;
  state.entries = payload.entries;
  saveBrowserBackup();
  showToast("История автоматически восстановлена из резервной копии");
  return true;
}

async function loadCurrentRate() {
  try {
    const payload = await requestJson(state.profile ? "/api/rates/latest" : "/api/rates/usd/latest");
    state.currentRate = payload.rate;
  } catch (error) {
    state.currentRate = null;
    console.warn(error);
  }
}

async function loadRateForDate(date) {
  const payload = await requestJson(`/api/rates?date=${encodeURIComponent(date)}`);
  return payload.rate;
}

async function deleteEntry(id) {
  const payload = await requestJson(`/api/entries/${encodeURIComponent(id)}`, { method: "DELETE" });
  state.entries = payload.entries;
  saveBrowserBackup();
  state.pendingDelete = null;
  render();
  showToast("Поступление удалено", "danger");
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function resetImportStatus() {
  els.historyImportInput.value = "";
  els.importDropzone.classList.remove("is-dragging", "is-importing");
  els.historyImportStatus.textContent = "Перетащи CSV, XLSX, XLS или JSON сюда";
}

async function importHistoryFile(file) {
  if (!file) return;
  els.formError.textContent = "";
  els.importDropzone.classList.add("is-importing");
  els.historyImportStatus.textContent = `Импортирую ${file.name}...`;

  try {
    const data = arrayBufferToBase64(await file.arrayBuffer());
    const payload = await requestJson("/api/entries/import", {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        data,
      }),
    });
    state.entries = payload.entries;
    saveBrowserBackup();
    resetVisibleRows();
    state.filters = { year: "all", month: "all" };
    render();
    els.dialog.close();
    showToast(
      `История импортирована: ${payload.added} добавлено, ${payload.updated} обновлено, ${payload.skipped} пропущено`,
    );
  } catch (error) {
    els.formError.textContent = error.message;
    els.historyImportStatus.textContent = "Файл не удалось импортировать";
  } finally {
    els.importDropzone.classList.remove("is-importing", "is-dragging");
    els.historyImportInput.value = "";
  }
}

function setGelPreview(value) {
  els.gelPreviewInput.value = value == null ? "" : money(value, profileLocalCurrency());
  syncFloatingFields();
}

async function refreshGelPreview() {
  els.formError.textContent = "";
  els.refreshGel.disabled = true;
  els.refreshGel.classList.add("is-loading");

  try {
    const incomeAmount = Number(els.usdInput.value.trim().replace(",", "."));
    if (!Number.isFinite(incomeAmount) || incomeAmount <= 0) {
      throw new Error(`Введите сумму в ${profileIncomeCurrency()}.`);
    }
    if (!els.dateInput.value) {
      throw new Error("Выберите дату поступления.");
    }

    const rate = await loadRateForDate(els.dateInput.value);
    setGelPreview(incomeAmount * rate.rate);
  } catch (error) {
    els.formError.textContent = error.message;
  } finally {
    els.refreshGel.disabled = false;
    els.refreshGel.classList.remove("is-loading");
  }
}

function openDialog() {
  if (!state.profile) {
    openProfileDialog("signup");
    return;
  }
  state.editingEntry = null;
  els.form.reset();
  const month = nextMonth(state.entries);
  els.dateInput.value = `${month}-01`;
  els.entryDialogTitle.textContent = "Добавить поступление";
  els.amountLabel.textContent = `Сумма в ${profileIncomeCurrency()}`;
  els.usdInput.name = "incomeAmount";
  els.usdInput.placeholder = "2500.00";
  setGelPreview(null);
  els.formError.textContent = "";
  resetImportStatus();
  els.submitEntry.textContent = "Добавить";
  els.dialog.showModal();
  syncFloatingFields();
  els.usdInput.focus();
}

function openEditDialog(entry) {
  state.editingEntry = entry;
  els.form.reset();
  els.entryDialogTitle.textContent = "Редактировать месяц";
  els.dateInput.value = entry.receivedDate;
  els.usdInput.value = String(entry.incomeAmount ?? estimatedIncome(entry)?.toFixed(2) ?? "");
  els.amountLabel.textContent = `Сумма в ${profileIncomeCurrency()}`;
  els.usdInput.name = "incomeAmount";
  els.usdInput.placeholder = "2500.00";
  setGelPreview(entry.localAmount);
  els.formError.textContent = "";
  resetImportStatus();
  els.submitEntry.textContent = "Сохранить";
  els.dialog.showModal();
  syncFloatingFields();
  els.usdInput.focus();
}

function openDeleteDialog(entry) {
  state.pendingDelete = entry;
  els.deleteMessage.textContent = `Запись за ${formatMonth(entry.month)} будет удалена. Это действие нельзя отменить.`;
  els.deleteDialog.showModal();
}

async function submitEntry(event) {
  event.preventDefault();
  els.formError.textContent = "";
  els.submitEntry.disabled = true;
  const isEditing = Boolean(state.editingEntry);
  els.submitEntry.textContent = isEditing ? "Сохраняю..." : "Запрашиваю курс...";

  try {
    const body = {
      receivedDate: els.dateInput.value,
      incomeAmount: els.usdInput.value,
    };
    const url = state.editingEntry
      ? `/api/entries/${encodeURIComponent(state.editingEntry.id)}`
      : "/api/entries";
    const method = state.editingEntry ? "PATCH" : "POST";
    const payload = await requestJson(url, { method, body: JSON.stringify(body) });
    state.entries = payload.entries;
    saveBrowserBackup();
    state.editingEntry = null;
    render();
    els.dialog.close();
    if (!isEditing) {
      showToast("Поступление добавлено");
    }
  } catch (error) {
    els.formError.textContent = error.message;
  } finally {
    els.submitEntry.disabled = false;
    els.submitEntry.textContent = state.editingEntry ? "Сохранить" : "Добавить";
  }
}

async function submitDelete(event) {
  event.preventDefault();
  if (!state.pendingDelete) return;
  els.confirmDelete.disabled = true;
  els.confirmDelete.textContent = "Удаляю...";
  try {
    await deleteEntry(state.pendingDelete.id);
    els.deleteDialog.close();
  } catch (error) {
    els.deleteMessage.textContent = error.message;
  } finally {
    els.confirmDelete.disabled = false;
    els.confirmDelete.textContent = "Удалить";
  }
}

function exportCsv() {
  const header = [
    "month",
    "receivedDate",
    "country",
    "incomeCurrency",
    "incomeAmount",
    "estimatedIncome",
    "localCurrency",
    "localAmount",
    "taxLocal",
    "taxRate",
    "rate",
    "rateDate",
    "source",
  ];
  const rows = filteredEntries().map((entry) => {
    const row = {
      ...entry,
      estimatedIncome: estimatedIncome(entry),
    };
    return header.map((key) => JSON.stringify(row[key] ?? "")).join(",");
  });
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "eztax.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function openProfileDialog(mode = "edit") {
  const isSignup = mode === "signup" || !state.profile;
  els.profileForm.reset();
  els.profileDialogTitle.textContent = isSignup ? "Регистрация" : "Профиль";
  els.profileNameInput.value = state.profile?.name || "";
  setProfileChoice("country", state.profile?.country || "GE");
  setProfileChoice("incomeCurrency", state.profile?.incomeCurrency || "USD");
  els.profileFormError.textContent = "";
  els.closeProfileDialog.hidden = isSignup;
  els.cancelProfileDialog.hidden = isSignup;
  els.saveProfile.textContent = isSignup ? "Продолжить" : "Сохранить";
  els.profileDialog.showModal();
  syncFloatingFields();
  els.profileNameInput.focus();
}

function closeProfileDialog() {
  if (!state.profile) return;
  els.profileDialog.close();
}

function setProfileChoice(name, value) {
  const input = name === "country" ? els.profileCountryInput : els.profileCurrencyInput;
  input.value = value;

  document.querySelectorAll(`[data-profile-option="${name}"]`).forEach((button) => {
    const isSelected = button.dataset.value === value;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

async function submitProfile(event) {
  event.preventDefault();
  els.profileFormError.textContent = "";
  els.saveProfile.disabled = true;
  els.saveProfile.textContent = "Сохраняю...";

  try {
    const payload = await requestJson("/api/profile", {
      method: state.profile ? "PATCH" : "POST",
      body: JSON.stringify({
        name: els.profileNameInput.value,
        country: els.profileCountryInput.value,
        incomeCurrency: els.profileCurrencyInput.value,
      }),
    });
    state.profile = payload.profile;
    state.countries = payload.countries || state.countries;
    state.incomeCurrencies = payload.incomeCurrencies || state.incomeCurrencies;
    saveBrowserBackup();
    state.filters = { year: "all", month: "all" };
    state.chartFilters = { year: "all", month: "all" };
    resetVisibleRows();
    await loadCurrentRate();
    render();
    els.profileDialog.close();
  } catch (error) {
    els.profileFormError.textContent = error.message;
  } finally {
    els.saveProfile.disabled = false;
    els.saveProfile.textContent = state.profile ? "Сохранить" : "Продолжить";
  }
}

els.openAddDialog.addEventListener("click", openDialog);
els.emptyAddDialog.addEventListener("click", openDialog);
els.profileButton.addEventListener("click", () => openProfileDialog("edit"));
els.signInButton.addEventListener("click", signInWithGoogle);
els.signOutButton.addEventListener("click", signOut);
document.querySelectorAll("[data-profile-option]").forEach((button) => {
  button.addEventListener("click", () => {
    setProfileChoice(button.dataset.profileOption, button.dataset.value);
  });
});
els.profileForm.addEventListener("submit", submitProfile);
els.closeProfileDialog.addEventListener("click", closeProfileDialog);
els.cancelProfileDialog.addEventListener("click", closeProfileDialog);
els.closeDialog.addEventListener("click", () => {
  state.editingEntry = null;
  els.dialog.close();
});
els.cancelDialog.addEventListener("click", () => {
  state.editingEntry = null;
  els.dialog.close();
});
els.form.addEventListener("submit", submitEntry);
els.refreshGel.addEventListener("click", refreshGelPreview);
els.importDropzone.addEventListener("click", () => els.historyImportInput.click());
els.importDropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    els.historyImportInput.click();
  }
});
els.importDropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.importDropzone.classList.add("is-dragging");
});
els.importDropzone.addEventListener("dragleave", () => {
  els.importDropzone.classList.remove("is-dragging");
});
els.importDropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.importDropzone.classList.remove("is-dragging");
  importHistoryFile(event.dataTransfer.files[0]);
});
els.historyImportInput.addEventListener("change", () => {
  importHistoryFile(els.historyImportInput.files[0]);
});
els.deleteForm.addEventListener("submit", submitDelete);
els.usdSparkline.addEventListener("click", () => openChart("usd"));
els.gelSparkline.addEventListener("click", () => openChart("gel"));
els.taxSparkline.addEventListener("click", () => openChart("tax"));
els.backToHome.addEventListener("click", closeChart);
els.closeDeleteDialog.addEventListener("click", () => {
  state.pendingDelete = null;
  els.deleteDialog.close();
});
els.cancelDelete.addEventListener("click", () => {
  state.pendingDelete = null;
  els.deleteDialog.close();
});
els.exportButton.addEventListener("click", exportCsv);
els.loadMoreButton.addEventListener("click", showMoreRows);
els.yearFilter.addEventListener("change", () => {
  state.filters.year = els.yearFilter.value;
  resetVisibleRows();
  render();
});
els.monthFilter.addEventListener("change", () => {
  state.filters.month = els.monthFilter.value;
  resetVisibleRows();
  render();
});
els.chartYearFilter.addEventListener("change", () => {
  state.chartFilters.year = els.chartYearFilter.value;
  renderChartView();
});
els.chartMonthFilter.addEventListener("change", () => {
  state.chartFilters.month = els.chartMonthFilter.value;
  renderChartView();
});
els.resetChartFilters.addEventListener("click", () => {
  state.chartFilters.year = "all";
  state.chartFilters.month = "all";
  renderChartView();
});
window.addEventListener("resize", () => {
  if (state.chartMetric) renderChartView();
});

initFloatingFields();

async function boot() {
  captureAuthSessionFromUrl();
  try {
    await exchangeOAuthCodeFromUrl();
  } catch (error) {
    console.warn(error);
  }
  await refreshAuthSession();
  try {
    await claimBrowserDataForAccount();
  } catch (error) {
    console.warn(error);
  }
  try {
    await loadProfile();
  } catch (error) {
    state.profile = null;
    console.warn(error);
  }

  try {
    await loadEntries();
    await restoreBrowserBackupIfNeeded();
    saveBrowserBackup();
  } catch (error) {
    els.emptyState.classList.add("visible");
    els.emptyState.innerHTML = `<strong>Не удалось загрузить данные</strong><span>${error.message}</span>`;
    return;
  }

  render();
  await loadCurrentRate();
  render();

  if (!state.profile) openProfileDialog("signup");
}

boot();
