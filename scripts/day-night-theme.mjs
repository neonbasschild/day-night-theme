/**
 * Day/Night Theme Switcher for Foundry VTT
 * Requires: Calendaria (https://github.com/Sayshal/Calendaria)
 *
 * Uses CALENDARIA.api.getSunrise() / getSunset() for accurate, calendar-aware
 * sunrise/sunset times — meaning they change with the season, calendar config,
 * and climate zone of the active scene.
 *
 * Theme strategy (v13) — two complementary layers:
 *
 *   1. Native uiConfig (character sheets & all ApplicationV2 windows)
 *      Foundry v13 stores the UI colour scheme in the `core.uiConfig` client
 *      setting under `colorScheme.applications` and `colorScheme.interface`.
 *      Setting these to "dark" / "light" is what drives the `theme-dark` /
 *      `theme-light` classes that ApplicationV2 windows (including all
 *      character sheets) read for their internal styling.
 *      This is a CLIENT-scope setting, so each user must apply it themselves —
 *      it cannot be set for another player via a socket.
 *
 *   2. Body class + CSS variables (legacy App V1 windows & custom chrome)
 *      Toggles `dnt-day` / `dnt-night` on <body> and re-declares Foundry's
 *      CSS custom properties inside those selectors.  This covers sidebar,
 *      navigation, hotbar, and any App V1 sheets that haven't migrated yet.
 *
 * Socket strategy:
 *   The GM calculates the period and broadcasts it.  Every client (including
 *   the GM) applies BOTH layers locally when it receives the message.
 *   Because uiConfig is client-scope, each client writes its own copy.
 */

const MODULE_ID    = "day-night-theme";
const SOCKET_EVENT = `module.${MODULE_ID}`;

// ─── Settings keys ─────────────────────────────────────────────────────────────

const S = {
  TRANSITION_DURATION: "transitionDuration",
  APPLY_TO_PLAYERS:    "applyToPlayers",
  NOTIFY_CHANGES:      "notifyChanges",
};

// ─── State ─────────────────────────────────────────────────────────────────────

let _lastPeriod = null;   // "day" | "night" — avoids redundant re-applies

// ─── Calendaria helpers ────────────────────────────────────────────────────────

/**
 * Ask Calendaria for today's sunrise and sunset, then determine if the current
 * in-game time falls between them.
 *
 * CALENDARIA.api.getSunrise() / getSunset() return the time in decimal hours
 * (e.g. 6.5 = 06:30).  They respect the active calendar's seasonal model and
 * the active scene's climate zone.
 *
 * Falls back to static 6/20 if Calendaria is not yet ready.
 *
 * @returns {"day"|"night"}
 */
function calcPeriod() {
  const api = globalThis.CALENDARIA?.api;

  if (!api) {
    // Calendaria not loaded — fall back to core game.time
    const hour = game.time?.components?.hour ?? 0;
    return (hour >= 6 && hour < 20) ? "day" : "night";
  }

  // getSunrise/getSunset return decimal hours, e.g. 6.5 = 6h30m
  const sunrise = api.getSunrise() ?? 6;
  const sunset  = api.getSunset()  ?? 20;

  // Current time as decimal hours (including fractional minutes)
  const now     = api.getCurrentDateTime();
  const currentDecimal = now.hour + (now.minute / 60) + (now.second / 3600);

  // Normal case: sunrise < sunset  (e.g. 6.5 → 19.75)
  if (sunrise <= sunset) {
    return (currentDecimal >= sunrise && currentDecimal < sunset) ? "day" : "night";
  }

  // Edge case: sunrise > sunset would imply a polar / inverted calendar
  return (currentDecimal >= sunrise || currentDecimal < sunset) ? "day" : "night";
}

// ─── Theme application ─────────────────────────────────────────────────────────

/**
 * Apply (or update) the theme for this client.
 *
 * Two layers are updated:
 *   A) Foundry's native `core.uiConfig` colorScheme — controls ApplicationV2
 *      windows (character sheets, item sheets, journals, etc.)
 *   B) Body CSS class (`dnt-day` / `dnt-night`) — controls App V1 windows,
 *      sidebar, navigation, and any chrome not covered by uiConfig.
 *
 * @param {"day"|"night"} period
 * @param {boolean} [force=false]  Apply even if period hasn't changed
 */
