const STORAGE_KEY = "menu-planner-state-v1";
const CLOUD_CONFIG_KEY = "menu-planner-cloud-config-v1";
const CLOUD_TABLE = "menu_planner_sync";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const makeId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const svgPhoto = (bg, accent, label) => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">
      <rect width="640" height="480" fill="${bg}"/>
      <circle cx="505" cy="98" r="62" fill="${accent}" opacity=".2"/>
      <ellipse cx="320" cy="282" rx="205" ry="92" fill="#fff" opacity=".94"/>
      <ellipse cx="320" cy="282" rx="152" ry="58" fill="${accent}" opacity=".22"/>
      <path d="M194 278c44-70 188-83 257-18 26 24 22 60-20 79-67 31-219 16-250-24-9-11-4-25 13-37Z" fill="${accent}" opacity=".72"/>
      <path d="M236 220c24-34 70-58 116-56 38 2 79 21 104 51-71-17-145-15-220 5Z" fill="#ffffff" opacity=".65"/>
      <text x="320" y="415" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#17201c">${label}</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const seedDishes = [
  {
    id: makeId(),
    name: "Tomato Egg Noodles",
    ingredients: ["tomato", "egg", "noodles", "scallion", "soy sauce"],
    time: "20 min",
    type: "Lunch",
    notes: "Fast, cozy, easy to adjust.",
    photo: svgPhoto("#dcebf2", "#bf4935", "Tomato Egg"),
  },
  {
    id: makeId(),
    name: "Herby Chicken Rice",
    ingredients: ["chicken thigh", "rice", "cilantro", "cucumber", "garlic"],
    time: "35 min",
    type: "Dinner",
    notes: "Good meal prep option.",
    photo: svgPhoto("#e6f2df", "#2f6f4e", "Chicken Rice"),
  },
  {
    id: makeId(),
    name: "Mushroom Toast",
    ingredients: ["sourdough", "mushrooms", "butter", "thyme", "lemon"],
    time: "15 min",
    type: "Breakfast",
    notes: "Nice for a lighter day.",
    photo: svgPhoto("#f2d890", "#7b5b31", "Mushroom Toast"),
  },
];

const state = loadState();
const cloudConfig = loadCloudConfig();
let currentPhoto = "";
let activePlanDishId = "";
let supabaseClient = null;

const dishForm = document.querySelector("#dishForm");
const dishPhoto = document.querySelector("#dishPhoto");
const photoPreview = document.querySelector("#photoPreview");
const dishGrid = document.querySelector("#dishGrid");
const menuSearch = document.querySelector("#menuSearch");
const planForm = document.querySelector("#planForm");
const planDate = document.querySelector("#planDate");
const planMeal = document.querySelector("#planMeal");
const planDish = document.querySelector("#planDish");
const planGrid = document.querySelector("#planGrid");
const shoppingForm = document.querySelector("#shoppingForm");
const shoppingItemName = document.querySelector("#shoppingItemName");
const shoppingList = document.querySelector("#shoppingList");
const cloudForm = document.querySelector("#cloudForm");
const cloudStatus = document.querySelector("#cloudStatus");
const supabaseUrl = document.querySelector("#supabaseUrl");
const supabaseKey = document.querySelector("#supabaseKey");
const syncId = document.querySelector("#syncId");
const pushCloud = document.querySelector("#pushCloud");
const pullCloud = document.querySelector("#pullCloud");

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return { dishes: seedDishes, plan: [], shopping: createShoppingState() };
  }

  try {
    const parsed = JSON.parse(saved);
    return {
      dishes: Array.isArray(parsed.dishes) ? parsed.dishes : seedDishes,
      plan: Array.isArray(parsed.plan) ? parsed.plan : [],
      shopping: createShoppingState(parsed.shopping),
    };
  } catch {
    return { dishes: seedDishes, plan: [], shopping: createShoppingState() };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadCloudConfig() {
  const saved = localStorage.getItem(CLOUD_CONFIG_KEY);
  if (!saved) {
    return { url: "", key: "", syncId: "my-menu" };
  }

  try {
    const parsed = JSON.parse(saved);
    return {
      url: parsed.url || "",
      key: parsed.key || "",
      syncId: parsed.syncId || "my-menu",
    };
  } catch {
    return { url: "", key: "", syncId: "my-menu" };
  }
}

function saveCloudConfig() {
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cloudConfig));
}

function createShoppingState(saved = {}) {
  return {
    owned: Array.isArray(saved.owned) ? saved.owned : [],
    skipped: Array.isArray(saved.skipped) ? saved.skipped : [],
    extras: Array.isArray(saved.extras) ? saved.extras : [],
  };
}

