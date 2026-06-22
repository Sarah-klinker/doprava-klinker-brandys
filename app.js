/** @typedef {{ psc_od: number, psc_do: number, zone: string, city?: string }} ZonyEntry */
/** @typedef {{ psc_od: number, psc_do: number, zone: number, okres?: string }} PscRange */
/** @typedef {{ limit_cn: number | null, minimum: number | null, carriers: Record<string, number | null> }} VnitroBracket */
/** @typedef {{ key: string, label: string, max_kg: number }} WeightCategory */

let shippingData = null;

async function loadData() {
  const response = await fetch("data/shipping.json");
  if (!response.ok) {
    throw new Error("Nepodařilo se načíst data. Spusťte nejdříve export z Excelu.");
  }
  shippingData = await response.json();
}

/**
 * @param {number} psc
 * @param {ZonyEntry[]} entries
 */
function lookupZony(psc, entries) {
  for (const entry of entries) {
    if (psc >= entry.psc_od && psc <= entry.psc_do) {
      return entry;
    }
  }
  return null;
}

/**
 * @param {number} psc
 * @param {PscRange[]} ranges
 */
function lookupPscZone(psc, ranges) {
  for (const range of ranges) {
    if (psc >= range.psc_od && psc <= range.psc_do) {
      return range.zone;
    }
  }
  return null;
}

/**
 * @param {number} weight
 * @param {number[]} tiers
 */
function findWeightTier(weight, tiers) {
  for (const tier of tiers) {
    if (tier >= weight) {
      return tier;
    }
  }
  return tiers.length > 0 ? tiers[tiers.length - 1] : null;
}

/**
 * @param {number} weight
 * @param {WeightCategory[]} categories
 */
function findWeightCategory(weight, categories) {
  for (const category of categories) {
    if (weight <= category.max_kg) {
      return category;
    }
  }
  return categories[categories.length - 1] ?? null;
}

function formatPrice(value) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "CZK",
    maximumFractionDigits: 0,
  }).format(value);
}

function normalizePsc(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 5) {
    return null;
  }
  return parseInt(digits.padStart(5, "0"), 10);
}

function applyFuel(price, surcharge) {
  if (price == null) {
    return null;
  }
  return Math.round(price * (1 + surcharge));
}

function isPrahaZone(zone) {
  return String(zone).toUpperCase().endsWith("P");
}

function calculateRaben(psc, weight) {
  const { psc_ranges, weights, prices, max_weight_kg } = shippingData.raben;
  const zone = lookupPscZone(psc, psc_ranges);
  if (zone == null) {
    return { available: false, reason: "PSČ není v ceniku Raben" };
  }

  const maxWeight = max_weight_kg ?? (weights.length > 0 ? weights[weights.length - 1] : null);
  if (maxWeight != null && weight > maxWeight) {
    return { available: false, reason: `Hmotnost nad maximum Raben (${maxWeight.toLocaleString("cs-CZ")} kg)` };
  }

  const tier = findWeightTier(weight, weights);
  if (tier == null) {
    return { available: false, reason: "Hmotnost mimo rozsah Raben" };
  }

  const price = prices[String(zone)]?.[String(tier)];
  if (price == null) {
    return { available: false, reason: "Cena není k dispozici" };
  }

  return {
    available: true,
    price,
    zone,
    tier,
    detail: `Zóna ${zone} · tarif do ${tier} kg`,
  };
}

function calculateDnp(psc, weight) {
  const { psc_ranges, weights, prices, max_weight_kg } = shippingData.dnp;
  const range = psc_ranges.find((item) => psc >= item.psc_od && psc <= item.psc_do);
  if (!range) {
    return { available: false, reason: "PSČ není v ceniku DNP" };
  }

  const maxWeight = max_weight_kg ?? (weights.length > 0 ? weights[weights.length - 1] : null);
  if (maxWeight != null && weight > maxWeight) {
    return { available: false, reason: `Hmotnost nad maximum DNP (${maxWeight.toLocaleString("cs-CZ")} kg)` };
  }

  const tier = findWeightTier(weight, weights);
  if (tier == null) {
    return { available: false, reason: "Hmotnost mimo rozsah DNP" };
  }

  const price = prices[String(range.zone)]?.[String(tier)];
  if (price == null) {
    return { available: false, reason: "Cena není k dispozici" };
  }

  const okres = range.okres ? ` · ${range.okres}` : "";
  return {
    available: true,
    price,
    zone: range.zone,
    tier,
    detail: `Zóna ${range.zone}${okres} · tarif do ${tier} kg`,
  };
}

/**
 * @param {string} zone
 * @param {number} weight
 */
function calculateVnitroOrPraha(zone, weight) {
  if (isPrahaZone(zone)) {
    return calculatePraha(zone, weight);
  }
  return calculateVnitro(zone, weight);
}

/**
 * @param {string} zone
 * @param {number} weight
 */
