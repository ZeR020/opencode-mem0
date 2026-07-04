/// <reference lib="dom" />
import { contextBridge, shell } from "electron";

/**
 * Minimal safe API exposed to the dashboard renderer.
 * All backend communication still flows through the same-origin REST API.
 */
const api = {
  /**
   * Open a URL in the user's default browser.
   * @param url - The external URL to open.
   */
  openExternal: (url: string) => shell.openExternal(url),

  /**
   * Current host platform string.
   */
  platform: process.platform,
};

contextBridge.exposeInMainWorld("electronAPI", api);

export type ElectronAPI = typeof api;

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
