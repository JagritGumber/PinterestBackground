/*
 * Copyright (C) 2026 Jagrit Gumber
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

export const parseRefreshTime: (value: string) => {hour: number, minute: number} | null = (value: string) => {
    const match: RegExpMatchArray | null = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if(!match){
        return null;
    }
    return {
        hour: +match[1],
        minute: +match[2]
    };
};

export const withLocalTime: (at: Date, hour: number, minute: number) => Date = (at: Date, hour: number, minute: number) =>
    new Date(at.getFullYear(), at.getMonth(), at.getDate(), hour, minute, 0, 0);

export const getNextRunAt: (now: Date, refreshTime: string) => Date = (now: Date, refreshTime: string) => {
    const parsed = parseRefreshTime(refreshTime) ?? {hour: 9, minute: 0};
    const today = withLocalTime(now, parsed.hour, parsed.minute);

    if(now.getTime() < today.getTime()){
        return today;
    }

    const tomorrow = new Date(today.getTime());
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
};

export const shouldCatchUpNow: (now: Date, refreshTime: string, lastSyncAt?: number) => boolean =
    (now: Date, refreshTime: string, lastSyncAt?: number) => {
        const parsed = parseRefreshTime(refreshTime) ?? {hour: 9, minute: 0};
        const slot = withLocalTime(now, parsed.hour, parsed.minute).getTime();

        if(now.getTime() < slot){
            return false;
        }
        return !lastSyncAt || lastSyncAt < slot;
    };
