const STORAGE_KEY = "menu-planner-state-v1";
const CLOUD_CONFIG_KEY = "menu-planner-cloud-config-v1";
const CLOUD_TABLE = "menu_planner_sync";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AUTOSAVE_DELAY = 700;
const DEFAULT_CLOUD_CONFIG = {
  url: "https://nohriuvjxxdovqfpqhpt.supabase.co",
  key: "sb_publishable_cIKe5OwXpmTviWsIJB2Ggg_2Q64s0Cv",
  syncId: "my-menu",
};
const menuCategories = [
  { key: "Breakfast", label: "Breakfast" },
  { key: "Lunch", label: "Lunch" },
  { key: "Dinner", label: "Dinner" },
  { key: "Snack", label: "Snacks" },
];
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
let editingDishId = "";
let supabaseClient = null;
let session = null;
let hasPulledCloud = false;
let isApplyingCloudState = false;
let isLoaded = false;
let autosaveTimer = null;
let pendingCloudSave = false;
let autosaveInFlight = false;
const expandedDishIds = new Set();
const expandedCategoryKeys = new Set();

const dishForm = document.querySelector("#dishForm");
const dishFormPanel = document.querySelector("#dishFormPanel");
const openDishForm = document.querySelector("#openDishForm");
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
const accountButton = document.querySelector("#accountButton");
const familyEmail = document.querySelector("#familyEmail");
const familyPassword = document.querySelector("#familyPassword");
const signedInText = document.querySelector("#signedInText");
const signInButton = document.querySelector("#signInButton");
const signUpButton = document.querySelector("#signUpButton");
const signOutButton = document.querySelector("#signOutButton");
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
  if (!isApplyingCloudState) scheduleAutoSync();
}

function loadCloudConfig() {
  const saved = localStorage.getItem(CLOUD_CONFIG_KEY);
  if (!saved) {
    return { ...DEFAULT_CLOUD_CONFIG };
  }

  try {
    const parsed = JSON.parse(saved);
    return {
      url: parsed.url || DEFAULT_CLOUD_CONFIG.url,
      key: parsed.key || DEFAULT_CLOUD_CONFIG.key,
      syncId: parsed.syncId || DEFAULT_CLOUD_CONFIG.syncId,
    };
  } catch {
    return { ...DEFAULT_CLOUD_CONFIG };
  }
}

function saveCloudConfig() {
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cloudConfig));
}

function createShoppingState(saved = {}) {
  const ownedRows = Array.isArray(saved.ownedRows) ? saved.ownedRows : [];
  const skippedRows = Array.isArray(saved.skippedRows) ? saved.skippedRows : [];
  const boughtRows = Array.isArray(saved.boughtRows) ? saved.boughtRows : [];
  return {
    owned: Array.isArray(saved.owned) ? saved.owned : [],
    skipped: Array.isArray(saved.skipped) ? saved.skipped : [],
    ownedRows,
    skippedRows,
    boughtRows,
    extras: Array.isArray(saved.extras) ? saved.extras : [],
  };
}

function normalizeItem(value) {
  return value.trim().toLowerCase();
}

