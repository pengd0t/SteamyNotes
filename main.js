"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const DEFAULT_SETTINGS = {
    steamNotesPath: '',
    destinationFolder: 'Steam/Notes',
    importRawFiles: true,
    resolveGameNames: true,
};
class SteamyNotesPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.settings = DEFAULT_SETTINGS;
        this.metadataCache = {};
    }
    async onload() {
        await this.loadSettings();
        this.addCommand({
            id: 'import-steam-notes',
            name: 'Import Steam notes',
            callback: () => void this.importSteamNotes(),
        });
        this.addRibbonIcon('book-open', 'Import Steam notes', () => void this.importSteamNotes());
        this.addSettingTab(new SteamyNotesSettingTab(this.app, this));
    }
    async loadSettings() {
        var _a, _b;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.metadataCache = (_b = (_a = (await this.loadData())) === null || _a === void 0 ? void 0 : _a.metadataCache) !== null && _b !== void 0 ? _b : {};
    }
    async saveSettings() {
        await this.saveData({ ...this.settings, metadataCache: this.metadataCache });
    }
    async importSteamNotes() {
        const source = this.settings.steamNotesPath.trim();
        if (!source) {
            new obsidian_1.Notice('SteamyNotes: set the Steam Game Notes folder in Settings first.');
            return;
        }
        try {
            const files = await this.findSteamNoteFiles(source);
            if (!files.length) {
                new obsidian_1.Notice('SteamyNotes: no notes_<gameid> files were found in that folder.');
                return;
            }
            let imported = 0;
            let failed = 0;
            for (const steamFile of files) {
                try {
                    imported += await this.importSteamFile(steamFile);
                }
                catch (error) {
                    failed++;
                    console.error('SteamyNotes import failed', steamFile, error);
                }
            }
            await this.saveSettings();
            new obsidian_1.Notice(`SteamyNotes: imported ${imported} note${imported === 1 ? '' : 's'} from ${files.length} Steam file${files.length === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}.`);
        }
        catch (error) {
            console.error('SteamyNotes scan failed', error);
            new obsidian_1.Notice(`SteamyNotes: unable to scan Steam notes folder. ${String(error)}`);
        }
    }
    async findSteamNoteFiles(source) {
        const entries = await fs.readdir(source, { withFileTypes: true });
        const result = [];
        for (const entry of entries) {
            if (!entry.isFile())
                continue;
            const match = /^notes_(\d+)$/.exec(entry.name);
            if (match)
                result.push({ filePath: path.join(source, entry.name), appId: match[1] });
        }
        return result.sort((a, b) => Number(a.appId) - Number(b.appId));
    }
    async importSteamFile(steamFile) {
        const raw = await fs.readFile(steamFile.filePath, 'utf8');
        const gameName = this.settings.resolveGameNames
            ? await this.getGameName(steamFile.appId)
            : `Steam App ${steamFile.appId}`;
        const folder = (0, obsidian_1.normalizePath)(`${this.settings.destinationFolder}/${sanitizePathPart(gameName)}`);
        await this.ensureVaultFolder(folder);
        const parsed = parseSteamNotes(raw);
        let count = 0;
        for (const note of parsed) {
            const fileName = sanitizePathPart(note.title || `Steam Note ${note.index}`);
            const target = (0, obsidian_1.normalizePath)(`${folder}/${String(note.index).padStart(2, '0')} - ${fileName}.md`);
            const markdown = buildMarkdown(gameName, steamFile.appId, steamFile.filePath, note);
            await this.writeVaultFile(target, markdown);
            count++;
        }
        if (this.settings.importRawFiles) {
            const rawName = `.steam-source-${steamFile.appId}.txt`;
            await this.writeVaultFile((0, obsidian_1.normalizePath)(`${folder}/${rawName}`), raw);
        }
        return count;
    }
    async getGameName(appId) {
        var _a, _b, _c;
        if ((_a = this.metadataCache[appId]) === null || _a === void 0 ? void 0 : _a.name)
            return this.metadataCache[appId].name;
        try {
            const response = await (0, obsidian_1.requestUrl)({ url: `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}` });
            const json = response.json;
            const name = (_c = (_b = json[appId]) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.name;
            if (name) {
                this.metadataCache[appId] = { appId, name };
                return name;
            }
        }
        catch (error) {
            console.warn(`SteamyNotes: unable to resolve Steam AppID ${appId}`, error);
        }
        return `Steam App ${appId}`;
    }
    async ensureVaultFolder(folder) {
        const parts = folder.split('/').filter(Boolean);
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!this.app.vault.getAbstractFileByPath(current))
                await this.app.vault.createFolder(current);
        }
    }
    async writeVaultFile(filePath, content) {
        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing && 'path' in existing) {
            const file = existing;
            await this.app.vault.modify(file, content);
        }
        else {
            await this.app.vault.create(filePath, content);
        }
    }
}
exports.default = SteamyNotesPlugin;
function sanitizePathPart(value) {
    return value.replace(/[\\/:*?"<>|]/g, '-').replace(/[. ]+$/, '').trim() || 'Untitled';
}
function buildMarkdown(gameName, appId, sourcePath, note) {
    return `---\nsteam_appid: ${appId}\nsteam_game: ${yamlQuote(gameName)}\nsteam_source: ${yamlQuote(sourcePath)}\nsteam_note_index: ${note.index}\n---\n\n# ${note.title || `Steam Note ${note.index}`}\n\n${note.body.trim()}\n`;
}
function yamlQuote(value) {
    return JSON.stringify(value);
}
/**
 * Steam's note file format is intentionally handled defensively here. The exact
 * current format is not a documented public Steam API. We first try JSON, then
 * a small Valve-KeyValues parser, then fall back to preserving the raw text.
 */
function parseSteamNotes(raw) {
    const text = raw.replace(/^\uFEFF/, '').replace(/\0/g, '');
    try {
        const parsed = JSON.parse(text);
        const notes = extractNotes(parsed);
        if (notes.length)
            return notes;
    }
    catch (_) {
        // Not JSON.
    }
    try {
        const kv = parseValveKeyValues(text);
        const notes = extractNotes(kv);
        if (notes.length)
            return notes;
    }
    catch (_) {
        // Not Valve KeyValues, or an unsupported variant.
    }
    return [{ title: 'Imported Steam Note', body: text, index: 1 }];
}
function extractNotes(value) {
    const found = [];
    const seen = new Set();
    let index = 0;
    const visit = (node) => {
        if (!node || typeof node !== 'object')
            return;
        if (Array.isArray(node)) {
            for (const item of node)
                visit(item);
            return;
        }
        const obj = node;
        const keys = Object.keys(obj);
        const lower = new Map(keys.map(k => [k.toLowerCase(), k]));
        const bodyKey = ['content', 'text', 'body', 'note', 'markdown', 'html'].map(k => lower.get(k)).find(Boolean);
        if (bodyKey && typeof obj[bodyKey] === 'string') {
            const titleKey = ['title', 'name', 'subject'].map(k => lower.get(k)).find(Boolean);
            const body = String(obj[bodyKey]);
            const title = titleKey && typeof obj[titleKey] === 'string' ? String(obj[titleKey]) : `Steam Note ${index + 1}`;
            const signature = `${title}\n${body}`;
            if (!seen.has(signature)) {
                seen.add(signature);
                found.push({ title, body: htmlToMarkdown(body), index: ++index });
            }
        }
        for (const key of keys)
            visit(obj[key]);
    };
    visit(value);
    return found;
}
function htmlToMarkdown(value) {
    return value
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p>/gi, '\n\n')
        .replace(/<\/?p>/gi, '')
        .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
        .replace(/<em>(.*?)<\/em>/gi, '*$1*')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}
function parseValveKeyValues(text) {
    let i = 0;
    const len = text.length;
    const skip = () => {
        while (i < len) {
            if (/\s/.test(text[i])) {
                i++;
                continue;
            }
            if (text[i] === '/' && text[i + 1] === '/') {
                while (i < len && text[i] !== '\n')
                    i++;
                continue;
            }
            break;
        }
    };
    const readString = () => {
        skip();
        if (text[i] !== '"')
            throw new Error('Expected quoted Valve KeyValue string');
        i++;
        let out = '';
        while (i < len) {
            const ch = text[i++];
            if (ch === '\\') {
                if (i < len)
                    out += text[i++];
            }
            else if (ch === '"')
                break;
            else
                out += ch;
        }
        return out;
    };
    const readObject = () => {
        const obj = {};
        skip();
        if (text[i] === '{')
            i++;
        while (i < len) {
            skip();
            if (text[i] === '}') {
                i++;
                break;
            }
            if (i >= len)
                break;
            const key = readString();
            skip();
            if (text[i] === '{')
                obj[key] = readObject();
            else
                obj[key] = readString();
        }
        return obj;
    };
    return readObject();
}
class SteamyNotesSettingTab extends obsidian_1.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'SteamyNotes' });
        new obsidian_1.Setting(containerEl)
            .setName('Steam Game Notes folder')
            .setDesc('Point this at Steam\\userdata\\<SteamUserID>\\2371090\\remote. The prototype scans files named notes_<gameid>.')
            .addText(text => text
            .setPlaceholder('C:\\Program Files (x86)\\Steam\\userdata\\12345678\\2371090\\remote')
            .setValue(this.plugin.settings.steamNotesPath)
            .onChange(async (value) => { this.plugin.settings.steamNotesPath = value.trim(); await this.plugin.saveSettings(); }))
            .addButton(button => button
            .setButtonText('Browse')
            .onClick(async () => {
            const picked = await browseForFolder();
            if (picked) {
                this.plugin.settings.steamNotesPath = picked;
                await this.plugin.saveSettings();
                this.display();
            }
        }))
            .addButton(button => button
            .setButtonText('Auto-detect')
            .onClick(async () => {
            const detected = await detectSteamNotesPath();
            if (detected) {
                this.plugin.settings.steamNotesPath = detected;
                await this.plugin.saveSettings();
                this.display();
                new obsidian_1.Notice(`SteamyNotes: found ${detected}`);
            }
            else {
                new obsidian_1.Notice('SteamyNotes: could not auto-detect a Steam Game Notes folder.');
            }
        }));
        new obsidian_1.Setting(containerEl)
            .setName('Obsidian destination folder')
            .setDesc('Imported notes will be grouped under this folder, then one folder per Steam game.')
            .addText(text => text
            .setPlaceholder('Steam/Notes')
            .setValue(this.plugin.settings.destinationFolder)
            .onChange(async (value) => { this.plugin.settings.destinationFolder = value.trim().replace(/^\/+|\/+$/g, ''); await this.plugin.saveSettings(); }));
        new obsidian_1.Setting(containerEl)
            .setName('Resolve game names')
            .setDesc('Use Steam AppID metadata to name Obsidian folders. The AppID remains in frontmatter, so folder renaming does not change the Steam identity.')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.resolveGameNames)
            .onChange(async (value) => { this.plugin.settings.resolveGameNames = value; await this.plugin.saveSettings(); }));
        new obsidian_1.Setting(containerEl)
            .setName('Keep raw Steam source files')
            .setDesc('Useful while we reverse-engineer the Steam notes format. Raw copies are prefixed with .steam-source-.')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.importRawFiles)
            .onChange(async (value) => { this.plugin.settings.importRawFiles = value; await this.plugin.saveSettings(); }));
        containerEl.createEl('p', { text: 'Prototype: Steam files are read-only. Bidirectional write-back is intentionally not enabled yet.', cls: 'steamynotes-setting-note' });
    }
}
async function browseForFolder() {
    var _a, _b, _c;
    try {
        const nodeRequire = window.require;
        const electron = nodeRequire === null || nodeRequire === void 0 ? void 0 : nodeRequire('electron');
        const paths = (_b = (_a = electron === null || electron === void 0 ? void 0 : electron.dialog) === null || _a === void 0 ? void 0 : _a.showOpenDialogSync) === null || _b === void 0 ? void 0 : _b.call(_a, {
            properties: ['openDirectory'],
            title: 'Select Steam Game Notes folder',
        });
        return (_c = paths === null || paths === void 0 ? void 0 : paths[0]) !== null && _c !== void 0 ? _c : null;
    }
    catch (error) {
        console.warn('SteamyNotes: native folder picker unavailable', error);
        new obsidian_1.Notice('SteamyNotes: the native folder picker is unavailable in this Obsidian build. Paste the folder path instead.');
        return null;
    }
}
async function detectSteamNotesPath() {
    var _a, _b, _c;
    const candidates = [];
    if (process.platform === 'win32') {
        const pf86 = process.env['ProgramFiles(x86)'];
        const pf = process.env.ProgramFiles;
        if (pf86)
            candidates.push(path.join(pf86, 'Steam'));
        if (pf)
            candidates.push(path.join(pf, 'Steam'));
    }
    else if (process.platform === 'darwin') {
        candidates.push(path.join((_a = process.env.HOME) !== null && _a !== void 0 ? _a : '', 'Library/Application Support/Steam'));
    }
    else {
        candidates.push(path.join((_b = process.env.HOME) !== null && _b !== void 0 ? _b : '', '.local/share/Steam'));
        candidates.push(path.join((_c = process.env.HOME) !== null && _c !== void 0 ? _c : '', '.steam/steam'));
    }
    for (const root of candidates) {
        try {
            const userdata = path.join(root, 'userdata');
            const users = await fs.readdir(userdata, { withFileTypes: true });
            for (const user of users) {
                if (!user.isDirectory() || !/^\d+$/.test(user.name))
                    continue;
                const notes = path.join(userdata, user.name, '2371090', 'remote');
                const files = await fs.readdir(notes);
                if (files.some(file => /^notes_\d+$/.test(file)))
                    return notes;
            }
        }
        catch (_) {
            // Continue checking the other standard locations.
        }
    }
    return null;
}
