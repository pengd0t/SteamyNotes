# SteamyNotes

Bring the notes you take in Steam's in-game overlay into Obsidian. Organized by game. Images included.  And then push edits back. 

## Description

SteamyNotes is an Obsidian plugin that syncs your Steam Overlay game notes (Shift+Tab → Notes while playing) with your vault as Markdown files, one folder per game.

**Status: v1.0.0** - Pull and push both work. Steam's local `notes_<AppID>` files can be updated from Obsidian. Read the [Push warnings](#push-to-steam-read-this-first) before writing back.

**Requires:** Obsidian 1.7.2 or newer · Desktop only · Steam installed on the same computer

### WARNING (push)
Pushing writes into Steam's local notes files. **Close any running game and the Steam Notes editor before you push.** After a push, the Steam client may keep the old note text in memory for a few minutes. **Do not open or edit that note in Steam during that wait** — Steam can overwrite your disk files with the stale in-memory copy and wipe the Obsidian edits you just pushed. 

---

## Why SteamyNotes?

Steam Notes is genuinely useful for puzzle solutions, build orders, checklists and map sketches. Players also report rough edges. SteamyNotes addresses several of them:

| What Steam Notes users report | What SteamyNotes does about it |
| --- | --- |
| **No export, import or backup.** There's no built-in way to get your notes out of Steam. | **Available.** Pulls every game's notes into plain Markdown in your vault for backup, sync and version control. |
| **Notes vanish, revert, or get cut off.** Edits disappear after switching notes or relaunching; cloud conflicts can blank *every* game's notes. | **Partial.** Reads Steam's local files directly for an independent copy. Pull preserves notes you edited in Obsidian (three-way compare). Optional History snapshots. Cannot fix Steam's own save/sync bugs. |
| **Notes are only reachable inside the overlay** (or per-game on the library page); no phone or "all notes" view. | **Available.** Once pulled, notes are ordinary vault files. Pull/push run on desktop. |
| **No search across games, no linking, no tags.** | **Available.** Obsidian search, backlinks, tags, graph. Frontmatter carries game and AppID. |
| **Images are awkward.** | **Available.** Images are copied into the vault and embedded as `![[…]]`. Known images can round-trip on push. |
| **Editing outside the game isn't possible.** | **Available (v0.7+).** Edit in Obsidian and push back so changes show in-game after Steam reloads the files. |

