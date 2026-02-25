import { request } from "https";

export type WallhavenSort = "date_added" | "relevance" | "views" | "favorites" | "toplist";

export type WallhavenWallpaper = {
    id: string,
    preview: string,
    full: string,
    resolution: string,
    favorites: number
};

export type WallhavenSearchResult = {
    currentPage: number,
    lastPage: number,
    items: WallhavenWallpaper[]
};

type WallhavenResponse = {
    data: {
        id: string,
        path: string,
        resolution: string,
        favorites: number,
        thumbs: {
            large: string
        }
    }[],
    meta: {
        current_page: number,
        last_page: number
    }
};

type WallhavenErrorResponse = {
    error?: string
};

const hostname = "wallhaven.cc";

const readJson = <T>(path: string, trace?: (message: string) => void): Promise<T> =>
    new Promise((resolve, reject) => {
        trace?.(`Requesting https://${hostname}${path}`);
        const req = request({
            hostname,
            method: "GET",
            path,
            headers: {
                "accept": "application/json",
                "user-agent": "Background VSCode Extension"
            }
        }, (res) => {
            trace?.(`Response status ${res.statusCode ?? "unknown"} for ${path}`);
            if(!res.statusCode || res.statusCode >= 400){
                reject(new Error(`Wallhaven request failed (${res.statusCode ?? "unknown"})`));
                res.resume();
                return;
            }

            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
                try{
                    const body = Buffer.concat(chunks).toString("utf-8");
                    trace?.(`Response body length ${body.length} for ${path}`);
                    resolve(JSON.parse(body) as T);
                }catch(error){
                    reject(error);
                }
            });
        });

        req.on("error", (error) => {
            trace?.(`Request error for ${path}: ${error.message}`);
            reject(error);
        });
        req.end();
    });

export const searchWallhaven = async (
    query: string,
    sort: WallhavenSort,
    page: number,
    trace?: (message: string) => void
): Promise<WallhavenSearchResult> => {
    const params = new URLSearchParams({
        sorting: sort,
        page: `${Math.max(page, 1)}`,
        categories: "111",
        purity: "100"
    });
    const normalizedQuery = query.trim();
    if(normalizedQuery){
        params.set("q", normalizedQuery);
    }
    if(sort === "toplist"){
        params.set("topRange", "1M");
    }

    const requestPath = `/api/v1/search?${params.toString()}`;
    trace?.(`Search input query='${normalizedQuery}' sort='${sort}' page=${Math.max(page, 1)}`);
    const payload = await readJson<WallhavenResponse | WallhavenErrorResponse>(requestPath, trace);

    if("error" in payload && payload.error){
        throw new Error(payload.error);
    }
    if(!("data" in payload) || !Array.isArray(payload.data) || !payload.meta){
        throw new Error("Wallhaven returned an unexpected response");
    }

    const response = payload;
    trace?.(`Parsed ${response.data.length} wallpapers, page ${response.meta.current_page}/${response.meta.last_page}`);

    return {
        currentPage: response.meta.current_page,
        lastPage: response.meta.last_page,
        items: response.data.map((item) => ({
            id: item.id,
            preview: item.thumbs.large,
            full: item.path,
            resolution: item.resolution,
            favorites: item.favorites
        }))
    };
};
