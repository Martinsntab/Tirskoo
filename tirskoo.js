#!/usr/bin/env node
/**
 * Tirskoo — single-file edition.
 *
 * The entire app lives in this one file on purpose: there are no folders to
 * preserve when uploading, and no npm packages to install. It runs on Node's
 * built-in modules only (node:http, node:sqlite, node:crypto), so the whole
 * deployment is literally "node tirskoo.js".
 *
 * Requires Node 22.5 or newer (for node:sqlite).
 *
 * Configuration is via environment variables — see README.md:
 *   PORT, BASE_URL, SESSION_SECRET, RESEND_API_KEY, EMAIL_FROM,
 *   CRON_SECRET, ENABLE_IN_PROCESS_DIGEST, DATABASE_PATH, NODE_ENV
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';
import { fileURLToPath } from 'node:url';

// =====================================================================
// Stylesheet (inlined so this file has no external assets)
// =====================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STYLE_CSS = "/* Tirskoo — light & dark, mobile-first. No frameworks, no build step. */\n\n:root {\n  color-scheme: light;\n\n  /* surfaces & ink */\n  --plane: #f9f9f7;\n  --surface: #fcfcfb;\n  --surface-2: #f2f2ef;\n  --ink: #0b0b0b;\n  --ink-2: #52514e;\n  --muted: #898781;\n  --hairline: rgba(11, 11, 11, 0.10);\n  --rule: #e1e0d9;\n\n  /* accent (blue, categorical slot 1 / sequential hue) */\n  --accent: #2a78d6;\n  --accent-strong: #256abf;\n  --accent-ink: #ffffff;\n  --accent-wash: #eaf2fd;\n  --meter-track: #cde2fb;\n\n  /* status — fixed roles, always paired with a written label */\n  --good: #0ca30c;\n  --warning: #fab219;\n  --serious: #ec835a;\n  --critical: #d03b3b;\n\n  --good-wash: #e6f6e6;\n  --good-ink: #085f08;\n  --warning-wash: #fdf0d5;\n  --warning-ink: #6b4906;\n  --serious-wash: #fceee7;\n  --serious-ink: #7c3d1e;\n  --critical-wash: #fbe9e9;\n  --critical-ink: #8e2020;\n  --neutral-wash: #eeeeea;\n\n  --radius: 14px;\n  --radius-sm: 10px;\n  --shadow: 0 1px 2px rgba(11, 11, 11, 0.05);\n  --shadow-lift: 0 6px 20px rgba(11, 11, 11, 0.09);\n\n  /* one timing for everything, so motion feels like a single system */\n  --t: 160ms cubic-bezier(0.2, 0, 0.2, 1);\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n    color-scheme: dark;\n    --plane: #0d0d0d;\n    --surface: #1a1a19;\n    --surface-2: #232322;\n    --ink: #ffffff;\n    --ink-2: #c3c2b7;\n    --muted: #898781;\n    --hairline: rgba(255, 255, 255, 0.10);\n    --rule: #2c2c2a;\n\n    --accent: #3987e5;\n    --accent-strong: #5598e7;\n    --accent-ink: #06121f;\n    --accent-wash: #17283c;\n    --meter-track: #16304f;\n\n    --good-wash: #102b10;\n    --good-ink: #7fd77f;\n    --warning-wash: #33280c;\n    --warning-ink: #f4c95f;\n    --serious-wash: #35211a;\n    --serious-ink: #f0a483;\n    --critical-wash: #351718;\n    --critical-ink: #f08f8f;\n    --neutral-wash: #262624;\n    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4);\n    --shadow-lift: 0 6px 20px rgba(0, 0, 0, 0.55);\n  }\n}\n\n/* Everything below animates. Anyone who has asked their device to reduce\n   motion gets the same interface with the movement switched off. */\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    animation-duration: 0.01ms !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: 0.01ms !important;\n  }\n}\n\n@keyframes rise {\n  from { opacity: 0; transform: translateY(8px); }\n  to   { opacity: 1; transform: none; }\n}\n@keyframes fill {\n  from { transform: scaleX(0); }\n  to   { transform: scaleX(1); }\n}\n\n* { box-sizing: border-box; }\n\nhtml, body {\n  margin: 0;\n  padding: 0;\n  background: var(--plane);\n  color: var(--ink);\n  font-family: system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif;\n  -webkit-text-size-adjust: 100%;\n  line-height: 1.45;\n}\n\na { color: var(--accent); text-decoration: none; }\na:hover { text-decoration: underline; }\n\n/* ---------- top bar ---------- */\n\n.topbar {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  padding: 12px 16px;\n  background: var(--surface);\n  border-bottom: 1px solid var(--hairline);\n  position: sticky;\n  top: 0;\n  z-index: 20;\n}\n.brand {\n  font-weight: 680;\n  font-size: 1.05rem;\n  color: var(--ink);\n  letter-spacing: -0.01em;\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n}\n.brand-dot {\n  width: 10px; height: 10px; border-radius: 50%;\n  background: var(--accent);\n  flex: none;\n}\n.topbar .inline-form { display: flex; align-items: center; gap: 8px; margin: 0; }\n.topbar .me {\n  color: var(--ink-2); font-size: 0.8rem;\n  max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n}\n\n.container { max-width: 660px; margin: 0 auto; padding: 18px 16px 80px; }\n.container.wide { max-width: 1040px; }\n\n/* ---------- cards & type ---------- */\n\n.card {\n  background: var(--surface);\n  border: 1px solid var(--hairline);\n  border-radius: var(--radius);\n  padding: 18px;\n  margin-bottom: 16px;\n  box-shadow: var(--shadow);\n  animation: rise 300ms cubic-bezier(0.2, 0, 0.2, 1) both;\n}\n\nh1 { font-size: 1.35rem; margin: 0 0 6px; letter-spacing: -0.02em; }\nh2 { font-size: 0.95rem; margin: 0 0 12px; letter-spacing: -0.01em; }\n.muted { color: var(--muted); }\n.small { font-size: 0.82rem; }\n\n.section-title {\n  display: flex; align-items: center; gap: 8px;\n  font-size: 0.78rem; font-weight: 700; letter-spacing: 0.06em;\n  text-transform: uppercase; color: var(--muted);\n  margin: 0 0 10px;\n}\n\n/* ---------- sign-in ---------- */\n\n.auth-card { margin-top: 8vh; text-align: center; }\n.auth-card h1 { font-size: 1.7rem; }\n.auth-lede { color: var(--ink-2); margin: 0 0 20px; }\n\n/* ---------- forms ---------- */\n\n.stacked-form { display: flex; flex-direction: column; gap: 4px; text-align: left; }\n.stacked-form.tight { margin-top: 10px; }\n.stacked-form label { font-size: 0.82rem; font-weight: 620; margin-top: 10px; color: var(--ink-2); }\n.stacked-form input[type=\"text\"],\n.stacked-form input[type=\"email\"],\n.stacked-form input[type=\"password\"],\n.stacked-form input[type=\"date\"],\n.stacked-form input[type=\"number\"],\n.stacked-form textarea {\n  padding: 12px;\n  border: 1px solid var(--rule);\n  border-radius: var(--radius-sm);\n  font-size: 1rem;\n  font-family: inherit;\n  width: 100%;\n  background: var(--plane);\n  color: var(--ink);\n}\n.stacked-form input:focus-visible,\n.stacked-form textarea:focus-visible,\n.btn:focus-visible, .switch:focus-visible, .link-btn:focus-visible {\n  outline: 2px solid var(--accent);\n  outline-offset: 2px;\n}\n.stacked-form textarea { min-height: 76px; resize: vertical; }\n\n.radio-group { border: none; padding: 0; margin: 12px 0 0; }\n.radio-group legend { font-size: 0.82rem; font-weight: 620; padding: 0; color: var(--ink-2); }\n.radio-option, .checkbox-option {\n  display: flex; align-items: center; gap: 10px;\n  font-size: 0.95rem; padding: 9px 0; cursor: pointer;\n}\n.radio-option input, .checkbox-option input { accent-color: var(--accent); width: 18px; height: 18px; }\n\n/* switch-styled checkbox (no JS) */\n.switch-row {\n  display: flex; align-items: center; justify-content: space-between;\n  gap: 12px; padding: 12px 0 4px; cursor: pointer; font-size: 0.95rem;\n}\n.switch-row input { position: absolute; opacity: 0; pointer-events: none; }\n.switch-track {\n  flex: none; width: 46px; height: 27px; border-radius: 999px;\n  background: var(--rule); position: relative; transition: background 0.15s ease;\n}\n.switch-track::after {\n  content: \"\"; position: absolute; top: 3px; left: 3px;\n  width: 21px; height: 21px; border-radius: 50%;\n  background: var(--surface); box-shadow: 0 1px 2px rgba(0,0,0,0.25);\n  transition: transform 0.15s ease;\n}\n.switch-row input:checked + .switch-track { background: var(--critical); }\n.switch-row input:checked + .switch-track::after { transform: translateX(19px); }\n.switch-row input:focus-visible + .switch-track { outline: 2px solid var(--accent); outline-offset: 2px; }\n\n/* ---------- buttons ---------- */\n\n.btn {\n  display: inline-flex; align-items: center; justify-content: center; gap: 6px;\n  min-height: 44px; padding: 10px 16px;\n  border-radius: var(--radius-sm); border: 1px solid transparent;\n  font-size: 0.95rem; font-weight: 620; font-family: inherit;\n  cursor: pointer; background: var(--surface); color: var(--ink);\n  transition: background var(--t), transform var(--t), box-shadow var(--t), filter var(--t);\n}\n.btn:hover { transform: translateY(-1px); }\n.btn:active { transform: translateY(0) scale(0.985); }\n.btn-primary:hover { box-shadow: 0 4px 14px rgba(42, 120, 214, 0.35); }\n.btn-block { width: 100%; margin-top: 14px; }\n.btn-primary { background: var(--accent); color: var(--accent-ink); }\n.btn-primary:hover { background: var(--accent-strong); }\n.btn-ghost { background: var(--surface); border-color: var(--rule); color: var(--ink); }\n.btn-ghost:hover { background: var(--surface-2); }\n.btn-small { min-height: 38px; padding: 7px 13px; font-size: 0.85rem; }\n.link-btn {\n  background: none; border: none; color: var(--accent);\n  font-size: 0.82rem; cursor: pointer; padding: 6px; font-family: inherit;\n}\n.inline-form { display: inline-block; margin: 6px 6px 0 0; }\n\n/* urgent toggle rendered as a switch, but it's a real submit button (no JS) */\n.switch {\n  display: inline-flex; align-items: center; gap: 9px;\n  background: none; border: none; cursor: pointer; padding: 6px 0;\n  font-size: 0.82rem; font-weight: 600; color: var(--ink-2); font-family: inherit;\n}\n.switch .track {\n  width: 38px; height: 22px; border-radius: 999px; background: var(--rule);\n  position: relative; flex: none; transition: background 0.15s ease;\n}\n.switch .track::after {\n  content: \"\"; position: absolute; top: 3px; left: 3px;\n  width: 16px; height: 16px; border-radius: 50%; background: var(--surface);\n  box-shadow: 0 1px 2px rgba(0,0,0,0.25); transition: transform 0.15s ease;\n}\n.switch[aria-pressed=\"true\"] .track { background: var(--critical); }\n.switch[aria-pressed=\"true\"] .track::after { transform: translateX(16px); }\n.switch[aria-pressed=\"true\"] { color: var(--critical-ink); }\n\n/* ---------- alerts ---------- */\n\n.alert {\n  padding: 12px 14px; border-radius: var(--radius-sm);\n  margin-bottom: 14px; font-size: 0.9rem; border: 1px solid transparent;\n}\n.alert-error { background: var(--critical-wash); color: var(--critical-ink); border-color: var(--hairline); }\n.alert-notice { background: var(--accent-wash); color: var(--ink); border-color: var(--hairline); }\n.dev-box {\n  background: var(--warning-wash); color: var(--warning-ink);\n  border: 1px dashed var(--warning); border-radius: var(--radius-sm);\n  padding: 14px; margin-top: 12px; font-size: 0.85rem; word-break: break-all; text-align: left;\n}\n.dev-box a { color: inherit; text-decoration: underline; font-weight: 600; }\n\n/* ---------- avatars ---------- */\n\n.avatar {\n  width: 30px; height: 30px; border-radius: 50%; flex: none;\n  display: inline-flex; align-items: center; justify-content: center;\n  font-size: 0.76rem; font-weight: 700; letter-spacing: 0.02em;\n  background: var(--accent-wash); color: var(--accent-strong);\n  border: 1px solid var(--hairline); text-transform: uppercase;\n}\n.avatar-sm { width: 24px; height: 24px; font-size: 0.66rem; }\n\n/* ---------- pair list (dashboard) ---------- */\n\n.pair-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }\n.pair-row {\n  border: 1px solid var(--hairline); border-radius: var(--radius);\n  background: var(--surface); padding: 0;\n}\n.pair-row.pending { padding: 14px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }\n.pair-row { transition: box-shadow var(--t), transform var(--t), border-color var(--t); }\n.pair-row:hover { box-shadow: var(--shadow-lift); transform: translateY(-2px); border-color: var(--accent); }\n.pair-link { display: block; padding: 14px; color: var(--ink); border-radius: var(--radius); }\n.pair-link:hover { text-decoration: none; }\n.pair-list > li { animation: rise 260ms cubic-bezier(0.2, 0, 0.2, 1) both; }\n.pair-list > li:nth-child(2) { animation-delay: 50ms; }\n.pair-list > li:nth-child(3) { animation-delay: 100ms; }\n.pair-list > li:nth-child(n+4) { animation-delay: 140ms; }\n.pair-top { display: flex; align-items: center; gap: 10px; }\n.pair-who { flex: 1; min-width: 0; }\n.pair-arrow { font-weight: 640; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.pair-sub { color: var(--muted); font-size: 0.8rem; }\n.chev { color: var(--muted); flex: none; }\n\n/* ---------- meter (single ratio against a limit) ---------- */\n\n.meter {\n  height: 6px; border-radius: 999px; background: var(--meter-track);\n  overflow: hidden; margin-top: 10px;\n}\n.meter > span {\n  display: block; height: 100%; background: var(--accent); border-radius: 999px;\n  transform-origin: left center;\n  animation: fill 620ms cubic-bezier(0.2, 0, 0.2, 1) both;\n}\n.meter-row {\n  display: flex; align-items: center; justify-content: space-between;\n  gap: 10px; margin-top: 8px; font-size: 0.8rem; color: var(--ink-2);\n}\n.counts { display: flex; gap: 6px; flex-wrap: wrap; }\n.count-chip {\n  display: inline-flex; align-items: center; gap: 5px;\n  background: var(--neutral-wash); color: var(--ink-2);\n  border-radius: 999px; padding: 2px 9px; font-size: 0.76rem; font-weight: 600;\n}\n.count-chip.is-critical { background: var(--critical-wash); color: var(--critical-ink); }\n.count-chip.is-warning { background: var(--warning-wash); color: var(--warning-ink); }\n.count-chip .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }\n\n/* ---------- badges ---------- */\n\n.badge {\n  display: inline-flex; align-items: center; gap: 5px;\n  padding: 3px 9px; border-radius: 999px;\n  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;\n  background: var(--neutral-wash); color: var(--ink-2); white-space: nowrap;\n}\n.badge .dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }\n.badge-delegator { background: var(--accent-wash); color: var(--accent-strong); }\n.badge-doer { background: var(--good-wash); color: var(--good-ink); }\n.badge-urgent { background: var(--critical-wash); color: var(--critical-ink); }\n.badge-urgent .dot { background: var(--critical); }\n.badge-stale { background: var(--warning-wash); color: var(--warning-ink); }\n.badge-stale .dot { background: var(--warning); }\n.badge-overdue { background: var(--serious-wash); color: var(--serious-ink); }\n.badge-overdue .dot { background: var(--serious); }\n.badge-self { background: var(--neutral-wash); color: var(--ink-2); }\n\n/* ---------- pair page header ---------- */\n\n.back-link { display: inline-block; margin-bottom: 12px; font-size: 0.88rem; color: var(--muted); }\n.pair-header { margin-bottom: 16px; }\n.pair-header-top { display: flex; align-items: flex-start; gap: 12px; }\n.pair-header-top .avatar { margin-top: 2px; }\n.pair-header h1 { margin: 0; }\n.pair-header .pair-sub { margin-top: 2px; }\n.pair-progress { margin-top: 14px; }\n\n.settings-details { margin-top: 12px; }\n.settings-details summary,\n.note-details summary,\n.history-details summary {\n  cursor: pointer; color: var(--accent); font-size: 0.82rem; font-weight: 600;\n  list-style: none; display: inline-flex; align-items: center; gap: 5px;\n}\n.settings-details summary::-webkit-details-marker,\n.note-details summary::-webkit-details-marker,\n.history-details summary::-webkit-details-marker { display: none; }\n.settings-details summary::before,\n.note-details summary::before,\n.history-details summary::before { content: \"▸\"; font-size: 0.7rem; }\n.settings-details[open] summary::before,\n.note-details[open] summary::before,\n.history-details[open] summary::before { content: \"▾\"; }\n\n/* ---------- add task ---------- */\n\n.add-task-details { margin-bottom: 20px; }\n.add-task-details > summary { list-style: none; cursor: pointer; }\n.add-task-details > summary::-webkit-details-marker { display: none; }\n.add-task-details[open] > summary { margin-bottom: 12px; background: var(--accent-strong); }\n.add-task-details form {\n  background: var(--surface); border: 1px solid var(--hairline);\n  border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow);\n}\n\n/* ---------- board ---------- */\n\n.board { display: grid; grid-template-columns: 1fr; gap: 22px; }\n@media (min-width: 780px) { .board { grid-template-columns: repeat(3, 1fr); align-items: start; } }\n\n.board-col h2 { display: flex; align-items: center; gap: 8px; }\n.board-col .count {\n  background: var(--neutral-wash); color: var(--ink-2); border-radius: 999px;\n  font-size: 0.72rem; padding: 1px 8px; font-weight: 700;\n}\n.col-mark { width: 8px; height: 8px; border-radius: 50%; flex: none; }\n.col-todo .col-mark { background: var(--muted); }\n.col-in_progress .col-mark { background: var(--accent); }\n.col-done .col-mark { background: var(--good); }\n.empty-col {\n  padding: 16px; border: 1px dashed var(--rule); border-radius: var(--radius);\n  text-align: center; color: var(--muted); font-size: 0.85rem;\n}\n\n.task-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }\n.task-card {\n  background: var(--surface); border: 1px solid var(--hairline);\n  border-radius: var(--radius); padding: 15px; box-shadow: var(--shadow);\n  border-left: 3px solid transparent;\n  transition: box-shadow var(--t), transform var(--t), border-color var(--t);\n  animation: rise 260ms cubic-bezier(0.2, 0, 0.2, 1) both;\n}\n.task-card:hover { box-shadow: var(--shadow-lift); transform: translateY(-2px); }\n/* stagger the first few cards in each column so a board settles in, rather\n   than appearing all at once */\n.task-list > li:nth-child(1) { animation-delay: 0ms; }\n.task-list > li:nth-child(2) { animation-delay: 40ms; }\n.task-list > li:nth-child(3) { animation-delay: 80ms; }\n.task-list > li:nth-child(4) { animation-delay: 120ms; }\n.task-list > li:nth-child(n+5) { animation-delay: 150ms; }\n.task-card.urgent { border-left-color: var(--critical); }\n.task-card.stale { border-left-color: var(--warning); }\n.task-card.is-done .task-title { color: var(--ink-2); }\n\n.task-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }\n.task-title { font-weight: 660; font-size: 0.98rem; letter-spacing: -0.01em; }\n.task-badges { display: flex; gap: 6px; flex-wrap: wrap; }\n.task-desc { margin: 8px 0 0; font-size: 0.89rem; color: var(--ink-2); }\n.task-meta { margin: 8px 0 0; font-size: 0.78rem; color: var(--muted); }\n.done-note {\n  background: var(--good-wash); color: var(--good-ink); border-radius: var(--radius-sm);\n  padding: 10px 12px; font-size: 0.86rem; margin: 10px 0 0;\n}\n.task-actions {\n  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;\n  margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--hairline);\n}\n\n.note-details, .history-details { margin-top: 10px; }\n.history-list {\n  list-style: none; margin: 10px 0 0; padding: 0; font-size: 0.8rem;\n  display: flex; flex-direction: column; gap: 8px;\n}\n.history-list li { border-left: 2px solid var(--rule); padding: 0 0 0 10px; }\n.history-when { color: var(--muted); }\n.history-what { font-weight: 600; }\n.history-note { font-style: italic; margin-top: 3px; color: var(--ink-2); }\n\n/* ---------- role clarity ---------- */\n\n.role-banner {\n  display: flex; flex-direction: column; gap: 2px;\n  border-radius: var(--radius); padding: 12px 14px; margin-top: 14px;\n  border: 1px solid var(--hairline); border-left-width: 3px;\n  background: var(--surface);\n}\n.role-title { font-weight: 680; font-size: 0.92rem; }\n.role-detail { font-size: 0.84rem; color: var(--ink-2); }\n.role-delegating { border-left-color: var(--accent); background: var(--accent-wash); }\n.role-doing { border-left-color: var(--good); background: var(--good-wash); }\n.role-doing .role-detail, .role-doing .role-title { color: var(--good-ink); }\n.role-shared { border-left-color: var(--muted); background: var(--neutral-wash); }\n\n.role-word { font-weight: 640; }\n.role-word.role-delegator { color: var(--accent-strong); }\n.role-word.role-doer { color: var(--good-ink); }\n.role-word.role-shared { color: var(--ink-2); }\n\n/* ---------- per-person notes ---------- */\n\n.notes { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }\n.note {\n  background: var(--surface-2); border-radius: var(--radius-sm);\n  padding: 9px 11px; font-size: 0.86rem;\n}\n.note-mine { background: var(--good-wash); }\n.note-head { display: flex; align-items: center; gap: 7px; margin-bottom: 4px; }\n.note-who { font-weight: 640; font-size: 0.8rem; }\n.note-when { margin-left: auto; }\n.note-body { color: var(--ink-2); }\n.note-mine .note-body, .note-mine .note-who { color: var(--good-ink); }\n\n/* ---------- invite code callout ---------- */\n\n.code-callout {\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 1.15rem; font-weight: 700; letter-spacing: 0.14em;\n  background: var(--surface); border: 1px dashed var(--accent);\n  border-radius: var(--radius-sm); padding: 10px 14px; display: inline-block; margin-top: 8px;\n}\n\n/* ---------- topics ---------- */\n\n.topic-row {\n  display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 12px;\n  margin-bottom: 8px; -webkit-overflow-scrolling: touch;\n  scrollbar-width: none;\n}\n.topic-row::-webkit-scrollbar { display: none; }\n.topic-chip {\n  display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;\n  padding: 7px 14px; border-radius: 999px; flex: none;\n  background: var(--surface); border: 1px solid var(--hairline);\n  color: var(--ink-2); font-size: 0.85rem; font-weight: 600;\n  transition: background var(--t), color var(--t), border-color var(--t), transform var(--t);\n}\n.topic-chip:hover { text-decoration: none; border-color: var(--accent); transform: translateY(-1px); }\n.topic-chip.is-active {\n  background: var(--accent); border-color: var(--accent); color: var(--accent-ink);\n}\n.topic-count {\n  background: var(--neutral-wash); color: var(--ink-2);\n  border-radius: 999px; padding: 0 7px; font-size: 0.72rem; font-weight: 700;\n}\n.topic-chip.is-active .topic-count { background: rgba(255,255,255,0.25); color: var(--accent-ink); }\n\n.badge-topic { background: var(--accent-wash); color: var(--accent-strong); text-transform: none; letter-spacing: 0; font-weight: 640; }\n\n.topic-manage { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; }\n.topic-manage li {\n  display: flex; align-items: center; justify-content: space-between; gap: 10px;\n  background: var(--surface-2); border-radius: var(--radius-sm); padding: 7px 12px; font-size: 0.88rem;\n}\n\n.stacked-form select {\n  padding: 12px; border: 1px solid var(--rule); border-radius: var(--radius-sm);\n  font-size: 1rem; font-family: inherit; width: 100%;\n  background: var(--plane); color: var(--ink);\n}\n\n/* ---------- archive / choice cards ---------- */\n\n.archived-details > summary {\n  cursor: pointer; color: var(--muted); font-size: 0.8rem; font-weight: 700;\n  letter-spacing: 0.06em; text-transform: uppercase; list-style: none;\n}\n.archived-details > summary::-webkit-details-marker { display: none; }\n.archived-details > summary::before { content: \"▸ \"; }\n.archived-details[open] > summary::before { content: \"▾ \"; }\n\n.choice-card { position: relative; border-left: 3px solid transparent; }\n.choice-card h2 { font-size: 1.1rem; margin-bottom: 6px; }\n.choice-body { font-size: 0.92rem; color: var(--ink-2); margin: 0 0 10px; }\n.choice-safe { border-left-color: var(--good); }\n.choice-danger { border-left-color: var(--critical); }\n.choice-tag {\n  display: inline-block; font-size: 0.68rem; font-weight: 800;\n  letter-spacing: 0.08em; text-transform: uppercase;\n  padding: 3px 9px; border-radius: 999px; margin-bottom: 10px;\n}\n.choice-tag-safe { background: var(--good-wash); color: var(--good-ink); }\n.choice-tag-danger { background: var(--critical-wash); color: var(--critical-ink); }\n\n/* ---------- destructive actions ---------- */\n\n.btn-danger { background: var(--critical); color: #fff; }\n.btn-danger:hover { filter: brightness(0.92); }\n.danger-link { color: var(--critical-ink); font-weight: 620; font-size: 0.85rem; }\n\n.danger-list {\n  display: flex; flex-direction: column; gap: 8px;\n  background: var(--critical-wash); color: var(--critical-ink);\n  border-radius: var(--radius-sm); padding: 14px; margin: 14px 0;\n  font-size: 0.88rem;\n}\n.danger-list div { display: flex; gap: 8px; align-items: baseline; }\n.danger-list div::before { content: \"×\"; font-weight: 700; flex: none; }\n\n.version-tag {\n  margin-top: 20px; font-size: 0.72rem; color: var(--muted);\n  letter-spacing: 0.08em; text-transform: uppercase;\n}\n\n.empty-state { text-align: center; padding: 26px 16px; color: var(--muted); }\n.empty-state strong { display: block; color: var(--ink); margin-bottom: 4px; font-size: 0.95rem; }\n";

// ====================================================================
// src/util.js
// ====================================================================

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toDate(iso) {
  if (!iso) return null;
  // SQLite datetime('now') gives "YYYY-MM-DD HH:MM:SS" (UTC, no offset marker).
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  return new Date(normalized);
}

function fmtDateTime(iso) {
  const d = toDate(iso);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = iso.length <= 10 ? new Date(iso + 'T00:00:00Z') : toDate(iso);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysSince(iso) {
  const d = toDate(iso);
  if (!d) return Infinity;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

function isOverdue(dueDate, status) {
  if (!dueDate || status === 'done') return false;
  const d = new Date(dueDate + 'T23:59:59Z');
  return Date.now() > d.getTime();
}

const STATUS_LABELS = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

const STATUS_ORDER = ['todo', 'in_progress', 'done'];

// ====================================================================
// src/db.js
// ====================================================================

// Storage layer. Uses Node's built-in node:sqlite (available from Node 22.5+),
// so the app runs with zero external dependencies.

const defaultDataDir = path.join(__dirname, 'data');
if (!fs.existsSync(defaultDataDir)) fs.mkdirSync(defaultDataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH && process.env.DATABASE_PATH.trim()
  ? process.env.DATABASE_PATH
  : path.join(defaultDataDir, 'app.db');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delegator_user_id INTEGER NOT NULL REFERENCES users(id),
  doer_user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending', -- pending | active
  invited_by_user_id INTEGER NOT NULL REFERENCES users(id),
  stale_days INTEGER NOT NULL DEFAULT 3,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(delegator_user_id, doer_user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id INTEGER NOT NULL REFERENCES pairs(id),
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'todo', -- todo | in_progress | done
  is_urgent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT,
  done_note TEXT
);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL, -- created | status_change | note | urgent_on | urgent_off
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_pair ON tasks(pair_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_pairs_delegator ON pairs(delegator_user_id);
CREATE INDEX IF NOT EXISTS idx_pairs_doer ON pairs(doer_user_id);
`);

// ---- migrations ------------------------------------------------------
// These run on every boot and must be safe against a database that already
// holds live data (Tirskoo keeps its SQLite file on a persistent volume).
// Each step checks whether it has already been applied.

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function addColumn(table, column, definition) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Passwords (added alongside the original magic-link sign-in).
addColumn('users', 'password_hash', 'TEXT');

// Relationship mode: 'delegated' (one person gives tasks, the other does
// them) or 'shared' (equal partners — both can do everything).
addColumn('pairs', 'mode', "TEXT NOT NULL DEFAULT 'delegated'");

// One-time code the inviter passes along out-of-band so a new person can
// claim their account without needing email delivery to work.
addColumn('pairs', 'invite_code', 'TEXT');

// One note per person per task — each person owns and edits only their own,
// so neither side can rewrite the other's record of what happened.
db.exec(`
CREATE TABLE IF NOT EXISTS task_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id);
`);

// Topics group tasks within a relationship (Mentorship, Career, Documents…).
// They belong to the pair, so each relationship keeps its own vocabulary.
db.exec(`
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id INTEGER NOT NULL REFERENCES pairs(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pair_id, name)
);
CREATE INDEX IF NOT EXISTS idx_topics_pair ON topics(pair_id);
`);

addColumn('tasks', 'topic_id', 'INTEGER REFERENCES topics(id)');

// Carry any pre-existing single done_note across to the new per-person
// notes table, attributed to the doer who wrote it. Runs once — the INSERT
// is skipped for tasks that already have a note row.
if (columnExists('tasks', 'done_note')) {
  db.exec(`
    INSERT OR IGNORE INTO task_notes (task_id, user_id, note, created_at, updated_at)
    SELECT t.id, p.doer_user_id, t.done_note,
           COALESCE(t.done_at, t.created_at), COALESCE(t.done_at, t.created_at)
    FROM tasks t
    JOIN pairs p ON p.id = t.pair_id
    WHERE t.done_note IS NOT NULL AND TRIM(t.done_note) != ''
  `);
}

// A tiny key/value table so the app can look after its own configuration
// instead of making the person deploying it set environment variables.
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/**
 * Read a stored setting, generating and saving it the first time. Used for
 * the session-signing secret: it is created once, kept in the database, and
 * reused on every later boot — so nobody has to generate or paste one.
 */
function getOrCreateSetting(key, generate) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  const value = generate();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

// ====================================================================
// src/auth.js
// ====================================================================

// Signed, stateless session cookies (HMAC-SHA256) and password hashing.
// No external libraries needed.
// The secret that signs sign-in cookies. If nobody supplies one, the app
// generates a strong random secret on first run and keeps it in its own
// database — so a fresh deployment is secure by default with nothing to
// configure. Setting SESSION_SECRET still overrides it.
const SECRET = process.env.SESSION_SECRET
  || getOrCreateSetting('session_secret', () => crypto.randomBytes(32).toString('hex'));

const SESSION_COOKIE = 'tsk_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const LOGIN_TOKEN_TTL_MS = 1000 * 60 * 15; // 15 minutes

function hmac(input) {
  return crypto.createHmac('sha256', SECRET).update(input).digest('base64url');
}

function sign(payloadObj) {
  const json = JSON.stringify(payloadObj);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = hmac(b64);
  return `${b64}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expected = hmac(b64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Short, human-readable invite code the inviter reads out or pastes into a
 * chat message. Excludes characters that get misread out loud (0/O, 1/I/L).
 */
function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// ---- password hashing (scrypt, from node:crypto — no dependencies) ----
// scrypt is deliberately slow and memory-hard, which is what makes a stolen
// database of hashes impractical to crack.

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt$${salt}$${derived.toString('hex')}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    if (!stored || typeof stored !== 'string') return resolve(false);
    const [scheme, salt, expectedHex] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !expectedHex) return resolve(false);
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS, (err, derived) => {
      if (err) return resolve(false);
      const expected = Buffer.from(expectedHex, 'hex');
      if (expected.length !== derived.length) return resolve(false);
      resolve(crypto.timingSafeEqual(expected, derived));
    });
  });
}

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (password.length > 200) return 'That password is too long.';
  return null;
}

