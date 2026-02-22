/*
 * Copyright (C) 2026 Jagrit Gumber
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { window } from "vscode";

import { get, update } from "../extension/config";
import { getFavorites, likeCurrent, likeCurrentAndNext, openFavoritesPicker, setMode, syncNow } from "../extension/wallhaven";
import { quickPickItem, separator, showQuickPick } from "../lib/vscode";

const parseCsv: (value: string) => string[] = (value: string) =>
    value.split(",").map(item => item.trim()).filter(Boolean);

export const wallhavenMenu: () => void = () =>
    showQuickPick([
        quickPickItem({
            label: get("wallhaven.enabled") ? "Disable Wallhaven Sync" : "Enable Wallhaven Sync",
            description: `[${get("wallhaven.enabled") ? "on" : "off"}]`,
            handle: async () => {
                await update("wallhaven.enabled", !get("wallhaven.enabled"), undefined, true);
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Sync Now",
            handle: async () => {
                await syncNow(true);
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Set Refresh Time",
            description: `[${get("wallhaven.refreshTimeLocal")}]`,
            handle: async () => {
                const next = await window.showInputBox({
                    title: "Wallhaven Refresh Time",
                    value: `${get("wallhaven.refreshTimeLocal") || "09:00"}`,
                    placeHolder: "HH:mm",
                    validateInput: value => /^([01]?\d|2[0-3]):([0-5]\d)$/.test(value.trim()) ? null : "Format must be HH:mm"
                });
                if(next){
                    await update("wallhaven.refreshTimeLocal", next.trim(), undefined, true);
                }
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Set Search Query",
            description: `[${get("wallhaven.query") || "unset"}]`,
            handle: async () => {
                const next = await window.showInputBox({
                    title: "Wallhaven query",
                    value: `${get("wallhaven.query") || "anime 1girl wallpaper"}`,
                    placeHolder: "1girl anime city night"
                });
                if(next !== undefined){
                    await update("wallhaven.query", next.trim(), undefined, true);
                }
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Set Purity",
            description: `[${get("wallhaven.purity") || "100"}]`,
            handle: async () => {
                const selected = await window.showQuickPick([
                    {label: "SFW (100)", value: "100"},
                    {label: "SFW + Sketchy (110)", value: "110"},
                    {label: "All (111)", value: "111"}
                ], {title: "Wallhaven Purity"});
                if(selected){
                    await update("wallhaven.purity", selected.value, undefined, true);
                }
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Set Minimum Resolution",
            description: `[${get("wallhaven.atleast") || "1920x1080"}]`,
            handle: async () => {
                const next = await window.showInputBox({
                    title: "Wallhaven minimum resolution",
                    value: `${get("wallhaven.atleast") || "1920x1080"}`,
                    placeHolder: "1920x1080",
                    validateInput: value => /^\d+x\d+$/i.test(value.trim()) ? null : "Format must be WIDTHxHEIGHT"
                });
                if(next){
                    await update("wallhaven.atleast", next.trim().toLowerCase(), undefined, true);
                }
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Set Ratios",
            description: `[${(get("wallhaven.ratios") || []).join(", ") || "unset"}]`,
            handle: async () => {
                const current = Array.isArray(get("wallhaven.ratios")) ? get("wallhaven.ratios").join(", ") : "16x9, 16x10, 21x9";
                const next = await window.showInputBox({
                    title: "Wallhaven ratios",
                    value: current,
                    placeHolder: "16x9, 16x10, 21x9"
                });
                if(next !== undefined){
                    await update("wallhaven.ratios", parseCsv(next), undefined, true);
                }
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Set Sorting",
            description: `[${get("wallhaven.sorting") || "random"}]`,
            handle: async () => {
                const selected = await window.showQuickPick([
                    {label: "Random", value: "random"},
                    {label: "Toplist", value: "toplist"},
                    {label: "Favorites", value: "favorites"},
                    {label: "Views", value: "views"},
                    {label: "Date Added", value: "date_added"},
                    {label: "Relevance", value: "relevance"}
                ], {title: "Wallhaven sorting"});
                if(selected){
                    await update("wallhaven.sorting", selected.value, undefined, true);
                }
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Set API Key (optional)",
            description: `[${get("wallhaven.apiKey") ? "set" : "unset"}]`,
            handle: async () => {
                const next = await window.showInputBox({
                    title: "Wallhaven API key",
                    value: `${get("wallhaven.apiKey") || ""}`,
                    password: true
                });
                if(next !== undefined){
                    await update("wallhaven.apiKey", next.trim(), undefined, true);
                }
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Toggle Mode",
            description: `[${get("wallhaven.mode")}]`,
            handle: async () => {
                await setMode(get("wallhaven.mode") === "favorites" ? "daily" : "favorites");
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Set Mapping",
            description: `[${get("wallhaven.mapping") || "unset"}]`,
            handle: async () => {
                const selected = await window.showQuickPick([
                    {label: "Shared pool", value: "shared"},
                    {label: "Per-surface pools", value: "perSurface"}
                ], {title: "Mapping"});
                if(selected){
                    await update("wallhaven.mapping", selected.value, undefined, true);
                }
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Like Current Background",
            handle: async () => {
                await likeCurrent();
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Like Current + Next Background",
            handle: async () => {
                await likeCurrentAndNext();
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Remove Favorite",
            description: `[${getFavorites().length}]`,
            handle: async () => {
                await openFavoritesPicker();
                wallhavenMenu();
            }
        }),
        separator(),
        quickPickItem({
            label: "Set Mode: Daily",
            handle: async () => {
                await setMode("daily");
                wallhavenMenu();
            }
        }),
        quickPickItem({
            label: "Set Mode: Favorites",
            handle: async () => {
                await setMode("favorites");
                wallhavenMenu();
            }
        })
    ], {
        title: "Wallhaven"
    });