function calculateVnitro(zone, weight) {
  const { fuel_surcharge, weight_categories, zones } = shippingData.vnitro;
  const zoneData = zones[String(zone)];
  if (!zoneData) {
    return { available: false, reason: `Pásmo ${zone} není v ceniku Vnitro` };
  }

  const category = findWeightCategory(weight, weight_categories);
  if (!category) {
    return { available: false, reason: "Hmotnost mimo rozsah Vnitro" };
  }

  /** @type {VnitroBracket | undefined} */
  const bracket = zoneData[category.key];
  if (!bracket || bracket.limit_cn == null) {
    return { available: false, reason: "Cena není k dispozici" };
  }

  const carrierRows = Object.entries(bracket.carriers)
    .filter(([, price]) => price != null)
    .map(([carrier, basePrice]) => {
      const withFuel = applyFuel(basePrice, fuel_surcharge);
      return {
        carrier,
        basePrice,
        withFuel,
      };
    })
    .sort((a, b) => (a.withFuel ?? Infinity) - (b.withFuel ?? Infinity));

  const limitWithFuel = applyFuel(bracket.limit_cn, fuel_surcharge);
  const minimumWithFuel = applyFuel(bracket.minimum, fuel_surcharge);
  const cheapest = carrierRows.length > 0 ? carrierRows[0] : null;

  return {
    available: true,
    mode: "vnitro",
    zone,
    category: category.label,
    kmRange: zoneData.km_range || "",
    limitCn: limitWithFuel,
    minimum: minimumWithFuel,
    cheapestCarrier: cheapest?.carrier ?? null,
    cheapestPrice: cheapest?.withFuel ?? null,
    carrierRows,
    fuelSurcharge: fuel_surcharge,
    detail: `Pásmo ${zone}${zoneData.km_range ? ` (${zoneData.km_range} km)` : ""} · ${category.label}`,
  };
}

/**
 * @param {string} zone
 * @param {number} weight
 */
function calculatePraha(zone, weight) {
  const { additional_unload, weight_categories, zones } = shippingData.vnitro;
  const fuel_surcharge = shippingData.vnitro.fuel_surcharge;
  const prahaZones = shippingData.praha.zones;
  const zoneData = prahaZones[zone];
  if (!zoneData) {
    return { available: false, reason: `Pásmo ${zone} není v ceniku Praha` };
  }

  const category = findWeightCategory(weight, shippingData.praha.weight_categories);
  if (!category) {
    return { available: false, reason: "Hmotnost mimo rozsah Praha" };
  }

  const carriers = zoneData[category.key];
  if (!carriers) {
    return { available: false, reason: "Cena není k dispozici" };
  }

  const carrierRows = Object.entries(carriers)
    .filter(([, price]) => price != null)
    .map(([carrier, basePrice]) => {
      const withFuel = applyFuel(basePrice, fuel_surcharge);
      return {
        carrier,
        basePrice,
        withFuel,
      };
    })
    .sort((a, b) => (a.withFuel ?? Infinity) - (b.withFuel ?? Infinity));

  const prices = carrierRows.map((row) => row.withFuel).filter((value) => value != null);
  const limitCn = prices.length > 0 ? Math.max(...prices) : null;
  const minimum = prices.length > 0 ? Math.min(...prices) : null;
  const cheapest = carrierRows.length > 0 ? carrierRows[0] : null;

  return {
    available: true,
    mode: "praha",
    zone,
    category: category.label,
    kmRange: "",
    limitCn,
    minimum,
    cheapestCarrier: cheapest?.carrier ?? null,
    cheapestPrice: cheapest?.withFuel ?? null,
    carrierRows,
    fuelSurcharge: fuel_surcharge,
    detail: `Praha ${zone} · ${category.label}`,
  };
}

function renderPalletCard(result) {
  const card = document.createElement("div");
  const isBest = result.isBest;
  card.className = "result-card" + (isBest ? " best" : "") + (result.available ? "" : " unavailable");

  const left = document.createElement("div");
  const name = document.createElement("div");
  name.className = "carrier-name";
  name.innerHTML = result.carrier + (isBest ? '<span class="best-badge">Nejlevnější</span>' : "");
  const detail = document.createElement("div");
  detail.className = "carrier-detail";
  detail.textContent = result.available ? result.detail : result.reason;
  left.appendChild(name);
  left.appendChild(detail);

  const priceWrap = document.createElement("div");
  priceWrap.className = "carrier-prices";
  const priceEl = document.createElement("div");
  priceEl.className = "carrier-price";
  priceEl.textContent = result.available ? formatPrice(result.price) : "—";
  priceWrap.appendChild(priceEl);

  card.appendChild(left);
  card.appendChild(priceWrap);
  return card;
}