function normalizeItem(value) {
  return value.trim().toLowerCase();
}

function splitIngredients(value) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function setDefaultPlanDate() {
  const tomorrow = new Date(Date.now() + MS_PER_DAY);
  planDate.value = tomorrow.toISOString().slice(0, 10);
}

function normalizeAppState(saved = {}) {
  return {
    dishes: Array.isArray(saved.dishes) ? saved.dishes : [],
    plan: Array.isArray(saved.plan) ? saved.plan : [],
    shopping: createShoppingState(saved.shopping),
  };
}

function getCloudPayload() {
  return normalizeAppState(state);
}

function render() {
  renderStats();
  renderDishes();
  renderDishSelect();
  renderPlan();
  renderShoppingList();
  renderCloudSettings();
  saveState();
}

function renderStats() {
  document.querySelector("#dishCount").textContent = state.dishes.length;
  document.querySelector("#planCount").textContent = state.plan.length;
}

function renderDishes() {
  const query = menuSearch.value.trim().toLowerCase();
  const dishes = state.dishes.filter((dish) => {
    const haystack = [dish.name, dish.type, dish.time, dish.notes, ...dish.ingredients].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  dishGrid.innerHTML = "";
  if (!dishes.length) {
    dishGrid.innerHTML = `<div class="empty-state">No dishes match that search.</div>`;
    return;
  }

  const template = document.querySelector("#dishCardTemplate");
  dishes.forEach((dish) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.id = dish.id;
    card.querySelector("img").src = dish.photo;
    card.querySelector("img").alt = dish.name;
    card.querySelector("h3").textContent = dish.name;
    card.querySelector(".dish-card-title span").textContent = dish.time || dish.type || "Dish";
    card.querySelector(".ingredients").textContent = dish.ingredients.join(", ");
    card.querySelector(".notes").textContent = dish.notes || "No notes yet.";
    dishGrid.append(card);
  });
}

function renderDishSelect() {
  planDish.innerHTML = "";
  state.dishes.forEach((dish) => {
    const option = document.createElement("option");
    option.value = dish.id;
    option.textContent = dish.name;
    planDish.append(option);
  });

  if (activePlanDishId && state.dishes.some((dish) => dish.id === activePlanDishId)) {
    planDish.value = activePlanDishId;
  }
}

function renderPlan() {
  planGrid.innerHTML = "";
  if (!state.plan.length) {
    planGrid.innerHTML = `<div class="empty-state">No meals planned yet. Choose a dish and add it to a date.</div>`;
    return;
  }

  const grouped = state.plan
    .slice()
    .sort((a, b) => `${a.date}${a.meal}`.localeCompare(`${b.date}${b.meal}`))
    .reduce((days, item) => {
      days[item.date] ||= [];
      days[item.date].push(item);
      return days;
    }, {});

  Object.entries(grouped).forEach(([date, items]) => {
    const day = document.createElement("article");
    day.className = "plan-day";
    day.innerHTML = `<h3>${formatDate(date)}</h3>`;

    items.forEach((item) => {
      const dish = state.dishes.find((candidate) => candidate.id === item.dishId);
      if (!dish) return;

      const row = document.createElement("div");
      row.className = "plan-item";
      const img = document.createElement("img");
      img.src = dish.photo;
      img.alt = dish.name;

      const text = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = dish.name;
      const meal = document.createElement("span");
      meal.textContent = item.meal;
      text.append(name, meal);

      const removeButton = document.createElement("button");
      removeButton.className = "danger-button remove-plan";
      removeButton.type = "button";
      removeButton.title = "Remove meal";
      removeButton.setAttribute("aria-label", `Remove ${dish.name} from ${item.meal}`);
      removeButton.textContent = "x";
      removeButton.addEventListener("click", () => {
        state.plan = state.plan.filter((planItem) => planItem.id !== item.id);
        render();
      });
      row.append(img, text, removeButton);
      day.append(row);
    });

    planGrid.append(day);
  });
}

function renderShoppingList() {
  const counts = new Map();
  state.plan.forEach((item) => {
    const dish = state.dishes.find((candidate) => candidate.id === item.dishId);
    if (!dish) return;

    dish.ingredients.forEach((ingredient) => {
      const normalized = normalizeItem(ingredient);
      counts.set(normalized, {
        label: ingredient,
        count: (counts.get(normalized)?.count || 0) + 1,
      });
    });
  });

  state.shopping.extras.forEach((extra) => {
    const normalized = normalizeItem(extra.label);
    if (!normalized) return;
    counts.set(normalized, {
      label: extra.label,
      count: (counts.get(normalized)?.count || 0) + 1,
    });
  });

  const owned = new Set(state.shopping.owned);
  const skipped = new Set(state.shopping.skipped);
  const allItems = [...counts.entries()]
    .map(([key, item]) => ({ key, ...item }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const neededItems = allItems.filter((item) => !owned.has(item.key) && !skipped.has(item.key));
  const ownedItems = allItems.filter((item) => owned.has(item.key));
  const skippedItems = allItems.filter((item) => skipped.has(item.key));

  shoppingList.innerHTML = "";
  if (!allItems.length) {
    shoppingList.append(createEmptyState("Plan a meal or add a shopping item."));
    return;
  }

  shoppingList.append(
    createShoppingSection("Need to buy", "need", neededItems),
    createShoppingSection("Already have", "owned", ownedItems),
    createShoppingSection("Skipped", "skipped", skippedItems),
  );
}

function createShoppingSection(title, kind, items) {
  const section = document.createElement("section");
  section.className = "shopping-section";
  section.dataset.kind = kind;

  const heading = document.createElement("h3");
  heading.textContent = `${title} (${items.length})`;
  const body = document.createElement("div");
  body.className = "shopping-section-body";

  if (!items.length) {
    body.append(createEmptyState(kind === "need" ? "Nothing needed here." : "No items here."));
  } else {
    items.forEach((item) => {
      body.append(createShoppingItem(item, kind));
    });
  }

  section.append(heading, body);
  return section;
}

function createShoppingItem(item, kind) {
  const row = document.createElement("div");
  row.className = "shopping-item";
  row.dataset.key = item.key;
  row.dataset.label = item.label;
  row.dataset.count = item.count;

  const text = document.createElement("div");
  const label = document.createElement("strong");
  label.textContent = item.label;
  const count = document.createElement("span");
  count.textContent = `x${item.count}`;
  text.append(label, count);

  const actions = document.createElement("div");
  actions.className = "shopping-item-actions";
  if (kind === "need") {
    actions.append(
      createShoppingAction("Have", "own", item.key),
      createShoppingAction("Remove", "skip", item.key, "danger-button"),
    );
  } else if (kind === "owned") {
    actions.append(
      createShoppingAction("Need", "need", item.key),
      createShoppingAction("Remove", "skip", item.key, "danger-button"),
    );
  } else {
    actions.append(createShoppingAction("Add back", "need", item.key));
  }

  row.append(text, actions);
  return row;
}

function createShoppingAction(label, action, key, className = "secondary-button") {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.dataset.action = action;
  button.dataset.key = key;
  button.textContent = label;
  return button;
}

function createEmptyState(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function switchView(viewName) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `${viewName}View`);
  });
}