**What SteamyNotes does *not* do:** it does not fix Steam's saving or cloud sync. If Notes misbehaves on Steam's side, see [Troubleshooting](#troubleshooting).

---

## Features

- **Pull** Steam Game Notes from your Steam `userdata` folder (`notes_<AppID>`)
- **Push** Obsidian edits back into those Steam files (with backup + restore)
- **One folder per game, one Markdown file per note**, named `NN - Title.md`
- **Game name lookup** from the AppID (optional)
- **Frontmatter:** `steam_appid`, `steam_game`, `steam_source`, `steam_note_id`, `steam_note_index`, `steam_created`, `steam_modified`
- **Image import** from `notes_<AppID>_images` into the vault
- **Bidirectional formatting** (see [Formatting](#formatting))
- **Safer pull:** notes you edited in Obsidian are kept; Steam's conflicting version can go to History
- **Shrink / hold protection** when Steam's file looks like data loss
- **`.steamy-backup`** written next to each Steam file before push; **Restore from backup** action
- **Auto-detect** Steam notes folder (Windows / macOS / Linux) plus Browse
- **Ribbon action chooser:** Pull, force resync, Push, Restore — explicit, nothing runs by accident

---

## Installation

### Manual install

1. Download `main.js`, `manifest.json` and `styles.css` from this repository.
2. In your vault, create `.obsidian/plugins/steamynotes/` and put the three files there.
3. **Settings → Community plugins** — turn off Restricted mode if needed, enable **SteamyNotes**.

---

## Quick start

1. Enable the plugin.
2. **Settings → SteamyNotes** → set **Steam Game Notes folder**. Use **Auto-detect**, **Browse**, or paste the path:

| OS | Typical location |
| --- | --- |
| Windows | `C:\Program Files (x86)\Steam\userdata\<SteamUserID>\2371090\remote` |
| macOS | `~/Library/Application Support/Steam/userdata/<SteamUserID>/2371090/remote` |
| Linux | `~/.local/share/Steam/userdata/<SteamUserID>/2371090/remote` (or `~/.steam/steam/…`) |

`<SteamUserID>` is the numeric folder under `userdata`. If you have several accounts, pick the one that contains `notes_…` files.

3. Set **Obsidian destination folder** (default `Steam/Notes`) and **image destination**.
4. Ribbon **book icon** → **Pull**, or command **Pull Steam notes into Obsidian**.
5. Edit in Obsidian if you like, then **Push** (see warnings below).

> **Tip:** Steam only creates a notes file after you save a note for that game at least once.

### What you get

```text
Steam/Notes/
  └─ Half-Life 2/
       ├─ 01 - Route notes.md
       ├─ 02 - Puzzle solutions.md
       └─ .steam-source-220.txt    ← optional raw copy
Steam/Notes/Images/
  └─ …
```

Example note:

```markdown
---
steam_appid: 220
steam_game: "Half-Life 2"
steam_source: "…\\userdata\\12345678\\2371090\\remote\\notes_220"
steam_note_id: "…"
steam_note_index: 1
steam_created: 2026-01-01T12:00:00.000Z
steam_modified: 2026-01-02T18:30:00.000Z
---

# Route notes

Your note text, with **bold**, *italic* and ![[Steam/Notes/Images/example.png]]
```

---

## Pull and push behaviour

### Pull

- Reads each `notes_<AppID>` file (JSON preferred; KeyValues attempted as fallback).
- Creates or updates Markdown under the destination folder.
- **Notes you edited in Obsidian are not overwritten.** If Steam also changed, Steam's version can be saved under History and your vault text is kept.
- Optional raw copy: `.steam-source-<AppID>.txt`.
- Force full resync re-checks everything even when Steam's file hash is unchanged.

### Push to Steam (read this first)

1. **Close games and the Steam Notes editor.** Steam may rewrite local files from its in-memory buffer if Notes is open.
2. Ribbon → **Push**, or command **Push Obsidian notes to Steam**.
3. Only notes that already exist in Steam (matched by `steam_note_id`) are updated. New notes created only in Obsidian are not created on the Steam side yet.
4. Before writing, SteamyNotes saves `notes_<AppID>.steamy-backup` next to the live file.
5. Writes are atomic (temp file + rename).

#### After you push - Steam UI lag

The files on disk update immediately. The Steam client often **does not**. It can keep showing the previous text for a few minutes until it reloads from disk or cloud.

**During that wait:**

- **Do not open or edit the note in Steam Notes.** The client can flush its old in-memory content back to disk and undo your push.
- Closing the Notes panel and switching library games is often not enough.
- Waiting a few minutes for Steam to poll the file again will update it on the Steam side. Avoid Steam console command `cloud_sync_down 2371090` right after a push — it can download an older cloud copy over your new local files.

Notes live under Steam AppID **2371090** (not the game’s AppID).

### Restore from backup

If a push leaves a note unreadable or wrong:

- Ribbon → **Restore from backup**, or command **Restore Steam notes from SteamyNotes backups**
- Restores every `notes_<AppID>.steamy-backup` over the live file
- Invalidates sync state so the next pull re-reads Steam

Keep the Notes editor closed while restoring.

---

## Formatting

Steam Notes use a limited BBCode formatting. SteamyNotes converts both ways for the tags below. Round-trips are best when you use normal Markdown in Obsidian and let push emit Steam tags (or apply formatting with Steam’s toolbar and pull).

| Steam                                                | Markdown                                 |
| ---------------------------------------------------- | ---------------------------------------- |
| `[p]…[/p]` (one block per visual line)               | Paragraphs / separate lines              |
| `[br]` (legacy; Steam may show this as literal text) | Newline on pull; **not** emitted on push |
| `[b]…[/b]`                                           | `**bold**`                               |
| `[i]…[/i]`                                           | `*italic*`                               |
| `[strike]…[/strike]`                                 | `~~strikethrough~~`                      |
| `[url="href"]text[/url]` or `[url=href]text[/url]`   | `[text](href)`                           |
| `[h1]` / `[h2]` / `[h3]`                             | `#` / `##` / `###`                       |
| `[list]` / `[olist]` + `[*]`                         | `-` / numbered lists                     |
| `[code]…[/code]`, `[c]…[/c]`                         | `` `code` `` or fenced blocks            |
| `[quote]…[/quote]`                                   | `> ` blockquote                          |
| `[hr][/hr]`                                          | `---`                                    |
| `[cloudimg src="…"][/cloudimg]`                      | `![[vault/path]]`                        |

**Notes:**

- Steam does not render `[br]` reliably; push uses separate `[p]` tags instead.
- Underline (`[u]`) has no Markdown equivalent; text is kept, tag dropped on pull.
- Images known from a previous pull (via the plugin image cache) can be pushed back. Brand-new vault images are not uploaded into Steam’s images folder yet.
- Residual tags the pull converter does not understand are left as-is so a later push is less likely to destroy them.

If you find a tag that should convert and does not, open an issue and include a sample of the Steam `content` string.

---

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| **Steam Game Notes folder** | *(empty)* | Folder containing `notes_<AppID>` (`…\2371090\remote`). Browse + Auto-detect. |
| **Obsidian destination folder** | `Steam/Notes` | Vault folder for imported notes (one subfolder per game). |
| **Steam note image destination** | `Steam/Notes/Images` | Where images are copied. |
| **Import all Steam note images** | On | Copy every image in `notes_<AppID>_images`, or only referenced ones. |
| **Resolve game names** | On | Look up names via Steam store API. Off = `Steam App <AppID>`, fully offline. |
| **Keep raw Steam source files** | On | Write `.steam-source-<AppID>.txt` per game. |

---

## How it works

Steam stores notes under `userdata/<SteamUserID>/2371090/remote` and syncs them through Steam Cloud (separate from most game saves). SteamyNotes reads and writes those local files.

The format is not officially documented. The parser tries **JSON** first, then Valve KeyValues. Push currently **writes JSON** only (the format modern clients use).

Matching uses `steam_note_id` in frontmatter. Sync state tracks content hashes so pull can tell “vault edited”, “Steam edited”, or both.

---

## Privacy

- Reads Steam’s local notes folder; writes vault files and, on push, Steam’s local notes files.
- With **Resolve game names** on, requests `store.steampowered.com/api/appdetails` with the **AppID only** — never note text. Names are cached. Turn the setting off for offline use.
- `steam_source` in frontmatter includes your local path (and numeric Steam user ID). Remove it before sharing notes publicly.

---

## Troubleshooting

**"Set the Steam Game Notes folder in Settings first."**  
Settings → SteamyNotes → set the folder (Auto-detect is fastest).

**"No notes_ files were found in that folder."**  
You need the folder that *directly* contains `notes_<AppID>`, usually `…\2371090\remote`.

**Auto-detect finds nothing.**  
Non-default Steam install path — use Browse or paste.

**Browse does nothing.**  
Some Obsidian builds lack the native folder picker — paste the path.

**Folder named `Steam App 12345`.**  
Name lookup failed (offline, API, delisted game). Later successful lookup creates a new folder; delete the old one after checking.

**Import/push failures.**  
Developer console (**Ctrl+Shift+I** / **Cmd+Opt+I**) → look for `SteamyNotes` errors.

**Steam shows empty notes / cloud icon on Notes.**  
Steam-side cloud conflict. Pull first to secure a vault copy. In Notes, use the cloud icon and prefer the newer timestamp. Big Picture overlay has been reported to break that UI.

**Pushed changes don’t appear in Steam.**  
Disk was updated; the client is still showing memory. Wait, fully exit Steam, or try `cloud_sync_up 2371090`. **Do not edit the note in Steam until it shows the new text**, or you may overwrite the push.

**Push left a note broken.**  
Ribbon → **Restore from backup** (requires `notes_<AppID>.steamy-backup` from the last push).

**Mobile.**  
Plugin is desktop-only (needs the Steam install). Imported Markdown can sync to mobile with your vault.

---

## Roadmap

- [x] Pull notes from Steam, organized by game
- [x] Pull attached images and embed them
- [x] Game name lookup and optional raw source copy
- [x] Auto-detect for the Steam notes folder
- [x] Push notes back to Steam
- [x] Preserve Obsidian edits on pull (conflict / History handling)
- [x] Wider formatting conversion (lists, links, headings, code, …)
- [x] Backup before push + restore action
- [x] Community Plugins listing
- [ ] Create brand-new notes on the Steam side from Obsidian-only files
- [ ] Upload new images into Steam’s `notes_*_images` folder
- [ ] Multi-account support


---

## Community feedback that shaped this plugin

- [All Steam notes disappeared](https://steamcommunity.com/discussions/forum/1/601908674063081415) — cloud conflict blanking notes
- [Steam notes not saving](https://steamcommunity.com/discussions/forum/1/6679490218977026954/) — edits lost when switching notes
- [Steam Notes unreliable in keeping note contents](https://steamcommunity.com/groups/SteamClientBeta/discussions/0/6400272865046922307)
- [Broken notes feature?](https://steamcommunity.com/discussions/forum/10/3951406499782450770)
- [New Overlay and Notes — General Feedback](https://steamcommunity.com/groups/SteamClientBeta/discussions/3/3826413850813031019/)
- [Notes missing important features, such as checkboxes](https://steamcommunity.com/groups/SteamClientBeta/discussions/3/6861841362671827963)
- [Accessing and editing notes through the mobile app](https://steamcommunity.com/discussions/forum/10/3801650156479108336)
- [How to access notes when not in the game?](https://steamcommunity.com/groups/SteamClientBeta/discussions/3/3826414483644187709/)
- [Expand "notes" feature](https://steamcommunity.com/discussions/forum/10/4031347296570621957/)
- [Steam's note-taking feature (gHacks)](https://www.ghacks.net/2023/04/30/steams-note-taking-feature-is-quite-the-useful-addition/)

---

## Disclaimer

SteamyNotes is an unofficial community plugin. It is not affiliated with, endorsed by, or sponsored by Valve Corporation or Obsidian. Steam and the Steam logo are trademarks of Valve Corporation. Steam’s notes storage format is not officially documented; a client update could change behaviour. Keep your own backups of anything important. Use push at your own risk and keep the Notes editor closed while writing to Steam’s files.

## License

[MIT](LICENSE) © pengd0t
