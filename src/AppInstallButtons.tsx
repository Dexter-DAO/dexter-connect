import { useEffect, useRef, useState, type ReactElement } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// AppInstallButtons — put an MCP server into the user's agent app with one
// explicit action per app. The first-class version of the docs-page install
// row (Rule #7): one component, real app marks, themeable via --dx-* vars,
// placeable on any surface.
//
// Mechanisms, verified from primary sources 2026-07-19:
//  - Cursor   cursor://anysphere.cursor-deeplink/mcp/install?name&config(base64)
//             (cursor.com/docs/mcp/install-links)
//  - VS Code  vscode:mcp/install?{URL-encoded JSON.stringify({name,type,url})}
//             (code.visualstudio.com/api/extension-guides/ai/mcp)
//  - Hermes   copies `hermes mcp add <name> --url <url> --auth oauth`, then
//             launches the app via its registered hermes:// protocol handler
//             (NousResearch/hermes-agent apps/desktop). The deep link focuses
//             the app; the paste is the install until Hermes honors an mcp
//             deep-link kind.
//  - Claude Code  copies `claude mcp add --transport http <name> <url>`.
//
// Interaction contract: every action is labeled with exactly what it does,
// nothing navigates by surprise, copy actions confirm visibly.
// ─────────────────────────────────────────────────────────────────────────────

const STYLE_ID = 'dexter-connect-appinstall-styles';

const APPINSTALL_CSS = `
.dx-appinstall{ display:flex; flex-wrap:wrap; gap:10px; }
.dx-appinstall--block{ flex-direction:column; }
.dx-appbtn{
  display:inline-flex; align-items:center; gap:10px;
  padding:10px 16px; border:1px solid var(--dx-appbtn-border, rgba(255,255,255,.14));
  border-radius:var(--dx-radius,0px);
  background:var(--dx-appbtn-bg, rgba(8,8,8,.55));
  color:var(--dx-appbtn-fg, #f4ece0); font:inherit; font-weight:600; font-size:.84rem;
  cursor:pointer; text-decoration:none; -webkit-tap-highlight-color:transparent;
  transition:border-color .16s ease, background .16s ease, transform .16s ease;
}
.dx-appbtn:hover{ border-color:color-mix(in srgb,var(--dx-ember,#f26c18) 55%,transparent); transform:translateY(-1px); }
.dx-appbtn:active{ transform:translateY(0); }
.dx-appbtn:focus-visible{ outline:none; box-shadow:0 0 0 3px color-mix(in srgb,var(--dx-ember,#f26c18) 38%,transparent); }
.dx-appbtn--block{ width:100%; justify-content:flex-start; }
.dx-appbtn__logo{
  width:22px; height:22px; display:block; flex:none; box-sizing:border-box;
  background:#fff; padding:3px; border-radius:var(--dx-radius,0px);
}
.dx-appbtn__copied{ color:var(--dx-ember,#f26c18); }
`;

export function ensureAppInstallStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = APPINSTALL_CSS;
  document.head.appendChild(el);
}

