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

const hostname = "wallhaven.cc";

const readJson = <T>(path: string): Promise<T> =>
    new Promise((resolve, reject) => {
        const req = request({ hostname, method: "GET", path }, (res) => {
            if(!res.statusCode || res.statusCode >= 400){
                reject(new Error(`Wallhaven request failed (${res.statusCode ?? "unknown"})`));
                res.resume();
                return;
            }

            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
                try{
                    resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T);
                }catch(error){
                    reject(error);
                }
            });
        });

        req.on("error", reject);
        req.end();
    });

export const searchWallhaven = async (query: string, sort: WallhavenSort, page: number): Promise<WallhavenSearchResult> => {
    const params = new URLSearchParams({
        q: query,
        sorting: sort,
        page: `${Math.max(page, 1)}`,
        categories: "111",
        purity: "100"
    });

    const response = await readJson<WallhavenResponse>(`/api/v1/search?${params.toString()}`);

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
