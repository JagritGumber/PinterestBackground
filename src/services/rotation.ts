import { Disposable, window } from "vscode";

import { applyWallpaper } from "./wallpaper";
import { StateStore, WallpaperCollection } from "../state/store";

const localDate = (): string => {
    const now = new Date();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
};

const nextMidnightDelay = (): number => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    return next.getTime() - now.getTime();
};

export class DailyRotationScheduler implements Disposable {

    private timer: NodeJS.Timeout | null = null;

    public constructor(private readonly store: StateStore, private readonly workbench: string, private readonly product: string){ }

    public async initialize(): Promise<void> {
        const pendingCollectionId = this.store.getState().pendingRotationCollectionId;
        if(pendingCollectionId){
            const collection = this.findCollection(pendingCollectionId);
            if(collection){
                await this.rotateFromCollection(collection, true);
            }
            await this.store.setPendingRotationCollection(null);
        }

        this.schedule();
    }

    public schedule(): void {
        if(this.timer){
            clearTimeout(this.timer);
        }

        this.timer = setTimeout(async () => {
            await this.handleMidnight();
            this.schedule();
        }, nextMidnightDelay());
    }

    public dispose(): void {
        if(this.timer){
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private async handleMidnight(): Promise<void> {
        const state = this.store.getState();
        if(!state.enabledCollectionId){
            return;
        }

        if(state.lastRotationDate === localDate()){
            return;
        }

        const collection = this.findCollection(state.enabledCollectionId);
        if(!collection || collection.wallpapers.length === 0){
            return;
        }

        const isActive = window.state.focused && window.visibleTextEditors.length > 0;

        if(isActive){
            const selection = await window.showInformationMessage(
                "Midnight reached. Change wallpaper now?",
                "Apply now",
                "Change on next startup",
                "Skip today"
            );

            if(selection === "Apply now"){
                await this.rotateFromCollection(collection, false);
                return;
            }

            if(selection === "Change on next startup"){
                await this.store.setPendingRotationCollection(collection.id);
                await this.store.setLastRotationDate(localDate());
                return;
            }

            await this.store.setLastRotationDate(localDate());
            return;
        }

        await this.rotateFromCollection(collection, false);
    }

    private async rotateFromCollection(collection: WallpaperCollection, startup: boolean): Promise<void> {
        if(collection.wallpapers.length === 0){
            return;
        }

        const index = Math.floor(Math.random() * collection.wallpapers.length);
        const selected = collection.wallpapers[index];
        await applyWallpaper(this.store, this.workbench, this.product, selected.url, "collection", selected.sourceId);
        await this.store.setLastRotationDate(localDate());

        if(startup){
            window.showInformationMessage(`Applied deferred wallpaper from collection '${collection.name}'.`);
        }
    }

    private findCollection(collectionId: string): WallpaperCollection | undefined {
        return this.store.getState().collections.find((collection) => collection.id === collectionId);
    }
}