function renderCloudSettings() {
  supabaseUrl.value = cloudConfig.url;
  supabaseKey.value = cloudConfig.key;
  syncId.value = cloudConfig.syncId;
  updateCloudStatus();
}

function updateCloudStatus(message = "") {
  cloudStatus.classList.remove("connected", "error");
  if (message) {
    cloudStatus.textContent = message;
    return;
  }

  if (cloudConfig.url && cloudConfig.key && cloudConfig.syncId) {
    cloudStatus.textContent = "Ready";
    cloudStatus.classList.add("connected");
  } else {
    cloudStatus.textContent = "Local only";
  }
}

function setCloudStatus(message, kind = "neutral") {
  cloudStatus.textContent = message;
  cloudStatus.classList.toggle("connected", kind === "success");
  cloudStatus.classList.toggle("error", kind === "error");
}

function getSupabaseClient() {
  if (!cloudConfig.url || !cloudConfig.key || !cloudConfig.syncId) {
    throw new Error("Add Supabase settings first.");
  }
  if (!window.supabase?.createClient) {
    throw new Error("Supabase library is not loaded.");
  }
  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(cloudConfig.url, cloudConfig.key);
  }
  return supabaseClient;
}

async function pushStateToCloud() {
  const client = getSupabaseClient();
  setCloudStatus("Pushing...");
  const { error } = await client.from(CLOUD_TABLE).upsert({
    sync_id: cloudConfig.syncId,
    state: getCloudPayload(),
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
  setCloudStatus("Cloud saved", "success");
}

async function pullStateFromCloud() {
  const client = getSupabaseClient();
  setCloudStatus("Pulling...");
  const { data, error } = await client
    .from(CLOUD_TABLE)
    .select("state")
    .eq("sync_id", cloudConfig.syncId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.state) {
    setCloudStatus("No cloud data yet", "error");
    return;
  }

  Object.assign(state, normalizeAppState(data.state));
  render();
  setCloudStatus("Cloud loaded", "success");
}

dishPhoto.addEventListener("change", () => {
  const file = dishPhoto.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    currentPhoto = reader.result;
    photoPreview.classList.add("has-image");
    photoPreview.style.backgroundImage = `url("${currentPhoto}")`;
  });
  reader.readAsDataURL(file);
});

dishForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!currentPhoto) {
    dishPhoto.reportValidity();
    return;
  }

  state.dishes.unshift({
    id: makeId(),
    name: document.querySelector("#dishName").value.trim(),
    ingredients: splitIngredients(document.querySelector("#dishIngredients").value),
    time: document.querySelector("#dishTime").value.trim(),
    type: document.querySelector("#dishType").value,
    notes: document.querySelector("#dishNotes").value.trim(),
    photo: currentPhoto,
  });

  dishForm.reset();
  currentPhoto = "";
  photoPreview.classList.remove("has-image");
  photoPreview.style.backgroundImage = "";
  switchView("menu");
  render();
});

document.querySelector("#clearDishForm").addEventListener("click", () => {
  dishForm.reset();
  currentPhoto = "";
  photoPreview.classList.remove("has-image");
  photoPreview.style.backgroundImage = "";
});

dishGrid.addEventListener("click", (event) => {
  const card = event.target.closest(".dish-card");
  if (!card) return;

  if (event.target.closest(".delete-dish")) {
    state.dishes = state.dishes.filter((dish) => dish.id !== card.dataset.id);
    state.plan = state.plan.filter((item) => item.dishId !== card.dataset.id);
    render();
    return;
  }

  if (event.target.closest(".plan-now")) {
    activePlanDishId = card.dataset.id;
    switchView("planner");
    renderDishSelect();
  }
});

planForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!planDish.value) return;

  state.plan.push({
    id: makeId(),
    date: planDate.value,
    meal: planMeal.value,
    dishId: planDish.value,
  });
  activePlanDishId = planDish.value;
  render();
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

menuSearch.addEventListener("input", renderDishes);

shoppingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const label = shoppingItemName.value.trim();
  const key = normalizeItem(label);
  if (!key) return;

  state.shopping.extras.push({ id: makeId(), label });
  state.shopping.owned = state.shopping.owned.filter((item) => item !== key);
  state.shopping.skipped = state.shopping.skipped.filter((item) => item !== key);
  shoppingForm.reset();
  render();
});

shoppingList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const key = button.dataset.key;
  state.shopping.owned = state.shopping.owned.filter((item) => item !== key);
  state.shopping.skipped = state.shopping.skipped.filter((item) => item !== key);

  if (button.dataset.action === "own") {
    state.shopping.owned.push(key);
  }
  if (button.dataset.action === "skip") {
    state.shopping.skipped.push(key);
  }

  render();
});

cloudForm.addEventListener("submit", (event) => {
  event.preventDefault();
  cloudConfig.url = supabaseUrl.value.trim();
  cloudConfig.key = supabaseKey.value.trim();
  cloudConfig.syncId = syncId.value.trim() || "my-menu";
  supabaseClient = null;
  saveCloudConfig();
  updateCloudStatus("Settings saved");
  window.setTimeout(() => updateCloudStatus(), 1200);
});

pushCloud.addEventListener("click", async () => {
  try {
    await pushStateToCloud();
  } catch (error) {
    setCloudStatus(error.message || "Push failed", "error");
  }
});

pullCloud.addEventListener("click", async () => {
  try {
    await pullStateFromCloud();
  } catch (error) {
    setCloudStatus(error.message || "Pull failed", "error");
  }
});

document.querySelector("#copyShoppingList").addEventListener("click", async () => {
  const button = document.querySelector("#copyShoppingList");
  const text = [...shoppingList.querySelectorAll('.shopping-section[data-kind="need"] .shopping-item')]
    .map((item) => `${item.dataset.label} x${item.dataset.count}`)
    .join("\n");

  if (!text) return;
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error("Clipboard unavailable");
    }
  } catch {
    const scratch = document.createElement("textarea");
    scratch.value = text;
    document.body.append(scratch);
    scratch.select();
    document.execCommand("copy");
    scratch.remove();
  }
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = "Copy list";
  }, 1200);
});

setDefaultPlanDate();
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}
