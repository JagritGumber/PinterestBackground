import { ConfigurationTarget, workspace } from "vscode";

import { install } from "../extension/writer";
import { StateStore } from "../state/store";

export const applyWallpaper = async (store: StateStore, workbench: string, product: string, url: string, source: "wallhaven" | "collection", wallhavenId?: string): Promise<void> => {
    const configuration = workspace.getConfiguration("background");

    await configuration.update("windowBackgrounds", [url], ConfigurationTarget.Global);
    await configuration.update("editorBackgrounds", [], ConfigurationTarget.Global);
    await configuration.update("sidebarBackgrounds", [], ConfigurationTarget.Global);
    await configuration.update("panelBackgrounds", [], ConfigurationTarget.Global);

    await store.setActiveWallpaper({
        source,
        url,
        wallhavenId,
        appliedAt: new Date().toISOString()
    });

    install(workbench, product, false);
};
