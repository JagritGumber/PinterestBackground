import { join } from "path";
import { platform, release } from "os";
import { exec } from "@vscode/sudo-prompt";
import { copyFileSync, existsSync } from "fs";
import {
    commands,
    env,
    ExtensionContext,
    InputBoxOptions,
    StatusBarAlignment,
    StatusBarItem,
    Uri,
    window
} from "vscode";

import { copyCommand } from "./lib/file";
import { reload } from "./lib/vscode";

import { install, uninstall } from "./extension/writer";
import { setUserDir } from "./extension/env";
import { api } from "./extension/api";

import { applyWallpaper } from "./services/wallpaper";
import { DailyRotationScheduler } from "./services/rotation";
import { SearchResultItem, SearchTreeProvider, wallhavenSortOptions } from "./sidebar/searchProvider";
import { CollectionItem, CollectionWallpaperItem, CollectionsTreeProvider } from "./sidebar/collectionsProvider";
import { CollectionWallpaper, StateStore, WallpaperCollection } from "./state/store";
import { WallhavenSort, WallhavenWallpaper } from "./wallhaven/client";

const forcedDelay = 1000;
export let installDelay = 7000;

export const setActive = (active?: boolean): void => {
    statusbar.text = `$(${active === false ? "file-media" : "loading~spin"}) Background`;
};

export const statusbar: StatusBarItem = (() => {
    const item = window.createStatusBarItem(StatusBarAlignment.Right);
    item.command = "workbench.view.extension.background";
    item.name = "Background";
    item.text = "$(file-media) Background";
    item.tooltip = "Open Background sidebar";
    return item;
})();

const createCollectionWallpaper = (wallpaper: WallhavenWallpaper): CollectionWallpaper => ({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    url: wallpaper.full,
    preview: wallpaper.preview,
    sourceId: wallpaper.id
});

const pickCollection = async (collections: WallpaperCollection[]): Promise<WallpaperCollection | undefined> => {
    if(collections.length === 0){
        return undefined;
    }

    const options = collections.map((collection) => ({
        label: collection.name,
        description: `${collection.wallpapers.length} wallpaper${collection.wallpapers.length === 1 ? "" : "s"}`,
        collection
    }));

    const selected = await window.showQuickPick(options, { placeHolder: "Select collection" });
    return selected?.collection;
};

