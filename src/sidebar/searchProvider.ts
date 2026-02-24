import { Event, EventEmitter, TreeDataProvider, TreeItem, TreeItemCollapsibleState, workspace } from "vscode";

import { WallhavenSort, WallhavenWallpaper, searchWallhaven } from "../wallhaven/client";

const sorts: WallhavenSort[] = ["date_added", "relevance", "views", "favorites", "toplist"];

const getConfig = () => workspace.getConfiguration("background");

export class SearchResultItem extends TreeItem {

    public readonly contextValue = "search.result";

    public constructor(public readonly wallpaper: WallhavenWallpaper){
        super(`#${wallpaper.id}  ${wallpaper.resolution}`, TreeItemCollapsibleState.None);
        this.description = `Favorites: ${wallpaper.favorites}`;
        this.tooltip = wallpaper.full;
        this.command = {
            command: "background.search.apply",
            title: "Apply Wallpaper",
            arguments: [wallpaper]
        };
    }
}

class ActionItem extends TreeItem {

    public constructor(label: string, command: string, tooltip?: string){
        super(label, TreeItemCollapsibleState.None);
        this.command = { command, title: label };
        this.tooltip = tooltip;
    }
}

class InfoItem extends TreeItem {

    public constructor(label: string, description?: string){
        super(label, TreeItemCollapsibleState.None);
        this.description = description;
    }
}

type SearchState = {
    loading: boolean,
    error?: string,
    lastPage: number,
    items: WallhavenWallpaper[]
};

export class SearchTreeProvider implements TreeDataProvider<TreeItem> {

    private readonly emitter = new EventEmitter<TreeItem | void>();
    private state: SearchState = {
        loading: false,
        lastPage: 1,
        items: []
    };

    public readonly onDidChangeTreeData: Event<TreeItem | void> = this.emitter.event;

    public async refresh(): Promise<void> {
        this.state = {...this.state, loading: true, error: undefined};
        this.emitter.fire();

        try{
            const query = this.query;
            const sort = this.sort;
            const page = this.page;

            const result = await searchWallhaven(query, sort, page);
            this.state = {
                loading: false,
                lastPage: result.lastPage,
                items: result.items
            };
        }catch(error: any){
            this.state = {
                ...this.state,
                loading: false,
                error: error.message ?? "Failed to load wallpapers"
            };
        }

        this.emitter.fire();
    }

    public async setQuery(query: string): Promise<void> {
        await getConfig().update("wallhaven.query", query, true);
        await getConfig().update("wallhaven.page", 1, true);
        await this.refresh();
    }

    public async setSort(sort: WallhavenSort): Promise<void> {
        await getConfig().update("wallhaven.sort", sort, true);
        await getConfig().update("wallhaven.page", 1, true);
        await this.refresh();
    }

    public async nextPage(): Promise<void> {
        if(this.page < this.state.lastPage){
            await getConfig().update("wallhaven.page", this.page + 1, true);
            await this.refresh();
        }
    }

    public async prevPage(): Promise<void> {
        if(this.page > 1){
            await getConfig().update("wallhaven.page", this.page - 1, true);
            await this.refresh();
        }
    }

    public getTreeItem(element: TreeItem): TreeItem {
        return element;
    }

    public getChildren(element?: TreeItem): TreeItem[] {
        if(element){
            return [];
        }

        const items: TreeItem[] = [
            new ActionItem(`Query: ${this.query || "(all)"}`, "background.search.setQuery", "Set Wallhaven search query"),
            new ActionItem(`Sort: ${this.sort}`, "background.search.setSort", "Set Wallhaven sort order"),
            new InfoItem(`Page ${this.page} of ${this.state.lastPage}`),
            new ActionItem("Previous Page", "background.search.prevPage"),
            new ActionItem("Next Page", "background.search.nextPage"),
            new ActionItem("Refresh", "background.search.refresh")
        ];

        if(this.state.loading){
            items.push(new InfoItem("Loading wallpapers..."));
            return items;
        }

        if(this.state.error){
            items.push(new InfoItem("Search failed", this.state.error));
            return items;
        }

        if(this.state.items.length === 0){
            items.push(new InfoItem("No wallpapers found"));
            return items;
        }

        items.push(...this.state.items.map((wallpaper) => new SearchResultItem(wallpaper)));
        return items;
    }

    private get query(): string {
        return getConfig().get<string>("wallhaven.query") ?? "";
    }

    private get sort(): WallhavenSort {
        const current = getConfig().get<WallhavenSort>("wallhaven.sort") ?? "date_added";
        return sorts.includes(current) ? current : "date_added";
    }

    private get page(): number {
        return Math.max(getConfig().get<number>("wallhaven.page") ?? 1, 1);
    }
}

export const wallhavenSortOptions: WallhavenSort[] = sorts;