/** True when a real email provider is configured, so links can actually arrive. */
function emailDeliveryConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// ====================================================================
// src/models.js
// ====================================================================

// Data-access helpers built on top of src/db.js. Keeping all SQL here keeps
// the route handlers focused on request/response and permission logic.
// ---- users -----------------------------------------------------------

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function findOrCreateUser(email) {
  const existing = findUserByEmail(email);
  if (existing) return existing;
  const info = db.prepare('INSERT INTO users (email) VALUES (?)').run(email);
  return findUserById(Number(info.lastInsertRowid));
}

function setUserPassword(userId, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

/**
 * A pending invite addressed to this email carrying this code. Used to let a
 * brand-new person claim their account without email delivery working.
 */
function findPendingInviteByCode(email, code) {
  return db.prepare(`
    SELECT p.* FROM pairs p
    JOIN users u ON u.id = p.delegator_user_id OR u.id = p.doer_user_id
    WHERE p.status = 'pending' AND UPPER(p.invite_code) = UPPER(?) AND u.email = ?
  `).get(code, email);
}

// ---- login tokens ------------------------------------------------------

function createLoginToken(userId, token, ttlMs) {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare('INSERT INTO login_tokens (user_id, token, expires_at) VALUES (?, ?, ?)')
    .run(userId, token, expiresAt);
}

function consumeLoginToken(token) {
  const row = db.prepare('SELECT * FROM login_tokens WHERE token = ?').get(token);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.used_at) return { ok: false, reason: 'used' };
  const expiresAtMs = new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime();
  if (Date.now() > expiresAtMs) return { ok: false, reason: 'expired' };
  db.prepare("UPDATE login_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
  return { ok: true, userId: row.user_id };
}

// ---- pairs ---------------------------------------------------------------

function createPair({ delegatorUserId, doerUserId, invitedByUserId, label, mode, inviteCode }) {
  return db.prepare(`
    INSERT INTO pairs (delegator_user_id, doer_user_id, invited_by_user_id, label, status, mode, invite_code)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(delegatorUserId, doerUserId, invitedByUserId, label || null,
         mode === 'shared' ? 'shared' : 'delegated', inviteCode || null);
}

function findPairBetween(delegatorUserId, doerUserId) {
  return db.prepare('SELECT * FROM pairs WHERE delegator_user_id = ? AND doer_user_id = ?')
    .get(delegatorUserId, doerUserId);
}

function getPairById(id) {
  return db.prepare(`
    SELECT p.*, ud.email AS delegator_email, uo.email AS doer_email
    FROM pairs p
    JOIN users ud ON ud.id = p.delegator_user_id
    JOIN users uo ON uo.id = p.doer_user_id
    WHERE p.id = ?
  `).get(id);
}

function listPairsForUser(userId) {
  return db.prepare(`
    SELECT p.*, ud.email AS delegator_email, uo.email AS doer_email
    FROM pairs p
    JOIN users ud ON ud.id = p.delegator_user_id
    JOIN users uo ON uo.id = p.doer_user_id
    WHERE p.delegator_user_id = ? OR p.doer_user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId, userId);
}

function setPairStatus(id, status) {
  db.prepare('UPDATE pairs SET status = ? WHERE id = ?').run(status, id);
}

function deletePair(id) {
  db.prepare('DELETE FROM pairs WHERE id = ?').run(id);
}

function updatePairSettings(id, { staleDays, label, mode }) {
  db.prepare('UPDATE pairs SET stale_days = ?, label = ?, mode = ? WHERE id = ?')
    .run(staleDays, label || null, mode === 'shared' ? 'shared' : 'delegated', id);
}

function clearInviteCode(id) {
  db.prepare('UPDATE pairs SET invite_code = NULL WHERE id = ?').run(id);
}

/**
 * Put a relationship away without losing anything. It drops off the active
 * dashboard, neither person can add to it, but the whole record stays and
 * can be brought back at any time.
 */
function archivePair(pairId) {
  db.prepare("UPDATE pairs SET status = 'archived' WHERE id = ?").run(pairId);
}

function restorePair(pairId) {
  db.prepare("UPDATE pairs SET status = 'active' WHERE id = ?").run(pairId);
}

/**
 * End a relationship and remove everything belonging to it. Children go
 * first so the foreign keys stay satisfied, and the whole thing runs in one
 * transaction so a failure part-way can't leave orphaned tasks behind.
 */
function disconnectPair(pairId) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM task_notes WHERE task_id IN (SELECT id FROM tasks WHERE pair_id = ?)').run(pairId);
    db.prepare('DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE pair_id = ?)').run(pairId);
    db.prepare('DELETE FROM tasks WHERE pair_id = ?').run(pairId);
    db.prepare('DELETE FROM topics WHERE pair_id = ?').run(pairId);
    db.prepare('DELETE FROM pairs WHERE id = ?').run(pairId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function roleInPair(pair, userId) {
  if (pair.delegator_user_id === userId) return 'delegator';
  if (pair.doer_user_id === userId) return 'doer';
  return null;
}

/**
 * Who may do what, given the relationship mode. In 'shared' mode the two
 * people are equals; in 'delegated' mode the doer owns the status column so
 * the record of what actually happened stays theirs.
 */
function permissionsFor(pair, role) {
  const shared = pair.mode === 'shared';
  return {
    shared,
    canAddTasks: true,
    canChangeStatus: shared || role === 'doer',
    canAddNotes: true,
    canToggleUrgentOwn: true,
  };
}

// ---- topics ----------------------------------------------------------

function listTopics(pairId) {
  return db.prepare('SELECT * FROM topics WHERE pair_id = ? ORDER BY name COLLATE NOCASE').all(pairId);
}

/** Find a topic by name within a pair, creating it if it's new. */
function findOrCreateTopic(pairId, rawName) {
  const name = (rawName || '').trim().slice(0, 40);
  if (!name) return null;
  const existing = db.prepare('SELECT * FROM topics WHERE pair_id = ? AND name = ? COLLATE NOCASE')
    .get(pairId, name);
  if (existing) return existing;
  const info = db.prepare('INSERT INTO topics (pair_id, name) VALUES (?, ?)').run(pairId, name);
  return db.prepare('SELECT * FROM topics WHERE id = ?').get(Number(info.lastInsertRowid));
}

function getTopic(pairId, topicId) {
  if (!topicId) return null;
  return db.prepare('SELECT * FROM topics WHERE id = ? AND pair_id = ?').get(topicId, pairId);
}

function deleteTopic(pairId, topicId) {
  db.prepare('UPDATE tasks SET topic_id = NULL WHERE topic_id = ? AND pair_id = ?').run(topicId, pairId);
  db.prepare('DELETE FROM topics WHERE id = ? AND pair_id = ?').run(topicId, pairId);
}

/** Task counts per topic, for the board's filter row. */
function topicCounts(pairId) {
  return db.prepare(`
    SELECT COALESCE(topic_id, 0) AS topic_id,
           COUNT(*) AS total,
           SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open
    FROM tasks WHERE pair_id = ? GROUP BY COALESCE(topic_id, 0)
  `).all(pairId);
}

// ---- tasks -----------------------------------------------------------

function createTask({ pairId, title, description, dueDate, createdByUserId, isUrgent, topicId }) {
  const info = db.prepare(`
    INSERT INTO tasks (pair_id, title, description, due_date, created_by_user_id, is_urgent, topic_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(pairId, title, description || null, dueDate || null, createdByUserId, isUrgent ? 1 : 0, topicId || null);
  const taskId = Number(info.lastInsertRowid);
  addTaskEvent({ taskId, actorUserId: createdByUserId, type: 'created', toStatus: 'todo' });
  if (isUrgent) {
    addTaskEvent({ taskId, actorUserId: createdByUserId, type: 'urgent_on' });
  }
  return taskId;
}

function getTaskById(id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

function listTasksForPair(pairId) {
  return db.prepare(`
    SELECT t.*, tp.name AS topic_name
    FROM tasks t LEFT JOIN topics tp ON tp.id = t.topic_id
    WHERE t.pair_id = ? ORDER BY t.created_at DESC
  `).all(pairId);
}

function setTaskTopic(taskId, topicId) {
  db.prepare('UPDATE tasks SET topic_id = ? WHERE id = ?').run(topicId || null, taskId);
}

function updateTaskStatus(taskId, { toStatus, actorUserId }) {
  const task = getTaskById(taskId);
  const fromStatus = task.status;
  const isDone = toStatus === 'done';
  db.prepare(`
    UPDATE tasks
    SET status = ?, status_changed_at = datetime('now'),
        done_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END
    WHERE id = ?
  `).run(toStatus, isDone ? 1 : 0, taskId);
  addTaskEvent({ taskId, actorUserId, type: 'status_change', fromStatus, toStatus });
}

/**
 * Save the acting user's own note on a task. Each person has exactly one
 * note per task and can only ever write their own — nobody can edit or
 * delete what the other person recorded.
 */
function saveMyNote(taskId, { note, actorUserId }) {
  const text = (note || '').trim();
  if (!text) {
    db.prepare('DELETE FROM task_notes WHERE task_id = ? AND user_id = ?').run(taskId, actorUserId);
  } else {
    db.prepare(`
      INSERT INTO task_notes (task_id, user_id, note) VALUES (?, ?, ?)
      ON CONFLICT(task_id, user_id)
      DO UPDATE SET note = excluded.note, updated_at = datetime('now')
    `).run(taskId, actorUserId, text);
  }
  addTaskEvent({ taskId, actorUserId, type: 'note', note: text || null });
}

function listTaskNotes(taskId) {
  return db.prepare(`
    SELECT n.*, u.email AS author_email
    FROM task_notes n JOIN users u ON u.id = n.user_id
    WHERE n.task_id = ? ORDER BY n.updated_at ASC
  `).all(taskId);
}

function listNotesForPair(pairId) {
  return db.prepare(`
    SELECT n.*, u.email AS author_email
    FROM task_notes n
    JOIN users u ON u.id = n.user_id
    JOIN tasks t ON t.id = n.task_id
    WHERE t.pair_id = ?
  `).all(pairId);
}

function setTaskUrgent(taskId, { isUrgent, actorUserId }) {
  db.prepare('UPDATE tasks SET is_urgent = ? WHERE id = ?').run(isUrgent ? 1 : 0, taskId);
  addTaskEvent({ taskId, actorUserId, type: isUrgent ? 'urgent_on' : 'urgent_off' });
}

function addTaskEvent({ taskId, actorUserId, type, fromStatus, toStatus, note }) {
  db.prepare(`
    INSERT INTO task_events (task_id, actor_user_id, type, from_status, to_status, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(taskId, actorUserId, type, fromStatus || null, toStatus || null, note || null);
}

function listTaskEvents(taskId) {
  return db.prepare(`
    SELECT e.*, u.email AS actor_email
    FROM task_events e
    JOIN users u ON u.id = e.actor_user_id
    WHERE e.task_id = ?
    ORDER BY e.created_at ASC, e.id ASC
  `).all(taskId);
}

/**
 * Per-pair task counts used by the dashboard meter and count chips.
 * `staleOpen` counts open tasks whose status hasn't moved within the pair's
 * configured stale window, computed in SQL so the dashboard stays one query
 * per pair rather than loading every task.
 */
function getPairStats(pairId, staleDays) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) AS todo,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status != 'done' AND is_urgent = 1 THEN 1 ELSE 0 END) AS urgentOpen,
      SUM(CASE WHEN status != 'done'
                AND julianday('now') - julianday(status_changed_at) >= ?
               THEN 1 ELSE 0 END) AS staleOpen
    FROM tasks WHERE pair_id = ?
  `).get(staleDays, pairId);

  return {
    total: row.total || 0,
    todo: row.todo || 0,
    in_progress: row.in_progress || 0,
    done: row.done || 0,
    urgentOpen: row.urgentOpen || 0,
    staleOpen: row.staleOpen || 0,
  };
}

// ---- reporting (weekly digest) ---------------------------------------

function listTasksDoneSince(pairId, sinceIso) {
  return db.prepare(`
    SELECT * FROM tasks WHERE pair_id = ? AND status = 'done' AND done_at >= ?
    ORDER BY done_at ASC
  `).all(pairId, sinceIso);
}

function listActivePairs() {
  return db.prepare(`
    SELECT p.*, ud.email AS delegator_email, uo.email AS doer_email
    FROM pairs p
    JOIN users ud ON ud.id = p.delegator_user_id
    JOIN users uo ON uo.id = p.doer_user_id
    WHERE p.status = 'active'
  `).all();
}

// ====================================================================
// src/email.js
// ====================================================================

// Email delivery abstraction. Uses Resend's HTTP API via the built-in
// `fetch` (no SDK dependency needed) when RESEND_API_KEY is set. Otherwise
// falls back to logging the email to the server console, which is enough
// to develop and test the whole app without any email provider.
async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tirskoo <onboarding@resend.dev>';

  if (apiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[email] Resend API error ${res.status}: ${body}`);
      }
      return { delivered: res.ok, dev: false };
    } catch (err) {
      console.error('[email] failed to send via Resend:', err.message);
      return { delivered: false, dev: false };
    }
  }

  console.log('\n----- DEV EMAIL (set RESEND_API_KEY to send real emails) -----');
  console.log('To:', to);
  console.log('Subject:', subject);
  console.log(text);
  console.log('----------------------------------------------------------------\n');
  return { delivered: false, dev: true };
}

