/*
 * Copyright (C) 2026 Jagrit Gumber
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

import { Catalog, CachedImage } from "./types";

const EmptyCatalog: Catalog = {
    feed: [],
    favorites: []
};

export const readCatalog: (path: string) => Catalog = (path: string) => {
    if(!existsSync(path)){
        return {...EmptyCatalog};
    }
    try{
        const data = JSON.parse(readFileSync(path, "utf-8")) as Catalog;
        return {
            feed: data.feed ?? [],
            favorites: data.favorites ?? [],
            lastSyncAt: data.lastSyncAt,
            nextScheduledAt: data.nextScheduledAt,
            mapping: data.mapping,
            lastError: data.lastError
        };
    }catch(_){
        return {...EmptyCatalog};
    }
};

export const writeCatalog: (path: string, catalog: Catalog) => void = (path: string, catalog: Catalog) => {
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, JSON.stringify(catalog, null, 2), "utf-8");
};

const dedupeById: (items: CachedImage[]) => CachedImage[] = (items: CachedImage[]) => {
    const seen = new Set<string>();
    const result: CachedImage[] = [];
    for(const item of items){
        if(!seen.has(item.id)){
            seen.add(item.id);
            result.push(item);
        }
    }
    return result;
};

export const mergeFeed: (catalog: Catalog, fresh: CachedImage[]) => Catalog = (catalog: Catalog, fresh: CachedImage[]) => ({
    ...catalog,
    feed: dedupeById([...fresh, ...catalog.feed])
});

export const addFavorite: (catalog: Catalog, item: CachedImage) => Catalog = (catalog: Catalog, item: CachedImage) => ({
    ...catalog,
    favorites: dedupeById([item, ...catalog.favorites])
});

export const removeFavorite: (catalog: Catalog, id: string) => Catalog = (catalog: Catalog, id: string) => ({
    ...catalog,
    favorites: catalog.favorites.filter(item => item.id !== id)
});

export const pruneCatalog: (catalog: Catalog, maxItems: number) => {catalog: Catalog, removed: CachedImage[]} =
    (catalog: Catalog, maxItems: number) => {
        const keep = Math.max(1, maxItems);
        const favoriteIds = new Set(catalog.favorites.map(item => item.id));
        const result = [...catalog.feed];
        const removed: CachedImage[] = [];

        while(result.length > keep){
            const index = result.map(item => favoriteIds.has(item.id)).lastIndexOf(false);
            if(index === -1){
                break;
            }
            removed.push(result[index]);
            result.splice(index, 1);
        }

        return {
            catalog: {
                ...catalog,
                feed: result
            },
            removed
        };
    };
