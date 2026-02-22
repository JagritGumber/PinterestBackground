/*
 * Copyright (C) 2026 Jagrit Gumber
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { UI } from "../config";

export type WallhavenMode = "daily" | "favorites";
export type WallhavenMapping = "shared" | "perSurface";

export type CachedImage = {
    id: string,
    sourceUrl: string,
    localPath: string,
    tags: string[],
    fetchedAt: number
};

export type Catalog = {
    feed: CachedImage[],
    favorites: CachedImage[],
    lastSyncAt?: number,
    nextScheduledAt?: number,
    mapping?: WallhavenMapping,
    lastError?: string
};

export type CurrentSelection = {
    window?: string,
    editor?: string,
    sidebar?: string,
    panel?: string
};

export const uiKeys: UI[] = ["window", "editor", "sidebar", "panel"];