// ====================================================================
// src/views.js
// ====================================================================

function layout({ title, user, body, wide }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} · Tirskoo</title>
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>✅</text></svg>">
</head>
<body>
<header class="topbar">
  <a class="brand" href="${user ? '/dashboard' : '/login'}"><span class="brand-dot"></span>Tirskoo</a>
  ${user ? `<form method="post" action="/auth/logout" class="inline-form">
      <span class="me">${escapeHtml(user.email)}</span>
      <button class="link-btn" type="submit">Sign out</button>
    </form>` : ''}
</header>
<main class="${wide ? 'container wide' : 'container'}">
${body}
</main>
</body>
</html>`;
}

function alertBox(query) {
  let out = '';
  if (query.error) out += `<div class="alert alert-error">${escapeHtml(query.error)}</div>`;
  if (query.notice) out += `<div class="alert alert-notice">${escapeHtml(query.notice)}</div>`;
  return out;
}

function initials(email) {
  const name = String(email || '').split('@')[0];
  const parts = name.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]);
  return name.slice(0, 2) || '?';
}

function avatar(email, small) {
  return `<span class="avatar${small ? ' avatar-sm' : ''}" title="${escapeHtml(email)}">${escapeHtml(initials(email))}</span>`;
}

/** A single ratio against a limit — rendered as a meter, not a chart. */
function meter(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return `<div class="meter" role="img" aria-label="${done} of ${total} tasks done">
    <span style="width:${pct}%"></span>
  </div>`;
}

function countChips(stats) {
  const chips = [];
  if (stats.urgentOpen > 0) {
    chips.push(`<span class="count-chip is-critical"><span class="dot"></span>${stats.urgentOpen} urgent</span>`);
  }
  if (stats.staleOpen > 0) {
    chips.push(`<span class="count-chip is-warning"><span class="dot"></span>${stats.staleOpen} gone quiet</span>`);
  }
  const open = stats.todo + stats.in_progress;
  chips.push(`<span class="count-chip">${open} open</span>`);
  return `<div class="counts">${chips.join('')}</div>`;
}

const APP_VERSION = 'v5';

function loginPage({ query }) {
  return {
    title: 'Sign in',
    body: `