// App marks as isolated data URIs: no id collisions, brand colors intact.
const CURSOR_MARK = 'data:image/svg+xml;base64,PHN2ZyBmaWxsPSJub25lIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHdpZHRoPSI1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0ibTUxMiAzMjUuNWMwIDcuMTI0IDAgMTQuMjQtLjA0MSAyMS4zNjQtLjAzNCA1Ljk5OS0uMTAzIDExLjk5OC0uMjY4IDE3Ljk5LS4zNTYgMTMuMDY4LTEuMTI0IDI2LjI0NS0zLjQ0OCAzOS4xNjktMi4zNTkgMTMuMTA5LTYuMjA1IDI1LjMwNi0xMi4yNjYgMzcuMjIyLTUuOTU4IDExLjcwMy0xMy43NDYgMjIuNDE5LTIzLjAyOSAzMS43MDktOS4yOSA5LjI5LTIwIDE3LjA3Mi0zMS43MSAyMy4wMy0xMS45MDkgNi4wNjEtMjQuMTEzIDkuOTA3LTM3LjIyMiAxMi4yNjYtMTIuOTIzIDIuMzI0LTI2LjEwMSAzLjA5Mi0zOS4xNjkgMy40NDgtNS45OTkuMTY1LTExLjk5MS4yMzMtMTcuOTkuMjY4LTcuMTIzLjA0OC0xNC4yNC4wNDEtMjEuMzY0LjA0MWgtMTM5Yy03LjEyNCAwLTE0LjI0IDAtMjEuMzY0LS4wNDEtNS45OTktLjAzNS0xMS45OTgtLjEwMy0xNy45OS0uMjY4LTEzLjA2OC0uMzU2LTI2LjI0NS0xLjEyNC0zOS4xNjktMy40NDgtMTMuMTA5LTIuMzU5LTI1LjMwNi02LjIwNS0zNy4yMjE5LTEyLjI2Ni0xMS43MDMzLTUuOTU4LTIyLjQxOTQtMTMuNzQ2LTMxLjcwOTUtMjMuMDMtOS4yOS05LjI5LTE3LjA3MTctMTkuOTk5LTIzLjAyOTYtMzEuNzA5LTYuMDYwOC0xMS45MDktOS45MDcwNy0yNC4xMTMtMTIuMjY1NTctMzcuMjIyLTIuMzI0MjItMTIuOTI0LTMuMDkyMS0yNi4xMDEtMy40NDg2MTgtMzkuMTY5LS4xNjQ1NDYtNS45OTktLjIzMzEwNzEtMTEuOTkxLS4yNjczODc2LTE3Ljk5LS4wMjc0MjQ0LTcuMTI0LS4wMjc0MjQ0LTE0LjI0LS4wMjc0MjQ0LTIxLjM2NHYtMTM5YzAtNy4xMjQgMC0xNC4yNC4wNDExMzY2LTIxLjM2NC4wMzQyODA1LTUuOTk5LjEwMjg0MTQtMTEuOTk4LjI2NzM4ODQtMTcuOTkuMzU2NTE3LTEzLjA2OCAxLjEyNDQwNS0yNi4yNDUgMy40NDg2MTUtMzkuMTY5IDIuMzU4NS0xMy4xMDkxIDYuMjA0NzgtMjUuMzA2MSAxMi4yNjU1Ni0zNy4yMjIgNS45NTgtMTEuNzAzNCAxMy43NDY1LTIyLjQxOTUgMjMuMDI5Ny0zMS43MDk1IDkuMjktOS4yOSAxOS45OTkyLTE3LjA3MTcgMzEuNzA5NC0yMy4wMjk2IDExLjkwOTEtNi4wNjA4NCAyNC4xMTI5LTkuOTA3MTEgMzcuMjIyMi0xMi4yNjU2MSAxMi45MjMtMi4zMjQyMiAyNi4xMDEtMy4wOTIxMDQgMzkuMTY5LTMuNDQ4NjIyIDUuOTk5LS4xNjQ1NDYgMTEuOTkxLS4yMzMxMDcgMTcuOTktLjI2NzM4NzUgNy4xMTctLjAzNDI4MDUgMTQuMjMzLS4wMzQyODA1IDIxLjM1Ny0uMDM0MjgwNWgxMzljNy4xMjQgMCAxNC4yNCAwIDIxLjM2NC4wNDExMzY2IDUuOTk5LjAzNDI4MDUgMTEuOTk4LjEwMjg0MTQgMTcuOTkuMjY3Mzg4NCAxMy4wNjguMzU2NTE3IDI2LjI0NSAxLjEyNDQwNSAzOS4xNjkgMy40NDg2MTUgMTMuMTA5IDIuMzU4NSAyNS4zMDYgNi4yMDQ3OCAzNy4yMjIgMTIuMjY1NTYgMTEuNzAzIDUuOTU4IDIyLjQxOSAxMy43NDY1IDMxLjcwOSAyMy4wMjk3IDkuMjkgOS4yOSAxNy4wNzIgMTkuOTk5MiAyMy4wMyAzMS43MDk0IDYuMDYxIDExLjkwOTEgOS45MDcgMjQuMTEyOSAxMi4yNjYgMzcuMjIyMiAyLjMyNCAxMi45MjMgMy4wOTIgMjYuMTAxIDMuNDQ4IDM5LjE2OS4xNjUgNS45OTkuMjMzIDExLjk5MS4yNjggMTcuOTkuMDQ4IDcuMTIzLjA0MSAxNC4yNC4wNDEgMjEuMzY0djEzOXoiIGZpbGw9IiMxNDEyMGIiLz48cGF0aCBkPSJtMTg2LjUgNGgxMzljNy4xMjUgMCAxNC4yMzEtLjAwMDA0IDIxLjM0MS4wNDEwMiA1Ljk4NS4wMzQyIDExLjk1Mi4xMDIyMSAxNy45MDMuMjY1NjJoLjAwMWMxMy4wMDMuMzU0NzUgMjUuOTQzIDEuMTE3MDkgMzguNTY5IDMuMzg3NyAxMi43NzUgMi4yOTgyNyAyNC41OTIgNi4wMzE0NiAzNi4xMTggMTEuODkzNTZ2LS4wMDFjMTAuOTc0IDUuNTg2NyAyMS4wNTIgMTIuODM4NCAyOS44NDggMjEuNDU3bC44NDcuODM3OWM4Ljk5MyA4Ljk5MyAxNi41MjUgMTkuMzU5NCAyMi4yOTIgMzAuNjkzNHYuMDAxYzUuNjc4IDExLjE1NzUgOS4zNiAyMi42MDIzIDExLjY3NCAzNC45MjA4bC4yMTkgMS4xOTVjMi4xMjkgMTEuODM3IDIuOTMyIDIzLjk1IDMuMzE2IDM2LjEzMmwuMDcyIDIuNDM4Yy4xNjQgNS45NTguMjMyIDExLjkxOS4yNjYgMTcuOTA0di4wMDRjLjA0OCA3LjEwNy4wNDEgMTQuMjA3LjA0MSAyMS4zMzd2MTI5LjM0NGwtLjAwNy0uMDA3djkuNjU2YzAgNy4xMjUgMCAxNC4yMzEtLjA0MSAyMS4zNDEtLjAzNCA1Ljk4NS0uMTAyIDExLjk1Mi0uMjY2IDE3LjkwM3YuMDAxYy0uMzU0IDEzLjAwMy0xLjExNyAyNS45NDMtMy4zODcgMzguNTY5LTIuMjI3IDEyLjM3Ni01LjggMjMuODUzLTExLjM1MSAzNS4wMzdsLS41NDMgMS4wOGMtNS43NjYgMTEuMzI3LTEzLjMwNiAyMS43MDEtMjIuMjkzIDMwLjY5NS04Ljk5MyA4Ljk5My0xOS4zNjEgMTYuNTI2LTMwLjY5NSAyMi4yOTMtMTEuNTE4IDUuODYxLTIzLjM0MiA5LjU5NS0zNi4xMTYgMTEuODkzLTExLjgzNyAyLjEyOS0yMy45NSAyLjkzMi0zNi4xMzIgMy4zMTZsLTIuNDM4LjA3MmMtNS45NTguMTY0LTExLjkxOS4yMzItMTcuOTA0LjI2NmgtLjAwNGMtNy4xMDcuMDQ4LTE0LjIwNy4wNDEtMjEuMzM3LjA0MWgtMTM5Yy03LjEyNSAwLTE0LjIzMSAwLTIxLjM0MS0uMDQxLTUuOTg1LS4wMzQtMTEuOTUyLS4xMDItMTcuOTAzLS4yNjZoLS4wMDFjLTEzLjAwMy0uMzU1LTI1Ljk0NC0xLjExNy0zOC41Ny0zLjM4OC0xMi43NzQyLTIuMjk4LTI0LjU5MTQtNi4wMzEtMzYuMTE2NS0xMS44OTNoLjAwMWMtMTAuOTc0LTUuNTg3LTIxLjA1MzQtMTIuODM3LTI5Ljg0OTYtMjEuNDU2bC0uODQ2Ny0uODM4Yy04LjcxMTgtOC43MTItMTYuMDUzMS0xOC43MTMtMjEuNzQ2MS0yOS42MzRsLS41NDU5LTEuMDYtLjU0MzktMS4wODFjLTUuMzcxLTEwLjgxNi04Ljg5MDUtMjEuOTE5LTExLjEyOTkxLTMzLjg0bC0uMjE5NzMtMS4xOTZjLTIuMjcwNjEtMTIuNjI2LTMuMDMyOTQtMjUuNTY2LTMuMzg3NjktMzguNTY5di0uMDAxYy0uMTYzNDEtNS45NTgtLjIzMTQyLTExLjkxOC0uMjY1NjMtMTcuOTAzLS4wMjczNi03LjExMi0uMDI3MzQtMTQuMjE5LS4wMjczNC0yMS4zNDF2LTEzOWMwLTcuMTI1LS4wMDAwNC0xNC4yMzEuMDQxMDItMjEuMzQxLjAzNDItNS45ODUuMTAyMjEtMTEuOTUyLjI2NTYyLTE3LjkwM3YtLjAwMWMuMzU0NzYtMTMuMDAzIDEuMTE3LTI1Ljk0NCAzLjM4NzctMzguNTcgMi4yOTgyOC0xMi43NzQ0IDYuMDMxNTYtMjQuNTkxNiAxMS44OTM1Ni0zNi4xMTY2bC0uMDAxLS4wMDFjNS43NjY2LTExLjMyNyAxMy4zMDczLTIxLjY5OTkgMjIuMjk0LTMwLjY5MzQgOC45OTMzLTguOTkzMyAxOS4zNjA3LTE2LjUyNjEgMzAuNjk1My0yMi4yOTI5IDExLjUxNzMtNS44NjE1IDIzLjM0MDYtOS41OTYxOSAzNi4xMTQ4LTExLjg5NDU4IDExLjgzNy0yLjEyODc3IDIzLjk1MS0yLjkzMDE2IDM2LjEzMy0zLjMxNDQ1bDIuNDM4LS4wNzIyN2M1Ljk1OC0uMTYzNDIgMTEuOTE5LS4yMzE0MiAxNy45MDQtLjI2NTYybC0uMDAxLS4wMDA5OGM3LjEwNC0uMDM0MjEgMTQuMjExLS4wMzMyIDIxLjMzNS0uMDMzMnoiIHN0cm9rZT0iI2VkZWNlYyIgc3Ryb2tlLW9wYWNpdHk9Ii4yIiBzdHJva2Utd2lkdGg9IjgiLz48cGF0aCBkPSJtNDE1LjAzNSAxNTYuMzUtMTUxLjUwMy04Ny40Njk1Yy00Ljg2NS0yLjgwOTQtMTAuODY4LTIuODA5NC0xNS43MzMgMGwtMTUxLjQ5NjkgODcuNDY5NWMtNC4wODk3IDIuMzYyLTYuNjE0NiA2LjcyOS02LjYxNDYgMTEuNDU5djE3Ni4zODNjMCA0LjczIDIuNTI0OSA5LjA5NyA2LjYxNDYgMTEuNDU4bDE1MS41MDM5IDg3LjQ3YzQuODY1IDIuODA5IDEwLjg2OCAyLjgwOSAxNS43MzMgMGwxNTEuNTA0LTg3LjQ3YzQuMDg5LTIuMzYxIDYuNjE0LTYuNzI4IDYuNjE0LTExLjQ1OHYtMTc2LjM4M2MwLTQuNzMtMi41MjUtOS4wOTctNi42MTQtMTEuNDU5em0tOS41MTYgMTguNTI4LTE0Ni4yNTUgMjUzLjMyYy0uOTg4IDEuNzA3LTMuNTk5IDEuMDEtMy41OTktLjk2N3YtMTY1Ljg3MmMwLTMuMzE0LTEuNzcxLTYuMzc5LTQuNjQ0LTguMDQ0bC0xNDMuNjQ1LTgyLjkzMmMtMS43MDctLjk4OC0xLjAxLTMuNTk5Ljk2OC0zLjU5OWgyOTIuNTA5YzQuMTU0IDAgNi43NSA0LjUwMyA0LjY3MyA4LjEwMWgtLjAwN3oiIGZpbGw9IiNlZGVjZWMiLz48L3N2Zz4=';
const VSCODE_MARK = 'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPG1hc2sgaWQ9Im1hc2swIiBtYXNrLXR5cGU9ImFscGhhIiBtYXNrVW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4PSIwIiB5PSIwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCI+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNNzAuOTExOSA5OS4zMTcxQzcyLjQ4NjkgOTkuOTMwNyA3NC4yODI4IDk5Ljg5MTQgNzUuODcyNSA5OS4xMjY0TDk2LjQ2MDggODkuMjE5N0M5OC42MjQyIDg4LjE3ODcgMTAwIDg1Ljk4OTIgMTAwIDgzLjU4NzJWMTYuNDEzM0MxMDAgMTQuMDExMyA5OC42MjQzIDExLjgyMTggOTYuNDYwOSAxMC43ODA4TDc1Ljg3MjUgMC44NzM3NTZDNzMuNzg2MiAtMC4xMzAxMjkgNzEuMzQ0NiAwLjExNTc2IDY5LjUxMzUgMS40NDY5NUM2OS4yNTIgMS42MzcxMSA2OS4wMDI4IDEuODQ5NDMgNjguNzY5IDIuMDgzNDFMMjkuMzU1MSAzOC4wNDE1TDEyLjE4NzIgMjUuMDA5NkMxMC41ODkgMjMuNzk2NSA4LjM1MzYzIDIzLjg5NTkgNi44NjkzMyAyNS4yNDYxTDEuMzYzMDMgMzAuMjU0OUMtMC40NTI1NTIgMzEuOTA2NCAtMC40NTQ2MzMgMzQuNzYyNyAxLjM1ODUzIDM2LjQxN0wxNi4yNDcxIDUwLjAwMDFMMS4zNTg1MyA2My41ODMyQy0wLjQ1NDYzMyA2NS4yMzc0IC0wLjQ1MjU1MiA2OC4wOTM4IDEuMzYzMDMgNjkuNzQ1M0w2Ljg2OTMzIDc0Ljc1NDFDOC4zNTM2MyA3Ni4xMDQzIDEwLjU4OSA3Ni4yMDM3IDEyLjE4NzIgNzQuOTkwNUwyOS4zNTUxIDYxLjk1ODdMNjguNzY5IDk3LjkxNjdDNjkuMzkyNSA5OC41NDA2IDcwLjEyNDYgOTkuMDEwNCA3MC45MTE5IDk5LjMxNzFaTTc1LjAxNTIgMjcuMjk4OUw0NS4xMDkxIDUwLjAwMDFMNzUuMDE1MiA3Mi43MDEyVjI3LjI5ODlaIiBmaWxsPSJ3aGl0ZSIvPgo8L21hc2s+CjxnIG1hc2s9InVybCgjbWFzazApIj4KPHBhdGggZD0iTTk2LjQ2MTQgMTAuNzk2Mkw3NS44NTY5IDAuODc1NTQyQzczLjQ3MTkgLTAuMjcyNzczIDcwLjYyMTcgMC4yMTE2MTEgNjguNzUgMi4wODMzM0wxLjI5ODU4IDYzLjU4MzJDLTAuNTE1NjkzIDY1LjIzNzMgLTAuNTEzNjA3IDY4LjA5MzcgMS4zMDMwOCA2OS43NDUyTDYuODEyNzIgNzQuNzU0QzguMjk3OTMgNzYuMTA0MiAxMC41MzQ3IDc2LjIwMzYgMTIuMTMzOCA3NC45OTA1TDkzLjM2MDkgMTMuMzY5OUM5Ni4wODYgMTEuMzAyNiAxMDAgMTMuMjQ2MiAxMDAgMTYuNjY2N1YxNi40Mjc1QzEwMCAxNC4wMjY1IDk4LjYyNDYgMTEuODM3OCA5Ni40NjE0IDEwLjc5NjJaIiBmaWxsPSIjMDA2NUE5Ii8+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXIwX2QpIj4KPHBhdGggZD0iTTk2LjQ2MTQgODkuMjAzOEw3NS44NTY5IDk5LjEyNDVDNzMuNDcxOSAxMDAuMjczIDcwLjYyMTcgOTkuNzg4NCA2OC43NSA5Ny45MTY3TDEuMjk4NTggMzYuNDE2OUMtMC41MTU2OTMgMzQuNzYyNyAtMC41MTM2MDcgMzEuOTA2MyAxLjMwMzA4IDMwLjI1NDhMNi44MTI3MiAyNS4yNDZDOC4yOTc5MyAyMy44OTU4IDEwLjUzNDcgMjMuNzk2NCAxMi4xMzM4IDI1LjAwOTVMOTMuMzYwOSA4Ni42MzAxQzk2LjA4NiA4OC42OTc0IDEwMCA4Ni43NTM4IDEwMCA4My4zMzM0VjgzLjU3MjZDMTAwIDg1Ljk3MzUgOTguNjI0NiA4OC4xNjIyIDk2LjQ2MTQgODkuMjAzOFoiIGZpbGw9IiMwMDdBQ0MiLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyMV9kKSI+CjxwYXRoIGQ9Ik03NS44NTc4IDk5LjEyNjNDNzMuNDcyMSAxMDAuMjc0IDcwLjYyMTkgOTkuNzg4NSA2OC43NSA5Ny45MTY2QzcxLjA1NjQgMTAwLjIyMyA3NSA5OC41ODk1IDc1IDk1LjMyNzhWNC42NzIxM0M3NSAxLjQxMDM5IDcxLjA1NjQgLTAuMjIzMTA2IDY4Ljc1IDIuMDgzMjlDNzAuNjIxOSAwLjIxMTQwMiA3My40NzIxIC0wLjI3MzY2NiA3NS44NTc4IDAuODczNjMzTDk2LjQ1ODcgMTAuNzgwN0M5OC42MjM0IDExLjgyMTcgMTAwIDE0LjAxMTIgMTAwIDE2LjQxMzJWODMuNTg3MUMxMDAgODUuOTg5MSA5OC42MjM0IDg4LjE3ODYgOTYuNDU4NiA4OS4yMTk2TDc1Ljg1NzggOTkuMTI2M1oiIGZpbGw9IiMxRjlDRjAiLz4KPC9nPgo8ZyBzdHlsZT0ibWl4LWJsZW5kLW1vZGU6b3ZlcmxheSIgb3BhY2l0eT0iMC4yNSI+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNNzAuODUxMSA5OS4zMTcxQzcyLjQyNjEgOTkuOTMwNiA3NC4yMjIxIDk5Ljg5MTMgNzUuODExNyA5OS4xMjY0TDk2LjQgODkuMjE5N0M5OC41NjM0IDg4LjE3ODcgOTkuOTM5MiA4NS45ODkyIDk5LjkzOTIgODMuNTg3MVYxNi40MTMzQzk5LjkzOTIgMTQuMDExMiA5OC41NjM1IDExLjgyMTcgOTYuNDAwMSAxMC43ODA3TDc1LjgxMTcgMC44NzM2OTVDNzMuNzI1NSAtMC4xMzAxOSA3MS4yODM4IDAuMTE1Njk5IDY5LjQ1MjcgMS40NDY4OEM2OS4xOTEyIDEuNjM3MDUgNjguOTQyIDEuODQ5MzcgNjguNzA4MiAyLjA4MzM1TDI5LjI5NDMgMzguMDQxNEwxMi4xMjY0IDI1LjAwOTZDMTAuNTI4MyAyMy43OTY0IDguMjkyODUgMjMuODk1OSA2LjgwODU1IDI1LjI0NkwxLjMwMjI1IDMwLjI1NDhDLTAuNTEzMzM0IDMxLjkwNjQgLTAuNTE1NDE1IDM0Ljc2MjcgMS4yOTc3NSAzNi40MTY5TDE2LjE4NjMgNTBMMS4yOTc3NSA2My41ODMyQy0wLjUxNTQxNSA2NS4yMzc0IC0wLjUxMzMzNCA2OC4wOTM3IDEuMzAyMjUgNjkuNzQ1Mkw2LjgwODU1IDc0Ljc1NEM4LjI5Mjg1IDc2LjEwNDIgMTAuNTI4MyA3Ni4yMDM2IDEyLjEyNjQgNzQuOTkwNUwyOS4yOTQzIDYxLjk1ODZMNjguNzA4MiA5Ny45MTY3QzY5LjMzMTcgOTguNTQwNSA3MC4wNjM4IDk5LjAxMDQgNzAuODUxMSA5OS4zMTcxWk03NC45NTQ0IDI3LjI5ODlMNDUuMDQ4MyA1MEw3NC45NTQ0IDcyLjcwMTJWMjcuMjk4OVoiIGZpbGw9InVybCgjcGFpbnQwX2xpbmVhcikiLz4KPC9nPgo8L2c+CjxkZWZzPgo8ZmlsdGVyIGlkPSJmaWx0ZXIwX2QiIHg9Ii04LjM5NDExIiB5PSIxNS44MjkxIiB3aWR0aD0iMTE2LjcyNyIgaGVpZ2h0PSI5Mi4yNDU2IiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+CjxmZUZsb29kIGZsb29kLW9wYWNpdHk9IjAiIHJlc3VsdD0iQmFja2dyb3VuZEltYWdlRml4Ii8+CjxmZUNvbG9yTWF0cml4IGluPSJTb3VyY2VBbHBoYSIgdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDEyNyAwIi8+CjxmZU9mZnNldC8+CjxmZUdhdXNzaWFuQmx1ciBzdGREZXZpYXRpb249IjQuMTY2NjciLz4KPGZlQ29sb3JNYXRyaXggdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAuMjUgMCIvPgo8ZmVCbGVuZCBtb2RlPSJvdmVybGF5IiBpbjI9IkJhY2tncm91bmRJbWFnZUZpeCIgcmVzdWx0PSJlZmZlY3QxX2Ryb3BTaGFkb3ciLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbj0iU291cmNlR3JhcGhpYyIgaW4yPSJlZmZlY3QxX2Ryb3BTaGFkb3ciIHJlc3VsdD0ic2hhcGUiLz4KPC9maWx0ZXI+CjxmaWx0ZXIgaWQ9ImZpbHRlcjFfZCIgeD0iNjAuNDE2NyIgeT0iLTguMDc1NTgiIHdpZHRoPSI0Ny45MTY3IiBoZWlnaHQ9IjExNi4xNTEiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz4KPGZlQ29sb3JNYXRyaXggaW49IlNvdXJjZUFscGhhIiB0eXBlPSJtYXRyaXgiIHZhbHVlcz0iMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMTI3IDAiLz4KPGZlT2Zmc2V0Lz4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iNC4xNjY2NyIvPgo8ZmVDb2xvck1hdHJpeCB0eXBlPSJtYXRyaXgiIHZhbHVlcz0iMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMC4yNSAwIi8+CjxmZUJsZW5kIG1vZGU9Im92ZXJsYXkiIGluMj0iQmFja2dyb3VuZEltYWdlRml4IiByZXN1bHQ9ImVmZmVjdDFfZHJvcFNoYWRvdyIvPgo8ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9ImVmZmVjdDFfZHJvcFNoYWRvdyIgcmVzdWx0PSJzaGFwZSIvPgo8L2ZpbHRlcj4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyIiB4MT0iNDkuOTM5MiIgeTE9IjAuMjU3ODEyIiB4Mj0iNDkuOTM5MiIgeTI9Ijk5Ljc0MjMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0id2hpdGUiLz4KPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSJ3aGl0ZSIgc3RvcC1vcGFjaXR5PSIwIi8+CjwvbGluZWFyR3JhZGllbnQ+CjwvZGVmcz4KPC9zdmc+Cg==';
const HERMES_MARK = 'data:image/png;base64,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';
const CLAUDE_MARK = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBjbGFzcz0idy1mdWxsIiBmaWxsPSJoc2woMTQuOCwgNjMuMSUsIDU5LjYlKSI+PHBhdGggZD0ibTE5LjYgNjYuNSAxOS43LTExIC4zLTEtLjMtLjVoLTFsLTMuMy0uMi0xMS4yLS4zTDE0IDUzbC05LjUtLjUtMi40LS41TDAgNDlsLjItMS41IDItMS4zIDIuOS4yIDYuMy41IDkuNS42IDYuOS40TDM4IDQ5LjFoMS42bC4yLS43LS41LS40LS40LS40TDI5IDQxbC0xMC42LTctNS42LTQuMS0zLTItMS41LTItLjYtNC4yIDIuNy0zIDMuNy4zLjkuMiAzLjcgMi45IDggNi4xTDM3IDM2bDEuNSAxLjIuNi0uNC4xLS4zLS43LTEuMUwzMyAyNWwtNi0xMC40LTIuNy00LjMtLjctMi42Yy0uMy0xLS40LTItLjQtM2wzLTQuMkwyOCAwbDQuMi42TDMzLjggMmwyLjYgNiA0LjEgOS4zTDQ3IDI5LjlsMiAzLjggMSAzLjQuMyAxaC43di0uNWwuNS03LjIgMS04LjcgMS0xMS4yLjMtMy4yIDEuNi0zLjggMy0yTDYxIDIuNmwyIDIuOS0uMyAxLjgtMS4xIDcuN0w1OSAyNy4xbC0xLjUgOC4yaC45bDEtMS4xIDQuMS01LjQgNi45LTguNiAzLTMuNUw3NyAxM2wyLjMtMS44aDQuM2wzLjEgNC43LTEuNCA0LjktNC40IDUuNi0zLjcgNC43LTUuMyA3LjEtMy4yIDUuNy4zLjRoLjdsMTItMi42IDYuNC0xLjEgNy42LTEuMyAzLjUgMS42LjQgMS42LTEuNCAzLjQtOC4yIDItOS42IDItMTQuMyAzLjMtLjIuMS4yLjMgNi40LjYgMi44LjJoNi44bDEyLjYgMSAzLjMgMiAxLjkgMi43LS4zIDItNS4xIDIuNi02LjgtMS42LTE2LTMuOC01LjQtMS4zaC0uOHYuNGw0LjYgNC41IDguMyA3LjVMODkgODAuMWwuNSAyLjQtMS4zIDItMS40LS4yLTkuMi03LTMuNi0zLTgtNi44aC0uNXYuN2wxLjggMi43IDkuOCAxNC43LjUgNC41LS43IDEuNC0yLjYgMS0yLjctLjYtNS44LTgtNi05LTQuNy04LjItLjUuNC0yLjkgMzAuMi0xLjMgMS41LTMgMS4yLTIuNS0yLTEuNC0zIDEuNC02LjIgMS42LTggMS4zLTYuNCAxLjItNy45LjctMi42di0uMkg0OUw0MyA3MmwtOSAxMi4zLTcuMiA3LjYtMS43LjctMy0xLjUuMy0yLjhMMjQgODZsMTAtMTIuOCA2LTcuOSA0LTQuNi0uMS0uNWgtLjNMMTcuMiA3Ny40bC00LjcuNi0yLTIgLjItMyAxLTEgOC01LjVaIj48L3BhdGg+PC9zdmc+';

