# Storymaps.io

A free, open-source user story mapping tool with real-time collaboration.

![Screenshot](public/resources/screenshot.png)

## What is Storymaps.io?

User story mapping is a technique for visualising a product as a diagram focused around the journeys its users make. It helps teams build a shared understanding of what a product does, who it serves, how it delivers value, how it was built, and where it's going next. It's a comprehension tool which shows you the product vision and evolution in a single artefact.

If a sprint shows you the tree, a story map shows you the forest.


It's not a replacement for your project management tool or your product roadmap. Your project management tool shows you the backlog, the sprint, and what work needs doing. Your roadmap tells you when things ship. But neither one shows you the product as a whole, how all that work fits together and how it's evolved. A story map is that full picture.

### Why It Matters

Agile workflows like Scrum and Kanban are great at showing you what you're building right now. They're not always great at showing you how it connects to everything else. Long-running projects often follow the same pattern: they start with energy, vision, and shared understanding, and six months later that coherent picture of the product has been replaced by a giant backlog. Everyone knows what their tickets are. Nobody can point to a single place that shows how all that work fits together as a product. The vision that started the project isn't lost because people forgot it. It's lost because nothing in the workflow preserves it.

A story map preserves it. One diagram that shows who the users are, what journey they take, what features support each step, and what's been delivered versus what's planned. You can draw a line across the map and say 'everything above this is V1, everything below is V2.' The product vision stays visible, not as a document nobody reads, but as a living artifact the team works from, refers back to, and can update as the product evolves.

### Here's the basic structure of a story map:
- **Users** - Who are the users? e.g. first-time shopper
- **Activities** - What are they trying to achieve? e.g. find a product
- **Steps** - The journey they take to achieve their goals from left to right e.g. search -> browse -> compare
- **Tasks** - The work to support each step e.g. keyword search, category filters, compare products
- **Slices** - Horizontal groupings for releases (MVP, v1, v2, etc.)

## App Features

### Story Mapping
- **Users, Activities & Steps (Backbone)** - define the user journey left-to-right
- **Task cards** - break down work under each step
- **Release slices** - group tasks into MVP, V1, V2 etc.; mark slices complete or collapse them
- **Slice details** - click a slice's name to rename it and give it an optional goal and target date, shown behind the ⓘ next to the name (or on the banner of a completed slice); on phones the details open as a sheet at the top of the screen, clear of the keyboard
- **Slice menu** - right-click a slice or click its ☰ to edit details, copy its link, mark it complete, collapse, reopen, or delete it
- **Slice links** - every slice has its own link (`#slice-<id>`) that scrolls the map to it and briefly spotlights it; copy it from the slice menu, including on locked maps
- **Status indicators** - done, in-progress, planned, blocked with per-slice progress tracking
- **Story points** - estimate effort per card, auto-summed per slice
- **Tags** - categorize cards with free-text tags, autocomplete from existing tags
- **Overview** - counts of cards, steps, slices, users and activities, overall progress across slices, and how many cards are in each legend category
- **Legend** - define colour-coded card categories (e.g. Tasks, Notes, Questions, Edge Cases) in the Overview tab
- **Map Partials** - reusable story map fragments that eliminate duplication when multiple user journeys converge on shared steps; extract a sequence of columns once, reference it from anywhere, and expand inline to see the detail
- **Card title & body** - each card has a short title visible on the map and an optional body for longer descriptions or details
- **Expanded view** - click the expand button on any card to edit the title and body in a larger modal; its footer shows status, points, tags and a link you can open on one line, and Edit opens them with colour for changing; cards with body text show an expand indicator
- **Story chips** - in the expanded view of a story card, add a user story (As a, I want, So that), a scenario (Given, When, Then) or an acceptance criteria list to the body in one click; Enter moves to the next line to fill in, and starts the next item in a list
- **Card colours & links** - 14 colours, external URLs to issue trackers
- **Drag & drop** - reorder cards, columns, and slices; the map auto-scrolls when you drag near its edges
- **Insert steps & spacers** - right-click a step to add a new step or a spacer column before or after it, or duplicate it; spacer columns visually group steps

### Search & Filter
- **Search** (Ctrl+F) - live search with non-matching cards dimmed
- **Filter panel** - filter by status, colour, or tag; combine multiple filters

### Multi-Select & Bulk Edit
- **Select cards** - click, Shift+click, or marquee-drag to select multiple cards
- **Drag selections** - drag any selected card to move the whole selection; the cards stack at the drop point in map order
- **Selection toolbar** - bulk change colour, status, or tags; duplicate or delete selected items

