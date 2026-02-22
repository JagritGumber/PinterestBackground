/*
 * Copyright (C) 2026 Jagrit Gumber
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { join } from "path";
import { ExtensionContext, ProgressLocation, commands, window } from "vscode";

import { UI, get, update } from "../config";
import { add as addToUI, get as getFromUI } from "../../menu/file";
import { downloadImage, removePaths } from "./cache";
import { addFavorite, mergeFeed, pruneCatalog, readCatalog, removeFavorite, writeCatalog } from "./catalog";
import { SearchOptions, WallhavenCandidate, searchWallpapers } from "./client";
import { getNextRunAt, shouldCatchUpNow } from "./scheduler";
import { CachedImage, Catalog, CurrentSelection, WallhavenMode, uiKeys } from "./types";

type ContextState = {
    context?: ExtensionContext,
    timer?: NodeJS.Timeout,
    syncRunning: boolean,
    current: CurrentSelection
};

const state: ContextState = {
    syncRunning: false,
    current: {}
};

const catalogPath: () => string = () => join(state.context!.globalStorageUri.fsPath, "wallhaven", "catalog.json");
const cacheDir: () => string = () => join(state.context!.globalStorageUri.fsPath, "wallhaven", "cache");

const read: () => Catalog = () => readCatalog(catalogPath());
const write: (catalog: Catalog) => void = (catalog: Catalog) => writeCatalog(catalogPath(), catalog);
const log: (...args: unknown[]) => void = (...args: unknown[]) => {
    console.log("[Background][Wallhaven]", ...args);
};

const getMode: () => WallhavenMode = () => {
    const mode = get("wallhaven.mode");
    return mode === "favorites" ? "favorites" : "daily";
};

const isEnabled: () => boolean = () => get("wallhaven.enabled") === true;
const fetchPerDay: () => number = () => Math.max(1, +get("wallhaven.fetchPerDay") || 20);
const cacheMax: () => number = () => Math.max(20, +get("wallhaven.cacheMax") || 200);

const parseRatios: () => string[] = () => {
    const raw = get("wallhaven.ratios");
    if(!Array.isArray(raw)){
        return ["16x9", "16x10", "21x9"];
    }
    const ratios = raw.map(value => `${value}`.trim()).filter(Boolean);
    return ratios.length > 0 ? ratios : ["16x9", "16x10", "21x9"];
};

const searchOptions: () => SearchOptions = () => ({
    query: `${get("wallhaven.query") || ""}`.trim() || "anime 1girl wallpaper",
    purity: `${get("wallhaven.purity") || "100"}`.trim() || "100",
    atleast: `${get("wallhaven.atleast") || "1920x1080"}`.trim() || "1920x1080",
    ratios: parseRatios(),
    sorting: `${get("wallhaven.sorting") || "random"}`.trim() || "random",
    limit: fetchPerDay(),
    apiKey: `${get("wallhaven.apiKey") || process.env.WALLHAVEN_API_KEY || ""}`.trim() || undefined
});

const pickFromPool: (items: string[], ui: UI) => string[] = (items: string[], ui: UI) => {
    if(items.length === 0){
        return [];
    }
    const mapping = get("wallhaven.mapping", {includeDefault: false});
    if(mapping !== "perSurface"){
        return items;
    }

    const index = ({
        window: 0,
        editor: 1,
        sidebar: 2,
        panel: 3
    })[ui];
    const rotated = [...items.slice(index), ...items.slice(0, index)];
    return rotated;
};

const applyCatalogToBackgrounds: (catalog: Catalog) => Promise<void> = async (catalog: Catalog) => {
    const source = getMode() === "favorites" ? catalog.favorites : catalog.feed;
    const globs = source.map(item => item.localPath.replace(/\\/g, '/'));

    for(const ui of uiKeys){
        const mapped = pickFromPool(globs, ui);
        await update(`${ui}Backgrounds`, mapped, undefined, true);
        state.current[ui] = mapped[0];
    }

    if(globs.length > 0){
        commands.executeCommand("background.install");
    }
};

const toCachedImage: (candidate: WallhavenCandidate, tags: string[]) => Promise<CachedImage | null> =
    async (candidate: WallhavenCandidate, tags: string[]) => {
        try{
            const {localPath} = await downloadImage(candidate.imageUrl, cacheDir());
            log("Downloaded image", {
                id: candidate.id,
                sourceUrl: candidate.sourceUrl,
                localPath
            });
            return {
                id: candidate.id,
                sourceUrl: candidate.sourceUrl,
                localPath,
                tags,
                fetchedAt: Date.now()
            };
        }catch(err: any){
            log("Download failed", {
                id: candidate.id,
                imageUrl: candidate.imageUrl,
                error: err?.message ?? `${err}`
            });
            return null;
        }
    };

const ensureMappingPrompt: () => Promise<void> = async () => {
    if(!isEnabled()){
        return;
    }
    const mapping = get("wallhaven.mapping", {includeDefault: false});
    if(mapping){
        return;
    }

    const pick = await window.showQuickPick([
        {label: "Shared pool", value: "shared"},
        {label: "Per-surface pools", value: "perSurface"}
    ], {
        title: "Wallhaven mapping preference",
        placeHolder: "Choose how fetched images map to window/editor/sidebar/panel"
    });

    if(pick?.value){
        await update("wallhaven.mapping", pick.value, undefined, true);
    }else{
        await update("wallhaven.mapping", "shared", undefined, true);
    }
};

export const syncNow: (showToast?: boolean) => Promise<boolean> = async (showToast: boolean = true) => {
    if(!state.context || state.syncRunning || !isEnabled()){
        log("Sync skipped", {
            hasContext: !!state.context,
            syncRunning: state.syncRunning,
            enabled: isEnabled()
        });
        return false;
    }
    state.syncRunning = true;

    return window.withProgress({
        location: ProgressLocation.Notification,
        title: "Wallhaven sync in progress",
        cancellable: false
    }, async progress => {
        try{
            progress.report({message: "Searching wallpapers..."});
            const options = searchOptions();
            log("Sync started", {
                query: options.query,
                purity: options.purity,
                atleast: options.atleast,
                ratios: options.ratios,
                sorting: options.sorting,
                limit: options.limit,
                hasApiKey: !!options.apiKey
            });
            const candidates = await searchWallpapers(options);
            log("Candidates fetched", {count: candidates.length});
            progress.report({message: `Downloading images (0/${Math.min(candidates.length, options.limit)})...`});
            const tags = options.query.split(/\s+/).map(value => value.trim()).filter(Boolean);
            const fresh: CachedImage[] = [];
            const target = candidates.slice(0, options.limit);

            for(let i = 0, len = target.length; i < len; i++){
                const image = await toCachedImage(target[i], tags);
                if(image){
                    fresh.push(image);
                }
                progress.report({message: `Downloading images (${i + 1}/${len})...`});
            }
            log("Fresh images prepared", {count: fresh.length});
            progress.report({message: "Applying synced images..."});

            let catalog = read();
            const previousFeedCount = catalog.feed.length;
            const previousFavoriteCount = catalog.favorites.length;
            catalog = mergeFeed(catalog, fresh);
            const {catalog: pruned, removed} = pruneCatalog(catalog, cacheMax());
            catalog = {
                ...pruned,
                lastSyncAt: Date.now(),
                lastError: undefined
            };
            log("Catalog updated", {
                previousFeedCount,
                previousFavoriteCount,
                newFeedCount: catalog.feed.length,
                favoriteCount: catalog.favorites.length,
                prunedCount: removed.length
            });

            if(removed.length > 0){
                removePaths(removed.map(item => item.localPath));
            }

            write(catalog);
            await applyCatalogToBackgrounds(catalog);
            log("Sync completed", {
                newImages: fresh.length,
                appliedSource: getMode() === "favorites" ? "favorites" : "feed"
            });
            if(showToast){
                window.showInformationMessage(`Wallhaven sync complete (${fresh.length} new images).`);
            }
            return true;
        }catch(err: any){
            log("Sync failed", {error: err?.message ?? `${err}`});
            const catalog = read();
            write({
                ...catalog,
                lastError: err.message
            });
            if(showToast){
                window.showWarningMessage(`Wallhaven sync failed: ${err.message}`);
            }
            return false;
        }finally{
            state.syncRunning = false;
            scheduleNext();
        }
    });
};

const scheduleNext: () => void = () => {
    if(state.timer){
        clearTimeout(state.timer);
        state.timer = undefined;
    }
    if(!isEnabled()){
        return;
    }

    const refreshTime = `${get("wallhaven.refreshTimeLocal") || "09:00"}`;
    const next = getNextRunAt(new Date(), refreshTime);
    const now = Date.now();
    const delay = Math.max(1000, next.getTime() - now);

    const catalog = read();
    write({
        ...catalog,
        nextScheduledAt: next.getTime()
    });

    state.timer = setTimeout(() => {
        syncNow(false);
    }, delay);
};

export const likeCurrent: (ui?: UI) => Promise<boolean> = async (ui?: UI) => {
    if(!isEnabled()){
        return false;
    }

    const targetUI: UI = ui ?? "window";
    const current = state.current[targetUI] ?? getFromUI(targetUI)[0];
    if(!current){
        window.showWarningMessage("No current background is available to favorite.");
        return false;
    }

    const catalog = read();
    const known = catalog.feed.find(item => item.localPath === current) ??
        catalog.favorites.find(item => item.localPath === current);
    if(!known){
        const created: CachedImage = {
            id: `manual-${Date.now()}`,
            sourceUrl: current,
            localPath: current,
            tags: [],
            fetchedAt: Date.now()
        };
        write(addFavorite(catalog, created));
        return true;
    }

    write(addFavorite(catalog, known));
    return true;
};

export const likeCurrentAndNext: (ui?: UI) => Promise<boolean> = async (ui?: UI) => {
    if(!isEnabled()){
        return false;
    }

    const targetUI: UI = ui ?? "window";
    if(!await likeCurrent(targetUI)){
        return false;
    }

    const current = getFromUI(targetUI);
    if(current.length < 2){
        window.showInformationMessage("Need at least 2 synced backgrounds to move to next image.");
        return true;
    }

    const rotated = [...current.slice(1), current[0]];
    await update(`${targetUI}Backgrounds`, rotated, undefined, true);
    state.current[targetUI] = rotated[0];
    await commands.executeCommand("background.install");
    return true;
};

export const unlike: (id: string) => Promise<void> = async (id: string) => {
    write(removeFavorite(read(), id));
};

export const getFavorites: () => string[] = () => read().favorites.map(item => item.localPath);

export const setMode: (mode: WallhavenMode) => Promise<boolean> = async (mode: WallhavenMode) => {
    await update("wallhaven.mode", mode, undefined, true);
    await applyCatalogToBackgrounds(read());
    return true;
};

export const initializeWallhaven: (context: ExtensionContext) => Promise<void> = async (context: ExtensionContext) => {
    state.context = context;
    await ensureMappingPrompt();

    if(!isEnabled()){
        return;
    }

    const catalog = read();
    const refreshTime = `${get("wallhaven.refreshTimeLocal") || "09:00"}`;
    if(shouldCatchUpNow(new Date(), refreshTime, catalog.lastSyncAt)){
        syncNow(false);
    }else{
        scheduleNext();
    }
};

export const openFavoritesPicker: () => Promise<void> = async () => {
    const catalog = read();
    if(catalog.favorites.length === 0){
        window.showInformationMessage("Favorites catalog is empty.");
        return;
    }
    const item = await window.showQuickPick(
        catalog.favorites.map(entry => ({
            label: entry.id,
            description: entry.localPath,
            detail: entry.sourceUrl
        })),
        {
            title: "Favorites",
            placeHolder: "Select a favorite to remove"
        }
    );
    if(!item){
        return;
    }
    await unlike(item.label);
};

export const addManualFavorite: (ui: UI, glob: string) => Promise<void> = async (ui: UI, glob: string) => {
    await addToUI(ui, glob, true);
    await likeCurrent(ui);
};
