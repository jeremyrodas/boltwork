---
target: Strongroom renderer UI
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\skynet\\Documents\\git\\strongroom\\src\\renderer\\styles.css"
target_fingerprint: "sha256:cb8e822fb2aab7b29f3bd6c81f3ea2d9e89a8d46954867fd7049e2b7ed4a8f85"
target_path: "C:\\Users\\skynet\\Documents\\git\\strongroom\\src\\renderer\\styles.css"
timestamp: 2026-11-05T08-40-18Z
slug: src-renderer-styles-css
closed: true
---
# Strongroom UI critique (dual-agent)

Score 23/40 (Acceptable). Heuristics: status 2, real world 3, control 2, consistency 2, error prevention 2, recognition 2, efficiency 3, minimalism 2, error recovery 2, help 3.

Specificity: competent but category-interchangeable; emoji icon system, SaaS blue-violet gradient primary; the vault-dial brand mark is the one authored seed and is unused beyond the logo. Credential typography (two-tone mono password, split TOTP) is the strongest authored detail.

## Priority issues
1. [P1] Watchtower shows switched-off checks as green/passing; score ignores missing checks.
2. [P1] One-time code has no copy button and is click-only; row actions at 40% opacity; toasts not announced.
3. [P1] Esc in the item editor discards edits without asking.
4. [P2] Contrast: gradient primary 3.4:1 with white text, default placeholder 3.9:1, muted text on selection 4.0:1, strength labels 3.4:1, light-theme warn/good text ~2.2:1, 10px TOTP countdown, no themed focus-visible.
5. [P2] Emoji as icon system; Watchtower side stripes (side-tab) and nested banner; 12-item item menu with flat Watchtower ignores; 22-tile category picker.

Personas: Alex (no copy-code shortcut in main window, shortcuts not in tooltips); Sam (no focus ring theme, menus/modals lack ARIA and focus handling, labels not linked, no live regions).