### Collaboration
- **Real-time sync** - multiple users editing simultaneously (Yjs CRDTs)
- **Display names** - prompted on first visit; shown on cursor labels, the viewer badge, and in the activity log; click your name to change it anytime; supports emojis
- **Live cursors** - see other users' cursor positions, names, and drag operations in real-time
- **Viewer badge** - shows your name and a live count of connected users; hover the count to see everyone on the map
- **Mobile & tablet** - touch device users join silently without a name prompt; desktop users see them listed as "Mobile user" in the viewer tooltip
- **Collaborative notepad** - shared notes that sync in real-time
- **Activity log** - shows when the map was created and last edited, who's here now, recent contributors, and total edits, above a real-time feed of the last 20 map edits; hover an entry to highlight the affected card on the map; entries show the user's name, with icons to distinguish CLI and mobile sources
- **Shareable URLs** - each map gets a unique link
- **Projects** - group related maps as tabs at a project link (`/p/<project>`); start one from any map, add a new map or paste the link to one you have, and rename the project, reorder the maps or remove one from the project name button; a map can be in any number of projects and a plain map link never shows them; removing a map never deletes the map or the project, and deleting a project is a separate step that leaves the maps alone
- **Lock maps** - password-protect to prevent edits

### Import & Export
- **JSON** - import/export story maps as JSON files
- **YAML** - import/export as human-readable YAML; author maps in a text editor, version-control them in git, or generate from scripts
- **CSV** - import/export as spreadsheet-friendly CSV
- **Slice details travel too** - slice goals, target dates, and completed or collapsed state are kept in JSON, YAML, and CSV exports, imports, and backups
- **Jira** - import from CSV file or via server-proxied REST API; export as CSV or via server-proxied REST API; card body text is used as the issue description
- **Asana** - import from CSV file or via server-proxied REST API; export as CSV or via server-proxied REST API; card body text is used as the task notes
- **Phabricator** - import from CSV file or via server-proxied Conduit API; export via server-proxied Conduit API, or as a script you run in your browser's console on your Phabricator site (for instances the server can't reach, e.g. behind a VPN); card body text is used as the task description
- **Linear** - import from CSV file or via server-proxied REST API; export via server-proxied REST API
- **URL endpoints** - append `.json`, `.yaml`, or `.csv` to any map URL to fetch its data programmatically (e.g. `curl storymaps.io/abc123.csv`); exports include the map ID for traceability
- **Share as image** - copy map screenshot to clipboard or download as PNG
- **Print / PDF**

### Navigation
- **Infinite canvas** - Ctrl+scroll to zoom, right-click drag, or touch-drag to pan
- **Pinch-to-zoom** - two-finger pinch to zoom on touch devices
- **Zoom to fit** (Alt+R / Shift+0) - auto-fit all content to viewport
- **Keyboard shortcuts** - undo/redo (Ctrl+Z / Ctrl+Y), search (Ctrl+F), duplicate (Ctrl+D), delete (Delete/Backspace), zoom, pan

### Backups
- **Manual backups** - create named snapshots of your map (up to 5 kept)
- **Auto backups** - safety snapshots created automatically before imports and restores
- **Restore** - roll back to any backup with one click; a safety backup is created first
- **Portable backups** - backups travel with JSON/YAML exports and imports; imported backups are tagged so you can tell them apart from local ones
- **Backup metadata** - each backup shows the map name, card count, size, and relative age

### Other
- **View controls** - quick-access toggle buttons for focus mode, full screen, dark mode, and cursor visibility alongside the zoom controls
- **Dark mode** - matches your system theme, or toggle from the view controls
- **Full Screen Mode** - toggle from the view controls; double-Esc to exit (single Esc still closes modals, search, etc.); auto zoom-to-fit on enter and exit
- **Focus Mode** - hide card metadata (status, points, tags, links) for a cleaner presentation view; toggle from the view controls; expand icons still appear on hover
- **Copy map** - duplicate an existing map to a new URL
- **Guided tour** - interactive walkthrough that teaches story mapping concepts using a Lego house example, with live demos of slices, legend cards, dark mode, the notepad, and the activity log
- **Build with AI** - export your story map as a structured prompt to AI coding tools (Claude, ChatGPT, Gemini, Copilot) or app builders (Lovable, v0, Bolt, Replit); select a specific release slice, choose between Prototype (quick preview) and Full App (production-ready) build modes, add custom instructions, and copy the prompt or open it directly; CLI tool integration for Claude Code, Codex, and Gemini CLI via `npx storymaps`
- **Sample maps** - load examples to learn the methodology
- **Map counter** - community stat showing total maps created
- **Auto-save** - continuous save to local storage and server

