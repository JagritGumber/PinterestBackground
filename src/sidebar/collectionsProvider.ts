import { Event, EventEmitter, TreeDataProvider, TreeItem, TreeItemCollapsibleState, ThemeIcon } from "vscode";

import { CollectionWallpaper, StateStore, WallpaperCollection } from "../state/store";

export class CollectionItem extends TreeItem {

    public readonly contextValue = "collection.item";

    public constructor(public readonly collection: WallpaperCollection, isEnabled: boolean){
        super(collection.name, TreeItemCollapsibleState.Collapsed);
        this.description = `${collection.wallpapers.length} wallpaper${collection.wallpapers.length === 1 ? "" : "s"}${isEnabled ? " • Daily" : ""}`;
        this.iconPath = new ThemeIcon(isEnabled ? "sync" : "files");
    }
}

export class CollectionWallpaperItem extends TreeItem {

    public readonly contextValue = "collection.wallpaper";

    public constructor(public readonly collectionId: string, public readonly wallpaper: CollectionWallpaper){
        super(wallpaper.sourceId ? `#${wallpaper.sourceId}` : wallpaper.url, TreeItemCollapsibleState.None);
        this.description = wallpaper.url;
        this.tooltip = wallpaper.url;
        this.command = {
            command: "background.collections.applyNow",
            title: "Apply Wallpaper",
            arguments: [collectionId, wallpaper.id]
        };
    }
}

class ActionItem extends TreeItem {

    public readonly contextValue = "collection.action";

    public constructor(label: string, command: string){
        super(label, TreeItemCollapsibleState.None);
        this.command = { command, title: label };
    }
}

class EmptyItem extends TreeItem {

    public constructor(label: string){
        super(label, TreeItemCollapsibleState.None);
    }
}

export class CollectionsTreeProvider implements TreeDataProvider<TreeItem> {

    private readonly emitter = new EventEmitter<TreeItem | void>();

    public readonly onDidChangeTreeData: Event<TreeItem | void> = this.emitter.event;

    public constructor(private readonly store: StateStore){ }

    public refresh(): void {
        this.emitter.fire();
    }

    public getTreeItem(element: TreeItem): TreeItem {
        return element;
    }

    public getChildren(element?: TreeItem): TreeItem[] {
        const state = this.store.getState();

        if(!element){
            const root: TreeItem[] = [new ActionItem("Create Collection", "background.collections.create")];

            if(state.collections.length === 0){
                root.push(new EmptyItem("No collections yet"));
                return root;
            }

            root.push(...state.collections.map((collection) =>
                new CollectionItem(collection, state.enabledCollectionId === collection.id)
            ));

            return root;
        }

        if(element instanceof CollectionItem){
            const children: TreeItem[] = [new ActionItem("Add wallpaper URL", "background.collections.addWallpaper")];
            children[0].command = {
                command: "background.collections.addWallpaper",
                title: "Add Wallpaper",
                arguments: [element.collection.id]
            };

            if(element.collection.wallpapers.length === 0){
                children.push(new EmptyItem("Collection is empty"));
                return children;
            }

            children.push(...element.collection.wallpapers.map((wallpaper) =>
                new CollectionWallpaperItem(element.collection.id, wallpaper)
            ));

            return children;
        }

        return [];
    }
}
