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

/**
 * Bump FORMAT_VERSION whenever the generated Markdown for a note changes
 * (converter improvements, frontmatter changes). It is part of the settings
 * fingerprint, so a bump makes the next sync regenerate notes that were not
 * edited in Obsidian.
 */
const FORMAT_VERSION = 2;
const HISTORY_FOLDER = 'History';
const NAME_FAILURE_TTL_MS = 24 * 60 * 60 * 1000;
const ALERT_TIMEOUT_MS = 20000;
const STARTUP_SYNC_DELAY_MS = 3000;
const SNAPSHOT_NAME_RE = / - \d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?: - \d+)?\.md$/;

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
    recreateDeletedNotes: true,
    includeSourcePath: true,
};

class SteamyNotesPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.settings = { ...DEFAULT_SETTINGS };
        this.metadataCache = {};
        this.imageCache = {};
        this.nameFailures = {};
        this.syncState = {};
        this.syncInProgress = false;
        this.autoSyncTimer = null;
        this.autoSyncRestartTimer = null;
        this.startupTimer = null;
        this.lastSavedJson = '';
        this.lastAlertKey = '';
        this.lastScanError = '';
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
        this.addCommand({
            id: 'force-resync-steam-notes',
            name: 'Force full resync of Steam notes (ignore change detection)',
            callback: () => void this.importSteamNotes(false, { force: true }),
        });
        this.addCommand({
            id: 'review-held-games',
            name: 'Review games held by shrink protection',
            callback: () => this.openHeldReview(),
        });
        // The ribbon deliberately opens an action chooser rather than immediately
        // writing anything. Push is disabled until two-way sync is implemented.
        this.addRibbonIcon('book-open', 'SteamyNotes: Steam notes actions', () => this.openSyncActions());
        this.addSettingTab(new SteamyNotesSettingTab(this.app, this));
        this.app.workspace.onLayoutReady(() => {
            this.restartAutoSync();
            if (this.settings.autoSyncOnStartup) {
                // Give the metadata cache a moment to finish indexing so notes that
                // were moved in the vault can still be found by their Steam note ID.
                this.startupTimer = window.setTimeout(() => {
                    this.startupTimer = null;
                    void this.importSteamNotes(true);
                }, STARTUP_SYNC_DELAY_MS);
            }
        });
    }
    onunload() {
        if (this.startupTimer !== null)
            window.clearTimeout(this.startupTimer);
        if (this.autoSyncRestartTimer !== null)
            window.clearTimeout(this.autoSyncRestartTimer);
        if (this.autoSyncTimer !== null)
            window.clearInterval(this.autoSyncTimer);
    }
    openSyncActions() {
        new SyncActionsModal(this.app, this).open();
    }
    openHeldReview() {
        new HeldReviewModal(this.app, this).open();
    }
    /** (Re)arm the interval timer from the current setting. Safe to call repeatedly. */
    restartAutoSync() {
        if (this.autoSyncTimer !== null) {
            window.clearInterval(this.autoSyncTimer);
            this.autoSyncTimer = null;
        }
        const minutes = this.settings.autoSyncIntervalMinutes;
        if (minutes > 0) {
            this.autoSyncTimer = window.setInterval(() => void this.importSteamNotes(true), minutes * 60 * 1000);
            this.registerInterval(this.autoSyncTimer);
        }
    }
    /** Debounced restart, used while the user is typing in the interval setting. */
    scheduleAutoSyncRestart() {
        if (this.autoSyncRestartTimer !== null)
            window.clearTimeout(this.autoSyncRestartTimer);
        this.autoSyncRestartTimer = window.setTimeout(() => {
            this.autoSyncRestartTimer = null;
            this.restartAutoSync();
        }, 800);
    }
    async loadSettings() {
        const data = (await this.loadData()) ?? {};
        const { metadataCache, imageCache, nameFailures, syncState, ...settings } = data;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
        this.metadataCache = metadataCache ?? {};
        this.imageCache = imageCache ?? {};
        this.nameFailures = nameFailures ?? {};
        this.syncState = migrateSyncState(syncState ?? {});
        this.lastSavedJson = JSON.stringify(this.buildPayload());
    }
    buildPayload() {
        return {
            ...this.settings,
            metadataCache: this.metadataCache,
            imageCache: this.imageCache,
            nameFailures: this.nameFailures,
            syncState: this.syncState,
        };
    }
    /** Writes data.json only when something actually changed. */
    async saveSettings() {
        const payload = this.buildPayload();
        const json = JSON.stringify(payload);
        if (json === this.lastSavedJson)
            return;
        await this.saveData(payload);
        this.lastSavedJson = json;
    }
    settingsFingerprint() {
        const s = this.settings;
        return sha1(JSON.stringify([
            FORMAT_VERSION,
            s.destinationFolder,
            s.imageDestinationFolder,
            s.importAllSteamImages,
            s.importRawFiles,
            s.includeSourcePath,
            parseGlobalTags(s.globalTags),
        ]));
    }
    getHeldGames() {
        return Object.entries(this.syncState)
            .filter(([, state]) => state && state.pending)
            .map(([appId, state]) => ({
            appId,
            gameName: state.pending.gameName || state.gameName || `Steam App ${appId}`,
            kind: state.pending.kind,
            message: state.pending.message,
            detectedAt: state.pending.detectedAt,
        }));
    }
    async importSteamNotes(silent = false, options = {}) {
        if (this.syncInProgress) {
            if (!silent)
                new obsidian_1.Notice('SteamyNotes: a sync is already running.');
            return;
        }
        const source = this.settings.steamNotesPath.trim();
        if (!source) {
            if (!silent)
                new obsidian_1.Notice('SteamyNotes: set the Steam Game Notes folder in Settings first.');
            return;
        }
        this.syncInProgress = true;
        try {
            let files;
            try {
                files = await this.findSteamNoteFiles(source);
                this.lastScanError = '';
            }
            catch (error) {
                console.error('SteamyNotes scan failed', error);
                const message = `SteamyNotes: unable to scan Steam notes folder. ${errorMessage(error)}`;
                // Automatic syncs report a given scan problem once, not on every tick.
                if (!silent || message !== this.lastScanError)
                    new obsidian_1.Notice(message);
                this.lastScanError = message;
                return;
            }
            if (!files.length) {
                if (!silent)
                    new obsidian_1.Notice('SteamyNotes: no notes_<gameid> files were found in that folder.');
                return;
            }
            const ctx = {
                silent,
                manual: !silent,
                force: !!options.force,
                accept: false,
                noteIndex: this.buildNoteIndex(),
                fingerprint: this.settingsFingerprint(),
            };
            const totals = emptyResult();
            for (const steamFile of files) {
                try {
                    addResult(totals, await this.importSteamFile(steamFile, ctx));
                }
                catch (error) {
                    totals.errors.push(`${steamFile.appId}: ${errorMessage(error)}`);
                    console.error('SteamyNotes import failed', steamFile, error);
                }
            }
            await this.saveSettings();
            this.reportResults(totals, files.length, silent);
        }
        finally {
            this.syncInProgress = false;
        }
    }
    /** Applies Steam's current version for a game that was held for review. */
    async acceptHeldGame(appId) {
        if (this.syncInProgress) {
            new obsidian_1.Notice('SteamyNotes: a sync is already running. Try again in a moment.');
            return false;
        }
        const source = this.settings.steamNotesPath.trim();
        if (!source) {
            new obsidian_1.Notice('SteamyNotes: set the Steam Game Notes folder in Settings first.');
            return false;
        }
        this.syncInProgress = true;
        try {
            const steamFile = { filePath: path.join(source, `notes_${appId}`), appId };
            const ctx = {
                silent: false,
                manual: true,
                force: true,
                accept: true,
                noteIndex: this.buildNoteIndex(),
                fingerprint: this.settingsFingerprint(),
            };
            const totals = emptyResult();
            addResult(totals, await this.importSteamFile(steamFile, ctx));
            await this.saveSettings();
            this.reportResults(totals, 1, false);
            return true;
        }
        catch (error) {
            console.error('SteamyNotes: unable to apply Steam version', appId, error);
            new obsidian_1.Notice(`SteamyNotes: unable to apply Steam's version. ${errorMessage(error)}`);
            return false;
        }
        finally {
            this.syncInProgress = false;
        }
    }
    reportResults(totals, fileCount, silent) {
        const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        const parts = [`${plural(totals.checked, 'note')} checked`];
        if (totals.changed)
            parts.push(`${totals.changed} updated`);
        if (totals.created)
            parts.push(`${totals.created} new`);
        if (totals.recreated)
            parts.push(`${totals.recreated} recreated`);
        if (totals.unchanged)
            parts.push(`${totals.unchanged} unchanged`);
        if (totals.keptEdited)
            parts.push(`${totals.keptEdited} kept (edited in Obsidian)`);
        if (totals.conflicts.length)
            parts.push(plural(totals.conflicts.length, 'conflict'));
        if (totals.heldCount)
            parts.push(`${plural(totals.heldCount, 'game')} held for review`);
        if (totals.errors.length)
            parts.push(`${totals.errors.length} failed`);
        const alerts = [];
        for (const held of totals.newlyHeld)
            alerts.push(`Held ${held.gameName}: ${held.message}`);
        for (const conflict of totals.conflicts)
            alerts.push(`Conflict in ${conflict.gameName}, "${conflict.title}": edited in both places. Your note was kept and Steam's version was saved to History.`);
        for (const error of totals.errors)
            alerts.push(`Failed ${error}`);
        const shown = alerts.length > 6 ? [...alerts.slice(0, 6), `…and ${alerts.length - 6} more (see the developer console).`] : alerts;
        let message = `SteamyNotes: ${parts.join(', ')} from ${plural(fileCount, 'Steam file')}.`;
        if (shown.length)
            message += `\n${shown.join('\n')}`;
        if (totals.newlyHeld.length)
            message += '\nRun "Review games held by shrink protection" to review.';
        const key = JSON.stringify(alerts);
        if (!silent) {
            new obsidian_1.Notice(message, alerts.length ? ALERT_TIMEOUT_MS : undefined);
        }
        else {
            // Automatic syncs stay quiet unless there is something new to say.
            if (alerts.length && key !== this.lastAlertKey)
                new obsidian_1.Notice(message, ALERT_TIMEOUT_MS);
            this.lastAlertKey = alerts.length ? key : '';
        }
        if (totals.errors.length)
            console.error('SteamyNotes sync errors:', totals.errors);
        if (alerts.length)
            console.warn('SteamyNotes alerts:', alerts);
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
    /**
     * One pass over the vault: appId -> (steam note id -> vault path).
     * History snapshots are excluded so they can never be mistaken for the real note.
     */
    buildNoteIndex() {
        const index = new Map();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!fm || fm.steam_appid === undefined || fm.steam_appid === null)
                continue;
            if (typeof fm.steam_note_id !== 'string' || !fm.steam_note_id)
                continue;
            if (fm.steam_snapshot === true || isSnapshotPath(file.path))
                continue;
            const appId = String(fm.steam_appid);
            let byId = index.get(appId);
            if (!byId) {
                byId = new Map();
                index.set(appId, byId);
            }
            if (!byId.has(fm.steam_note_id))
                byId.set(fm.steam_note_id, file.path);
        }
        return index;
    }
    canSkipUnchanged(previous, sourceHash, gameName, fingerprint) {
        if (!previous || previous.pending)
            return false;
        if (previous.sourceHash !== sourceHash || previous.fingerprint !== fingerprint || previous.gameName !== gameName)
            return false;
        // The hash is an optimization, not permission to assume the vault is intact.
        if (!this.settings.recreateDeletedNotes)
            return true;
        return previous.noteIds.every(id => {
            const record = previous.notes[id];
            return !!record && !!this.app.vault.getAbstractFileByPath(record.path);
        });
    }
    /** Decides whether Steam's file looks unsafe to apply. Returns null when it is fine. */
    evaluateHold(previous, parsed) {
        if (!parsed.ok) {
            return { kind: 'unrecognized', message: 'the Steam notes file could not be read (empty, partially written, or in a new format). Nothing was imported.' };
        }
        if (!previous)
            return null;
        if (previous.noteCount > 0 && parsed.notes.length < previous.noteCount) {
            return {
                kind: 'shrink',
                message: `Steam now lists ${parsed.notes.length} note${parsed.notes.length === 1 ? '' : 's'}, down from ${previous.noteCount}. Your vault notes were left untouched.`,
            };
        }
        const older = parsed.notes.filter(note => {
            const record = previous.notes?.[note.id];
            return typeof note.timeModified === 'number' && typeof record?.steamModified === 'number' && note.timeModified < record.steamModified;
        });
        if (older.length) {
            const names = older.slice(0, 3).map(note => `"${note.title || note.id}"`).join(', ');
            return {
                kind: 'older',
                message: `${older.length} note${older.length === 1 ? '' : 's'} in Steam ${older.length === 1 ? 'is' : 'are'} older than the copy you imported (${names}${older.length > 3 ? ', …' : ''}). Steam may have reverted them. Your vault notes were left untouched.`,
            };
        }
        return null;
    }
    async importSteamFile(steamFile, ctx) {
        const appId = steamFile.appId;
        const raw = await fs.readFile(steamFile.filePath, 'utf8');
        const sourceHash = sha1(raw);
        const gameName = this.settings.resolveGameNames
            ? await this.getGameName(appId, ctx.manual)
            : `Steam App ${appId}`;
        const previous = this.syncState[appId];
        const result = emptyResult();
        // Already held and already reported for exactly this version of Steam's file.
        if (!ctx.accept && previous?.pending && previous.pending.sourceHash === sourceHash) {
            result.heldCount = 1;
            return result;
        }
        if (!ctx.force && !ctx.accept && this.canSkipUnchanged(previous, sourceHash, gameName, ctx.fingerprint)) {
            result.checked = previous.noteCount;
            result.unchanged = previous.noteCount;
            return result;
        }
        const parsed = parseSteamNotes(raw);
        if (!ctx.accept) {
            const hold = this.evaluateHold(previous, parsed);
            if (hold) {
                const pending = { kind: hold.kind, message: hold.message, sourceHash, gameName, detectedAt: new Date().toISOString() };
                this.syncState[appId] = { ...(previous ?? emptyState()), pending };
                result.heldCount = 1;
                result.newlyHeld.push({ appId, gameName, message: hold.message });
                return result;
            }
        }
        const folder = (0, obsidian_1.normalizePath)(`${this.settings.destinationFolder ? `${this.settings.destinationFolder}/` : ''}${sanitizePathPart(gameName)}`);
        await this.ensureVaultFolder(folder);
        const imageRoot = path.join(path.dirname(steamFile.filePath), `notes_${appId}_images`);
        const imageDestination = this.settings.imageDestinationFolder.trim()
            ? (0, obsidian_1.normalizePath)(this.settings.imageDestinationFolder.trim())
            : folder;
        await this.ensureVaultFolder(imageDestination);
        const imageMap = await this.importSteamImages(imageRoot, imageDestination, parsed.notes, gameName);
        const existingById = ctx.noteIndex.get(appId) ?? new Map();
        const records = { ...(previous?.notes ?? {}) };
        const noteIds = [];
        let hadNoteError = false;
        result.checked = parsed.notes.length;
        for (const note of parsed.notes) {
            noteIds.push(note.id);
            try {
                const outcome = await this.syncNote({ appId, gameName, folder, note, record: records[note.id], existingById, imageMap, steamFile });
                records[note.id] = outcome.record;
                if (outcome.kind === 'conflict')
                    result.conflicts.push({ gameName, title: note.title || note.id });
                else if (outcome.kind !== 'skipped')
                    result[outcome.kind]++;
            }
            catch (error) {
                hadNoteError = true;
                result.errors.push(`${gameName}, "${note.title || note.id}": ${errorMessage(error)}`);
                console.error('SteamyNotes note sync failed', appId, note.id, error);
            }
        }
        if (this.settings.importRawFiles) {
            // Optional extra. Hidden files are not indexed by Obsidian, so use the
            // adapter, and never let a failure here block the state update below.
            try {
                await this.app.vault.adapter.write((0, obsidian_1.normalizePath)(`${folder}/.steam-source-${appId}.txt`), raw);
            }
            catch (error) {
                console.warn('SteamyNotes: unable to write raw Steam source copy', appId, error);
            }
        }
        this.syncState[appId] = {
            // An empty hash forces the next pass to retry when any note failed.
            sourceHash: hadNoteError ? '' : sourceHash,
            fingerprint: ctx.fingerprint,
            gameName,
            noteCount: parsed.notes.length,
            noteIds,
            notes: records,
            syncedAt: new Date().toISOString(),
        };
        return result;
    }
    /**
     * Three-way decision for one note. The recorded state tells us what we last
     * saw from Steam (steamHash) and what we last wrote or adopted (writtenHash):
     *   vault unchanged            -> Steam wins; the old version goes to History
     *   vault changed, Steam same  -> keep the vault note
     *   both changed               -> keep the vault note, save Steam's version to History
     */
    async syncNote({ appId, gameName, folder, note, record, existingById, imageMap, steamFile }) {
        const steamHash = hashSteamNote(note);
        const steamModified = typeof note.timeModified === 'number' ? note.timeModified : null;
        const desired = buildMarkdown(gameName, appId, steamFile.filePath, note, imageMap, this.settings.globalTags, this.settings.includeSourcePath);
        const desiredNorm = normalizeForCompare(desired);
        const desiredHash = sha1(desiredNorm);
        const file = this.locateNoteFile(appId, note.id, record, existingById);
        if (!file) {
            if (record && !this.settings.recreateDeletedNotes)
                return { kind: 'skipped', record };
            const preferred = record?.path && !isSnapshotPath(record.path) ? record.path : `${folder}/${defaultNoteFileName(note)}`;
            const target = this.freeNotePath((0, obsidian_1.normalizePath)(preferred));
            await this.ensureVaultFolder(parentFolder(target));
            await this.app.vault.create(target, desired);
            return { kind: record ? 'recreated' : 'created', record: { path: target, steamHash, writtenHash: desiredHash, steamModified } };
        }
        const current = await this.app.vault.read(file);
        const currentNorm = normalizeForCompare(current);
        if (currentNorm === desiredNorm) {
            // Same content. Refresh differences that don't count as edits (the steam_source line, line endings).
            if (current !== desired)
                await this.app.vault.modify(file, desired);
            return { kind: 'unchanged', record: { path: file.path, steamHash, writtenHash: desiredHash, steamModified } };
        }
        const currentHash = sha1(currentNorm);
        // An unknown baseline (no record, or a record from an older plugin version) is treated as "edited".
        const vaultChanged = record?.writtenHash ? currentHash !== record.writtenHash : true;
        const steamChanged = record?.steamHash ? steamHash !== record.steamHash : true;
        if (!vaultChanged) {
            await this.createHistorySnapshot(folder, file.name, current, 'replaced');
            await this.app.vault.modify(file, desired);
            return { kind: 'changed', record: { path: file.path, steamHash, writtenHash: desiredHash, steamModified } };
        }
        if (!steamChanged) {
            return { kind: 'keptEdited', record: { ...record, path: file.path } };
        }
        await this.createHistorySnapshot(folder, file.name, desired, 'steam-version');
        // Advance the Steam baseline so this Steam version is only reported once.
        return { kind: 'conflict', record: { path: file.path, steamHash, writtenHash: record?.writtenHash || '', steamModified } };
    }
    /** Finds the vault file for a Steam note: recorded path first, then by frontmatter ID anywhere in the vault. */
    locateNoteFile(appId, noteId, record, existingById) {
        const candidates = [];
        if (record?.path && !isSnapshotPath(record.path))
            candidates.push(record.path);
        const indexed = existingById.get(noteId);
        if (indexed && !candidates.includes(indexed))
            candidates.push(indexed);
        for (const candidate of candidates) {
            const file = this.app.vault.getAbstractFileByPath(candidate);
            if (file instanceof obsidian_1.TFile && this.belongsToNote(file, appId, noteId))
                return file;
        }
        return null;
    }
    /** A file only counts as the note if its frontmatter doesn't say it belongs to someone else. */
    belongsToNote(file, appId, noteId) {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!fm)
            return true; // cache not ready yet; trust the recorded path
        if (fm.steam_snapshot === true)
            return false;
        if (typeof fm.steam_note_id === 'string') {
            return fm.steam_note_id === noteId && String(fm.steam_appid ?? appId) === appId;
        }
        return true;
    }
    /** Never claim a path that already holds some other file. */
    freeNotePath(target) {
        if (!this.app.vault.getAbstractFileByPath(target))
            return target;
        const base = target.replace(/\.md$/i, '');
        for (let n = 2;; n++) {
            const candidate = `${base} (${n}).md`;
            if (!this.app.vault.getAbstractFileByPath(candidate))
                return candidate;
        }
    }
    /**
     * Saves a copy under <game folder>/History. Snapshots carry neutral frontmatter
     * (no steam_appid / steam_note_id / tags) so Bases, Dataview and tag searches
     * don't treat them as real notes, and the sync never mistakes them for the note.
     */
    async createHistorySnapshot(gameFolder, fileName, content, kind) {
        const historyFolder = (0, obsidian_1.normalizePath)(`${gameFolder}/${HISTORY_FOLDER}`);
        await this.ensureVaultFolder(historyFolder);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const label = kind === 'steam-version' ? ' - Steam version' : '';
        const base = `${sanitizePathPart(fileName.replace(/\.md$/i, ''))}${label}`;
        let target = (0, obsidian_1.normalizePath)(`${historyFolder}/${base} - ${stamp}.md`);
        let n = 2;
        while (this.app.vault.getAbstractFileByPath(target)) {
            target = (0, obsidian_1.normalizePath)(`${historyFolder}/${base} - ${stamp} - ${n++}.md`);
        }
        await this.app.vault.create(target, neutralizeSnapshot(content, kind));
        return target;
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
        const cachedTargets = new Set(Object.values(this.imageCache));
        const appIdForImages = steamAppIdForImageRoot(imageRoot);
        for (const entry of entries) {
            if (!entry.isFile())
                continue;
            if (!this.settings.importAllSteamImages && !referenced.has(entry.name))
                continue;
            const source = path.join(imageRoot, entry.name);
            try {
                const bytes = await fs.readFile(source);
                const cacheKey = `${appIdForImages}:${entry.name}`;
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
                    target = await this.uniqueImageTarget(imageDestination, baseName, path.extname(entry.name), usedTargets, cachedTargets);
                    this.imageCache[cacheKey] = target;
                    cachedTargets.add(target);
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
    /**
     * Picks a free vault path for an image that has no cached mapping yet. A path
     * already claimed by another image (cached or written this run) or by any
     * existing file is never reused, so one Steam image can't overwrite another.
     */
    async uniqueImageTarget(destination, baseName, extension, usedTargets, cachedTargets) {
        let number = 1;
        while (true) {
            const suffix = number === 1 ? '' : ` ${number}`;
            const target = (0, obsidian_1.normalizePath)(destination ? `${destination}/${baseName}${suffix}${extension}` : `${baseName}${suffix}${extension}`);
            if (usedTargets.has(target) || cachedTargets.has(target) || this.app.vault.getAbstractFileByPath(target)) {
                number++;
                continue;
            }
            return target;
        }
    }
    async getGameName(appId, manual = false) {
        const cached = this.metadataCache[appId]?.name;
        if (cached)
            return cached;
        const failedAt = this.nameFailures[appId];
        // Don't hammer Steam's store API on every automatic sync for games it can't resolve.
        if (!manual && typeof failedAt === 'number' && Date.now() - failedAt < NAME_FAILURE_TTL_MS) {
            return `Steam App ${appId}`;
        }
        try {
            const response = await (0, obsidian_1.requestUrl)({ url: `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}` });
            const json = response.json;
            const name = json?.[appId]?.data?.name;
            if (name) {
                this.metadataCache[appId] = { appId, name };
                delete this.nameFailures[appId];
                return name;
            }
        }
        catch (error) {
            console.warn(`SteamyNotes: unable to resolve Steam AppID ${appId}`, error);
        }
        this.nameFailures[appId] = Date.now();
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
    async writeVaultBinary(filePath, data) {
        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof obsidian_1.TFile) {
            // Steam names image files by content, so an unchanged size means unchanged bytes.
            const size = data.byteLength ?? data.length;
            if (existing.stat && existing.stat.size === size)
                return;
            await this.app.vault.adapter.writeBinary(filePath, data);
        }
        else {
            await this.app.vault.createBinary(filePath, data);
        }
    }
}
exports.default = SteamyNotesPlugin;

function sha1(text) {
    return (0, node_crypto_1.createHash)('sha1').update(text, 'utf8').digest('hex');
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function emptyState() {
    return { sourceHash: '', fingerprint: '', gameName: '', noteCount: 0, noteIds: [], notes: {}, syncedAt: '' };
}
function emptyResult() {
    return { checked: 0, created: 0, recreated: 0, changed: 0, unchanged: 0, keptEdited: 0, conflicts: [], errors: [], heldCount: 0, newlyHeld: [] };
}
function addResult(total, part) {
    for (const key of ['checked', 'created', 'recreated', 'changed', 'unchanged', 'keptEdited', 'heldCount'])
        total[key] += part[key];
    total.conflicts.push(...part.conflicts);
    total.errors.push(...part.errors);
    total.newlyHeld.push(...part.newlyHeld);
}
/** Upgrades sync state saved by earlier versions (which only stored note paths). */
function migrateSyncState(raw) {
    const result = {};
    for (const [appId, old] of Object.entries(raw)) {
        if (!old || typeof old !== 'object')
            continue;
        const state = { ...old };
        if (!state.notes || typeof state.notes !== 'object') {
            state.notes = {};
            for (const [id, notePath] of Object.entries(old.notePaths ?? {})) {
                // Older versions could record a History snapshot as the note; discard those.
                if (typeof notePath === 'string' && !isSnapshotPath(notePath)) {
                    state.notes[id] = { path: notePath, steamHash: '', writtenHash: '', steamModified: null };
                }
            }
        }
        delete state.notePaths;
        state.noteIds = Array.isArray(state.noteIds) ? state.noteIds.filter(id => typeof id === 'string') : Object.keys(state.notes);
        state.noteCount = typeof state.noteCount === 'number' ? state.noteCount : state.noteIds.length;
        result[appId] = state;
    }
    return result;
}
function sanitizePathPart(value) {
    return value.replace(/[\\/:*?"<>|]/g, '-').replace(/[. ]+$/, '').trim() || 'Untitled';
}
function parentFolder(filePath) {
    const i = filePath.lastIndexOf('/');
    return i === -1 ? '' : filePath.slice(0, i);
}
function defaultNoteFileName(note) {
    return `${String(note.index).padStart(2, '0')} - ${sanitizePathPart(note.title || `Steam Note ${note.index}`)}.md`;
}
function isSnapshotPath(filePath) {
    const parts = filePath.split('/');
    if (parts.length < 2)
        return false;
    return parts[parts.length - 2] === HISTORY_FOLDER && SNAPSHOT_NAME_RE.test(parts[parts.length - 1]);
}
function hashSteamNote(note) {
    return sha1(JSON.stringify([note.title, note.body, note.timeCreated ?? null, note.timeModified ?? null]));
}
/** Text used to decide whether a note was edited: ignores the volatile steam_source line and CRLF. */
function normalizeForCompare(markdown) {
    return markdown
        .replace(/\r\n/g, '\n')
        .replace(/^---\n[\s\S]*?\n---(?=\n|$)/, block => block.replace(/^steam_source:.*(?:\n|$)/m, ''));
}
function neutralizeSnapshot(content, kind) {
    const text = content.replace(/\r\n/g, '\n');
    const marker = ['steam_snapshot: true', `steam_snapshot_kind: ${yamlQuote(kind)}`];
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
    if (!match)
        return `---\n${marker.join('\n')}\n---\n\n${text}`;
    const kept = [];
    let inTags = false;
    for (const line of match[1].split('\n')) {
        if (/^tags\s*:/i.test(line)) {
            inTags = true;
            continue;
        }
        if (inTags) {
            if (/^\s*-\s/.test(line) || /^\s+\S/.test(line))
                continue;
            inTags = false;
        }
        kept.push(line.replace(/^steam_appid:/, 'steam_snapshot_appid:').replace(/^steam_note_id:/, 'steam_snapshot_note_id:'));
    }
    return `---\n${[...kept, ...marker].join('\n')}\n---\n${text.slice(match[0].length)}`;
}
function steamAppIdForImageRoot(imageRoot) {
    const match = /notes_(\d+)_images$/.exec(imageRoot.replace(/\\/g, '/'));
    return match?.[1] ?? 'unknown';
}
function buildMarkdown(gameName, appId, sourcePath, note, imageMap, globalTags, includeSourcePath = true) {
    const body = steamBodyToMarkdown(note.body, imageMap);
    const created = note.timeCreated ? new Date(note.timeCreated * 1000).toISOString() : '';
    const modified = note.timeModified ? new Date(note.timeModified * 1000).toISOString() : '';
    const tags = parseGlobalTags(globalTags);
    const tagsFrontmatter = tags.length ? `tags:\n${tags.map(tag => `  - ${yamlQuote(tag)}`).join('\n')}\n` : '';
    const sourceLine = includeSourcePath ? `steam_source: ${yamlQuote(sourcePath)}\n` : '';
    return `---\n${tagsFrontmatter}steam_appid: ${appId}\nsteam_game: ${yamlQuote(gameName)}\n${sourceLine}steam_note_id: ${yamlQuote(note.id)}\nsteam_note_index: ${note.index}\n${created ? `steam_created: ${created}\n` : ''}${modified ? `steam_modified: ${modified}\n` : ''}---\n\n# ${note.title || `Steam Note ${note.index}`}\n\n${body.trim()}\n`;
}
/** Obsidian tags can't contain spaces or most punctuation. */
function parseGlobalTags(value) {
    return (value ?? '')
        .split(/[\n,]+/)
        .map(tag => tag.trim().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\-/]/gu, ''))
        .filter(Boolean);
}
function yamlQuote(value) {
    return JSON.stringify(value);
}
/**
 * Steam's note file format is intentionally handled defensively here. The exact
 * current format is not a documented public Steam API. We first try JSON, then
 * a small Valve-KeyValues parser. If neither yields a notes list the file is
 * reported as unrecognized and NOTHING is imported from it: writing raw or
 * partial text into the vault as a "note" would be worse than doing nothing.
 */
function parseSteamNotes(raw) {
    const text = raw.replace(/^\uFEFF/, '').replace(/\0/g, '');
    try {
        const notes = extractNotes(JSON.parse(text));
        if (notes)
            return { ok: true, notes };
    }
    catch (_) {
        // Not JSON.
    }
    try {
        const notes = extractNotes(parseValveKeyValues(text));
        if (notes && notes.length)
            return { ok: true, notes };
    }
    catch (_) {
        // Not Valve KeyValues, or an unsupported variant.
    }
    return { ok: false, notes: [] };
}
/** Returns null if the value isn't a recognizable notes document; an empty list is valid. */
function extractNotes(value) {
    if (!value || typeof value !== 'object')
        return null;
    const root = value;
    if (!Array.isArray(root.notes))
        return null;
    const found = [];
    root.notes.forEach((raw, index) => {
        if (!raw || typeof raw !== 'object')
            return;
        const obj = raw;
        const content = typeof obj.content === 'string' ? obj.content : '';
        const title = typeof obj.title === 'string' ? obj.title : `Steam Note ${index + 1}`;
        let id;
        if (typeof obj.id === 'string')
            id = obj.id;
        else if (typeof obj.id === 'number')
            id = String(obj.id);
        else
            id = `index-${index + 1}`;
        found.push({
            id,
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
            .setDesc('Read Steam Game Notes and update the corresponding Obsidian Markdown files. Notes you edited in Obsidian are kept.')
            .addButton(button => button
            .setButtonText('Pull')
            .setCta()
            .onClick(() => {
            this.close();
            void this.plugin.importSteamNotes();
        }));
        new obsidian_1.Setting(contentEl)
            .setName('Force full resync')
            .setDesc('Re-check every note even if Steam\'s files have not changed. Notes you edited in Obsidian are still kept.')
            .addButton(button => button
            .setButtonText('Resync')
            .onClick(() => {
            this.close();
            void this.plugin.importSteamNotes(false, { force: true });
        }));
        const held = this.plugin.getHeldGames().length;
        if (held) {
            new obsidian_1.Setting(contentEl)
                .setName(`Games held for review (${held})`)
                .setDesc('Steam\'s notes file changed in a way that could mean data loss, so these games were paused.')
                .addButton(button => button
                .setButtonText('Review')
                .setWarning()
                .onClick(() => {
                this.close();
                this.plugin.openHeldReview();
            }));
        }
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
class HeldReviewModal extends obsidian_1.Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
    }
    onOpen() {
        this.render();
    }
    render() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Games held for review' });
        const held = this.plugin.getHeldGames();
        if (!held.length) {
            contentEl.createEl('p', { text: 'Nothing is held. All games are in sync.', cls: 'steamynotes-setting-note' });
            new obsidian_1.Setting(contentEl).addButton(button => button.setButtonText('Close').onClick(() => this.close()));
            return;
        }
        contentEl.createEl('p', {
            text: 'SteamyNotes paused these games because Steam\'s notes file changed in a way that could mean data loss (for example a cloud conflict). Your vault notes were left untouched, and you won\'t be warned again until Steam\'s file changes. Accepting applies Steam\'s current version: notes you haven\'t edited are replaced (the previous version is saved to History) and notes you edited are kept.',
            cls: 'steamynotes-setting-note',
        });
        for (const item of held) {
            const setting = new obsidian_1.Setting(contentEl).setName(item.gameName).setDesc(item.message);
            if (item.kind !== 'unrecognized') {
                setting.addButton(button => button
                    .setButtonText('Accept Steam\'s version')
                    .setWarning()
                    .onClick(async () => {
                    button.setDisabled(true);
                    await this.plugin.acceptHeldGame(item.appId);
                    this.render();
                }));
            }
        }
        new obsidian_1.Setting(contentEl).addButton(button => button.setButtonText('Close').onClick(() => this.close()));
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
        const heldCount = this.plugin.getHeldGames().length;
        if (heldCount) {
            new obsidian_1.Setting(containerEl)
                .setName(`Games held for review (${heldCount})`)
                .setDesc('SteamyNotes paused these games because Steam\'s notes file changed in a way that could mean data loss. Your vault notes were left untouched.')
                .addButton(button => button
                .setButtonText('Review')
                .setWarning()
                .onClick(() => this.plugin.openHeldReview()));
        }
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
            .setDesc('Steam stores pasted note images in notes_<gameid>_images. SteamyNotes copies them here, using readable names such as Game - Note title - Image 01.png. Leave it on "Game folder" to keep images next to each game\'s notes. The original Steam SHA-1 filename is retained internally for future synchronization.');
        imageSetting.addButton(button => button
            .setButtonText(this.plugin.settings.imageDestinationFolder || 'Game folder')
            .onClick(() => {
            const folders = getVaultFolders(this.plugin.app);
            new FolderPickerModal(this.plugin.app, folders, async (folder) => {
                this.plugin.settings.imageDestinationFolder = folder;
                await this.plugin.saveSettings();
                this.display();
            }).open();
        }));
        imageSetting.addButton(button => button
            .setButtonText('Game folder')
            .setDisabled(!this.plugin.settings.imageDestinationFolder)
            .onClick(async () => {
            this.plugin.settings.imageDestinationFolder = '';
            await this.plugin.saveSettings();
            this.display();
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
            .setDesc("Copy every image in each game's notes_<gameid>_images folder, including images no longer referenced by a note. Disable to copy only images referenced by imported notes.")
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.importAllSteamImages)
            .onChange(async (value) => { this.plugin.settings.importAllSteamImages = value; await this.plugin.saveSettings(); }));
        new obsidian_1.Setting(containerEl)
            .setName('Custom global tags')
            .setDesc('Optional tags added to the frontmatter of imported Steam notes you have not edited in Obsidian. Separate multiple tags with commas; a leading # is optional. Spaces become hyphens and characters Obsidian does not allow in tags are removed. Example: steamnotes, games, #steam')
            .addText(text => text
            .setPlaceholder('steamnotes')
            .setValue(this.plugin.settings.globalTags)
            .onChange(async (value) => { this.plugin.settings.globalTags = value; await this.plugin.saveSettings(); }));
        new obsidian_1.Setting(containerEl)
            .setName('Sync on Obsidian startup')
            .setDesc('Check Steam notes shortly after Obsidian finishes loading. Steam remains read-only.')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.autoSyncOnStartup)
            .onChange(async (value) => { this.plugin.settings.autoSyncOnStartup = value; await this.plugin.saveSettings(); }));
        new obsidian_1.Setting(containerEl)
            .setName('Automatic sync interval (minutes)')
            .setDesc('0 disables interval syncing. Changes apply immediately. Hashes are used to avoid unnecessary work, and automatic syncs only show a notice when there is something to report.')
            .addText(text => text
            .setPlaceholder('0')
            .setValue(String(this.plugin.settings.autoSyncIntervalMinutes))
            .onChange(async (value) => {
            const minutes = Math.max(0, Math.floor(Number(value) || 0));
            this.plugin.settings.autoSyncIntervalMinutes = minutes;
            await this.plugin.saveSettings();
            this.plugin.scheduleAutoSyncRestart();
        }));
        new obsidian_1.Setting(containerEl)
            .setName('Recreate deleted notes')
            .setDesc('If you delete an imported note from your vault, recreate it on the next sync while it still exists in Steam. Turn off to leave deleted notes deleted.')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.recreateDeletedNotes)
            .onChange(async (value) => { this.plugin.settings.recreateDeletedNotes = value; await this.plugin.saveSettings(); }));
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
        new obsidian_1.Setting(containerEl)
            .setName('Include Steam file path in frontmatter')
            .setDesc('Adds steam_source, the local path of the Steam file, to every note. That path contains your numeric Steam user ID, so turn this off before sharing or publishing your vault.')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.includeSourcePath)
            .onChange(async (value) => { this.plugin.settings.includeSourcePath = value; await this.plugin.saveSettings(); }));
        containerEl.createEl('p', { text: 'Prototype: Steam files are read-only. Bidirectional write-back is intentionally not enabled yet.', cls: 'steamynotes-setting-note' });
    }
}
async function browseForFolder() {
    try {
        const nodeRequire = window.require;
        const electron = nodeRequire?.('electron');
        let dialog = electron?.remote?.dialog;
        if (!dialog) {
            try {
                dialog = nodeRequire?.('@electron/remote')?.dialog;
            }
            catch (_) {
                // Not available in this Obsidian build.
            }
        }
        if (!dialog)
            dialog = electron?.dialog;
        const options = { properties: ['openDirectory'], title: 'Select Steam Game Notes folder' };
        if (dialog?.showOpenDialog) {
            const result = await dialog.showOpenDialog(options);
            return result && !result.canceled ? (result.filePaths?.[0] ?? null) : null;
        }
        if (dialog?.showOpenDialogSync) {
            return dialog.showOpenDialogSync(options)?.[0] ?? null;
        }
    }
    catch (error) {
        console.warn('SteamyNotes: native folder picker failed', error);
    }
    new obsidian_1.Notice('SteamyNotes: the native folder picker is unavailable in this Obsidian build. Paste the folder path instead.');
    return null;
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
