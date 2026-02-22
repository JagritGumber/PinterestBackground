/*
 * Copyright (C) 2026 Jagrit Gumber
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

type RawWallpaper = {
    id?: string,
    url?: string,
    short_url?: string,
    path?: string,
    purity?: string,
    category?: string,
    resolution?: string,
    dimension_x?: number,
    dimension_y?: number
};

type SearchResponse = {
    data?: RawWallpaper[],
    meta?: {
        current_page?: number,
        last_page?: number
    }
};

export type SearchOptions = {
    query: string,
    purity: string,
    atleast: string,
    ratios: string[],
    sorting: string,
    limit: number,
    apiKey?: string
};

export type WallhavenCandidate = {
    id: string,
    imageUrl: string,
    sourceUrl: string,
    resolution?: string,
    category?: string,
    purity?: string
};

const log: (...args: unknown[]) => void = (...args: unknown[]) => {
    console.log("[Background][Wallhaven]", ...args);
};

const readItems: (payload: SearchResponse) => RawWallpaper[] = (payload: SearchResponse) =>
    Array.isArray(payload?.data) ? payload.data : [];

const validDimensions: (item: RawWallpaper) => boolean = (item: RawWallpaper) => {
    if(typeof item.dimension_x === "number" && item.dimension_x <= 0){
        return false;
    }
    if(typeof item.dimension_y === "number" && item.dimension_y <= 0){
        return false;
    }
    return true;
};

const normalizeWallpaper: (item: RawWallpaper) => WallhavenCandidate | null = (item: RawWallpaper) => {
    if(!item.id || !item.path || !item.path.startsWith("http") || !validDimensions(item)){
        return null;
    }

    return {
        id: item.id,
        imageUrl: item.path,
        sourceUrl: item.url || item.short_url || item.path,
        resolution: item.resolution,
        category: item.category,
        purity: item.purity
    };
};

const callSearch: (options: SearchOptions, page: number) => Promise<SearchResponse> = async (options: SearchOptions, page: number) => {
    const params = new URLSearchParams();
    params.set("q", options.query.trim() || "anime 1girl wallpaper");
    params.set("categories", "010");
    params.set("purity", options.purity || "100");
    params.set("sorting", options.sorting || "random");
    params.set("atleast", options.atleast || "1920x1080");
    params.set("ratios", options.ratios.filter(Boolean).join(",") || "16x9,16x10,21x9");
    params.set("page", `${Math.max(1, page)}`);
    if(options.apiKey){
        params.set("apikey", options.apiKey);
    }
    log("API request", {
        page,
        q: params.get("q"),
        categories: params.get("categories"),
        purity: params.get("purity"),
        sorting: params.get("sorting"),
        atleast: params.get("atleast"),
        ratios: params.get("ratios"),
        hasApiKey: !!options.apiKey
    });

    const response = await fetch(`https://wallhaven.cc/api/v1/search?${params.toString()}`, {
        headers: {"Accept": "application/json"}
    });
    if(!response.ok){
        log("API failure", {page, status: response.status});
        throw new Error(`Wallhaven API failed (${response.status})`);
    }
    log("API success", {page, status: response.status});
    return response.json() as Promise<SearchResponse>;
};

export const searchWallpapers: (options: SearchOptions) => Promise<WallhavenCandidate[]> = async (options: SearchOptions) => {
    const limit = Math.max(1, Math.min(100, options.limit || 20));
    const perPage = 24;
    const maxPages = Math.min(10, Math.max(1, Math.ceil(limit / perPage) + 2));

    const results: WallhavenCandidate[] = [];
    for(let page = 1; page <= maxPages && results.length < limit; page++){
        const payload = await callSearch(options, page);
        const rawItems = readItems(payload);
        const normalized = rawItems
            .map(normalizeWallpaper)
            .filter((item): item is WallhavenCandidate => !!item);
        log("Page processed", {
            page,
            rawCount: rawItems.length,
            normalizedCount: normalized.length,
            runningTotal: results.length + normalized.length,
            lastPage: payload.meta?.last_page ?? page
        });
        results.push(...normalized);

        const lastPage = payload.meta?.last_page ?? page;
        if(page >= lastPage){
            log("Reached last page", {page, lastPage, collected: results.length});
            break;
        }
    }

    log("Search complete", {limit, returned: results.slice(0, limit).length, collected: results.length});
    return results.slice(0, limit);
};
