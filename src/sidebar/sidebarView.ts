import { randomUUID } from "crypto";

import {
    InputBoxOptions,
    QuickPickItem,
    Webview,
    WebviewView,
    WebviewViewProvider,
    window,
    workspace
} from "vscode";

import { logError, logInfo } from "../lib/log";
import { applyWallpaper } from "../services/wallpaper";
import { DailyRotationScheduler } from "../services/rotation";
import { CollectionWallpaper, StateStore, WallpaperCollection } from "../state/store";
import { WallhavenSort, WallhavenWallpaper, searchWallhaven } from "../wallhaven/client";

type SidebarState = {
    query: string,
    sort: WallhavenSort,
    page: number,
    lastPage: number,
    loading: boolean,
    error: string | null,
    results: WallhavenWallpaper[]
};

const sortTabs: WallhavenSort[] = ["date_added", "relevance", "views", "favorites", "toplist"];

const createCollectionWallpaper = (wallpaper: WallhavenWallpaper): CollectionWallpaper => ({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    url: wallpaper.full,
    preview: wallpaper.preview,
    sourceId: wallpaper.id
});

const pickCollection = async (collections: WallpaperCollection[]): Promise<WallpaperCollection | undefined> => {
    if(collections.length === 0){
        return undefined;
    }

    const choices: (QuickPickItem & {collection: WallpaperCollection})[] = collections.map((collection) => ({
        label: collection.name,
        description: `${collection.wallpapers.length} wallpaper${collection.wallpapers.length === 1 ? "" : "s"}`,
        collection
    }));

    const selected = await window.showQuickPick(choices, { placeHolder: "Select collection" });
    return selected?.collection;
};

export class SidebarWebviewProvider implements WebviewViewProvider {

    public static readonly viewType = "background.mainView";

    private view?: WebviewView;

    private state: SidebarState = {
        query: "",
        sort: "date_added",
        page: 1,
        lastPage: 1,
        loading: false,
        error: null,
        results: []
    };
    private refreshVersion = 0;
    private initialized = false;

    public constructor(
        private readonly store: StateStore,
        private readonly scheduler: DailyRotationScheduler,
        private readonly workbench: string,
        private readonly product: string
    ){
        const configuration = workspace.getConfiguration("background");
        const sort = configuration.get<WallhavenSort>("wallhaven.sort") ?? "date_added";

        this.state.query = configuration.get<string>("wallhaven.query") ?? "";
        this.state.page = Math.max(configuration.get<number>("wallhaven.page") ?? 1, 1);
        this.state.sort = sortTabs.includes(sort) ? sort : "date_added";
        logInfo("sidebar", `Initialized query='${this.state.query}' sort='${this.state.sort}' page=${this.state.page}`);
    }

    public async refreshSearch(): Promise<void> {
        const version = ++this.refreshVersion;
        logInfo("sidebar", `refreshSearch start v=${version} query='${this.state.query}' sort='${this.state.sort}' page=${this.state.page}`);
        this.state.loading = true;
        this.state.error = null;
        await this.syncState();

        try{
            const result = await searchWallhaven(this.state.query, this.state.sort, this.state.page, (line) => logInfo("wallhaven", line));
            if(version !== this.refreshVersion){
                logInfo("sidebar", `refreshSearch ignored stale response v=${version} current=${this.refreshVersion}`);
                return;
            }
            this.state.results = result.items;
            this.state.page = result.currentPage;
            this.state.lastPage = result.lastPage;
            this.state.loading = false;
            logInfo("sidebar", `refreshSearch success v=${version} items=${result.items.length} page=${result.currentPage}/${result.lastPage}`);
        }catch(error: any){
            if(version !== this.refreshVersion){
                logInfo("sidebar", `refreshSearch ignored stale error v=${version} current=${this.refreshVersion}`);
                return;
            }
            this.state.loading = false;
            this.state.error = error.message ?? "Failed to load wallpapers";
            this.state.results = [];
            logError("sidebar", `refreshSearch failed v=${version}`, error);
        }

        await this.persistSearchSettings();
        await this.syncState();
    }

