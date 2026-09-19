"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const fs = require("node:fs/promises");
const path = require("node:path");
const DEFAULT_SETTINGS = {
    steamNotesPath: '',
    destinationFolder: 'Steam/Notes',
    imageDestinationFolder: 'Steam/Notes/Images',
    importAllSteamImages: true,
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
    }
    openSyncActions() {
        new SyncActionsModal(this.app, this).open();
    }
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.metadataCache = (await this.loadData())?.metadataCache ?? {};
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
        const folder = (0, obsidian_1.normalizePath)(`${this.settings.destinationFolder ? `${this.settings.destinationFolder}/` : ''}${sanitizePathPart(gameName)}`);
        await this.ensureVaultFolder(folder);
        const parsed = parseSteamNotes(raw);
        const imageRoot = path.join(path.dirname(steamFile.filePath), `notes_${steamFile.appId}_images`);
        const imageDestination = this.settings.imageDestinationFolder.trim()
            ? (0, obsidian_1.normalizePath)(this.settings.imageDestinationFolder.trim())
            : folder;
        await this.ensureVaultFolder(imageDestination);
        const imageMap = await this.importSteamImages(imageRoot, imageDestination, parsed);
        let count = 0;
        for (const note of parsed) {
            const fileName = sanitizePathPart(note.title || `Steam Note ${note.index}`);
            const target = (0, obsidian_1.normalizePath)(`${folder}/${String(note.index).padStart(2, '0')} - ${fileName}.md`);
            const markdown = buildMarkdown(gameName, steamFile.appId, steamFile.filePath, note, imageMap);
            await this.writeVaultFile(target, markdown);
            count++;
        }
        if (this.settings.importRawFiles) {
            const rawName = `.steam-source-${steamFile.appId}.txt`;
            await this.writeVaultFile((0, obsidian_1.normalizePath)(`${folder}/${rawName}`), raw);
        }
        return count;
    }
    async importSteamImages(imageRoot, imageDestination, notes) {
        const result = new Map();
        let entries;
        try {
            entries = await fs.readdir(imageRoot, { withFileTypes: true });
        }
        catch (_) {
            return result;
        }
        const referenced = new Set(notes.flatMap(note => extractSteamImageRefs(note.body).map(ref => ref.filename)));
        for (const entry of entries) {
            if (!entry.isFile())
                continue;
            if (!this.settings.importAllSteamImages && !referenced.has(entry.name))
                continue;
            const source = path.join(imageRoot, entry.name);
            const target = (0, obsidian_1.normalizePath)(`${imageDestination}/${sanitizePathPart(entry.name)}`);
            try {
                const bytes = await fs.readFile(source);
                await this.writeVaultBinary(target, bytes);
                result.set(entry.name, target);
            }
            catch (error) {
                console.warn('SteamyNotes: unable to import image', source, error);
            }
        }
        return result;
    }

    async getGameName(appId) {
        if (this.metadataCache[appId]?.name)
            return this.metadataCache[appId].name;
        try {
            const response = await (0, obsidian_1.requestUrl)({ url: `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}` });
            const json = response.json;
            const name = json[appId]?.data?.name;
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
function buildMarkdown(gameName, appId, sourcePath, note, imageMap) {
    const body = steamBodyToMarkdown(note.body, imageMap);
    const created = note.timeCreated ? new Date(note.timeCreated * 1000).toISOString() : '';
    const modified = note.timeModified ? new Date(note.timeModified * 1000).toISOString() : '';
    return `---\nsteam_appid: ${appId}\nsteam_game: ${yamlQuote(gameName)}\nsteam_source: ${yamlQuote(sourcePath)}\nsteam_note_id: ${yamlQuote(note.id)}\nsteam_note_index: ${note.index}\n${created ? `steam_created: ${created}\n` : ''}${modified ? `steam_modified: ${modified}\n` : ''}---\n\n# ${note.title || `Steam Note ${note.index}`}\n\n${body.trim()}\n`;
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
        window.setTimeout(() => this.input?.focus(), 0);
    }
    async create() {
        const value = (0, obsidian_1.normalizePath)((this.input?.value ?? '').trim().replace(/^\/+|\/+$/g, ''));
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
            .setDesc('Steam stores pasted note images in notes_<gameid>_images. By default SteamyNotes copies them into Steam/Notes/Images and embeds them in imported notes.');
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
            const configured = this.plugin.app.vault.getConfig?.('attachmentFolderPath');
            if (typeof configured === 'string' && configured) {
                this.plugin.settings.imageDestinationFolder = configured;
                await this.plugin.saveSettings();
                this.display();
            }
            else {
                new obsidian_1.Notice('SteamyNotes: Obsidian did not expose a configured attachment folder.');
            }
        }));
        new obsidian_1.Setting(containerEl)
            .setName('Import all Steam note images')
            .setDesc("Copy every image in each game's notes_<gameid>_images folder, including images no longer referenced by a note. Disable to copy only images referenced by imported notes.")
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.importAllSteamImages)
            .onChange(async (value) => { this.plugin.settings.importAllSteamImages = value; await this.plugin.saveSettings(); }));
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
    try {
        const nodeRequire = window.require;
        const electron = nodeRequire?.('electron');
        const paths = electron?.dialog?.showOpenDialogSync?.({
            properties: ['openDirectory'],
            title: 'Select Steam Game Notes folder',
        });
        return paths?.[0] ?? null;
    }
    catch (error) {
        console.warn('SteamyNotes: native folder picker unavailable', error);
        new obsidian_1.Notice('SteamyNotes: the native folder picker is unavailable in this Obsidian build. Paste the folder path instead.');
        return null;
    }
}
async function detectSteamNotesPath() {
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
        candidates.push(path.join(process.env.HOME ?? '', 'Library/Application Support/Steam'));
    }
    else {
        candidates.push(path.join(process.env.HOME ?? '', '.local/share/Steam'));
        candidates.push(path.join(process.env.HOME ?? '', '.steam/steam'));
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