function renderVnitro(vnitroResult) {
  const section = document.getElementById("vnitro-section");
  const title = document.getElementById("vnitro-title");
  const summary = document.getElementById("vnitro-summary");
  const tableBody = document.getElementById("vnitro-table-body");
  const note = document.getElementById("vnitro-note");

  if (!vnitroResult.available) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  title.textContent = vnitroResult.mode === "praha" ? "Praha (pásma P)" : "Vnitro";
  summary.innerHTML = `
    <div class="metric"><span class="metric-label">Cena do CN</span><strong>${formatPrice(vnitroResult.limitCn)}</strong></div>
    <div class="metric"><span class="metric-label">Nejnižší cena</span><strong>${formatPrice(vnitroResult.minimum)}</strong></div>
    <div class="metric"><span class="metric-label">Nejlevnější dopravce</span><strong>${vnitroResult.cheapestCarrier ?? "—"}</strong></div>
  `;

  tableBody.innerHTML = "";
  for (const row of vnitroResult.carrierRows) {
    const tr = document.createElement("tr");
    const isCheapest = row.carrier === vnitroResult.cheapestCarrier;
    tr.innerHTML = `
      <td>${row.carrier}${isCheapest ? ' <span class="tag">nejlevnější</span>' : ""}</td>
      <td>${formatPrice(row.basePrice)}</td>
      <td>${formatPrice(row.withFuel)}</td>
    `;
    tableBody.appendChild(tr);
  }

  const fuelPercent = Math.round((vnitroResult.fuelSurcharge ?? 0) * 100);
  note.textContent =
    `${vnitroResult.detail}. Palivový příplatek ${fuelPercent} % je započten ve sloupci „Vč. paliva“. Vše v Kč bez DPH.`;
}

function calculate() {
  hideError();

  if (!shippingData) {
    showError("Data nejsou načtena. Obnovte stránku.");
    return;
  }

  const psc = normalizePsc(document.getElementById("psc").value);
  const weight = parseFloat(document.getElementById("weight").value);

  if (psc == null) {
    showError("Zadejte platné PSČ (5 číslic).");
    return;
  }
  if (!weight || weight <= 0) {
    showError("Zadejte platnou hmotnost v kg (větší než 0).");
    return;
  }

  const zonyEntry = lookupZony(psc, shippingData.zony);
  if (!zonyEntry) {
    showError(`PSČ ${String(psc).padStart(5, "0")} nebylo nalezeno v seznamu zón Brandýs.`);
    return;
  }

  document.getElementById("info-psc").textContent = String(psc).padStart(5, "0");
  document.getElementById("info-city").textContent = zonyEntry.city || "—";
  document.getElementById("info-pasmo").textContent = String(zonyEntry.zone);
  document.getElementById("info-panel").classList.remove("hidden");

  const raben = { carrier: "Raben", ...calculateRaben(psc, weight) };
  const dnp = { carrier: "DNP", ...calculateDnp(psc, weight) };
  const vnitro = calculateVnitroOrPraha(zonyEntry.zone, weight);

  const palletResults = [raben, dnp];
  const palletPrices = palletResults
    .filter((item) => item.available && item.price != null)
    .map((item) => item.price);
  const vnitroComparePrice = vnitro.available ? vnitro.cheapestPrice : null;
  const allPrices = [...palletPrices, ...(vnitroComparePrice != null ? [vnitroComparePrice] : [])];
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;

  const palletGrid = document.getElementById("pallet-results");
  palletGrid.innerHTML = "";
  for (const result of palletResults) {
    result.isBest = result.available && result.price === minPrice && minPrice != null;
    palletGrid.appendChild(renderPalletCard(result));
  }

  renderVnitro(vnitro);

  const bestNote = document.getElementById("best-note");
  if (minPrice != null && allPrices.length > 1) {
    let bestLabel = "";
    if (raben.available && raben.price === minPrice) bestLabel = "Raben";
    else if (dnp.available && dnp.price === minPrice) bestLabel = "DNP";
    else if (vnitro.available && vnitro.cheapestPrice === minPrice) {
      bestLabel = `${vnitro.cheapestCarrier} (Vnitro)`;
    }
    bestNote.textContent = `Nejlevnější doprava: ${bestLabel} za ${formatPrice(minPrice)} bez DPH (Vnitro vč. paliva).`;
    bestNote.classList.remove("hidden");
  } else {
    bestNote.classList.add("hidden");
  }

  document.getElementById("results").classList.remove("hidden");
}

function showError(message) {
  const el = document.getElementById("error");
  el.textContent = message;
  el.classList.remove("hidden");
  document.getElementById("results").classList.add("hidden");
  document.getElementById("info-panel").classList.add("hidden");
}

function hideError() {
  document.getElementById("error").classList.add("hidden");
}

function init() {
  document.getElementById("calc-btn").addEventListener("click", calculate);
  for (const id of ["psc", "weight"]) {
    document.getElementById(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        calculate();
      }
    });
  }

  loadData().catch((error) => {
    showError(error.message);
  });
}

init();