    public async resolveWebviewView(view: WebviewView): Promise<void> {
        this.view = view;
        logInfo("sidebar", "resolveWebviewView called");

        view.webview.options = {
            enableScripts: true
        };

        view.webview.onDidReceiveMessage(async (message: any) => {
            logInfo("sidebar", `message type='${message?.type ?? "unknown"}'`);
            switch(message?.type){
                case "clientReady": {
                    logInfo("webview", "client script initialized");
                    break;
                }
                case "clientLog": {
                    logInfo("webview", `${message.message ?? "log"}`);
                    break;
                }
                case "clientError": {
                    logError("webview", `${message.message ?? "error"}`);
                    break;
                }
                case "init": {
                    await this.syncState();
                    if(!this.initialized){
                        this.initialized = true;
                        await this.refreshSearch();
                    }
                    break;
                }
                case "search": {
                    this.state.query = `${message.query ?? ""}`.trim();
                    this.state.page = 1;
                    await this.refreshSearch();
                    break;
                }
                case "setSort": {
                    const sort = message.sort as WallhavenSort;
                    if(sortTabs.includes(sort)){
                        this.state.sort = sort;
                        this.state.page = 1;
                        await this.refreshSearch();
                    }
                    break;
                }
                case "nextPage": {
                    if(this.state.page < this.state.lastPage){
                        this.state.page += 1;
                        await this.refreshSearch();
                    }
                    break;
                }
                case "prevPage": {
                    if(this.state.page > 1){
                        this.state.page -= 1;
                        await this.refreshSearch();
                    }
                    break;
                }
                case "apply": {
                    const wallpaper = this.state.results.find((entry) => entry.id === message.id);
                    if(!wallpaper){
                        return;
                    }

                    await applyWallpaper(this.store, this.workbench, this.product, wallpaper.full, "wallhaven", wallpaper.id);
                    window.showInformationMessage(`Applied wallpaper #${wallpaper.id}`);
                    await this.syncState();
                    break;
                }
                case "addToCollection": {
                    const wallpaper = this.state.results.find((entry) => entry.id === message.id);
                    if(!wallpaper){
                        return;
                    }

                    let collection = await pickCollection(this.store.getState().collections);
                    if(!collection){
                        const name = await window.showInputBox({ prompt: "No collections found. Enter collection name." } as InputBoxOptions);
                        if(!name || !name.trim()){
                            return;
                        }
                        collection = await this.store.createCollection(name.trim());
                    }

                    await this.store.addWallpaper(collection.id, createCollectionWallpaper(wallpaper));
                    window.showInformationMessage(`Added #${wallpaper.id} to '${collection.name}'.`);
                    await this.syncState();
                    break;
                }
                case "createCollection": {
                    const name = await window.showInputBox({ prompt: "Collection name" });
                    if(!name || !name.trim()){
                        return;
                    }

                    await this.store.createCollection(name.trim());
                    await this.syncState();
                    break;
                }
                case "deleteCollection": {
                    const collectionId = `${message.collectionId ?? ""}`;
                    if(!collectionId){
                        return;
                    }

                    const collection = this.store.getState().collections.find((entry) => entry.id === collectionId);
                    if(!collection){
                        return;
                    }

                    const confirmation = await window.showWarningMessage(
                        `Delete collection '${collection.name}'?`,
                        { modal: true },
                        "Delete"
                    );

                    if(confirmation !== "Delete"){
                        return;
                    }

                    await this.store.deleteCollection(collectionId);
                    this.scheduler.schedule();
                    await this.syncState();
                    break;
                }
                case "setDaily": {
                    const collectionId = `${message.collectionId ?? ""}`;
                    if(!collectionId){
                        return;
                    }

                    await this.store.setEnabledCollection(collectionId);
                    await this.store.setPendingRotationCollection(null);
                    this.scheduler.schedule();
                    await this.syncState();
                    break;
                }
                case "applyCollection": {
                    const collectionId = `${message.collectionId ?? ""}`;
                    const collection = this.store.getState().collections.find((entry) => entry.id === collectionId);
                    if(!collection || collection.wallpapers.length === 0){
                        window.showWarningMessage("This collection has no wallpapers.");
                        return;
                    }

                    const selected = collection.wallpapers[Math.floor(Math.random() * collection.wallpapers.length)];
                    await applyWallpaper(this.store, this.workbench, this.product, selected.url, "collection", selected.sourceId);
                    window.showInformationMessage(`Applied wallpaper from '${collection.name}'.`);
                    await this.syncState();
                    break;
                }
                case "addCollectionUrl": {
                    const collectionId = `${message.collectionId ?? ""}`;
                    if(!collectionId){
                        return;
                    }

                    const url = await window.showInputBox({
                        prompt: "Wallpaper URL",
                        placeHolder: "https://...",
                        validateInput: (value) => /^https:\/\//.test(value) ? undefined : "URL must start with https://"
                    });

                    if(!url){
                        return;
                    }

                    await this.store.addWallpaper(collectionId, {
                        id: randomUUID(),
                        url,
                        preview: url
                    });
                    await this.syncState();
                    break;
                }
            }
        });
        view.webview.html = this.getHtml(view.webview);
    }

