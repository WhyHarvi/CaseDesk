import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const SOUND_ASSET_MODULE = "virtual:casedesk-sound-assets";
const SOUND_ASSET_MODULE_RESOLVED = `\0${SOUND_ASSET_MODULE}`;
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac"]);

function soundAssetManifest() {
  const publicDirectory = fileURLToPath(new URL("./public", import.meta.url));
  const folders = [
    ["ringtones", "RINGTONE_ASSETS"],
    ["notification-sounds", "NOTIFICATION_SOUND_ASSETS"],
  ];

  const readAssets = (folder) => {
    const directory = join(publicDirectory, folder);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({
        id: `${folder}:${entry.name}`,
        fileName: entry.name,
        src: `/${folder}/${encodeURIComponent(entry.name)}`,
      }));
  };

  return {
    name: "casedesk-sound-assets",
    resolveId(id) {
      return id === SOUND_ASSET_MODULE ? SOUND_ASSET_MODULE_RESOLVED : null;
    },
    load(id) {
      if (id !== SOUND_ASSET_MODULE_RESOLVED) return null;
      return folders
        .map(([folder, exportName]) => `export const ${exportName} = ${JSON.stringify(readAssets(folder))};`)
        .join("\n");
    },
    configureServer(server) {
      const directories = folders.map(([folder]) => join(publicDirectory, folder));
      server.watcher.add(directories);
      const refresh = (file) => {
        if (!directories.some((directory) => file.startsWith(directory))) return;
        const module = server.moduleGraph.getModuleById(SOUND_ASSET_MODULE_RESOLVED);
        if (module) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", refresh);
      server.watcher.on("unlink", refresh);
    },
  };
}

export default defineConfig({
  plugins: [react(), soundAssetManifest()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
