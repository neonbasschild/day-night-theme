# Day/Night Theme Switcher — FoundryVTT Module

Automatically switches the Foundry UI between **dark** (night) and **light** (day) themes based on the **actual in-game sunrise and sunset times** provided by [Calendaria](https://github.com/Sayshal/Calendaria).

This means the threshold shifts with the season, the active calendar (Gregorian, Harptos, Exandria, etc.), and the climate zone of the current scene — not a hardcoded clock time.

---

## Requirements

| Module | Version |
|---|---|
| [Calendaria](https://foundryvtt.com/packages/calendaria) | Latest |
| Foundry VTT | v12+ (v13 verified) |

---

## Installation

1. Copy the `day-night-theme/` folder into `Data/modules/`.
2. In Foundry, go to **Add-on Modules** and enable **Day/Night Theme Switcher**.
3. Make sure **Calendaria** is also enabled.

---

## How It Works

On every in-game time change Calendaria fires the `calendaria.dateTimeChange` hook.  
The module then calls:

```js
const sunrise = CALENDARIA.api.getSunrise(); // e.g. 6.25 → 06:15
const sunset  = CALENDARIA.api.getSunset();  // e.g. 19.5 → 19:30
```

These values are derived from the active calendar's seasonal model and the active scene's configured climate zone.  The current in-game time (in decimal hours) is compared against them:

- `sunrise ≤ currentTime < sunset` → **light theme** (day)
- otherwise → **dark theme** (night)

The GM's client performs this check and (optionally) broadcasts the result to all connected players via Foundry's socket, so everyone's UI switches at the same moment.

---

## Settings

| Setting | Scope | Default | Description |
|---|---|---|---|
| Transition Duration (ms) | Client | 1500 | CSS crossfade speed. Set to 0 to disable. |
| Apply to All Players | World | true | Socket-broadcast theme to all connected clients |
| Show Notifications | Client | false | Show a brief UI popup when the theme switches |

---

## Fallback Behaviour

If Calendaria is not loaded (e.g. disabled for testing), the module falls back to `updateWorldTime` + a static 06:00 sunrise / 20:00 sunset. A console warning is shown.

---

## Customising the Palette

The module adds `dnt-day` or `dnt-night` to `<body>`.  All colours are CSS custom properties in `styles/day-night-theme.css`.  Override any variable in your own world styles:

```css
/* Make daytime backgrounds cooler/bluer */
body.dnt-day {
  --color-bg: #eef0f4;
}
```

---

## Calendaria Climate Zones

Calendaria lets you assign a **climate zone** to each scene (Arctic, Temperate, Desert, Tropical, etc.).  The zone affects the sunrise/sunset calculation — arctic summers have very short nights, desert campaigns near the equator have consistent 12-hour days, etc.

Configure zones in **Scene Configuration → Calendaria tab** within Calendaria's settings.

---

## Troubleshooting

**Players don't switch theme.**  
→ Make sure *Apply to All Players* is on, and the GM's Foundry tab is open.

**Theme never changes despite time advancing.**  
→ Confirm Calendaria is active and `CALENDARIA.api` is accessible in the browser console.  
→ Check that the scene has a climate zone configured in Calendaria if you expect seasonal variation.

**CSS conflicts with another theme module.**  
→ Increase selector specificity in `day-night-theme.css`, e.g. `body.dnt-night.dnt-night { … }`.