<div class="card auth-card">
  <h1>Tirskoo</h1>
  <p class="auth-lede">See what's actually gotten done — without making a call.</p>
  ${alertBox(query)}
  <form method="post" action="/auth/password" class="stacked-form">
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" inputmode="email" autocomplete="email" required placeholder="you@example.com">
    <label for="password">Your code</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="the code you chose">
    <button type="submit" class="btn btn-primary btn-block">Sign in</button>
  </form>
  <p class="muted small" style="margin-top:18px">
    New here with an invite code? <a href="/join">Set up your account</a><br>
    Been here since before codes? <a href="/set-password">Choose your code</a>
  </p>
  <p class="version-tag">Tirskoo ${APP_VERSION}</p>
</div>`,
  };
}

function setPasswordPage({ query }) {
  return {
    title: 'Choose your code',
    body: `
<div class="card auth-card">
  <h1>Choose your code</h1>
  <p class="auth-lede">Your account was set up before codes existed. Pick one now — you'll use it every time you sign in.</p>
  ${alertBox(query)}
  <form method="post" action="/set-password" class="stacked-form">
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" inputmode="email" autocomplete="email" required
           value="${escapeHtml(query.email || '')}" placeholder="you@example.com">
    <label for="password">Choose your code</label>
    <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
    <label for="confirm">Type it again</label>
    <input id="confirm" name="confirm" type="password" autocomplete="new-password" required minlength="8">
    <button type="submit" class="btn btn-primary btn-block">Save code &amp; sign in</button>
  </form>
  <p class="muted small" style="margin-top:16px">At least 8 characters. Write it down somewhere — there's no way to reset it yet. <a href="/login">Back to sign in</a></p>
  <p class="version-tag">Tirskoo ${APP_VERSION}</p>