export const activate = async (context: ExtensionContext): Promise<any> => {
    let workbench = "";
    let product = "";

    const dir = env.appRoot;

    setUserDir(join(context.globalStorageUri.fsPath, "../../../User"));

    if(!dir){
        window.showErrorMessage("Failed to find application directory, please report this issue");
        return {};
    }

    workbench = join(dir, "out", "vs", "workbench", "workbench.desktop.main.js");
    product = join(dir, "product.json");

    if(!existsSync(workbench)){
        window.showErrorMessage(`Failed to find '${workbench}', please report this issue`);
        return {};
    }
    if(!existsSync(product)){
        window.showErrorMessage(`Failed to find '${product}', please report this issue`);
        return {};
    }

    const workbenchBackup = workbench.replace(".js", "-backup.js");
    const productBackup = product.replace(".json", "-backup.json");

    if(!existsSync(workbenchBackup) || !existsSync(productBackup)){
        try{
            copyFileSync(workbench, workbenchBackup);
            copyFileSync(product, productBackup);
        }catch(err: any){
            const snap = platform() === "linux" &&
                workbench.replace(/\\/g, "/").includes("/snap/") &&
                product.replace(/\\/g, "/").includes("/snap/");

            if(snap){
                window.showErrorMessage("Background extension does not support snap installations, use deb or rpm");
                return {};
            }

            window.showWarningMessage(
                "Failed to backup files, run command as administrator?",
                {
                    detail: `The Background extension does not have permission to backup to the VSCode folder, run command using administrator permissions?\n\n${err.message}`,
                    modal: true
                },
                "Yes"
            ).then((value?: string) => {
                if(value !== "Yes"){
                    window.showWarningMessage("Background extension is running without backup files");
                    return;
                }

                const command = copyCommand([
                    [workbench, workbenchBackup],
                    [product, productBackup]
                ]);

                exec(command, { name: "VSCode Extension Host" }, (error?: Error) => {
                    if(error){
                        window.showErrorMessage(
                            "Failed to backup files",
                            {
                                detail: `OS: ${platform()} ${release()}\nUsing command: ${command}\n\n${error.name}\n${error.message}`.trim(),
                                modal: true
                            }
                        );
                    }
                });
            });
        }
    }

    const store = new StateStore(context);
    const searchProvider = new SearchTreeProvider();
    const collectionsProvider = new CollectionsTreeProvider(store);
    const scheduler = new DailyRotationScheduler(store, workbench, product);

    const changelog = Uri.file(join(context.extensionPath, "CHANGELOG.md"));
    const help = Uri.file(join(context.extensionPath, "HELP.md"));

    const registrations = [
        commands.registerCommand("background.install", () => install(workbench, product, true)),
        commands.registerCommand("background.uninstall", () => uninstall(workbench, product, true)),
        commands.registerCommand("background.reload", reload),
        commands.registerCommand("background.config", () => commands.executeCommand("workbench.view.extension.background")),
        commands.registerCommand("background.help", () => commands.executeCommand("markdown.showPreview", help)),
        commands.registerCommand("background.changelog", () => commands.executeCommand("markdown.showPreview", changelog)),

        commands.registerCommand("background.search.refresh", async () => searchProvider.refresh()),
        commands.registerCommand("background.search.prevPage", async () => searchProvider.prevPage()),
        commands.registerCommand("background.search.nextPage", async () => searchProvider.nextPage()),

        commands.registerCommand("background.search.setQuery", async () => {
            const input = await window.showInputBox({
                prompt: "Wallhaven search query",
                placeHolder: "e.g. nature, city night, minimal"
            } as InputBoxOptions);

            if(input !== undefined){
                await searchProvider.setQuery(input.trim());
            }
        }),
        commands.registerCommand("background.search.setSort", async () => {
            const selection = await window.showQuickPick(
                wallhavenSortOptions.map((sort) => ({ label: sort, sort })),
                { placeHolder: "Select Wallhaven sorting" }
            );

            if(selection){
                await searchProvider.setSort(selection.sort as WallhavenSort);
            }
        }),
        commands.registerCommand("background.search.apply", async (item?: WallhavenWallpaper | SearchResultItem) => {
            const wallpaper = item instanceof SearchResultItem ? item.wallpaper : item;
            if(!wallpaper){
                return;
            }

            await applyWallpaper(store, workbench, product, wallpaper.full, "wallhaven", wallpaper.id);
            window.showInformationMessage(`Applied wallpaper #${wallpaper.id}`);
            collectionsProvider.refresh();
        }),
        commands.registerCommand("background.search.addToCollection", async (item?: WallhavenWallpaper | SearchResultItem) => {
            const wallpaper = item instanceof SearchResultItem ? item.wallpaper : item;
            if(!wallpaper){
                return;
            }

            let collection = await pickCollection(store.getState().collections);
            if(!collection){
                const created = await window.showInputBox({ prompt: "No collections found. Enter a name to create one." });
                if(!created || !created.trim()){
                    return;
                }
                collection = await store.createCollection(created.trim());
            }

            await store.addWallpaper(collection.id, createCollectionWallpaper(wallpaper));
            collectionsProvider.refresh();
            window.showInformationMessage(`Added #${wallpaper.id} to '${collection.name}'.`);
        }),

        commands.registerCommand("background.collections.create", async () => {
            const name = await window.showInputBox({ prompt: "Collection name" });
            if(!name || !name.trim()){
                return;
            }

            await store.createCollection(name.trim());
            collectionsProvider.refresh();
        }),
        commands.registerCommand("background.collections.rename", async (item?: CollectionItem | string) => {
            const collectionId = item instanceof CollectionItem ? item.collection.id : item;
            if(!collectionId){
                return;
            }

            const current = store.getState().collections.find((collection) => collection.id === collectionId);
            if(!current){
                return;
            }

            const name = await window.showInputBox({ prompt: "New collection name", value: current.name });
            if(!name || !name.trim()){
                return;
            }

            await store.renameCollection(collectionId, name.trim());
            collectionsProvider.refresh();
        }),
        commands.registerCommand("background.collections.delete", async (item?: CollectionItem | string) => {
            const collectionId = item instanceof CollectionItem ? item.collection.id : item;
            if(!collectionId){
                return;
            }

            const collection = store.getState().collections.find((entry) => entry.id === collectionId);
            if(!collection){
                return;
            }

            const confirmation = await window.showWarningMessage(
                `Delete collection '${collection.name}'?`,
                { modal: true },
                "Delete"
            );

            if(confirmation !== "Delete"){
                return;
            }

            await store.deleteCollection(collectionId);
            collectionsProvider.refresh();
            scheduler.schedule();
        }),
        commands.registerCommand("background.collections.addWallpaper", async (arg?: CollectionItem | string) => {
            const collectionId = arg instanceof CollectionItem ? arg.collection.id : arg;
            if(!collectionId){
                return;
            }

            const url = await window.showInputBox({
                prompt: "Wallpaper URL",
                placeHolder: "https://...",
                validateInput: (value) => /^https:\/\//.test(value) ? undefined : "URL must start with https://"
            });

            if(!url){
                return;
            }

            await store.addWallpaper(collectionId, {
                id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                url,
                preview: url
            });
            collectionsProvider.refresh();
        }),
        commands.registerCommand("background.collections.removeWallpaper", async (item?: CollectionWallpaperItem) => {
            if(!item){
                return;
            }

            await store.removeWallpaper(item.collectionId, item.wallpaper.id);
            collectionsProvider.refresh();
        }),
        commands.registerCommand("background.collections.applyNow", async (arg1?: string | CollectionWallpaperItem, arg2?: string) => {
            let collectionId: string | undefined;
            let wallpaperId: string | undefined;

            if(arg1 instanceof CollectionWallpaperItem){
                collectionId = arg1.collectionId;
                wallpaperId = arg1.wallpaper.id;
            }else{
                collectionId = arg1;
                wallpaperId = arg2;
            }

            if(!collectionId || !wallpaperId){
                return;
            }

            const collection = store.getState().collections.find((entry) => entry.id === collectionId);
            const wallpaper = collection?.wallpapers.find((entry) => entry.id === wallpaperId);
            if(!collection || !wallpaper){
                return;
            }

            await applyWallpaper(store, workbench, product, wallpaper.url, "collection", wallpaper.sourceId);
            window.showInformationMessage(`Applied wallpaper from '${collection.name}'.`);
            collectionsProvider.refresh();
        }),
        commands.registerCommand("background.collections.enableDailyRotation", async (arg?: CollectionItem | string) => {
            let collectionId = arg instanceof CollectionItem ? arg.collection.id : arg;

            if(!collectionId){
                const selected = await pickCollection(store.getState().collections);
                collectionId = selected?.id;
            }

            if(!collectionId){
                return;
            }

            await store.setEnabledCollection(collectionId);
            await store.setPendingRotationCollection(null);
            collectionsProvider.refresh();
            scheduler.schedule();

            const collection = store.getState().collections.find((entry) => entry.id === collectionId);
            if(collection){
                window.showInformationMessage(`Daily rotation enabled for '${collection.name}'.`);
            }
        }),
        commands.registerCommand("background.rotation.deferUntilStartup", async () => {
            const enabledCollectionId = store.getState().enabledCollectionId;
            if(!enabledCollectionId){
                return;
            }

            await store.setPendingRotationCollection(enabledCollectionId);
            window.showInformationMessage("Wallpaper rotation deferred until next startup.");
        }),

        window.registerTreeDataProvider("background.searchView", searchProvider),
        window.registerTreeDataProvider("background.collectionsView", collectionsProvider),
        statusbar
    ];

    for(const registration of registrations){
        context.subscriptions.push(registration);
    }

    context.subscriptions.push(scheduler);

    statusbar.show();

    await scheduler.initialize();
    await searchProvider.refresh();

    for(let i = installDelay; i > forcedDelay; i -= 1000){
        setTimeout(() => installDelay -= 1000, i);
    }

    return api;
};

export const deactivate = (): void => {
    // no-op
};
