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
const node_crypto_1 = require("node:crypto");
const DEFAULT_SETTINGS = {
    steamNotesPath: '',
    destinationFolder: 'Steam/Notes',
    imageDestinationFolder: 'Steam/Notes/Images',
    importAllSteamImages: true,
    importRawFiles: true,
    resolveGameNames: true,
    globalTags: '',
    autoSyncOnStartup: false,
    autoSyncIntervalMinutes: 0,
};
class SteamyNotesPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.settings = DEFAULT_SETTINGS;
        this.metadataCache = {};
        this.imageCache = {};
        this.syncState = {};
        this.syncInProgress = false;
    }
    async onload() {
        await this.loadSettings();
        this.addCommand({
            id: 'open-sync-actions',
            name: 'Open Steam notes actions',
            callback: () => this.openSyncActions(),
        });
        this.addCommand({
            id: 'pull-steam-notes',
            name: 'Pull Steam notes into Obsidian',
            callback: () => void this.importSteamNotes(),
        });
        // The ribbon deliberately opens an action chooser rather than immediately
        // writing anything. Push is disabled until two-way sync is implemented.
        this.addRibbonIcon('book-open', 'SteamyNotes: Steam notes actions', () => this.openSyncActions());
        this.addSettingTab(new SteamyNotesSettingTab(this.app, this));
        this.app.workspace.onLayoutReady(() => {
            if (this.settings.autoSyncOnStartup)
                void this.importSteamNotes(true);
            if (this.settings.autoSyncIntervalMinutes > 0) {
                this.registerInterval(window.setInterval(() => void this.importSteamNotes(true), this.settings.autoSyncIntervalMinutes * 60 * 1000));
            }
        });
    }
    openSyncActions() {
        new SyncActionsModal(this.app, this).open();
    }
    async loadSettings() {
        var _a, _b, _c;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        const data = await this.loadData();
        this.metadataCache = (_a = data === null || data === void 0 ? void 0 : data.metadataCache) !== null && _a !== void 0 ? _a : {};
        this.imageCache = (_b = data === null || data === void 0 ? void 0 : data.imageCache) !== null && _b !== void 0 ? _b : {};
        this.syncState = (_c = data === null || data === void 0 ? void 0 : data.syncState) !== null && _c !== void 0 ? _c : {};
    }
    async saveSettings() {
        await this.saveData({ ...this.settings, metadataCache: this.metadataCache, imageCache: this.imageCache, syncState: this.syncState });
    }
    async importSteamNotes(silent = false) {
        if (this.syncInProgress)
            return;
        const source = this.settings.steamNotesPath.trim();
        if (!source) {
            if (!silent)
                new obsidian_1.Notice('SteamyNotes: set the Steam Game Notes folder in Settings first.');
            return;
        }
        this.syncInProgress = true;
        try {
            const files = await this.findSteamNoteFiles(source);
            if (!files.length) {
                if (!silent)
                    new obsidian_1.Notice('SteamyNotes: no notes_<gameid> files were found in that folder.');
                return;
            }
            let checked = 0;
            let changed = 0;
            let unchanged = 0;
            let recreated = 0;
            const skippedShrink = [];
            const errors = [];
            for (const steamFile of files) {
                try {
                    const result = await this.importSteamFile(steamFile);
                    checked += result.checked;
                    changed += result.changed;
                    unchanged += result.unchanged;
                    recreated += result.recreated;
                    if (result.shrinkWarning)
                        skippedShrink.push(`${steamFile.appId}: Steam note count dropped; existing vault notes were left untouched.`);
                }
                catch (error) {
                    errors.push(`${steamFile.appId}: ${error instanceof Error ? error.message : String(error)}`);
                    console.error('SteamyNotes import failed', steamFile, error);
                }
            }
            await this.saveSettings();
            const parts = [`${checked} note${checked === 1 ? '' : 's'} checked`, `${changed} changed`, `${unchanged} unchanged`];
            if (recreated)
                parts.push(`${recreated} recreated`);
            if (skippedShrink.length)
                parts.push(`${skippedShrink.length} shrink warning${skippedShrink.length === 1 ? '' : 's'}`);
            if (errors.length)
                parts.push(`${errors.length} failed`);
            const message = `SteamyNotes: ${parts.join(', ')} from ${files.length} Steam file${files.length === 1 ? '' : 's'}.`;
            if (!silent || errors.length || skippedShrink.length)
                new obsidian_1.Notice(message);
            if (errors.length)
                console.error('SteamyNotes sync errors:', errors);
            if (skippedShrink.length)
                console.warn('SteamyNotes shrink protection:', skippedShrink);
        }
        catch (error) {
            console.error('SteamyNotes scan failed', error);
            new obsidian_1.Notice(`SteamyNotes: unable to scan Steam notes folder. ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            this.syncInProgress = false;
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
        var _a;
        const raw = await fs.readFile(steamFile.filePath, 'utf8');
        const sourceHash = (0, node_crypto_1.createHash)('sha1').update(raw, 'utf8').digest('hex');
        const gameName = this.settings.resolveGameNames
            ? await this.getGameName(steamFile.appId)
            : `Steam App ${steamFile.appId}`;
        const folder = (0, obsidian_1.normalizePath)(`${this.settings.destinationFolder ? `${this.settings.destinationFolder}/` : ''}${sanitizePathPart(gameName)}`);
        await this.ensureVaultFolder(folder);
        const previous = this.syncState[steamFile.appId];
        const mappedPaths = (previous === null || previous === void 0 ? void 0 : previous.notePaths) ? Object.values(previous.notePaths) : [];
        if ((previous === null || previous === void 0 ? void 0 : previous.sourceHash) === sourceHash && mappedPaths.length === previous.noteCount && mappedPaths.every(p => !!this.app.vault.getAbstractFileByPath(p))) {
            return { checked: previous.noteCount, changed: 0, unchanged: previous.noteCount, recreated: 0, shrinkWarning: false };
        }
        const parsed = parseSteamNotes(raw);
        if (previous && parsed.length < previous.noteCount && previous.noteCount > 0) {
            console.warn(`SteamyNotes: refusing to overwrite ${steamFile.appId}; note count dropped from ${previous.noteCount} to ${parsed.length}.`);
            return { checked: parsed.length, changed: 0, unchanged: parsed.length, recreated: 0, shrinkWarning: true };
        }
        const imageRoot = path.join(path.dirname(steamFile.filePath), `notes_${steamFile.appId}_images`);
        const imageDestination = this.settings.imageDestinationFolder.trim()
            ? (0, obsidian_1.normalizePath)(this.settings.imageDestinationFolder.trim())
            : folder;
        await this.ensureVaultFolder(imageDestination);
        const imageMap = await this.importSteamImages(imageRoot, imageDestination, parsed, gameName);
        const existingById = this.findExistingSteamNotes(steamFile.appId);
        const noteIds = parsed.map(note => note.id);
        const notePaths = { ...((_a = previous === null || previous === void 0 ? void 0 : previous.notePaths) !== null && _a !== void 0 ? _a : {}) };
        let changed = 0;
        let unchanged = 0;
        let recreated = 0;
        for (const note of parsed) {
            const defaultFileName = `${String(note.index).padStart(2, '0')} - ${sanitizePathPart(note.title || `Steam Note ${note.index}`)}.md`;
            const target = (0, obsidian_1.normalizePath)(notePaths[note.id] || `${folder}/${defaultFileName}`);
            const markdown = buildMarkdown(gameName, steamFile.appId, steamFile.filePath, note, imageMap, this.settings.globalTags);
            const existingPath = existingById[note.id] || target;
            const existing = this.app.vault.getAbstractFileByPath(existingPath);
            if (existing && 'path' in existing) {
                const file = existing;
                const current = await this.app.vault.read(file);
                if (current === markdown) {
                    unchanged++;
                }
                else {
                    await this.createHistorySnapshot(folder, file, current);
                    await this.app.vault.modify(file, markdown);
                    changed++;
                }
                notePaths[note.id] = file.path;
            }
            else {
                await this.writeVaultFile(target, markdown);
                notePaths[note.id] = target;
                recreated++;
            }
        }
        if (this.settings.importRawFiles) {
            await this.writeVaultFile((0, obsidian_1.normalizePath)(`${folder}/.steam-source-${steamFile.appId}.txt`), raw);
        }
        this.syncState[steamFile.appId] = { sourceHash, noteCount: parsed.length, noteIds, notePaths, syncedAt: new Date().toISOString() };
        // A hash is an optimization, not permission to assume the vault is intact.
        // The identity map above is checked on every pull so deleted notes can be recreated.
        return { checked: parsed.length, changed, unchanged, recreated, shrinkWarning: false };
    }
    findExistingSteamNotes(appId) {
        var _a;
        const result = {};
        for (const file of this.app.vault.getMarkdownFiles()) {
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache === null || cache === void 0 ? void 0 : cache.frontmatter;
            if (String((_a = fm === null || fm === void 0 ? void 0 : fm.steam_appid) !== null && _a !== void 0 ? _a : '') !== appId)
                continue;
            const id = typeof (fm === null || fm === void 0 ? void 0 : fm.steam_note_id) === 'string' ? fm.steam_note_id : '';
            if (id)
                result[id] = file.path;
        }
        return result;
    }
    async createHistorySnapshot(gameFolder, file, content) {
        const historyFolder = (0, obsidian_1.normalizePath)(`${gameFolder}/History`);
        await this.ensureVaultFolder(historyFolder);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const base = sanitizePathPart(file.name.replace(/\.md$/i, ''));
        let target = (0, obsidian_1.normalizePath)(`${historyFolder}/${base} - ${stamp}.md`);
        let n = 2;
        while (this.app.vault.getAbstractFileByPath(target)) {
            target = (0, obsidian_1.normalizePath)(`${historyFolder}/${base} - ${stamp} - ${n++}.md`);
        }
        await this.app.vault.create(target, content);
    }
    async importSteamImages(imageRoot, imageDestination, notes, gameName) {
        const result = new Map();
        let entries;
        try {
            entries = await fs.readdir(imageRoot, { withFileTypes: true });
        }
        catch (_) {
            return result;
        }
        const imageInfo = new Map();
        let unreferencedNumber = 0;
        for (const note of notes) {
            let noteImageNumber = 0;
            for (const ref of extractSteamImageRefs(note.body)) {
                noteImageNumber++;
                if (!imageInfo.has(ref.filename)) {
                    imageInfo.set(ref.filename, { title: note.title || `Steam Note ${note.index}`, number: noteImageNumber });
                }
            }
        }
        const referenced = new Set(imageInfo.keys());
        const usedTargets = new Set();
        for (const entry of entries) {
            if (!entry.isFile())
                continue;
            if (!this.settings.importAllSteamImages && !referenced.has(entry.name))
                continue;
            const source = path.join(imageRoot, entry.name);
            try {
                const bytes = await fs.readFile(source);
                const cacheKey = `${steamAppIdForImageRoot(imageRoot)}:${entry.name}`;
                let target = this.imageCache[cacheKey];
                // If the user changed the configured image folder, move the imported
                // representation to the new folder rather than retaining the old path.
                if (target && !target.startsWith(`${imageDestination}/`) && target !== imageDestination) {
                    target = '';
                }
                if (!target) {
                    const info = imageInfo.get(entry.name);
                    let baseName;
                    if (info) {
                        baseName = `${sanitizePathPart(gameName)} - ${sanitizePathPart(info.title)} - Image ${String(info.number).padStart(2, '0')}`;
                    }
                    else {
                        unreferencedNumber++;
                        baseName = `${sanitizePathPart(gameName)} - Unreferenced Image ${String(unreferencedNumber).padStart(2, '0')}`;
                    }
                    target = await this.uniqueImageTarget(imageDestination, baseName, path.extname(entry.name), usedTargets);
                    this.imageCache[cacheKey] = target;
                }
                usedTargets.add(target);
                await this.writeVaultBinary(target, bytes);
                result.set(entry.name, target);
            }
            catch (error) {
                console.warn('SteamyNotes: unable to import image', source, error);
            }
        }
        return result;
    }
    async uniqueImageTarget(destination, baseName, extension, usedTargets) {
        let number = 1;
        while (true) {
            const suffix = number === 1 ? '' : ` ${number}`;
            const target = (0, obsidian_1.normalizePath)(destination ? `${destination}/${baseName}${suffix}${extension}` : `${baseName}${suffix}${extension}`);
            if (usedTargets.has(target)) {
                number++;
                continue;
            }
            const existing = this.app.vault.getAbstractFileByPath(target);
            if (!existing)
                return target;
            // If the existing file is one of our cached representations, it is safe
            // to reuse it; otherwise avoid overwriting an unrelated attachment.
            if (Object.values(this.imageCache).includes(target))
                return target;
            number++;
        }
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
    async writeVaultBinary(filePath, data) {
        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing && 'path' in existing) {
            await this.app.vault.adapter.writeBinary(filePath, data);
        }
        else {
            await this.app.vault.createBinary(filePath, data);
        }
    }
}
exports.default = SteamyNotesPlugin;
function sanitizePathPart(value) {
    return value.replace(/[\\/:*?"<>|]/g, '-').replace(/[. ]+$/, '').trim() || 'Untitled';
}
function steamAppIdForImageRoot(imageRoot) {
    var _a;
    const match = /notes_(\d+)_images$/.exec(imageRoot.replace(/\\/g, '/'));
    return (_a = match === null || match === void 0 ? void 0 : match[1]) !== null && _a !== void 0 ? _a : 'unknown';
}
function buildMarkdown(gameName, appId, sourcePath, note, imageMap, globalTags) {
    const body = steamBodyToMarkdown(note.body, imageMap);
    const created = note.timeCreated ? new Date(note.timeCreated * 1000).toISOString() : '';
    const modified = note.timeModified ? new Date(note.timeModified * 1000).toISOString() : '';
    const tags = parseGlobalTags(globalTags);
    const tagsFrontmatter = tags.length ? `tags:\n${tags.map(tag => `  - ${yamlQuote(tag)}`).join('\n')}\n` : '';
    return `---\n${tagsFrontmatter}steam_appid: ${appId}\nsteam_game: ${yamlQuote(gameName)}\nsteam_source: ${yamlQuote(sourcePath)}\nsteam_note_id: ${yamlQuote(note.id)}\nsteam_note_index: ${note.index}\n${created ? `steam_created: ${created}\n` : ''}${modified ? `steam_modified: ${modified}\n` : ''}---\n\n# ${note.title || `Steam Note ${note.index}`}\n\n${body.trim()}\n`;
}
function parseGlobalTags(value) {
    return value
        .split(/[\n,]+/)
        .map(tag => tag.trim().replace(/^#+/, ''))
        .filter(Boolean);
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
    if (!value || typeof value !== 'object')
        return found;
    const root = value;
    const rawNotes = Array.isArray(root.notes) ? root.notes : [];
    rawNotes.forEach((raw, index) => {
        if (!raw || typeof raw !== 'object')
            return;
        const obj = raw;
        const content = typeof obj.content === 'string' ? obj.content : '';
        const title = typeof obj.title === 'string' ? obj.title : `Steam Note ${index + 1}`;
        found.push({
            id: typeof obj.id === 'string' ? obj.id : `index-${index + 1}`,
            title,
            body: content,
            index: index + 1,
            ordinal: typeof obj.ordinal === 'number' ? obj.ordinal : undefined,
            timeCreated: typeof obj.time_created === 'number' ? obj.time_created : undefined,
            timeModified: typeof obj.time_modified === 'number' ? obj.time_modified : undefined,
        });
    });
    return found;
}
function extractSteamImageRefs(value) {
    const refs = [];
    const regex = /\[cloudimg\s+src="([^"]+)"\]\[\/cloudimg\]/gi;
    let match;
    while ((match = regex.exec(value)) !== null) {
        const src = match[1].replace(/\\/g, '/');
        refs.push({ src, filename: path.posix.basename(src) });
    }
    return refs;
}
function steamBodyToMarkdown(value, imageMap) {
    let body = value;
    body = body.replace(/\[cloudimg\s+src="([^"]+)"\]\[\/cloudimg\]/gi, (_m, src) => {
        const filename = path.posix.basename(src.replace(/\\/g, '/'));
        const vaultPath = imageMap.get(filename);
        return vaultPath ? `![[${vaultPath}]]` : `<!-- Steam image not imported: ${filename} -->`;
    });
    return htmlToMarkdown(body);
}
function htmlToMarkdown(value) {
    return value
        .replace(/\[p\]/gi, '')
        .replace(/\[\/p\]/gi, '\n\n')
        .replace(/\[br\]/gi, '\n')
        .replace(/\[b\](.*?)\[\/b\]/gis, '**$1**')
        .replace(/\[i\](.*?)\[\/i\]/gis, '*$1*')
        .replace(/<br\s*\/?>(?=\S)/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?p>/gi, '')
        .replace(/<strong>(.*?)<\/strong>/gis, '**$1**')
        .replace(/<em>(.*?)<\/em>/gis, '*$1*')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
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
class SyncActionsModal extends obsidian_1.Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'SteamyNotes actions' });
        contentEl.createEl('p', {
            text: 'Choose the direction explicitly. SteamyNotes currently never writes to Steam, so Push is disabled until two-way synchronization is implemented and tested.',
            cls: 'steamynotes-setting-note',
        });
        new obsidian_1.Setting(contentEl)
            .setName('Pull from Steam')
            .setDesc('Read Steam Game Notes and update the corresponding Obsidian Markdown files.')
            .addButton(button => button
            .setButtonText('Pull')
            .setCta()
            .onClick(() => {
            this.close();
            void this.plugin.importSteamNotes();
        }));
        new obsidian_1.Setting(contentEl)
            .setName('Push to Steam')
            .setDesc('Not available yet. No Steam files are modified by this prototype.')
            .addButton(button => button
            .setButtonText('Coming later')
            .setDisabled(true));
        new obsidian_1.Setting(contentEl)
            .addButton(button => button
            .setButtonText('Cancel')
            .onClick(() => this.close()));
    }
    onClose() {
        this.contentEl.empty();
    }
}
class FolderPickerModal extends obsidian_1.SuggestModal {
    constructor(app, folders, onChoose) {
        super(app);
        this.folders = folders;
        this.onChoose = onChoose;
        this.setPlaceholder('Search folders in this vault…');
    }
    getSuggestions(query) {
        const q = query.toLowerCase().trim();
        return this.folders.filter(folder => !q || folder.toLowerCase().includes(q));
    }
    renderSuggestion(folder, el) {
        el.createDiv({ text: folder || 'Vault root' });
    }
    onChooseSuggestion(folder) {
        this.onChoose(folder);
    }
}
class NewFolderModal extends obsidian_1.Modal {
    constructor(app, plugin, onCreated) {
        super(app);
        this.plugin = plugin;
        this.onCreated = onCreated;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Create Obsidian folder' });
        contentEl.createEl('p', { text: 'Enter a vault-relative folder path, for example Steam/Notes.' });
        this.input = contentEl.createEl('input', { type: 'text', placeholder: 'Steam/Notes' });
        this.input.style.width = '100%';
        this.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter')
                void this.create();
        });
        const buttons = contentEl.createDiv({ cls: 'steamynotes-modal-buttons' });
        new obsidian_1.ButtonComponent(buttons).setButtonText('Create').setCta().onClick(() => void this.create());
        new obsidian_1.ButtonComponent(buttons).setButtonText('Cancel').onClick(() => this.close());
        window.setTimeout(() => { var _a; return (_a = this.input) === null || _a === void 0 ? void 0 : _a.focus(); }, 0);
    }
    async create() {
        var _a, _b;
        const value = (0, obsidian_1.normalizePath)(((_b = (_a = this.input) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : '').trim().replace(/^\/+|\/+$/g, ''));
        if (!value) {
            new obsidian_1.Notice('SteamyNotes: enter a folder path.');
            return;
        }
        try {
            const parts = value.split('/').filter(Boolean);
            let current = '';
            for (const part of parts) {
                current = current ? `${current}/${part}` : part;
                if (!this.plugin.app.vault.getAbstractFileByPath(current)) {
                    await this.plugin.app.vault.createFolder(current);
                }
            }
            this.onCreated(value);
            this.close();
        }
        catch (error) {
            console.error('SteamyNotes: unable to create destination folder', error);
            new obsidian_1.Notice(`SteamyNotes: unable to create folder. ${String(error)}`);
        }
    }
    onClose() {
        this.contentEl.empty();
    }
}
function getVaultFolders(app) {
    const folders = new Set(['']);
    const walk = (folder) => {
        for (const child of folder.children) {
            if (child instanceof obsidian_1.TFolder) {
                folders.add(child.path);
                walk(child);
            }
        }
    };
    walk(app.vault.getRoot());
    return Array.from(folders).sort((a, b) => a.localeCompare(b));
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
            .setDesc('Select the Steam Game Notes remote folder. Standard Windows location: C:\\Program Files (x86)\\Steam\\userdata\\<SteamUserID>\\2371090\\remote. If Steam is installed elsewhere, locate the same userdata\\<SteamUserID>\\2371090\\remote structure there. The plugin scans files named notes_<gameid>.')
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
        const destinationSetting = new obsidian_1.Setting(containerEl)
            .setName('Obsidian destination folder')
            .setDesc('Choose a folder in this vault. Imported notes will be grouped under it, then one folder per Steam game.');
        destinationSetting.addButton(button => button
            .setButtonText(this.plugin.settings.destinationFolder || 'Vault root')
            .setTooltip('Choose an existing folder in the vault')
            .onClick(() => {
            const folders = getVaultFolders(this.plugin.app);
            new FolderPickerModal(this.plugin.app, folders, async (folder) => {
                this.plugin.settings.destinationFolder = folder;
                await this.plugin.saveSettings();
                this.display();
            }).open();
        }));
        destinationSetting.addButton(button => button
            .setButtonText('New folder…')
            .onClick(() => {
            new NewFolderModal(this.plugin.app, this.plugin, async (folder) => {
                this.plugin.settings.destinationFolder = folder;
                await this.plugin.saveSettings();
                this.display();
            }).open();
        }));
        destinationSetting.addButton(button => button
            .setButtonText('Vault root')
            .setDisabled(!this.plugin.settings.destinationFolder)
            .onClick(async () => {
            this.plugin.settings.destinationFolder = '';
            await this.plugin.saveSettings();
            this.display();
        }));
        const imageSetting = new obsidian_1.Setting(containerEl)
            .setName('Steam note image destination')
            .setDesc('Steam stores pasted note images in notes_<gameid>_images. SteamyNotes copies them here, using readable names such as Game - Note title - Image 01.png. The original Steam SHA-1 filename is retained internally for future synchronization.');
        imageSetting.addButton(button => button
            .setButtonText(this.plugin.settings.imageDestinationFolder || 'Vault root')
            .onClick(() => {
            const folders = getVaultFolders(this.plugin.app);
            new FolderPickerModal(this.plugin.app, folders, async (folder) => {
                this.plugin.settings.imageDestinationFolder = folder;
                await this.plugin.saveSettings();
                this.display();
            }).open();
        }));
        imageSetting.addButton(button => button
            .setButtonText('Obsidian attachment folder')
            .onClick(async () => {
            var _a, _b;
            const configured = (_b = (_a = this.plugin.app.vault).getConfig) === null || _b === void 0 ? void 0 : _b.call(_a, 'attachmentFolderPath');
            if (typeof configured === 'string' && configured) {
                this.plugin.settings.imageDestinationFolder = configured;
                await this.plugin.saveSettings();
                this.display();
            }
            else {
                new obsidian_1.Notice('SteamyNotes: Obsidian did not expose a configured attachment folder.');
            }
        }));
        imageSetting.addButton(button => button
            .setButtonText('New folder…')
            .onClick(() => {
            new NewFolderModal(this.plugin.app, this.plugin, async (folder) => {
                this.plugin.settings.imageDestinationFolder = folder;
                await this.plugin.saveSettings();
                this.display();
            }).open();
        }));
        new obsidian_1.Setting(containerEl)
            .setName('Import all Steam note images')
            .setDesc('Copy every image in each game\'s notes_<gameid>_images folder, including images no longer referenced by a note. Disable to copy only images referenced by imported notes.')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.importAllSteamImages)
            .onChange(async (value) => { this.plugin.settings.importAllSteamImages = value; await this.plugin.saveSettings(); }));
        new obsidian_1.Setting(containerEl)
            .setName('Custom global tags')
            .setDesc('Optional tags added to the existing frontmatter of every imported Steam note. Enter multiple tags separated by commas. A leading # is optional; for example: steamnotes, games, #steam')
            .addText(text => text
            .setPlaceholder('steamnotes')
            .setValue(this.plugin.settings.globalTags)
            .onChange(async (value) => { this.plugin.settings.globalTags = value; await this.plugin.saveSettings(); }));
        new obsidian_1.Setting(containerEl)
            .setName('Sync on Obsidian startup')
            .setDesc('Check Steam notes after Obsidian finishes loading. Steam remains read-only.')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.autoSyncOnStartup)
            .onChange(async (value) => { this.plugin.settings.autoSyncOnStartup = value; await this.plugin.saveSettings(); }));
        new obsidian_1.Setting(containerEl)
            .setName('Automatic sync interval (minutes)')
            .setDesc('0 disables interval syncing. Hashes are used to avoid unnecessary work, while missing Obsidian notes are still recreated.')
            .addText(text => text
            .setPlaceholder('0')
            .setValue(String(this.plugin.settings.autoSyncIntervalMinutes))
            .onChange(async (value) => {
            const minutes = Math.max(0, Math.floor(Number(value) || 0));
            this.plugin.settings.autoSyncIntervalMinutes = minutes;
            await this.plugin.saveSettings();
        }));
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
