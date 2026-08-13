# STMPE-Enriched

A companion **userscript** for the [STMPE-v2](https://high-guy-uk.github.io/STMPE-v2/) dark theme. Where STMPE-v2 restyles your website, STMPE-Enriched *adds* to it — a bundle of tools that enrich the TV series experience, all managed from a single panel on your profile settings page.

Everything is modular: each feature has its own on/off switch, so you can run the whole set or just the parts you want.

---

## Install

1. Install a userscript manager — [Tampermonkey](https://www.tampermonkey.net/) (recommended) or Violentmonkey.
2. Click the raw script link to install it:

   **https://high-guy-uk.github.io/STMPE-v2/STMPE-Enriched.user.js**

3. Your userscript manager will open an install tab — confirm the install.

The script is served from GitHub Pages and carries its own update URL, so your userscript manager will pull new versions automatically.

> Pairs best with the STMPE-v2 stylesheet. The script reads the theme's colour variables, so it blends into the same look; it still renders fine on its own if the theme isn't loaded.

---

## The Userscript Manager

Open your **profile settings page** and you'll find two new panels:

- **Userscript Manager** — a switch for every feature, plus a text slot for any API keys a feature needs.
- **Sonarr Settings** — the multi-server Sonarr configuration (see below).

Toggle a feature off and it simply stops running; your settings are kept.

### API keys

A few features pull artwork and metadata from public APIs. Keys are entered as plain text (never as a password field, so your browser's password manager won't nag you), and sensible defaults are baked in — you only need to change them if you want to use your own:

- **Fanart.tv API key** — used by the logo and artwork features.
- **TMDb API key** — used by the trending, cast, trailer and summary features.

---

## Features

### Sonarr Integration
Configure one or more Sonarr servers (URL + API key), test the connection, and pick a default quality profile, root folder and monitor option per server. On a series page each server shows up as a small colour-coded link on the actions bar — **green** if the show is already in that server's library (click to open it in Sonarr), **red** if it isn't (click to add it in one step via a themed dialog). No configuration leaks into the page; it all lives in the settings panel.

### Fanart.tv Logo
Fetches the show's HD clear logo from Fanart.tv and places it at the top of the series sidebar.

### IMDb Parents Guide
Adds a colour-coded Parents Guide below the listings on a series page — nudity, violence, profanity, alcohol and frightening content, each as a severity-graded card with the top notes, vote bars, spoiler blur and a UK certificate badge. Collapsed by default, cached for 7 days.

### Trending Shows
Adds a row of today's trending TV shows (from TMDb) to the top of the homepage, each linking through to a search for that title on your website.

### Artwork Placeholders
Replaces the site's default "no poster / no banner / no fan art" images with a clean placeholder that matches the theme — a dark gradient, a subtle glyph and the show's title — everywhere those defaults appear, including small thumbnails in listings.

### Hide Empty Requests
Hides the Requests section on a series page when there are no open requests, so the empty block doesn't take up space.

### Collapse Old Seasons
Automatically collapses every season except the most recent on a series page, and makes the built-in show/hide links actually work again so you can expand any season you like.

### Trailer Player (fixed)
Replaces the site's broken trailer embed with a clean pop-up YouTube player. It intercepts the play button, restores the referrer the site strips (the cause of YouTube's "Error 153"), and plays the trailer in a themed modal you can close with the ✕, the backdrop, or Esc. If your website has no trailer for a show, it looks one up on TMDb instead.

### Cast Row (TMDb)
Replaces the plain sidebar cast list with a horizontal cast row above the fan art — photos and character names from TMDb — while every actor still links to their page on your website.

### Enhanced Series Summary
Folds the sidebar **Latest Episode**, **Next Episode** and **Genres** panels into the main Series Summary card and enriches it with TMDb data: a chip strip of rating, status, network, run years and season/episode counts, plus episode blocks with stills, air dates and a countdown to the next episode. The original description and external links are kept, and the broken trailer card is hidden from the sidebar.

### Stamps Row
Moves the stamps panel out of the sidebar into a long horizontal row across the bottom of the main column.

### Fan Art Carousels
Fills the fan art card with artwork from Fanart.tv — backgrounds and banners — as controllable single-image carousels with previous/next arrows, a counter and a link to the full-resolution image.

---

## Notes

- **Where things run.** Most features act on series pages; Trending runs on the homepage; the settings panels appear on your profile settings page; the artwork placeholders run site-wide.
- **Privacy.** API requests go directly to the public services (TMDb, Fanart.tv, IMDb's public data, and your own Sonarr servers). Nothing is sent anywhere else.
- **Author.** Prism16 — a combination of userscripts brought together and restyled to fit the STMPE look.

## License

Personal project — use and adapt freely.