function splitIngredients(value) {
  return value
    .split(/[\n,，、;；]+/)
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

function getDishCategory(dish) {
  const type = String(dish.type || "").toLowerCase();
  if (type.includes("breakfast")) return "Breakfast";
  if (type.includes("dinner")) return "Dinner";
  if (type.includes("snack")) return "Snack";
  return "Lunch";
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
  menuCategories.forEach((category) => {
    const categoryDishes = dishes
      .filter((dish) => getDishCategory(dish) === category.key)
      .sort((a, b) => a.name.localeCompare(b.name));
    const isOpen = expandedCategoryKeys.has(category.key) || Boolean(query);

    const section = document.createElement("section");
    section.className = "dish-category";
    section.classList.toggle("expanded", isOpen);
    section.dataset.category = category.key;

    const button = document.createElement("button");
    button.className = "dish-category-button";
    button.type = "button";
    button.dataset.categoryToggle = category.key;
    button.innerHTML = `
      <span>${category.label}</span>
      <strong>${categoryDishes.length}</strong>
    `;

    const list = document.createElement("div");
    list.className = "dish-category-list";

    if (!categoryDishes.length) {
      list.append(createEmptyState("No dishes here yet."));
    }

    categoryDishes.forEach((dish) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.id = dish.id;
    card.classList.toggle("expanded", expandedDishIds.has(dish.id));
    card.querySelector(".dish-card-name").textContent = dish.name;
    card.querySelector(".dish-card-meta").textContent = dish.time || dish.type || "Dish";
    card.querySelector(".dish-card-toggle").textContent = expandedDishIds.has(dish.id) ? "-" : "+";
    card.querySelector("img").src = dish.photo;
    card.querySelector("img").alt = dish.name;
    card.querySelector("h3").textContent = dish.name;
    card.querySelector(".dish-card-title span").textContent = dish.time || dish.type || "Dish";
    card.querySelector(".ingredients").textContent = dish.ingredients.join(", ");
    card.querySelector(".notes").textContent = dish.notes || "No notes yet.";
      list.append(card);
    });

    section.append(button, list);
    dishGrid.append(section);
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
  const rows = [];
  state.plan.forEach((item) => {
    const dish = state.dishes.find((candidate) => candidate.id === item.dishId);
    if (!dish) return;

    dish.ingredients.forEach((ingredient, index) => {
      rows.push({
        key: `${item.id}:${index}:${normalizeItem(ingredient)}`,
        label: ingredient,
        source: dish.name,
      });
    });
  });

  state.shopping.extras.forEach((extra) => {
    const normalized = normalizeItem(extra.label);
    if (!normalized) return;
    rows.push({
      key: `extra:${extra.id || normalized}`,
      label: extra.label,
      source: "Added item",
    });
  });

  const owned = new Set([...(state.shopping.ownedRows || []), ...(state.shopping.owned || [])]);
  const skipped = new Set([...(state.shopping.skippedRows || []), ...(state.shopping.skipped || [])]);
  const bought = new Set(state.shopping.boughtRows || []);
  const allItems = rows
    .sort((a, b) => a.label.localeCompare(b.label));
  const neededItems = allItems.filter((item) => !owned.has(item.key) && !owned.has(normalizeItem(item.label)) && !skipped.has(item.key) && !skipped.has(normalizeItem(item.label)) && !bought.has(item.key));
  const boughtItems = allItems.filter((item) => bought.has(item.key));
  const ownedItems = allItems.filter((item) => owned.has(item.key) || owned.has(normalizeItem(item.label)));
  const skippedItems = allItems.filter((item) => skipped.has(item.key) || skipped.has(normalizeItem(item.label)));

  shoppingList.innerHTML = "";
  if (!allItems.length) {
    shoppingList.append(createEmptyState("Plan a meal or add a shopping item."));
    return;
  }

  shoppingList.append(
    createShoppingSection("Need to buy", "need", neededItems),
    createShoppingSection("Bought", "bought", boughtItems),
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
  const source = document.createElement("span");
  source.className = "shopping-source";
  source.textContent = item.source;
  text.append(label, source);

  const actions = document.createElement("div");
  actions.className = "shopping-item-actions";
  if (kind === "need") {
    actions.append(
      createShoppingAction("Bought", "bought", item.key),
      createShoppingAction("Have", "own", item.key),
      createShoppingAction("Skip", "skip", item.key, "danger-button"),
    );
  } else if (kind === "bought") {
    actions.append(createShoppingAction("Need", "need", item.key));
  } else if (kind === "owned") {
    actions.append(
      createShoppingAction("Need", "need", item.key),
      createShoppingAction("Skip", "skip", item.key, "danger-button"),
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
  accountButton.textContent = session ? "Sync" : "Sign in";
  signedInText.textContent = session?.user?.email ? `Signed in as ${session.user.email}` : "";
  signOutButton.hidden = !session;
  signInButton.hidden = Boolean(session);
  signUpButton.hidden = Boolean(session);
  updateCloudStatus();
}

function updateCloudStatus(message = "") {
  cloudStatus.classList.remove("connected", "error");
  if (message) {
    cloudStatus.textContent = message;
    return;
  }

  if (session) {
    cloudStatus.textContent = "Signed in";
    cloudStatus.classList.add("connected");
  } else if (cloudConfig.url && cloudConfig.key && cloudConfig.syncId) {
    cloudStatus.textContent = "Ready to sign in";
  } else if (cloudConfig.url && cloudConfig.syncId) {
    cloudStatus.textContent = "Setup needed";
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
    supabaseClient = window.supabase.createClient(cloudConfig.url, cloudConfig.key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return supabaseClient;
}

function canAutoSync() {
  return isLoaded && session && hasPulledCloud && !isApplyingCloudState;
}

function scheduleAutoSync() {
  pendingCloudSave = true;
  if (!canAutoSync()) return;

  window.clearTimeout(autosaveTimer);
  setCloudStatus("Autosave pending...");
  autosaveTimer = window.setTimeout(() => {
    flushAutoSync();
  }, AUTOSAVE_DELAY);
}

async function flushAutoSync(options = {}) {
  if (!pendingCloudSave || !canAutoSync() || autosaveInFlight) return;

  autosaveInFlight = true;
  try {
    await pushStateToCloud({ silent: true, keepPending: true });
    pendingCloudSave = false;
  } catch (error) {
    setCloudStatus(error.message || "Autosave failed", "error");
    if (!options.once) {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = window.setTimeout(() => {
        flushAutoSync();
      }, AUTOSAVE_DELAY * 4);
    }
  } finally {
    autosaveInFlight = false;
  }
}

async function pushStateToCloud(options = {}) {
  const client = getSupabaseClient();
  if (!session) throw new Error("Sign in first.");
  setCloudStatus(options.silent ? "Autosaving..." : "Saving...");
  const { error } = await client.from(CLOUD_TABLE).upsert({
    sync_id: cloudConfig.syncId,
    state: getCloudPayload(),
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
  if (!options.keepPending) pendingCloudSave = false;
  setCloudStatus(options.silent ? "Autosaved" : "Family menu saved", "success");
}

async function pullStateFromCloud(options = {}) {
  const client = getSupabaseClient();
  if (!session) throw new Error("Sign in first.");
  setCloudStatus(options.silent ? "Syncing..." : "Loading...");
  const { data, error } = await client
    .from(CLOUD_TABLE)
    .select("state")
    .eq("sync_id", cloudConfig.syncId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.state) {
    hasPulledCloud = true;
    setCloudStatus("No saved family menu yet", "error");
    flushAutoSync({ once: true });
    return;
  }

  isApplyingCloudState = true;
  Object.assign(state, normalizeAppState(data.state));
  render();
  isApplyingCloudState = false;
  hasPulledCloud = true;
  setCloudStatus(options.silent ? "Synced" : "Family menu loaded", "success");
  flushAutoSync({ once: true });
}

async function initializeAuth() {
  if (!cloudConfig.url || !cloudConfig.key) {
    isLoaded = true;
    return;
  }

  try {
    const client = getSupabaseClient();
    const { data } = await client.auth.getSession();
    session = data.session || null;
    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      hasPulledCloud = false;
      renderCloudSettings();
      if (session) {
        pullStateFromCloud({ silent: true }).catch((error) => setCloudStatus(error.message || "Sync failed", "error"));
      }
    });
    if (session) {
      await pullStateFromCloud({ silent: true });
    }
  } catch (error) {
    setCloudStatus(error.message || "Sync setup failed", "error");
  } finally {
    isLoaded = true;
    renderCloudSettings();
    flushAutoSync({ once: true });
  }
}

async function signIn() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: familyEmail.value.trim(),
    password: familyPassword.value,
  });
  if (error) throw error;
  session = data.session;
  setCloudStatus("Signed in", "success");
  await pullStateFromCloud({ silent: true });
  flushAutoSync({ once: true });
}

async function signUp() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signUp({
    email: familyEmail.value.trim(),
    password: familyPassword.value,
  });
  if (error) throw error;
  session = data.session;
  setCloudStatus(session ? "Signed in" : "Check email", "success");
  if (session) {
    await pullStateFromCloud({ silent: true });
    flushAutoSync({ once: true });
  }
}

async function signOut() {
  const client = getSupabaseClient();
  await client.auth.signOut();
  session = null;
  hasPulledCloud = false;
  setCloudStatus("Signed out");
  renderCloudSettings();
}

function resetDishForm() {
  dishForm.reset();
  editingDishId = "";
  currentPhoto = "";
  dishPhoto.required = true;
  photoPreview.classList.remove("has-image");
  photoPreview.style.backgroundImage = "";
  dishForm.querySelector('button[type="submit"]').textContent = "Save dish";
}

function openDishEditor(dish) {
  editingDishId = dish.id;
  currentPhoto = dish.photo;
  document.querySelector("#dishName").value = dish.name;
  document.querySelector("#dishIngredients").value = dish.ingredients.join(", ");
  document.querySelector("#dishTime").value = dish.time || "";
  document.querySelector("#dishType").value = dish.type || "Anytime";
  document.querySelector("#dishNotes").value = dish.notes || "";
  dishPhoto.required = false;
  photoPreview.classList.add("has-image");
  photoPreview.style.backgroundImage = `url("${currentPhoto}")`;
  dishForm.querySelector('button[type="submit"]').textContent = "Update dish";
  dishFormPanel.classList.remove("collapsed");
  dishFormPanel.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const nextDish = {
    id: editingDishId || makeId(),
    name: document.querySelector("#dishName").value.trim(),
    ingredients: splitIngredients(document.querySelector("#dishIngredients").value),
    time: document.querySelector("#dishTime").value.trim(),
    type: document.querySelector("#dishType").value,
    notes: document.querySelector("#dishNotes").value.trim(),
    photo: currentPhoto,
  };

  if (editingDishId) {
    state.dishes = state.dishes.map((dish) => (dish.id === editingDishId ? nextDish : dish));
    expandedDishIds.add(editingDishId);
  } else {
    state.dishes.unshift(nextDish);
    expandedDishIds.add(nextDish.id);
  }

  resetDishForm();
  dishFormPanel.classList.add("collapsed");
  switchView("menu");
  render();
});

openDishForm.addEventListener("click", () => {
  resetDishForm();
  dishFormPanel.classList.remove("collapsed");
  dishFormPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelector("#closeDishForm").addEventListener("click", () => {
  resetDishForm();
  dishFormPanel.classList.add("collapsed");
});

dishGrid.addEventListener("click", (event) => {
  const categoryButton = event.target.closest("[data-category-toggle]");
  if (categoryButton) {
    const key = categoryButton.dataset.categoryToggle;
    if (expandedCategoryKeys.has(key)) {
      expandedCategoryKeys.delete(key);
    } else {
      expandedCategoryKeys.add(key);
    }
    renderDishes();
    return;
  }

  const card = event.target.closest(".dish-card");
  if (!card) return;

  if (event.target.closest(".delete-dish")) {
    state.dishes = state.dishes.filter((dish) => dish.id !== card.dataset.id);
    state.plan = state.plan.filter((item) => item.dishId !== card.dataset.id);
    expandedDishIds.delete(card.dataset.id);
    render();
    return;
  }

  if (event.target.closest(".edit-dish")) {
    const dish = state.dishes.find((candidate) => candidate.id === card.dataset.id);
    if (dish) openDishEditor(dish);
    return;
  }

  if (event.target.closest(".plan-now")) {
    activePlanDishId = card.dataset.id;
    switchView("planner");
    renderDishSelect();
    return;
  }

  if (expandedDishIds.has(card.dataset.id)) {
    expandedDishIds.delete(card.dataset.id);
  } else {
    expandedDishIds.add(card.dataset.id);
  }
  renderDishes();
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

accountButton.addEventListener("click", () => switchView("cloud"));

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
  state.shopping.ownedRows = (state.shopping.ownedRows || []).filter((item) => item !== key);
  state.shopping.skippedRows = (state.shopping.skippedRows || []).filter((item) => item !== key);
  state.shopping.boughtRows = (state.shopping.boughtRows || []).filter((item) => item !== key);

  if (button.dataset.action === "own") {
    state.shopping.ownedRows.push(key);
  }
  if (button.dataset.action === "skip") {
    state.shopping.skippedRows.push(key);
  }
  if (button.dataset.action === "bought") {
    state.shopping.boughtRows.push(key);
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
  initializeAuth();
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

signInButton.addEventListener("click", async () => {
  try {
    await signIn();
  } catch (error) {
    setCloudStatus(error.message || "Sign in failed", "error");
  }
});

signUpButton.addEventListener("click", async () => {
  try {
    await signUp();
  } catch (error) {
    setCloudStatus(error.message || "Create login failed", "error");
  }
});

signOutButton.addEventListener("click", async () => {
  try {
    await signOut();
  } catch (error) {
    setCloudStatus(error.message || "Sign out failed", "error");
  }
});

document.querySelector("#copyShoppingList").addEventListener("click", async () => {
  const button = document.querySelector("#copyShoppingList");
  const text = [...shoppingList.querySelectorAll('.shopping-section[data-kind="need"] .shopping-item')]
    .map((item) => item.dataset.label)
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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushAutoSync({ once: true });
  }
});

window.addEventListener("pagehide", () => {
  flushAutoSync({ once: true });
});

setDefaultPlanDate();
render();
initializeAuth();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}