async function applyTheme(period, force = false) {
  if (!force && period === _lastPeriod) return;
  _lastPeriod = period;

  const isNight  = period === "night";
  const scheme   = isNight ? "dark" : "light";
  const duration = game.settings.get(MODULE_ID, S.TRANSITION_DURATION);

  // ── Layer A: Foundry v13 native ApplicationV2 theming ──────────────────────
  // uiConfig is a client-scope setting.  Writing it triggers Foundry's internal
  // _onChangeColorScheme handler, which adds/removes `theme-dark` / `theme-light`
  // on every open ApplicationV2 window element — including all character sheets.
  try {
    const uiConfig = game.settings.get("core", "uiConfig");
    // Only write if the value actually differs to avoid unnecessary re-renders
    if (
      uiConfig.colorScheme?.applications !== scheme ||
      uiConfig.colorScheme?.interface    !== scheme
    ) {
      uiConfig.colorScheme ??= {};
      uiConfig.colorScheme.applications = scheme;
      uiConfig.colorScheme.interface    = scheme;
      // Use set() so Foundry fires its own onChange handler for window re-theming
      await game.settings.set("core", "uiConfig", uiConfig);
    }
  } catch (err) {
    // uiConfig may not exist in very old versions — not fatal
    console.warn(`${MODULE_ID} | Could not update uiConfig colorScheme:`, err);
  }

  // ── Layer B: Body class for CSS-variable palette swap ──────────────────────
  // Covers the sidebar, navigation bar, hotbar, and legacy App V1 windows.
  const body = document.body;
  body.style.setProperty("--dnt-transition", `${duration}ms`);

  if (isNight) {
    body.classList.add("dnt-night");
    body.classList.remove("dnt-day");
  } else {
    body.classList.add("dnt-day");
    body.classList.remove("dnt-night");
  }

  // ── Notification ───────────────────────────────────────────────────────────
  const shouldNotify = game.settings.get(MODULE_ID, S.NOTIFY_CHANGES);
  if (shouldNotify) {
    const key = isNight ? "DAYNIGHT.NotifyNight" : "DAYNIGHT.NotifyDay";
    ui.notifications?.info(game.i18n.localize(key));
  }
}

// ─── Socket ────────────────────────────────────────────────────────────────────

function registerSocket() {
  // Each non-GM client receives the period from the GM and applies both
  // theming layers (uiConfig + body class) locally on their own client.
  game.socket.on(SOCKET_EVENT, ({ period }) => {
    applyTheme(period).catch(console.error);
  });
}

/**
 * Called by the GM on every time change.
 * Calculates the period and — if it changed — broadcasts + applies.
 */
async function onTimeChange() {
  if (!game.user.isGM) return;

  const period    = calcPeriod();
  const broadcast = game.settings.get(MODULE_ID, S.APPLY_TO_PLAYERS);

  if (broadcast) {
    // Tell all non-GM clients what period it is so they can update their
    // own uiConfig and body class.
    game.socket.emit(SOCKET_EVENT, { period });
  }

  // GM applies to itself (socket doesn't echo back to the emitter)
  await applyTheme(period);
}

// ─── Settings ──────────────────────────────────────────────────────────────────

function registerSettings() {
  game.settings.register(MODULE_ID, S.TRANSITION_DURATION, {
    name:    game.i18n.localize("DAYNIGHT.SettingTransitionDuration"),
    hint:    game.i18n.localize("DAYNIGHT.SettingTransitionDurationHint"),
    scope:   "client",
    config:  true,
    type:    Number,
    default: 1500,
    range:   { min: 0, max: 5000, step: 100 },
  });

  game.settings.register(MODULE_ID, S.APPLY_TO_PLAYERS, {
    name:    game.i18n.localize("DAYNIGHT.SettingApplyToPlayers"),
    hint:    game.i18n.localize("DAYNIGHT.SettingApplyToPlayersHint"),
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, S.NOTIFY_CHANGES, {
    name:    game.i18n.localize("DAYNIGHT.SettingNotifyChanges"),
    hint:    game.i18n.localize("DAYNIGHT.SettingNotifyChangesHint"),
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: false,
  });
}

// ─── Hooks ─────────────────────────────────────────────────────────────────────

Hooks.once("init", () => {
  registerSettings();
  console.log(`${MODULE_ID} | Initialised`);
});

Hooks.once("ready", () => {
  registerSocket();

  // ── Calendaria primary hook ───────────────────────────────────────────────
  Hooks.on("calendaria.dateTimeChange", (_data) => {
    onTimeChange().catch(console.error);
  });

  // ── Fallback: core updateWorldTime ────────────────────────────────────────
  if (!globalThis.CALENDARIA) {
    console.warn(`${MODULE_ID} | Calendaria not found — falling back to updateWorldTime hook with static 06:00/20:00 sunrise/sunset.`);
    Hooks.on("updateWorldTime", () => {
      onTimeChange().catch(console.error);
    });
  }

  // Apply the correct theme immediately on load
  applyTheme(calcPeriod(), true).catch(console.error);

  // Re-evaluate when the calendar is swapped mid-session
  Hooks.on("calendaria.calendarSwitched", () => {
    _lastPeriod = null;
    onTimeChange().catch(console.error);
  });

  console.log(`${MODULE_ID} | Ready — using ${globalThis.CALENDARIA ? "Calendaria" : "fallback"} sunrise/sunset`);
});