</div>`,
  };
}

function joinPage({ query, firstEver }) {
  return {
    title: 'Join Tirskoo',
    body: `
<div class="card auth-card">
  <h1>${firstEver ? 'Create the first account' : 'Join Tirskoo'}</h1>
  <p class="auth-lede">${firstEver
    ? 'This Tirskoo has no accounts yet — this one becomes the first.'
    : 'Enter the invite code the person who invited you sent over.'}</p>
  ${alertBox(query)}
  <form method="post" action="/join" class="stacked-form">
    <label for="email">Your email address</label>
    <input id="email" name="email" type="email" inputmode="email" autocomplete="email" required
           value="${escapeHtml(query.email || '')}" placeholder="you@example.com">
    ${firstEver ? '' : `
    <label for="code">Invite code</label>
    <input id="code" name="code" type="text" required autocapitalize="characters"
           spellcheck="false" placeholder="e.g. K7P2QX" value="${escapeHtml(query.code || '')}">`}
    <label for="password">Choose your own code</label>
    <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
    <label for="confirm">Type it again</label>
    <input id="confirm" name="confirm" type="password" autocomplete="new-password" required minlength="8">
    <button type="submit" class="btn btn-primary btn-block">Create my account</button>
  </form>
  <p class="muted small" style="margin-top:16px">
    Your own code is what you'll sign in with from now on — at least 8 characters, and write it down.<br>
    Already set up? <a href="/login">Sign in</a>
  </p>
  <p class="version-tag">Tirskoo ${APP_VERSION}</p>
</div>`,
  };
}

function pairRoleLabel(pair, userId) {
  const isDelegator = pair.delegator_user_id === userId;
  const otherEmail = isDelegator ? pair.doer_email : pair.delegator_email;
  if (pair.mode === 'shared') {
    return { arrow: `You ↔ ${otherEmail}`, role: 'shared', otherEmail, roleWord: 'equal partners' };
  }
  if (isDelegator) {
    return { arrow: `You → ${pair.doer_email}`, role: 'delegator', otherEmail, roleWord: 'you give tasks' };
  }
  return { arrow: `${pair.delegator_email} → You`, role: 'doer', otherEmail, roleWord: 'you do tasks' };
}

function dashboardPage({ user, active, archived = [], pendingIncoming, pendingOutgoing, query }) {
  const pairRow = (p) => {
    const { arrow, role, otherEmail, roleWord } = pairRoleLabel(p, user.id);
    const s = p.stats || { todo: 0, in_progress: 0, done: 0, total: 0, urgentOpen: 0, staleOpen: 0 };
    return `<li class="pair-row">
      <a class="pair-link" href="/pairs/${p.id}">
        <div class="pair-top">
          ${avatar(otherEmail)}
          <span class="pair-who">
            <span class="pair-arrow">${escapeHtml(arrow)}</span>
            <span class="pair-sub">${p.label ? escapeHtml(p.label) + ' · ' : ''}<span class="role-word role-${role}">${escapeHtml(roleWord)}</span></span>
          </span>
          <span class="chev">›</span>
        </div>
        ${meter(s.done, s.total)}
        <div class="meter-row">
          ${countChips(s)}
          <span class="muted small">${s.done}/${s.total} done</span>
        </div>
      </a>
    </li>`;
  };

  const incomingRow = (p) => {
    const { arrow, otherEmail } = pairRoleLabel(p, user.id);
    return `<li class="pair-row pending">
      ${avatar(otherEmail)}
      <span class="pair-who">
        <span class="pair-arrow">${escapeHtml(arrow)}</span>
        <span class="pair-sub">wants to connect</span>
      </span>
      <form method="post" action="/pairs/${p.id}/accept" class="inline-form">
        <button class="btn btn-small btn-primary" type="submit">Accept</button>
      </form>
      <form method="post" action="/pairs/${p.id}/decline" class="inline-form">
        <button class="btn btn-small btn-ghost" type="submit">Decline</button>
      </form>
    </li>`;
  };

  const outgoingRow = (p) => {
    const { arrow, otherEmail } = pairRoleLabel(p, user.id);
    return `<li class="pair-row pending">
      ${avatar(otherEmail)}
      <span class="pair-who">
        <span class="pair-arrow">${escapeHtml(arrow)}</span>
        <span class="pair-sub">waiting for them to confirm</span>
      </span>
    </li>`;
  };

  return {
    title: 'Dashboard',
    body: `
${alertBox(query)}

${pendingIncoming.length ? `
<section>
  <p class="section-title">Pending invites for you</p>
  <ul class="pair-list">${pendingIncoming.map(incomingRow).join('')}</ul>
</section>
<div style="height:20px"></div>` : ''}

<section>
  <p class="section-title">Your pairs</p>
  ${active.length
    ? `<ul class="pair-list">${active.map(pairRow).join('')}</ul>`
    : `<div class="card empty-state"><strong>No pairs yet</strong>Invite someone below to get started.</div>`}
</section>

${pendingOutgoing.length ? `
<div style="height:20px"></div>
<section>
  <p class="section-title">Waiting on them</p>
  <ul class="pair-list">${pendingOutgoing.map(outgoingRow).join('')}</ul>
</section>` : ''}

${archived.length ? `
<div style="height:20px"></div>
<details class="archived-details">
  <summary>Archived (${archived.length})</summary>
  <ul class="pair-list" style="margin-top:10px">
    ${archived.map((p) => {
      const { arrow, otherEmail } = pairRoleLabel(p, user.id);
      const s = p.stats || { total: 0, done: 0 };
      return `<li class="pair-row pending">
        ${avatar(otherEmail)}
        <span class="pair-who">
          <span class="pair-arrow">${escapeHtml(arrow)}</span>
          <span class="pair-sub">${s.total} task${s.total === 1 ? '' : 's'} kept${p.label ? ' · ' + escapeHtml(p.label) : ''}</span>
        </span>
        <form method="post" action="/pairs/${p.id}/restore" class="inline-form">
          <button class="btn btn-small btn-ghost" type="submit">Bring back</button>
        </form>
      </li>`;
    }).join('')}
  </ul>
</details>` : ''}

<div style="height:24px"></div>
<details class="add-task-details">
  <summary class="btn btn-primary btn-block">+ Invite someone</summary>
  <form method="post" action="/pairs" class="stacked-form">
    <label for="email">Their email</label>
    <input id="email" name="email" type="email" required placeholder="colleague@example.com">
    <fieldset class="radio-group">
      <legend>How do you work together?</legend>
      <label class="radio-option"><input type="radio" name="relationship" value="i_delegate" checked> I give them tasks</label>
      <label class="radio-option"><input type="radio" name="relationship" value="i_do"> They give me tasks</label>
      <label class="radio-option"><input type="radio" name="relationship" value="shared"> We're equals — we both just get things done</label>
    </fieldset>
    <label for="label">Label <span class="muted small">(optional, e.g. "Marketing")</span></label>
    <input id="label" name="label" type="text" maxlength="60" placeholder="Optional name for this pair">
    <button type="submit" class="btn btn-primary btn-block">Send invite</button>
  </form>
</details>
`,
  };
}

function disconnectPage({ pair, otherEmail, stats, query }) {
  return {
    title: 'End this relationship',
    body: `
<a class="back-link" href="/pairs/${pair.id}">← Back to the board</a>
${alertBox(query)}

<h1 style="margin-bottom:6px">Finish with ${escapeHtml(otherEmail)}?</h1>
<p class="muted" style="margin-top:0">There are two ways to do this. Pick the one you mean.</p>

<section class="card choice-card choice-safe">
  <span class="choice-tag choice-tag-safe">Reversible</span>
  <h2>Archive it</h2>
  <p class="choice-body">It disappears from both your dashboards and nobody can add to it any more —
  but every task, note and date is kept exactly as it is. Bring it back whenever you like,
  and it picks up where it left off.</p>
  <p class="muted small">Best if you might work together again, or you want to keep the record of what was done.</p>
  <form method="post" action="/pairs/${pair.id}/archive">
    <button type="submit" class="btn btn-primary btn-block">Archive — keep everything</button>
  </form>
</section>

<section class="card choice-card choice-danger">
  <span class="choice-tag choice-tag-danger">Permanent</span>
  <h2>Delete it all</h2>
  <p class="choice-body">Wipes the relationship and everything in it, for both of you, forever.</p>
  <div class="danger-list">
    <div><strong>${stats.total}</strong> task${stats.total === 1 ? '' : 's'}${stats.done ? ` (including ${stats.done} already done)` : ''}</div>
    <div>Every note either of you wrote</div>
    <div>The full history of what happened</div>
    <div>Your topics for this relationship</div>
  </div>
  <p class="muted small">There is no undo, and ${escapeHtml(otherEmail)} is not warned first.</p>
  <form method="post" action="/pairs/${pair.id}/disconnect" class="stacked-form">
    <label for="confirm_email">To be sure, type <strong>${escapeHtml(otherEmail)}</strong></label>
    <input id="confirm_email" name="confirm_email" type="text" required
           autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${escapeHtml(otherEmail)}">
    <button type="submit" class="btn btn-danger btn-block">Delete everything permanently</button>
  </form>
</section>