export type InstallApp = 'cursor' | 'vscode' | 'hermes' | 'claude-code';

export interface AppInstallButtonsProps {
  /** MCP endpoint to install. Default: OpenDexter. */
  mcpUrl?: string;
  /** Server name written into the app's config. Default: opendexter. */
  serverName?: string;
  /** Which app buttons to render, in order. Default: all four. */
  apps?: InstallApp[];
  /** Stack full-width instead of a wrapping row. */
  block?: boolean;
  className?: string;
  /** Observability hook: fired on every action a user takes. */
  onAction?: (app: InstallApp, action: 'deeplink' | 'copied') => void;
}

const DEFAULT_MCP_URL = 'https://open.dexter.cash/mcp';
const DEFAULT_NAME = 'opendexter';
const ALL_APPS: InstallApp[] = ['cursor', 'vscode', 'hermes', 'claude-code'];

export function cursorInstallUrl(name: string, mcpUrl: string): string {
  // btoa is global in every browser and in Node 16+ (test env included).
  const config = btoa(JSON.stringify({ url: mcpUrl }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
}

export function vscodeInstallUrl(name: string, mcpUrl: string): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, type: 'http', url: mcpUrl }))}`;
}

export function hermesInstallCommand(name: string, mcpUrl: string): string {
  // No --auth flag: verified against Hermes 0.18.2 (2026-07-19) — its SDK auth
  // module is absent, so oauth prints a failure then falls back anyway. The
  // hosted MCP guides the user into real wallet enrollment on first use.
  return `hermes mcp add ${name} --url ${mcpUrl}`;
}

export function claudeCodeInstallCommand(name: string, mcpUrl: string): string {
  return `claude mcp add --transport http ${name} ${mcpUrl}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function useCopied(): [copied: boolean, mark: () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [
    copied,
    () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2600);
    },
  ];
}

