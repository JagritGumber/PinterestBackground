import { window } from "vscode";

const channel = window.createOutputChannel("Background");

const now = (): string => new Date().toISOString();

export const logInfo = (scope: string, message: string): void => {
    channel.appendLine(`[${now()}] [${scope}] ${message}`);
};

export const logError = (scope: string, message: string, error?: unknown): void => {
    const detail = error instanceof Error
        ? `${error.name}: ${error.message}`
        : error ? String(error) : "";
    channel.appendLine(`[${now()}] [${scope}] ERROR ${message}${detail ? ` | ${detail}` : ""}`);
};

export const showLogs = (): void => {
    channel.show(true);
};