<p style="text-align:center"><a href="/pairs/${pair.id}">Neither — take me back</a></p>`,
  };
}

function statusHistoryList(events) {
  const label = (e) => {
    if (e.type === 'created') return `Created`;
    if (e.type === 'status_change') return `${STATUS_LABELS[e.from_status] || e.from_status} → ${STATUS_LABELS[e.to_status] || e.to_status}`;
    if (e.type === 'note') return `Note updated`;
    if (e.type === 'urgent_on') return `Marked urgent`;
    if (e.type === 'urgent_off') return `Unmarked urgent`;
    return e.type;
  };
  return `<ul class="history-list">
    ${events.map((e) => `<li>
      <span class="history-what">${escapeHtml(label(e))}</span>
      <span class="history-when">· ${fmtDateTime(e.created_at)} · ${escapeHtml(e.actor_email)}</span>
      ${e.note ? `<div class="history-note">"${escapeHtml(e.note)}"</div>` : ''}
    </li>`).join('')}
  </ul>`;
}

function taskCard({ task, role, perms, user, pair, events, notes = [] }) {
  const isCreator = task.created_by_user_id === user.id;
  const canChangeStatus = perms.canChangeStatus;
  const selfAdded = !perms.shared && task.created_by_user_id === pair.doer_user_id;
  const stale = task.status !== 'done' && daysSince(task.status_changed_at) >= pair.stale_days;
  const overdue = isOverdue(task.due_date, task.status);
  const addedByEmail = task.created_by_user_id === pair.delegator_user_id ? pair.delegator_email : pair.doer_email;
  const addedByLabel = task.created_by_user_id === user.id ? 'you' : addedByEmail.split('@')[0];
  const myNote = notes.find((n) => n.user_id === user.id);
  const theirNotes = notes.filter((n) => n.user_id !== user.id);

  const statusButtons = [];
  if (canChangeStatus) {
    if (task.status === 'todo') {
      statusButtons.push(`<form method="post" action="/pairs/${pair.id}/tasks/${task.id}/status" class="inline-form">
        <input type="hidden" name="status" value="in_progress">
        <button class="btn btn-small btn-primary" type="submit">Start</button>
      </form>`);
      statusButtons.push(`<form method="post" action="/pairs/${pair.id}/tasks/${task.id}/status" class="inline-form">
        <input type="hidden" name="status" value="done">
        <button class="btn btn-small btn-ghost" type="submit">Mark done</button>
      </form>`);
    }
    if (task.status === 'in_progress') {
      statusButtons.push(`<form method="post" action="/pairs/${pair.id}/tasks/${task.id}/status" class="inline-form">
        <input type="hidden" name="status" value="done">
        <button class="btn btn-small btn-primary" type="submit">Mark done</button>
      </form>`);
      statusButtons.push(`<form method="post" action="/pairs/${pair.id}/tasks/${task.id}/status" class="inline-form">
        <input type="hidden" name="status" value="todo">
        <button class="btn btn-small btn-ghost" type="submit">Back to to-do</button>
      </form>`);
    }
    if (task.status === 'done') {
      statusButtons.push(`<form method="post" action="/pairs/${pair.id}/tasks/${task.id}/status" class="inline-form">
        <input type="hidden" name="status" value="in_progress">
        <button class="btn btn-small btn-ghost" type="submit">Reopen</button>
      </form>`);
    }
  }

  const urgentToggle = isCreator ? `<form method="post" action="/pairs/${pair.id}/tasks/${task.id}/urgent" class="inline-form">
      <button class="switch" type="submit" aria-pressed="${task.is_urgent ? 'true' : 'false'}">
        <span class="track"></span>Urgent
      </button>
    </form>` : '';

  // Both people can leave a note; each owns theirs and can't touch the other's.
  const noteForm = `<details class="note-details">
      <summary>${myNote ? 'Edit your note' : 'Add your note'}</summary>
      <form method="post" action="/pairs/${pair.id}/tasks/${task.id}/note" class="stacked-form tight">
        <textarea name="note" maxlength="500" placeholder="e.g. handled this over email, see attached">${escapeHtml(myNote ? myNote.note : '')}</textarea>
        <button class="btn btn-small btn-primary" type="submit" style="align-self:flex-start;margin-top:8px">Save note</button>
      </form>
    </details>`;

  const noteBlock = (n, mine) => `<div class="note ${mine ? 'note-mine' : ''}">
      <div class="note-head">${avatar(n.author_email, true)}<span class="note-who">${mine ? 'You' : escapeHtml(n.author_email.split('@')[0])}</span><span class="note-when muted small">${fmtDate(n.updated_at)}</span></div>
      <div class="note-body">${escapeHtml(n.note)}</div>
    </div>`;

  const notesHtml = (myNote || theirNotes.length)
    ? `<div class="notes">
        ${theirNotes.map((n) => noteBlock(n, false)).join('')}
        ${myNote ? noteBlock(myNote, true) : ''}
      </div>`
    : '';

  const cardClasses = [
    'task-card',
    task.is_urgent ? 'urgent' : '',
    stale ? 'stale' : '',
    task.status === 'done' ? 'is-done' : '',
  ].filter(Boolean).join(' ');

  return `<li class="${cardClasses}" data-task-id="${task.id}">
    <div class="task-head">
      <span class="task-title">${escapeHtml(task.title)}</span>
      <span class="task-badges">
        ${task.topic_name ? `<span class="badge badge-topic">${escapeHtml(task.topic_name)}</span>` : ''}
        ${task.is_urgent ? '<span class="badge badge-urgent"><span class="dot"></span>Urgent</span>' : ''}
        ${stale ? `<span class="badge badge-stale"><span class="dot"></span>Quiet ${Math.floor(daysSince(task.status_changed_at))}d</span>` : ''}
        ${overdue ? '<span class="badge badge-overdue"><span class="dot"></span>Overdue</span>' : ''}
        ${selfAdded ? '<span class="badge badge-self">Self-added</span>' : ''}
      </span>
    </div>
    ${task.description ? `<p class="task-desc">${escapeHtml(task.description)}</p>` : ''}
    <div class="task-meta">
      Added ${fmtDate(task.created_at)} by ${escapeHtml(addedByLabel)}${task.due_date ? ` · Due ${fmtDate(task.due_date)}` : ''}${task.status === 'done' && task.done_at ? ` · Done ${fmtDate(task.done_at)}` : ''}
    </div>
    ${notesHtml}
    ${(statusButtons.length || urgentToggle) ? `<div class="task-actions">
      ${statusButtons.join('')}
      ${urgentToggle}
    </div>` : ''}
    ${noteForm}
    <details class="history-details">
      <summary>History (${events.length})</summary>
      ${statusHistoryList(events)}
    </details>
  </li>`;
}

/**
 * A plain-English statement of who you are here and what that lets you do.
 * The whole point is that nobody should have to work it out.
 */
function roleBanner(pair, role, perms) {
  const otherName = (role === 'delegator' ? pair.doer_email : pair.delegator_email).split('@')[0];
  if (perms.shared) {
    return `<div class="role-banner role-shared">
      <span class="role-title">Equal partners</span>
      <span class="role-detail">You and ${escapeHtml(otherName)} share this list — you can both add tasks, move them along, and leave notes.</span>
    </div>`;
  }
  if (role === 'delegator') {
    return `<div class="role-banner role-delegating">
      <span class="role-title">You give the tasks here</span>
      <span class="role-detail">${escapeHtml(otherName)} marks them done — you can add tasks and notes, and see everything they record.</span>
    </div>`;
  }
  return `<div class="role-banner role-doing">
      <span class="role-title">You do the tasks here</span>
      <span class="role-detail">${escapeHtml(otherName)} gives you tasks — you control the status and can add your own tasks and notes.</span>
    </div>`;
}

function topicFilterRow({ pair, topics, counts, activeTopic }) {
  const byId = new Map(counts.map((c) => [c.topic_id, c]));
  const totalOpen = counts.reduce((n, c) => n + (c.open || 0), 0);
  const untagged = byId.get(0);

  const chip = (value, label, open, isActive) =>
    `<a class="topic-chip${isActive ? ' is-active' : ''}" href="/pairs/${pair.id}${value ? `?topic=${value}` : ''}">
      ${escapeHtml(label)}${open ? `<span class="topic-count">${open}</span>` : ''}
    </a>`;

  if (!topics.length && !untagged) return '';

  return `<div class="topic-row">
    ${chip('', 'All topics', totalOpen, !activeTopic)}
    ${topics.map((t) => chip(String(t.id), t.name, (byId.get(t.id) || {}).open || 0, activeTopic === String(t.id))).join('')}
    ${untagged && untagged.total ? chip('none', 'No topic', untagged.open || 0, activeTopic === 'none') : ''}
  </div>`;
}

function pairPage({ user, pair, role, perms, columns, stats, topics = [], counts = [], activeTopic = '', query }) {
  const otherEmail = role === 'delegator' ? pair.doer_email : pair.delegator_email;
  const colOrder = ['todo', 'in_progress', 'done'];
  const emptyCopy = {
    todo: 'Nothing waiting.',
    in_progress: 'Nothing in flight.',
    done: 'Nothing finished yet.',
  };
  const topicSuggestions = ['Mentorship', 'Career', 'Documents', 'CVs', 'Motivation letters', 'Driver’s licence'];

  return {
    title: pair.label || otherEmail,
    wide: true,
    body: `
<a class="back-link" href="/dashboard">← Dashboard</a>
${alertBox(query)}
<div class="pair-header">
  <div class="pair-header-top">
    ${avatar(otherEmail)}
    <div class="pair-who">
      <h1>${escapeHtml(pair.label || otherEmail)}</h1>
      <div class="pair-sub">${perms.shared
        ? `You ↔ ${escapeHtml(pair.delegator_user_id === user.id ? pair.doer_email : pair.delegator_email)}`
        : role === 'delegator' ? `You → ${escapeHtml(pair.doer_email)}` : `${escapeHtml(pair.delegator_email)} → You`} · flags quiet tasks after ${pair.stale_days}d</div>
    </div>
  </div>
  ${roleBanner(pair, role, perms)}
  <div class="pair-progress">
    ${meter(stats.done, stats.total)}
    <div class="meter-row">
      ${countChips(stats)}
      <span class="muted small">${stats.done}/${stats.total} done</span>
    </div>
  </div>
  <details class="settings-details">
    <summary>Pair settings</summary>
    <form method="post" action="/pairs/${pair.id}/settings" class="stacked-form tight">
      <label for="label">Label</label>
      <input id="label" name="label" type="text" maxlength="60" value="${escapeHtml(pair.label || '')}">
      <label for="stale_days">Flag as quiet after (days)</label>
      <input id="stale_days" name="stale_days" type="number" min="1" max="60" value="${pair.stale_days}">
      <fieldset class="radio-group">
        <legend>Relationship</legend>
        <label class="radio-option"><input type="radio" name="mode" value="delegated" ${perms.shared ? '' : 'checked'}> One gives tasks, the other does them</label>
        <label class="radio-option"><input type="radio" name="mode" value="shared" ${perms.shared ? 'checked' : ''}> Equal partners — both do everything</label>
      </fieldset>
      <button type="submit" class="btn btn-small btn-primary" style="align-self:flex-start;margin-top:12px">Save settings</button>
    </form>
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--hairline)">
      <p class="section-title" style="margin-bottom:8px">Topics</p>
      ${topics.length ? `<ul class="topic-manage">
        ${topics.map((t) => `<li>
          <span>${escapeHtml(t.name)}</span>
          <form method="post" action="/pairs/${pair.id}/topics/${t.id}/delete" class="inline-form">
            <button class="link-btn" type="submit">Remove</button>
          </form>
        </li>`).join('')}
      </ul>` : '<p class="muted small">No topics yet — add one when you create a task, or below.</p>'}
      <form method="post" action="/pairs/${pair.id}/topics" class="stacked-form tight">
        <label for="topic_name">Add a topic</label>
        <input id="topic_name" name="name" type="text" maxlength="40" list="topic-ideas-2" placeholder="e.g. Career">
        <datalist id="topic-ideas-2">
          ${topicSuggestions.map((s) => `<option value="${escapeHtml(s)}"></option>`).join('')}
        </datalist>
        <button type="submit" class="btn btn-small btn-ghost" style="align-self:flex-start;margin-top:8px">Add topic</button>
      </form>
    </div>
    <p style="margin-top:18px;padding-top:14px;border-top:1px solid var(--hairline)">
      <a class="danger-link" href="/pairs/${pair.id}/disconnect">Finish with ${escapeHtml(otherEmail)}</a>
      <span class="muted small"> — archive it, or delete it permanently</span>
    </p>
  </details>
</div>

<details class="add-task-details" ${query.opened === 'add' ? 'open' : ''}>
  <summary class="btn btn-primary btn-block">+ Add task</summary>
  <form method="post" action="/pairs/${pair.id}/tasks" class="stacked-form">
    <label for="title">Title</label>
    <input id="title" name="title" type="text" required maxlength="200" placeholder="What needs doing?">
    <label for="description">Description <span class="muted small">(optional)</span></label>
    <textarea id="description" name="description" maxlength="1000" placeholder="Any extra detail"></textarea>
    <label for="topic_id">Topic</label>
    <select id="topic_id" name="topic_id">
      <option value="">— no topic —</option>
      ${topics.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
    </select>
    <label for="new_topic">…or type a new topic <span class="muted small">(this wins if filled in)</span></label>
    <input id="new_topic" name="new_topic" type="text" maxlength="40" list="topic-ideas" placeholder="e.g. Mentorship">
    <datalist id="topic-ideas">
      ${topicSuggestions.map((s) => `<option value="${escapeHtml(s)}"></option>`).join('')}
    </datalist>
    <label for="due_date">Due date <span class="muted small">(optional)</span></label>
    <input id="due_date" name="due_date" type="date">
    <label class="switch-row">
      <span>Mark urgent</span>
      <input type="checkbox" name="is_urgent" value="1">
      <span class="switch-track"></span>
    </label>
    <button type="submit" class="btn btn-primary btn-block">Save task</button>
  </form>
</details>

${topicFilterRow({ pair, topics, counts, activeTopic })}

<div class="board">
  ${colOrder.map((status) => `
    <section class="board-col col-${status}">
      <h2><span class="col-mark"></span>${STATUS_LABELS[status]} <span class="count">${columns[status].length}</span></h2>
      ${columns[status].length
        ? `<ul class="task-list">${columns[status].map((t) => taskCard(t)).join('')}</ul>`
        : `<p class="empty-col">${emptyCopy[status]}</p>`}
    </section>
  `).join('')}
</div>
`,
  };
}

// ====================================================================
// src/router.js
// ====================================================================

// A tiny dependency-free HTTP router with an Express-ish ctx API. Built on
// node:http directly so the app has zero npm dependencies.
function compilePattern(pattern) {
  const keys = [];
  const regexStr = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${regexStr}/?$`), keys };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  const limit = 1024 * 1024; // 1MB, plenty for this app's forms
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseBody(raw, contentType) {
  if (!raw) return {};
  if (contentType && contentType.includes('application/json')) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  // default: application/x-www-form-urlencoded
  const out = {};
  for (const [key, val] of new URLSearchParams(raw)) out[key] = val;
  return out;
}