function appCx(block: boolean): string {
  return block ? 'dx-appbtn dx-appbtn--block' : 'dx-appbtn';
}

export function AppInstallButtons(props: AppInstallButtonsProps): ReactElement {
  const {
    mcpUrl = DEFAULT_MCP_URL,
    serverName = DEFAULT_NAME,
    apps = ALL_APPS,
    block = false,
    className,
    onAction,
  } = props;
  useEffect(ensureAppInstallStyles, []);
  const [hermesCopied, markHermes] = useCopied();
  const [claudeCopied, markClaude] = useCopied();

  const buttons: Partial<Record<InstallApp, ReactElement>> = {
    cursor: (
      <a
        key="cursor"
        className={appCx(block)}
        href={cursorInstallUrl(serverName, mcpUrl)}
        onClick={() => onAction?.('cursor', 'deeplink')}
      >
        <img className="dx-appbtn__logo" src={CURSOR_MARK} alt="" aria-hidden />
        Add to Cursor
      </a>
    ),
    vscode: (
      <a
        key="vscode"
        className={appCx(block)}
        href={vscodeInstallUrl(serverName, mcpUrl)}
        onClick={() => onAction?.('vscode', 'deeplink')}
      >
        <img className="dx-appbtn__logo" src={VSCODE_MARK} alt="" aria-hidden />
        Add to VS Code
      </a>
    ),
    hermes: (
      <button
        key="hermes"
        type="button"
        className={appCx(block)}
        onClick={async () => {
          if (await copyText(hermesInstallCommand(serverName, mcpUrl))) {
            markHermes();
            onAction?.('hermes', 'copied');
          }
          // Launch/focus the installed app in the same user gesture; a quiet
          // no-op in most browsers when Hermes isn't installed.
          window.location.href = `hermes://open/${encodeURIComponent(serverName)}`;
        }}
      >
        <img className="dx-appbtn__logo" src={HERMES_MARK} alt="" aria-hidden />
        {hermesCopied ? <span className="dx-appbtn__copied">Copied. Paste it in Hermes</span> : 'Copy for Hermes'}
      </button>
    ),
    'claude-code': (
      <button
        key="claude-code"
        type="button"
        className={appCx(block)}
        onClick={async () => {
          if (await copyText(claudeCodeInstallCommand(serverName, mcpUrl))) {
            markClaude();
            onAction?.('claude-code', 'copied');
          }
        }}
      >
        <img className="dx-appbtn__logo" src={CLAUDE_MARK} alt="" aria-hidden />
        {claudeCopied ? <span className="dx-appbtn__copied">Copied. Run it in your terminal</span> : 'Copy for Claude Code'}
      </button>
    ),
  };

  return (
    <div className={['dx-appinstall', block ? 'dx-appinstall--block' : '', className ?? ''].filter(Boolean).join(' ')}>
      {apps.map((app) => buttons[app] ?? null)}
    </div>
  );
}