    private async persistSearchSettings(): Promise<void> {
        const configuration = workspace.getConfiguration("background");
        await configuration.update("wallhaven.query", this.state.query, true);
        await configuration.update("wallhaven.sort", this.state.sort, true);
        await configuration.update("wallhaven.page", this.state.page, true);
        logInfo("sidebar", `persisted query='${this.state.query}' sort='${this.state.sort}' page=${this.state.page}`);
    }

    private async syncState(): Promise<void> {
        if(!this.view){
            logInfo("sidebar", "syncState skipped (view not ready)");
            return;
        }

        const storeState = this.store.getState();
        logInfo(
            "sidebar",
            `syncState loading=${this.state.loading} error=${this.state.error ? "yes" : "no"} results=${this.state.results.length} collections=${storeState.collections.length}`
        );
        await this.view.webview.postMessage({
            type: "state",
            state: {
                ...this.state,
                collections: storeState.collections,
                enabledCollectionId: storeState.enabledCollectionId,
                activeWallpaper: storeState.activeWallpaper
            }
        });
    }

    private getHtml(webview: Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Background</title>
    <style>
        :root {
            --gap: 10px;
            --radius: 8px;
            --border: var(--vscode-panel-border);
            --fg: var(--vscode-foreground);
            --muted: var(--vscode-descriptionForeground);
            --bg: var(--vscode-sideBar-background);
            --surface: color-mix(in srgb, var(--bg) 88%, var(--fg) 12%);
            --surface-2: color-mix(in srgb, var(--bg) 80%, var(--fg) 20%);
            --accent: var(--vscode-button-background);
            --accent-fg: var(--vscode-button-foreground);
        }

        * { box-sizing: border-box; }
        body {
            margin: 0;
            color: var(--fg);
            background: var(--bg);
            font-family: var(--vscode-font-family);
            font-size: 12px;
            line-height: 1.45;
        }

        .wrap { padding: 10px; display: flex; flex-direction: column; gap: 14px; }
        .top {
            position: sticky;
            top: 0;
            z-index: 2;
            background: var(--bg);
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding-bottom: 6px;
            border-bottom: 1px solid var(--border);
        }

        .search-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
        .search-input {
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 7px 8px;
        }

        .btn {
            border: 1px solid var(--vscode-button-border, transparent);
            background: var(--surface);
            color: var(--fg);
            border-radius: 6px;
            padding: 6px 8px;
            cursor: pointer;
        }

        .btn.primary { background: var(--accent); color: var(--accent-fg); }
        .btn:disabled { opacity: 0.55; cursor: default; }

        .tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
        .tab {
            border: 1px solid var(--border);
            background: var(--surface);
            color: var(--fg);
            border-radius: 999px;
            padding: 4px 10px;
            white-space: nowrap;
            cursor: pointer;
        }
        .tab.active { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }

        .pager { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: var(--muted); }
        .pager > div { display: flex; gap: 6px; }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
            gap: var(--gap);
        }

        .card {
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--surface);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        .thumb {
            width: 100%;
            aspect-ratio: 3 / 4;
            object-fit: cover;
            display: block;
            background: var(--surface-2);
        }