function createRouter() {
  const routes = [];
  const middlewares = [];

  function add(method, pattern, handler) {
    routes.push({ method, ...compilePattern(pattern), handler });
  }

  const router = {
    use(fn) { middlewares.push(fn); },
    get(pattern, handler) { add('GET', pattern, handler); },
    post(pattern, handler) { add('POST', pattern, handler); },
    async handle(req, res) {
      const host = req.headers.host || 'localhost';
      const url = new URL(req.url, `http://${host}`);
      const query = Object.fromEntries(url.searchParams.entries());
      const cookies = parseCookies(req.headers.cookie);

      let body = {};
      if (req.method === 'POST') {
        try {
          const raw = await readBody(req);
          body = parseBody(raw, req.headers['content-type']);
        } catch (err) {
          res.writeHead(413, { 'Content-Type': 'text/plain' });
          res.end('Payload too large');
          return;
        }
      }

      const ctx = {
        req, res, url, query, cookies, body,
        method: req.method,
        pathname: url.pathname,
        params: {},
        user: null,
        setCookie(name, value, opts = {}) {
          const parts = [`${name}=${encodeURIComponent(value)}`];
          parts.push(`Path=${opts.path || '/'}`);
          parts.push('HttpOnly');
          parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
          if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
          if (process.env.NODE_ENV === 'production') parts.push('Secure');
          const existing = res.getHeader('Set-Cookie');
          const cookieStr = parts.join('; ');
          if (existing) {
            res.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, cookieStr] : [existing, cookieStr]);
          } else {
            res.setHeader('Set-Cookie', cookieStr);
          }
        },
        clearCookie(name) {
          ctx.setCookie(name, '', { maxAge: 0 });
        },
        redirect(location, status = 303) {
          res.writeHead(status, { Location: location });
          res.end();
        },
        html(content, status = 200) {
          res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        },
        json(obj, status = 200) {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        },
        text(str, status = 200) {
          res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(str);
        },
        notFound() { ctx.html('<h1>404</h1><p>Not found.</p><p><a href="/">Home</a></p>', 404); },
      };

      for (const mw of middlewares) {
        await mw(ctx);
      }

      for (const route of routes) {
        if (route.method !== req.method) continue;
        const match = route.regex.exec(url.pathname);
        if (!match) continue;
        route.keys.forEach((key, i) => { ctx.params[key] = decodeURIComponent(match[i + 1]); });
        try {
          await route.handler(ctx);
        } catch (err) {
          console.error(`[router] error handling ${req.method} ${url.pathname}:`, err);
          if (!res.writableEnded) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>500</h1><p>Something went wrong.</p>');
          }
        }
        return;
      }

      ctx.notFound();
    },
  };

  return router;
}

// ====================================================================
// src/routes/auth.js
// ====================================================================

function startSession(ctx, user) {
  const session = sign({ uid: user.id, exp: Date.now() + SESSION_TTL_MS });
  ctx.setCookie(SESSION_COOKIE, session, { maxAge: Math.floor(SESSION_TTL_MS / 1000) });
}