## Architecture

The server entry point is `server.js`, which delegates to modules in `server/`:
- **WebSocket** - Real-time collaboration via y-websocket
- **Static files** - Serves the client app from `public/` and `src/`
- **REST API** - Route handlers in `server/routes/` for locks, backups, activity log, stats, format endpoints (`.json`, `.yaml`, `.csv`), and server-proxied third-party imports/exports with SSE progress streaming. Requests to Jira, Asana, Phabricator and Linear go only to public addresses over HTTPS. The server checks the address of each host name before connecting, connects to the address it checked, and checks again on every redirect
- **Middleware** - Origin checks, body parsing, and rate limiting in `server/middleware.js` and `server/rate-limit.js`. Through the API, each address can create 10 maps a minute and 500 a day, push a map or request a new map ID 30 times a minute, and use the import, export, backup and unlock routes 5 times a minute

### Real-time Sync (Yjs)

Each map is a [Yjs](https://yjs.dev/) document named after its map ID. The server keeps one shared copy of each open map in memory, and every browser on the map keeps its own. Yjs merges edits from everyone into the same result whatever order they arrive in, so the server has no conflict-handling logic of its own.

**Document structure**
- **Map data** - the name, steps, users, activities, slices and their cards, legend, and map partials
- **Notepad** - shared text bound to the CodeMirror editor, so people can type in it at the same time
- **Activity log** - the feed of recent edits, trimmed to the last 20 entries

**Client**
- The app renders from a plain JavaScript state object, not from Yjs directly. After a local change, the state is written into the document in one transaction. Items that keep their order are updated field by field; a list whose items were added, removed, or reordered is rebuilt. Nothing is written if the state hasn't changed.
- Changes from other people are read back into the state and the map re-renders: the first change renders straight away, and a burst of changes is collapsed into one more render shortly after.
- Undo and redo restore snapshots of the local state rather than using Yjs's own undo, so an undo syncs to everyone like any other edit.
- Presence and live cursors use the Yjs awareness protocol. Each client shares its name, colour, device type, and cursor position; the server relays these to everyone on the map and never saves them.
- Yjs only loads when a map is opened, so it doesn't slow down the home page. A new map (from a sample, import, or copy) is written into the empty document after the first sync.

**Server**
- Each WebSocket connection is checked against the allowed origins, then joins its map's shared document through y-websocket, which runs the sync protocol and relays updates to everyone on the map.
- y-leveldb loads a map from disk when its first client connects and saves every update as it arrives. When the last client leaves, the in-memory copy is dropped. The map stays on disk as a list of updates, which y-leveldb merges into one once the list grows long.
- Shortly after editing stops, the map's name, last-edited time, and edit count are saved to SQLite for the map index and activity stats.
- The REST API works on the same documents. Format URLs read the in-memory copy if the map is open, and otherwise load it from disk. CLI pushes write into the live document, so people on the map see the change straight away, and add an entry to the activity log.
- On shutdown the server saves open documents and pending SQLite updates before it exits.

### Data Storage
- **LevelDB** - Yjs document persistence in `data/`
- **SQLite** - Map index with names and timestamps (`data/maps.db`)
- **JSON files** - Lock state (`data/locks.json`), counters (`data/stats.json`), and backups (`data/backups/*.json`)

### Client
The client has no build step - ES modules are loaded directly from `src/`. Third-party libraries (Yjs, CodeMirror, html-to-image, js-yaml, html2canvas) are vendored as pre-built bundles in `public/vendor/`.

## Self-Hosting

Storymaps is a single Docker container behind a Caddy reverse proxy. It runs on any Linux server and gives your team a private instance at e.g. `storymaps.yourcompany.com` with automatic HTTPS.

### Prerequisites
- A Linux server (VM, VPS, or container platform) - 512 MB RAM / 1 vCPU is sufficient
- Docker and Docker Compose
- A domain or subdomain with DNS pointing to the server

### Quick Start

1. Clone the repo:
   ```bash
   git clone https://github.com/jackgleeson/storymaps.io.git
   cd storymaps.io
   ```
2. Edit the `Caddyfile` - replace `storymaps.io` with your domain and remove the `www` redirect block. Keep the `header` block (security headers), the `log` block (access logs) and the `header_up` line, which passes the address of each visitor to the app. The block at the top trusts the Cloudflare addresses: keep it if your site is behind Cloudflare, otherwise delete it:
   ```
   storymaps.yourcompany.com {
       header {
           # ...security headers, unchanged
       }

       log {
           # ...access logs, unchanged
       }

       reverse_proxy app:8080 {
           header_up X-Forwarded-For {client_ip}
       }
   }
   ```
3. Edit `docker-compose.yml` and add your domain to the `app` service's `environment` section. `STORYMAPS_ALLOWED_ORIGINS` must list it, or browsers on it can't connect. `TRUST_PROXY=true` is already there; it lets rate limiting see each visitor's IP through Caddy instead of counting everyone as one client:
   ```yaml
   services:
     app:
       # ...
       environment:
         - TRUST_PROXY=true
         - STORYMAPS_ALLOWED_ORIGINS=https://storymaps.yourcompany.com
   ```
4. Build and start:
   ```bash
   docker compose up -d --build
   ```
5. Visit `https://storymaps.yourcompany.com` - Caddy provisions TLS automatically via Let's Encrypt.

### Behind an Existing Reverse Proxy

If you already run nginx, Traefik, HAProxy, or another proxy, you can skip Caddy and expose the app directly.

1. Remove the `caddy` service from `docker-compose.yml` and expose port 8080 on the `app` service. Binding to `127.0.0.1` keeps the app reachable only through your proxy:
   ```yaml
   services:
     app:
       image: storymaps-app
       build: .
       restart: unless-stopped
       volumes:
         - ./data:/app/data
       ports:
         - "127.0.0.1:8080:8080"
       environment:
         - STORYMAPS_ALLOWED_ORIGINS=https://storymaps.yourcompany.com
         - TRUST_PROXY=true
   ```
   Only set `TRUST_PROXY=true` if your proxy sets `X-Forwarded-For` and clients can't reach port 8080 directly; otherwise a client could fake its IP to dodge rate limits.
2. Point your existing proxy at `localhost:8080` and handle TLS termination there.

   Example nginx snippet:
   ```nginx
   server {
       listen 443 ssl;
       server_name storymaps.yourcompany.com;

       ssl_certificate     /path/to/cert.pem;
       ssl_certificate_key /path/to/key.pem;

       location / {
           proxy_pass http://localhost:8080;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       }
   }
   ```
   The `Upgrade` and `Connection` headers are required for WebSocket connections. `X-Forwarded-For` passes the visitor's IP through for rate limiting (with `TRUST_PROXY=true`).

### Data & Backups

All data lives in `./data/` on the host:
- LevelDB files - Yjs document state
- `maps.db` - SQLite map index
- `locks.json` - lock state
- `stats.json` - counters
- `backups/` - per-map backup snapshots

Back up this directory regularly (e.g. a cron job with `tar` or `rsync`). To migrate to a new server, copy `data/` across and start the containers.

Caddy keeps access logs in its own volume, rotated at 10 MB and kept for up to 30 days. Read them with `docker compose exec caddy tail -f /data/access.log`.

To delete a map, for example spam, stop the app and run the admin script with its ID. It deletes one map per run. Add `--dry-run` first to see what would be deleted:
```bash
docker compose stop app
docker compose run --rm app node server/admin/delete-map.js <id>
docker compose start app
```

### Updating

```bash
git pull && docker compose build --pull && docker compose up -d
```

`--pull` fetches the latest `node:24-slim` base image, so Node security fixes reach your build even when an older copy of the image is cached. Data is preserved across rebuilds since `data/` is a host-mounted volume.

### Environment Variables

Set these in the `environment` section of the `app` service in `docker-compose.yml`. The app doesn't read a `.env` file.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `8080`  | Server listen port |
| `STORYMAPS_ALLOWED_ORIGINS` | storymaps.io origins | Comma-separated origins allowed to open WebSocket connections and write to the API, e.g. `https://storymaps.yourcompany.com`. Required when self-hosting on your own domain. `localhost` is always allowed. |
| `TRUST_PROXY` | unset (`true` in the bundled `docker-compose.yml`) | Set to `true` to take the client IP from `X-Forwarded-For` for rate limiting. Use it behind the bundled Caddy or another trusted proxy; leave it unset if clients can reach the app directly. |
| `DATA_DIR` | `./data` | Folder for the map database, lock state, counters and backups. |
| `IMPORT_EXPORT_ENABLED` | `true` | Set to `false` to turn off imports and exports through the APIs of Jira, Asana, Phabricator and Linear. The server then never calls an address someone types in, and the app hides those options. Imports and exports of JSON, YAML and CSV files still work. |
| `DISABLE_SSRF_CHECK` | unset | Set to `1` to let server-proxied imports and exports call non-HTTPS URLs, localhost, and private network addresses. This turns off SSRF protection, so use it for local development only. |

### Running Locally (Development)

```bash
npm install
npm start
```

The server starts on `http://localhost:8080`.

### Running the Tests

```bash
npm test                  # unit and integration tests
npm run test:unit         # unit tests only: a few seconds, no server
npm run test:integration  # starts the server on a spare port with a temporary data folder
npm run test:e2e          # browser tests in Chrome and phone-sized WebKit
npm run test:coverage     # unit and integration tests with a coverage report
```

- **Unit tests** (`test/unit`) cover saving and loading maps, JSON, YAML and CSV import and export, real-time sync including two people editing at once, editing and partial maps, search, locks, backups, the activity log, and the Jira, Asana, Linear and Phabricator imports and exports against canned API responses.
- **Integration tests** (`test/integration`) start the real server to test WebSocket sync, origin checks, locks, request handling and static files.
- **Browser tests** (`test/e2e`) use [Playwright](https://playwright.dev) to run the main journeys: editing a map, two people editing at once, menus and undo, locks, and YAML import and export, plus phone layout checks. They start their own server on port 3210 (set `E2E_PORT` to change it), so they can run alongside a dev server. Locally they use your installed Chrome; run `npx playwright install webkit` once for the phone tests.

CI runs all of them on every push to `main` and every pull request.

## Usage
1. Visit [storymaps.io](https://storymaps.io) or self-host your own instance
2. Click **New Story Map**, **Take the Tour** for an interactive walkthrough, or try a sample to get started
3. Click **+** to add steps (columns) to the backbone, or right-click a step to add a step or spacer column before or after it
4. Click **+** in a column to add tasks
5. Click **+ Add Slice** to create release groupings, then click a slice's name to rename it or set a goal and target date
6. Right-click a slice or click its **☰** to copy a link to it, mark it complete, or collapse it
7. Click the **expand** button on a card to add a description in the body field and set its status, points, tags, link, or colour; the title stays visible on the map
8. Click the **...** menu on cards to set colours, status, links, tags, or story points
9. Drag tasks to reorder or move between columns; select several cards first to drag them together
10. Open the **Overview** tab to see your map's counts and progress, and use its **Legend** to define card categories and colour-code your map
11. Use **Ctrl+F** to search or open the **Filter** panel to filter by status, colour, or tag
12. Click, Shift+click, or marquee-drag to select multiple cards, then use the toolbar to bulk edit
13. Use the **Notepad** to capture team notes and decisions
14. Click **Share** to copy the URL, copy the map as an image, or download as PNG
15. Use **Menu → Lock Map** to password-protect the map from edits
16. Use **Ctrl+Z** / **Ctrl+Y** to undo and redo, **Ctrl+D** to duplicate
17. Use **Ctrl+scroll** to zoom, **right-click drag** to pan, **Alt+R** to zoom to fit
18. Select consecutive columns and use **Menu → Create Partial** to extract shared sequences into reusable map partials; manage them from the **Partials** panel
19. Use the **view controls** (next to zoom) to toggle focus mode, full screen, dark mode, or cursor visibility
20. Press **Esc** twice to exit full screen (single Esc still closes modals, search, etc.)
21. Use **Menu → Backups** to create, restore, or delete map snapshots
22. Use **Menu → Import** to import from JSON, YAML, CSV, or from Jira, Asana, Phabricator, or Linear (CSV file or API)
23. Use **Menu → Export** to save as JSON, YAML, or CSV, or export to Jira, Asana, Phabricator, or Linear
24. Use **Print** to save as PDF
25. Click **Build with AI** to generate a prompt from your story map for AI coding tools or app builders; select a slice and target, add optional instructions, then copy or open the prompt

## Support
If you find this tool useful, consider [buying me a coffee](https://buymeacoffee.com/jackgleeson). It goes towards server costs and helps me keep the app running.

## Credits
- Thanks to Jeff Patton for pioneering user story mapping. Learn more: [Jeff Patton's Story Mapping](https://jpattonassociates.com/story-mapping/)
- Real-time collaboration powered by [Yjs](https://yjs.dev/) CRDTs
- Drag and drop powered by [SortableJS](https://sortablejs.github.io/Sortable/)
- Collaborative notepad powered by [CodeMirror 6](https://codemirror.net/)

## Documentation
- [Contributing](CONTRIBUTING.md) - development setup, code style, and contribution guidelines

## License
AGPL-3.0 - see [LICENCE](LICENCE) for details.