        .meta { padding: 7px; display: flex; flex-direction: column; gap: 6px; }
        .line { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); }
        .id { color: var(--fg); font-weight: 600; }
        .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

        .collections {
            border-top: 1px solid var(--border);
            padding-top: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .collections-head { display: flex; justify-content: space-between; align-items: center; }
        .collections-list { display: flex; flex-direction: column; gap: 7px; }

        .collection {
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--surface);
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 7px;
        }

        .collection-title { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
        .badge {
            border-radius: 999px;
            border: 1px solid var(--border);
            padding: 1px 7px;
            color: var(--muted);
            font-size: 11px;
        }

        .collection-actions {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px;
        }

        .empty {
            border: 1px dashed var(--border);
            border-radius: var(--radius);
            color: var(--muted);
            padding: 10px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="wrap">
        <section class="top">
            <div class="search-row">
                <input id="query" class="search-input" type="text" placeholder="Search wallpapers" />
                <button id="searchBtn" type="button" class="btn primary">Search</button>
            </div>
            <div id="tabs" class="tabs"></div>
            <div class="pager">
                <span id="pageInfo">Page 1 of 1</span>
                <div>
                    <button id="prevBtn" class="btn" type="button">Prev</button>
                    <button id="nextBtn" class="btn" type="button">Next</button>
                </div>
            </div>
        </section>

        <section>
            <div id="results" class="grid"></div>
        </section>

        <section class="collections">
            <div class="collections-head">
                <strong>Collections</strong>
                <button id="createCollection" class="btn" type="button">New</button>
            </div>
            <div id="collections" class="collections-list"></div>
        </section>
    </div>

    <script>
        (function(){
            const vscode = acquireVsCodeApi();
            const send = (type, payload = {}) => vscode.postMessage({ type, ...payload });
            const getEl = (id) => {
                const element = document.getElementById(id);
                if(!element){
                    throw new Error("Missing element #" + id);
                }
                return element;
            };

            try{
                const state = {
                    query: "",
                    sort: "date_added",
                    page: 1,
                    lastPage: 1,
                    loading: false,
                    error: null,
                    results: [],
                    collections: [],
                    enabledCollectionId: null,
                    activeWallpaper: null
                };

                const sortTabs = ["date_added", "relevance", "views", "favorites", "toplist"];

                const queryInput = getEl("query");
                const searchBtn = getEl("searchBtn");
                const tabs = getEl("tabs");
                const pageInfo = getEl("pageInfo");
                const prevBtn = getEl("prevBtn");
                const nextBtn = getEl("nextBtn");
                const results = getEl("results");
                const collections = getEl("collections");
                const createCollectionBtn = getEl("createCollection");

                const renderTabs = () => {
                    tabs.innerHTML = "";
                    sortTabs.forEach((sort) => {
                        const button = document.createElement("button");
                        button.type = "button";
                        button.className = "tab" + (state.sort === sort ? " active" : "");
                        button.textContent = sort.replace("_", " ");
                        button.onclick = () => send("setSort", { sort });
                        tabs.appendChild(button);
                    });
                };

                const card = (wallpaper) => {
            const el = document.createElement("article");
            el.className = "card";

            const image = document.createElement("img");
            image.className = "thumb";
            image.src = wallpaper.preview;
            image.alt = wallpaper.id;
            el.appendChild(image);

            const meta = document.createElement("div");
            meta.className = "meta";
            meta.innerHTML =
                "<div class=\"line\"><span class=\"id\">#" + wallpaper.id + "</span><span>" + wallpaper.resolution + "</span></div>" +
                "<div class=\"line\"><span>Favorites</span><span>" + wallpaper.favorites + "</span></div>";

            const actions = document.createElement("div");
            actions.className = "actions";

            const applyBtn = document.createElement("button");
            applyBtn.className = "btn primary";
            applyBtn.textContent = "Apply";
            applyBtn.onclick = () => send("apply", { id: wallpaper.id });

            const addBtn = document.createElement("button");
            addBtn.className = "btn";
            addBtn.textContent = "Collect";
            addBtn.onclick = () => send("addToCollection", { id: wallpaper.id });

            actions.append(applyBtn, addBtn);
            meta.appendChild(actions);
            el.appendChild(meta);
            return el;
                };

                const renderResults = () => {
            results.innerHTML = "";

            if(state.loading){
                const empty = document.createElement("div");
                empty.className = "empty";
                empty.textContent = "Loading wallpapers...";
                results.appendChild(empty);
                return;
            }

            if(state.error){
                const empty = document.createElement("div");
                empty.className = "empty";
                empty.textContent = state.error;
                results.appendChild(empty);
                return;
            }

            if(!state.results.length){
                const empty = document.createElement("div");
                empty.className = "empty";
                empty.textContent = "No wallpapers found.";
                results.appendChild(empty);
                return;
            }

            state.results.forEach((wallpaper) => results.appendChild(card(wallpaper)));
                };

                const renderCollections = () => {
            collections.innerHTML = "";

            if(!state.collections.length){
                const empty = document.createElement("div");
                empty.className = "empty";
                empty.textContent = "No collections yet.";
                collections.appendChild(empty);
                return;
            }

            state.collections.forEach((collection) => {
                const item = document.createElement("article");
                item.className = "collection";

                const top = document.createElement("div");
                top.className = "collection-title";
                top.innerHTML =
                    "<strong>" + collection.name + "</strong>" +
                    "<span class=\"badge\">" + collection.wallpapers.length + " item" +
                    (collection.wallpapers.length === 1 ? "" : "s") +
                    (state.enabledCollectionId === collection.id ? " • Daily" : "") +
                    "</span>";

                const actions = document.createElement("div");
                actions.className = "collection-actions";

                const apply = document.createElement("button");
                apply.type = "button";
                apply.className = "btn";
                apply.textContent = "Apply random";
                apply.onclick = () => send("applyCollection", { collectionId: collection.id });

                const daily = document.createElement("button");
                daily.type = "button";
                daily.className = "btn";
                daily.textContent = state.enabledCollectionId === collection.id ? "Daily: ON" : "Set Daily";
                daily.onclick = () => send("setDaily", { collectionId: collection.id });

                const add = document.createElement("button");
                add.type = "button";
                add.className = "btn";
                add.textContent = "Add URL";
                add.onclick = () => send("addCollectionUrl", { collectionId: collection.id });

                const del = document.createElement("button");
                del.type = "button";
                del.className = "btn";
                del.textContent = "Delete";
                del.onclick = () => send("deleteCollection", { collectionId: collection.id });

                actions.append(apply, daily, add, del);
                item.append(top, actions);
                collections.appendChild(item);
            });
                };

                const render = () => {
                    queryInput.value = state.query;
                    pageInfo.textContent = "Page " + state.page + " of " + Math.max(1, state.lastPage);
                    prevBtn.disabled = state.page <= 1 || state.loading;
                    nextBtn.disabled = state.page >= state.lastPage || state.loading;
                    renderTabs();
                    renderResults();
                    renderCollections();
                };

                window.addEventListener("message", (event) => {
                    const message = event.data;
                    if(message.type !== "state"){
                        return;
                    }

                    Object.assign(state, message.state);
                    render();
                });

                const runSearch = () => {
                    send("clientLog", { message: "runSearch fired query='" + queryInput.value + "'" });
                    send("search", { query: queryInput.value });
                };

                queryInput.addEventListener("keydown", (event) => {
                    if(event.key !== "Enter"){
                        return;
                    }

                    event.preventDefault();
                    runSearch();
                });

                searchBtn.addEventListener("click", runSearch);
                searchBtn.addEventListener("pointerdown", () => send("clientLog", { message: "searchBtn pointerdown" }));

                prevBtn.addEventListener("click", () => send("prevPage"));
                nextBtn.addEventListener("click", () => send("nextPage"));
                createCollectionBtn.addEventListener("click", () => send("createCollection"));

                send("clientReady");
                send("init");
            }catch(error){
                const message = error && error.message ? error.message : String(error);
                send("clientError", { message });
            }
        })();
    </script>
</body>
</html>`;
    }
}