function redirectWithError(ctx, path, message) {
  return ctx.redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function registerAuthRoutes(router) {
  router.get('/login', (ctx) => {
    if (ctx.user) return ctx.redirect('/dashboard');
    const { title, body } = loginPage({ query: ctx.query });
    ctx.html(layout({ title, user: null, body }));
  });

  // ---- password sign-in ------------------------------------------------

  router.post('/auth/password', async (ctx) => {
    const emailRaw = ctx.body.email || '';
    const password = ctx.body.password || '';
    if (!isValidEmail(emailRaw)) {
      return redirectWithError(ctx, '/login', 'Please enter a valid email address.');
    }
    const email = normalizeEmail(emailRaw);
    const user = findUserByEmail(email);

    // A person whose account predates passwords (or who was just invited)
    // has no hash yet — send them to set one rather than failing silently.
    if (user && !user.password_hash) {
      return ctx.redirect(`/set-password?email=${encodeURIComponent(email)}`);
    }

    const ok = user && await verifyPassword(password, user.password_hash);
    if (!ok) {
      // Same message either way, so this can't be used to discover which
      // email addresses have accounts.
      return redirectWithError(ctx, '/login', 'That email and password combination is not recognised.');
    }
    startSession(ctx, user);
    ctx.redirect('/dashboard');
  });

  // ---- first-time password setup --------------------------------------

  router.get('/set-password', (ctx) => {
    const { title, body } = setPasswordPage({ query: ctx.query });
    ctx.html(layout({ title, user: null, body }));
  });

  router.post('/set-password', async (ctx) => {
    const emailRaw = ctx.body.email || '';
    const password = ctx.body.password || '';
    const confirm = ctx.body.confirm || '';
    const back = `/set-password?email=${encodeURIComponent(emailRaw)}`;

    if (!isValidEmail(emailRaw)) return redirectWithError(ctx, '/set-password', 'Please enter a valid email address.');
    const email = normalizeEmail(emailRaw);
    const user = findUserByEmail(email);

    if (!user) return redirectWithError(ctx, '/join', 'No account for that email yet — use your invite code to join.');
    if (user.password_hash) {
      return redirectWithError(ctx, '/login', 'That account already has a password. Sign in with it.');
    }
    const problem = passwordProblem(password);
    if (problem) return redirectWithError(ctx, back, problem);
    if (password !== confirm) return redirectWithError(ctx, back, 'Those two passwords do not match.');

    setUserPassword(user.id, await hashPassword(password));
    startSession(ctx, user);
    ctx.redirect('/dashboard?notice=' + encodeURIComponent('Password set. You can sign in with it from now on.'));
  });

  // ---- joining with an invite code -------------------------------------

  router.get('/join', (ctx) => {
    const { title, body } = joinPage({ query: ctx.query, firstEver: countUsers() === 0 });
    ctx.html(layout({ title, user: null, body }));
  });

  router.post('/join', async (ctx) => {
    const emailRaw = ctx.body.email || '';
    const code = (ctx.body.code || '').trim();
    const password = ctx.body.password || '';
    const confirm = ctx.body.confirm || '';

    if (!isValidEmail(emailRaw)) return redirectWithError(ctx, '/join', 'Please enter a valid email address.');
    const email = normalizeEmail(emailRaw);

    const existing = findUserByEmail(email);
    if (existing && existing.password_hash) {
      return redirectWithError(ctx, '/login', 'You already have an account — sign in instead.');
    }

    // The very first account on a fresh install needs no code; everyone
    // after that must present an invite code addressed to their email.
    const isFirstEver = countUsers() === 0;
    if (!isFirstEver) {
      if (!code) return redirectWithError(ctx, '/join', 'Please enter the invite code you were given.');
      if (!findPendingInviteByCode(email, code)) {
        return redirectWithError(ctx, '/join', 'That invite code does not match that email address.');
      }
    }

    const problem = passwordProblem(password);
    if (problem) return redirectWithError(ctx, '/join', problem);
    if (password !== confirm) return redirectWithError(ctx, '/join', 'Those two passwords do not match.');

    const user = findOrCreateUser(email);
    setUserPassword(user.id, await hashPassword(password));
    startSession(ctx, user);
    ctx.redirect('/dashboard?notice=' + encodeURIComponent('Welcome to Tirskoo.'));
  });

  // Sign-in links have been removed entirely — signing in is email + code,
  // and nothing else. These two routes stay only so that any old link
  // sitting in someone's history lands somewhere sensible instead of a 404.

  router.post('/auth/request', (ctx) => {
    redirectWithError(ctx, '/login', 'Sign-in links are no longer used. Sign in with your email and code.');
  });

  router.get('/auth/verify', (ctx) => {
    redirectWithError(ctx, '/login', 'Sign-in links are no longer used. Sign in with your email and code.');
  });

  router.post('/auth/logout', (ctx) => {
    ctx.clearCookie(SESSION_COOKIE);
    ctx.redirect('/login');
  });
}

function sessionMiddleware(ctx) {
  const payload = verify(ctx.cookies[SESSION_COOKIE]);
  if (payload && payload.uid) {
    const user = findUserById(payload.uid);
    if (user) ctx.user = user;
  }
}

function requireAuth(handler) {
  return (ctx) => {
    if (!ctx.user) return ctx.redirect('/login');
    return handler(ctx);
  };
}

// ====================================================================
// src/routes/pairs.js
// ====================================================================

function loadPairForMember(ctx) {
  const pair = getPairById(Number(ctx.params.id));
  if (!pair) return { error: 'not_found' };
  const role = roleInPair(pair, ctx.user.id);
  if (!role) return { error: 'forbidden' };
  return { pair, role };
}

function registerPairRoutes(router) {
  router.get('/dashboard', requireAuth((ctx) => {
    const all = listPairsForUser(ctx.user.id);
    const withStats = (p) => ({ ...p, stats: getPairStats(p.id, p.stale_days) });
    const active = all.filter((p) => p.status === 'active').map(withStats);
    const archived = all.filter((p) => p.status === 'archived').map(withStats);
    const pendingIncoming = all.filter((p) => p.status === 'pending' && p.invited_by_user_id !== ctx.user.id);
    const pendingOutgoing = all.filter((p) => p.status === 'pending' && p.invited_by_user_id === ctx.user.id);
    const { title, body } = dashboardPage({
      user: ctx.user, active, archived, pendingIncoming, pendingOutgoing, query: ctx.query,
    });
    ctx.html(layout({ title, user: ctx.user, body }));
  }));

  router.post('/pairs', requireAuth(async (ctx) => {
    const emailRaw = ctx.body.email || '';
    const relationship = ctx.body.relationship; // i_delegate | i_do | shared
    const label = (ctx.body.label || '').trim().slice(0, 60);

    if (!isValidEmail(emailRaw)) {
      return ctx.redirect(`/dashboard?error=${encodeURIComponent('Please enter a valid email address.')}`);
    }
    const otherEmail = normalizeEmail(emailRaw);
    if (otherEmail === ctx.user.email) {
      return ctx.redirect(`/dashboard?error=${encodeURIComponent("You can't connect with yourself.")}`);
    }
    const other = findOrCreateUser(otherEmail);

    // In 'shared' mode nobody is the boss, but the table still stores two
    // sides; the inviter takes the first slot and mode drives permissions.
    const mode = relationship === 'shared' ? 'shared' : 'delegated';
    const iDelegate = relationship !== 'i_do';
    const delegatorId = iDelegate ? ctx.user.id : other.id;
    const doerId = iDelegate ? other.id : ctx.user.id;

    if (findPairBetween(delegatorId, doerId) || findPairBetween(doerId, delegatorId)) {
      return ctx.redirect(`/dashboard?error=${encodeURIComponent('You are already connected with that person.')}`);
    }

    // A new person needs a code to claim their account, since email
    // delivery may not be switched on. Existing people just sign in.
    const needsCode = !other.password_hash;
    const inviteCode = needsCode ? generateInviteCode() : null;
    createPair({
      delegatorUserId: delegatorId, doerUserId: doerId,
      invitedByUserId: ctx.user.id, label, mode, inviteCode,
    });

    sendEmail({
      to: otherEmail,
      subject: `${ctx.user.email} invited you on Tirskoo`,
      text: `${ctx.user.email} invited you to Tirskoo.\n\n${mode === 'shared'
        ? 'You will work together as equals on a shared task list.'
        : iDelegate ? 'They will give you tasks.' : 'You will give them tasks.'}\n\n${inviteCode
        ? `Go to ${process.env.BASE_URL || `http://${ctx.req.headers.host}`}/join and use invite code: ${inviteCode}`
        : `Sign in at ${process.env.BASE_URL || `http://${ctx.req.headers.host}`}/login to accept.`}`,
    }).catch(() => {});

    const notice = inviteCode
      ? `Invite created for ${otherEmail}. Send them this code to join: ${inviteCode}`
      : `Invite sent to ${otherEmail}. They'll see it when they next sign in.`;
    ctx.redirect(`/dashboard?notice=${encodeURIComponent(notice)}`);
  }));

  router.post('/pairs/:id/accept', requireAuth((ctx) => {
    const { pair, role, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    if (pair.status !== 'pending' || pair.invited_by_user_id === ctx.user.id) return ctx.redirect('/dashboard');
    setPairStatus(pair.id, 'active');
    clearInviteCode(pair.id); // single-use: the code has done its job
    ctx.redirect('/dashboard?notice=' + encodeURIComponent('Connected.'));
  }));

  router.post('/pairs/:id/decline', requireAuth((ctx) => {
    const { pair, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    if (pair.status !== 'pending' || pair.invited_by_user_id === ctx.user.id) return ctx.redirect('/dashboard');
    deletePair(pair.id);
    ctx.redirect('/dashboard?notice=' + encodeURIComponent('Invite declined.'));
  }));

  router.post('/pairs/:id/settings', requireAuth((ctx) => {
    const { pair, role, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    const staleDays = Math.min(60, Math.max(1, parseInt(ctx.body.stale_days, 10) || 3));
    const label = (ctx.body.label || '').trim().slice(0, 60);
    const mode = ctx.body.mode === 'shared' ? 'shared' : 'delegated';
    updatePairSettings(pair.id, { staleDays, label, mode });
    ctx.redirect(`/pairs/${pair.id}?notice=${encodeURIComponent('Settings saved.')}`);
  }));

  // ---- ending a relationship ------------------------------------------
  // Two steps on purpose: this throws away the shared record permanently,
  // so it should never be one stray tap away.

  router.get('/pairs/:id/disconnect', requireAuth((ctx) => {
    const { pair, role, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    const stats = getPairStats(pair.id, pair.stale_days);
    const otherEmail = role === 'delegator' ? pair.doer_email : pair.delegator_email;
    const { title, body } = disconnectPage({ pair, otherEmail, stats, query: ctx.query });
    ctx.html(layout({ title, user: ctx.user, body }));
  }));

  // Rename or remove a topic from the board's topic manager.
  router.post('/pairs/:id/topics', requireAuth((ctx) => {
    const { pair, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    const name = (ctx.body.name || '').trim();
    if (name) findOrCreateTopic(pair.id, name);
    ctx.redirect(`/pairs/${pair.id}?notice=${encodeURIComponent(name ? `Topic "${name}" added.` : 'Nothing to add.')}`);
  }));

  router.post('/pairs/:id/topics/:topicId/delete', requireAuth((ctx) => {
    const { pair, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    // Tasks are kept — they simply lose their topic.
    deleteTopic(pair.id, Number(ctx.params.topicId));
    ctx.redirect(`/pairs/${pair.id}?notice=${encodeURIComponent('Topic removed. Its tasks are still here.')}`);
  }));

  // Archiving is the safe, reversible option and needs no confirmation.
  router.post('/pairs/:id/archive', requireAuth((ctx) => {
    const { pair, role, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    const otherEmail = role === 'delegator' ? pair.doer_email : pair.delegator_email;
    archivePair(pair.id);
    ctx.redirect('/dashboard?notice=' + encodeURIComponent(
      `Archived. Everything with ${otherEmail} is kept and can be brought back any time.`));
  }));

  router.post('/pairs/:id/restore', requireAuth((ctx) => {
    const { pair, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    restorePair(pair.id);
    ctx.redirect('/dashboard?notice=' + encodeURIComponent('Brought back.'));
  }));

  // Deleting is permanent, so it needs the other person's email typed out.
  router.post('/pairs/:id/disconnect', requireAuth((ctx) => {
    const { pair, role, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    const otherEmail = role === 'delegator' ? pair.doer_email : pair.delegator_email;

    const typed = normalizeEmail(ctx.body.confirm_email || '');
    if (typed !== otherEmail) {
      return ctx.redirect(`/pairs/${pair.id}/disconnect?error=${encodeURIComponent(
        `To delete permanently, type ${otherEmail} exactly. Nothing has been deleted.`)}`);
    }
    disconnectPair(pair.id);
    ctx.redirect('/dashboard?notice=' + encodeURIComponent(`Deleted everything with ${otherEmail}.`));
  }));

  router.get('/pairs/:id', requireAuth((ctx) => {
    const { pair, role, error } = loadPairForMember(ctx);
    if (error === 'not_found') return ctx.notFound();
    if (error === 'forbidden') return ctx.html(layout({ title: 'Forbidden', user: ctx.user, body: '<div class="alert alert-error">You are not part of this pair.</div>' }), 403);

    const perms = permissionsFor(pair, role);
    const topics = listTopics(pair.id);
    const counts = topicCounts(pair.id);

    // Optional ?topic= filter. 'none' means "tasks with no topic yet".
    const filter = ctx.query.topic || '';
    const filterId = filter === 'none' ? 0 : (filter ? Number(filter) : null);

    let tasks = listTasksForPair(pair.id);
    if (filterId !== null && !Number.isNaN(filterId)) {
      tasks = tasks.filter((t) => (t.topic_id || 0) === filterId);
    }

    const columns = { todo: [], in_progress: [], done: [] };
    for (const task of tasks) {
      const events = listTaskEvents(task.id);
      const notes = listTaskNotes(task.id);
      columns[task.status].push({ task, role, perms, user: ctx.user, pair, events, notes });
    }
    // Urgent-first, then (for open tasks) oldest status-change first so the
    // most-gone-quiet items surface near the top; done tasks newest first.
    for (const status of Object.keys(columns)) {
      columns[status].sort((a, b) => {
        if (a.task.is_urgent !== b.task.is_urgent) return a.task.is_urgent ? -1 : 1;
        if (status === 'done') return new Date(b.task.done_at || 0) - new Date(a.task.done_at || 0);
        return new Date(a.task.status_changed_at) - new Date(b.task.status_changed_at);
      });
    }

    const stats = getPairStats(pair.id, pair.stale_days);
    const { title, body, wide } = pairPage({
      user: ctx.user, pair, role, perms, columns, stats,
      topics, counts, activeTopic: filter, query: ctx.query,
    });
    ctx.html(layout({ title, user: ctx.user, body, wide }));
  }));

  router.post('/pairs/:id/tasks', requireAuth((ctx) => {
    const { pair, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    const title = (ctx.body.title || '').trim().slice(0, 200);
    if (!title) return ctx.redirect(`/pairs/${pair.id}?error=${encodeURIComponent('Title is required.')}&opened=add`);
    const description = (ctx.body.description || '').trim().slice(0, 1000);
    const dueDate = (ctx.body.due_date || '').trim();
    const isUrgent = ctx.body.is_urgent === '1';

    // A typed-in new topic wins over the dropdown selection, so people can
    // add a topic and use it in the same step.
    const newTopic = (ctx.body.new_topic || '').trim();
    let topicId = null;
    if (newTopic) {
      const t = findOrCreateTopic(pair.id, newTopic);
      topicId = t ? t.id : null;
    } else if (ctx.body.topic_id) {
      const t = getTopic(pair.id, Number(ctx.body.topic_id));
      topicId = t ? t.id : null;
    }

    createTask({
      pairId: pair.id, title, description, dueDate: dueDate || null,
      createdByUserId: ctx.user.id, isUrgent, topicId,
    });
    ctx.redirect(`/pairs/${pair.id}?notice=${encodeURIComponent('Task added.')}`);
  }));

  function loadTaskInPair(ctx, pair) {
    const task = getTaskById(Number(ctx.params.taskId));
    if (!task || task.pair_id !== pair.id) return null;
    return task;
  }

  router.post('/pairs/:id/tasks/:taskId/status', requireAuth((ctx) => {
    const { pair, role, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    const task = loadTaskInPair(ctx, pair);
    if (!task) return ctx.notFound();
    if (!permissionsFor(pair, role).canChangeStatus) {
      return ctx.redirect(`/pairs/${pair.id}?error=${encodeURIComponent('Only the doer can change task status in this relationship.')}`);
    }
    const toStatus = ctx.body.status;
    if (!['todo', 'in_progress', 'done'].includes(toStatus)) {
      return ctx.redirect(`/pairs/${pair.id}?error=${encodeURIComponent('Invalid status.')}`);
    }
    updateTaskStatus(task.id, { toStatus, actorUserId: ctx.user.id });
    ctx.redirect(`/pairs/${pair.id}`);
  }));

  router.post('/pairs/:id/tasks/:taskId/note', requireAuth((ctx) => {
    const { pair, role, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    const task = loadTaskInPair(ctx, pair);
    if (!task) return ctx.notFound();
    // Both people can leave a note — but only ever their own. saveMyNote is
    // keyed on the acting user, so neither side can touch the other's.
    const note = (ctx.body.note || '').trim().slice(0, 500);
    saveMyNote(task.id, { note, actorUserId: ctx.user.id });
    ctx.redirect(`/pairs/${pair.id}?notice=${encodeURIComponent(note ? 'Note saved.' : 'Note removed.')}`);
  }));

  router.post('/pairs/:id/tasks/:taskId/urgent', requireAuth((ctx) => {
    const { pair, error } = loadPairForMember(ctx);
    if (error) return ctx.redirect('/dashboard');
    const task = loadTaskInPair(ctx, pair);
    if (!task) return ctx.notFound();
    if (task.created_by_user_id !== ctx.user.id) {
      return ctx.redirect(`/pairs/${pair.id}?error=${encodeURIComponent('Only the person who created a task can toggle urgent.')}`);
    }
    setTaskUrgent(task.id, { isUrgent: !task.is_urgent, actorUserId: ctx.user.id });
    ctx.redirect(`/pairs/${pair.id}`);
  }));
}

// ====================================================================
// src/routes/cron.js
// ====================================================================

async function runWeeklyDigest() {
  const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const pairs = listActivePairs();

  // Group by delegator so someone in several pairs gets one email, not several.
  const byDelegator = new Map();
  for (const pair of pairs) {
    const done = listTasksDoneSince(pair.id, sinceIso);
    if (!done.length) continue;
    const list = byDelegator.get(pair.delegator_user_id) || { email: pair.delegator_email, sections: [] };
    list.sections.push({ pair, done });
    byDelegator.set(pair.delegator_user_id, list);
  }

  const results = [];
  for (const [, entry] of byDelegator) {
    const text = [
      `Here's what got marked done this week:`,
      '',
      ...entry.sections.flatMap(({ pair, done }) => [
        `${pair.label || pair.doer_email} (${pair.doer_email}):`,
        ...done.map((t) => `  - ${t.title} (done ${fmtDate(t.done_at)})`),
        '',
      ]),
    ].join('\n');

    await sendEmail({ to: entry.email, subject: 'Your weekly Tirskoo digest', text });
    results.push({ to: entry.email, taskCount: entry.sections.reduce((n, s) => n + s.done.length, 0) });
  }
  return results;
}

function registerCronRoutes(router) {
  const handler = async (ctx) => {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const provided = ctx.query.secret || ctx.req.headers['x-cron-secret'];
      if (provided !== secret) return ctx.text('Forbidden', 403);
    } else if (process.env.NODE_ENV === 'production') {
      return ctx.text('CRON_SECRET is not configured', 500);
    }
    const results = await runWeeklyDigest();
    ctx.json({ ok: true, sent: results.length, results });
  };
  router.get('/cron/weekly-digest', handler);
  router.post('/cron/weekly-digest', handler);
}

// ====================================================================
// src/app.js
// ====================================================================


const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function createApp() {
  const router = createRouter();
  router.use(sessionMiddleware);

  router.get('/', (ctx) => ctx.redirect(ctx.user ? '/dashboard' : '/login'));

  router.get('/style.css', (ctx) => {
    ctx.res.writeHead(200, { 'Content-Type': MIME['.css'], 'Cache-Control': 'public, max-age=300' });
    ctx.res.end(STYLE_CSS);
  });

  router.get('/healthz', (ctx) => ctx.text('ok'));

  registerAuthRoutes(router);
  registerPairRoutes(router);
  registerCronRoutes(router);

  maybeScheduleInProcessDigest();

  return router;
}

// Optional convenience for single-instance deployments that don't have an
// external scheduler available: check once an hour and fire the digest the
// first time we see Monday 08:00 (server-local time) each week. Off by
// default — see .env.example.
function maybeScheduleInProcessDigest() {
  if (process.env.ENABLE_IN_PROCESS_DIGEST !== 'true') return;
  let lastRunWeekKey = null;
  const check = async () => {
    const now = new Date();
    const isMondayMorning = now.getDay() === 1 && now.getHours() === 8;
    const weekKey = `${now.getFullYear()}-${Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000))}`;
    if (isMondayMorning && weekKey !== lastRunWeekKey) {
      lastRunWeekKey = weekKey;
      console.log('[digest] firing in-process weekly digest');
      try { await runWeeklyDigest(); } catch (err) { console.error('[digest] failed', err); }
    }
  };
  setInterval(check, 60 * 60 * 1000);
}

// ====================================================================
// server.js
// ====================================================================

const router = createApp();
const port = Number(process.env.PORT) || 3000;

const server = http.createServer((req, res) => {
  router.handle(req, res);
});

server.listen(port, () => {
  console.log(`Tirskoo listening on http://localhost:${port}`);
  if (!process.env.RESEND_API_KEY) {
    console.log('[email] No RESEND_API_KEY set — emails will be logged to this console.');
  }
});
