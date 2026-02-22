/*
 * Copyright (C) 2026 Jagrit Gumber
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

import { createHash } from "crypto";
import { extname } from "path";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";

const toExt: (url: string, contentType?: string | null) => string = (url: string, contentType?: string | null) => {
    const ext = extname(new URL(url).pathname).toLowerCase();
    if([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"].includes(ext)){
        return ext;
    }
    if(!contentType){
        return ".jpg";
    }
    if(contentType.includes("png")) return ".png";
    if(contentType.includes("webp")) return ".webp";
    if(contentType.includes("gif")) return ".gif";
    if(contentType.includes("bmp")) return ".bmp";
    if(contentType.includes("svg")) return ".svg";
    return ".jpg";
};

export const hashText: (value: string) => string = (value: string) =>
    createHash("sha256").update(value).digest("hex");

export const downloadImage: (url: string, dir: string) => Promise<{id: string, localPath: string}> =
    async (url: string, dir: string) => {
        const response = await fetch(url);
        if(!response.ok){
            throw new Error(`Image request failed (${response.status})`);
        }

        const contentType: string | null = response.headers.get("content-type");
        if(contentType && !contentType.startsWith("image/")){
            throw new Error(`Unsupported content type: ${contentType}`);
        }

        const id = hashText(url);
        const ext = toExt(url, contentType);

        mkdirSync(dir, {recursive: true});
        const target = `${dir}/${id}${ext}`;
        if(!existsSync(target)){
            const arr = await response.arrayBuffer();
            writeFileSync(target, Buffer.from(arr));
        }
        return {
            id,
            localPath: target.replace(/\\/g, '/')
        };
    };

export const removePaths: (paths: string[]) => void = (paths: string[]) => {
    for(const path of paths){
        if(existsSync(path)){
            try{
                unlinkSync(path);
            }catch(_){
                // ignore cleanup failure
            }
        }
    }
};
