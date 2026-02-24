import { ExtensionContext } from "vscode";

export type CollectionWallpaper = {
    id: string,
    url: string,
    preview: string,
    sourceId?: string
};

export type WallpaperCollection = {
    id: string,
    name: string,
    wallpapers: CollectionWallpaper[]
};

export type ActiveWallpaper = {
    source: "wallhaven" | "collection",
    url: string,
    wallhavenId?: string,
    appliedAt: string
};

export type ExtensionState = {
    collections: WallpaperCollection[],
    activeWallpaper: ActiveWallpaper | null,
    enabledCollectionId: string | null,
    lastRotationDate: string | null,
    pendingRotationCollectionId: string | null
};

const storageKey = "background.state.v1";

const initialState: ExtensionState = {
    collections: [],
    activeWallpaper: null,
    enabledCollectionId: null,
    lastRotationDate: null,
    pendingRotationCollectionId: null
};

const createId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class StateStore {

    private state: ExtensionState;

    public constructor(private readonly context: ExtensionContext){
        this.state = this.context.globalState.get<ExtensionState>(storageKey) ?? initialState;
    }

    public getState(): ExtensionState {
        return this.state;
    }

    public async save(): Promise<void> {
        await this.context.globalState.update(storageKey, this.state);
    }

    public async createCollection(name: string): Promise<WallpaperCollection> {
        const collection: WallpaperCollection = {
            id: createId(),
            name,
            wallpapers: []
        };
        this.state = {
            ...this.state,
            collections: [...this.state.collections, collection]
        };
        await this.save();
        return collection;
    }

    public async renameCollection(collectionId: string, name: string): Promise<void> {
        this.state = {
            ...this.state,
            collections: this.state.collections.map((collection) =>
                collection.id === collectionId ? {...collection, name} : collection
            )
        };
        await this.save();
    }

    public async deleteCollection(collectionId: string): Promise<void> {
        this.state = {
            ...this.state,
            collections: this.state.collections.filter((collection) => collection.id !== collectionId),
            enabledCollectionId: this.state.enabledCollectionId === collectionId ? null : this.state.enabledCollectionId,
            pendingRotationCollectionId: this.state.pendingRotationCollectionId === collectionId ? null : this.state.pendingRotationCollectionId
        };
        await this.save();
    }

    public async addWallpaper(collectionId: string, wallpaper: CollectionWallpaper): Promise<void> {
        this.state = {
            ...this.state,
            collections: this.state.collections.map((collection) => {
                if(collection.id !== collectionId){
                    return collection;
                }

                if(collection.wallpapers.some((current) => current.url === wallpaper.url)){
                    return collection;
                }

                return {
                    ...collection,
                    wallpapers: [...collection.wallpapers, wallpaper]
                };
            })
        };
        await this.save();
    }

    public async removeWallpaper(collectionId: string, wallpaperId: string): Promise<void> {
        this.state = {
            ...this.state,
            collections: this.state.collections.map((collection) =>
                collection.id === collectionId
                    ? {
                        ...collection,
                        wallpapers: collection.wallpapers.filter((wallpaper) => wallpaper.id !== wallpaperId)
                    }
                    : collection
            )
        };
        await this.save();
    }

    public async setActiveWallpaper(activeWallpaper: ActiveWallpaper): Promise<void> {
        this.state = {
            ...this.state,
            activeWallpaper
        };
        await this.save();
    }

    public async setEnabledCollection(collectionId: string | null): Promise<void> {
        this.state = {
            ...this.state,
            enabledCollectionId: collectionId
        };
        await this.save();
    }

    public async setLastRotationDate(lastRotationDate: string): Promise<void> {
        this.state = {
            ...this.state,
            lastRotationDate
        };
        await this.save();
    }

    public async setPendingRotationCollection(collectionId: string | null): Promise<void> {
        this.state = {
            ...this.state,
            pendingRotationCollectionId: collectionId
        };
        await this.save();
    }
}
