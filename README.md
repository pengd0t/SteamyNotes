# SteamyNotes
Bring the notes you take in Steam's in-game overlay into Obsidian. Organized by game. Images included.

## Description
SteamyNotes is an Obsidian plugin that pulls your Steam Overlay game notes (the ones you write with Shift+Tab → Notes while playing) into your vault as Markdown files, one folder per game.

Status: early prototype (v0.6.1). Pulling notes and their attached images works. Pushing edits back to Steam is not available yet, so SteamyNotes only reads your Steam notes and never modifies them.

Requires: Obsidian 1.7.2 or newer · Desktop only · Steam installed on the same computer

### WARNING
With no push feature enabled, each pull from Steam overwrites previously imported notes. If you edit an imported note in Obsidian, your edits will be replaced the next time you pull. For now, you'd want to keep additional writing done on the Obsidian side in a separate notes that links to the imported ones.

## Why SteamyNotes?
Steam Notes is a genuinely handy feature, and plenty of players use it for puzzle solutions, build orders, checklists and map sketches. But going by what players have written on the Steam forums, it also has some rough edges. SteamyNotes addresses several of them today, and is designed to address more once push-back lands.
 
| What Steam Notes users report | What SteamyNotes does about it |
|---|---|
| **No export, import or backup.** There's no built-in way to get your notes out of Steam. | **Available now.** Pulls every game's notes into plain Markdown files in your vault, where you can back them up, sync them and version them like any other file. |
| **Notes vanish, revert, or get cut off.** Users describe recent edits disappearing after switching notes or relaunching a game, and a "cloud conflict" state that can make *every* game's notes look empty. | **Partial.** SteamyNotes reads Steam's local notes files directly, so you get an independent copy outside Steam. It is only as current as your last pull, each pull replaces the previous one (it's a copy, not a version history), and it can't fix Steam's own saving or sync. Snapshot history is on the roadmap. |
| **Notes are only reachable inside the overlay** (or per-game on the library page), and there's no phone access or "all my notes" view. | **Available now.** Once pulled, your notes are ordinary vault files that go wherever your vault goes. The pull itself runs on desktop. |
| **No search across games, no linking, no tags.** You see one note at a time. | **Available now.** Use Obsidian search, backlinks, tags, the graph and split panes over all your game notes at once. Each note carries the game and AppID in its frontmatter. |
| **Images are awkward.** Pasting works but is undocumented, and getting screenshots in and out is a hassle. | **Available now.** Images attached to your notes are copied into your vault and embedded in the imported notes. |
| **Editing outside the game isn't possible.** | **Planned.** Editing in Obsidian and pushing changes back so they show up in-game is in development and not yet available. |
 
**What SteamyNotes does *not* do:** it does not fix Steam's own saving or cloud sync, and today it cannot write to Steam. If Steam Notes is misbehaving, see [Troubleshooting](#troubleshooting).
 
---
 
## Features
 
- **Pulls Steam Game Notes** from your Steam `userdata` folder (files named `notes_<AppID>`)
- **One folder per game, one Markdown file per note**, named `NN - Title.md`
- **Game name lookup** from the AppID (optional), so folders are named after the game instead of a number
- **Frontmatter on every note**: `steam_appid`, `steam_game`, `steam_source`, `steam_note_id`, `steam_note_index`, `steam_created`, `steam_modified`
- **Image import**: copies images from Steam's `notes_<AppID>_images` folder into your vault and embeds them as `![[…]]` links (import all of them, or only those a note references)
- **Formatting conversion** for paragraphs, line breaks, bold and italic (see [Formatting](#formatting))
- **Optional raw copy** of each Steam source file, useful for troubleshooting
- **Auto-detect** for the Steam notes folder on Windows, macOS and Linux default install locations, plus a Browse button
- **Ribbon icon and command palette** entries. The ribbon opens an action chooser (Pull enabled, Push shown as "Coming later") so nothing is written by accident

 
### Coming next
 
- [ ] **Push notes back to Steam** so edits made in Obsidian appear in the overlay in-game *(in development; disabled)*
- [ ] Safer re-imports: never overwrite a note you've edited.
- [ ] Match notes by their Steam note ID so renames and reorders don't leave stray files
- [ ] Wider formatting support (lists, links and more)
See the [Roadmap](#roadmap).
 
---
 
## Installation
 
### Manual install
 
1. Download `main.js`, `manifest.json` and `styles.css` from this repository.
2. In your vault, create the folder `.obsidian/plugins/steamynotes/` and put the three files in it.
3. In Obsidian, open **Settings → Community plugins**, turn off Restricted mode if needed, and enable **SteamyNotes**.
 
---
 
## Quick start
 
1. **Enable the plugin** (see above).
2. Open **Settings → SteamyNotes** and set **Steam Game Notes folder**. Click **Auto-detect**, or use **Browse**, or paste the path yourself. The folder is:
   | OS | Typical location |
   |---|---|
   | Windows | `C:\Program Files (x86)\Steam\userdata\<SteamUserID>\2371090\remote` |
   | macOS | `~/Library/Application Support/Steam/userdata/<SteamUserID>/2371090/remote` |
   | Linux | `~/.local/share/Steam/userdata/<SteamUserID>/2371090/remote` (or `~/.steam/steam/…`) |
   
   `<SteamUserID>` is the numeric folder name under `userdata`. If Steam is installed elsewhere, look for the same `userdata/<SteamUserID>/2371090/remote` structure there. If you have several Steam accounts, pick the folder that contains `notes_…` files. Auto-detect will use the first one it finds.
   
3. Choose your **Obsidian destination folder** (default `Steam/Notes`) and **image destination** (default `Steam/Notes/Images`).
4. Click the **book icon** in the ribbon and choose **Pull**, or run **`Pull Steam notes into Obsidian`** from the command palette.
5. A notice reports how many notes were imported. Open your destination folder to see them.
> **Tip:** Steam only creates a notes file once you've saved a note for that game. Take a note in the overlay first, then pull.
 
### What you get
 
```
Steam/Notes/
  └─ Half-Life 2/                    ← one folder per game (example)
       ├─ 01 - Route notes.md
       ├─ 02 - Puzzle solutions.md
       └─ .steam-source-220.txt      ← optional raw copy (hidden in Obsidian)
Steam/Notes/Images/
  └─ …                               ← images from your notes
```
 
Each note looks like this:
 
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
 
Files are named from the note's **position** in Steam's list (`01`, `02`, …) plus its title. Characters that aren't allowed in file names are replaced with `-`.
 
### Re-importing (read this first)
 
- **Pull overwrites.** Every pull rewrites the Markdown file for each note it finds in Steam, replacing whatever is in the vault. **Edits you make to imported notes will be lost on the next pull.** Until push-back exists, treat imported notes as a read-only mirror, and write your own thoughts in separate notes that link to them.
- **Don't rename or move imported notes.** The next pull will recreate them at the original location.
- **Pull never deletes files.** If you delete, rename or reorder notes in Steam, files from earlier pulls can be left behind, because files are named by position and title. You can safely delete stale files yourself.
- **Steam's copy wins.** If Steam reverts a note to an older version (some players report this), the next pull will bring the older text into your vault.
---
 
## Settings
 
| Setting | Default | What it does |
|---|---|---|
| **Steam Game Notes folder** | *(empty)* | The `…\userdata\<SteamUserID>\2371090\remote` folder that contains the `notes_<AppID>` files. Has **Browse** and **Auto-detect** buttons. |
| **Obsidian destination folder** | `Steam/Notes` | Where imported notes go, with one subfolder per game. Choose an existing folder, create a new one, or use the vault root. |
| **Steam note image destination** | `Steam/Notes/Images` | Where images are copied. You can pick any folder, create one, or use your Obsidian attachment folder. |
| **Import all Steam note images** | On | Copy every image in a game's `notes_<AppID>_images` folder, even ones no note references. Turn off to copy only referenced images. |
| **Resolve game names** | On | Look up the game's name from its AppID to name the folder. Turn off to use `Steam App <AppID>` and stay fully offline. |
| **Keep raw Steam source files** | On | Save a copy of each Steam source file as `.steam-source-<AppID>.txt` in the game's folder. |
 
---
 
## How it works
 
Steam keeps your notes in a local folder and syncs them to Steam Cloud. Community reports say this sync is separate from game save files. SteamyNotes reads the local `notes_<AppID>` files and never writes to that folder.
 
Steam's notes format isn't officially documented, so the parser is defensive. It tries JSON first, then Valve's KeyValues text format, and if neither works it imports the raw text as a single note so nothing is silently dropped.
 
### Formatting
 
Steam note bodies use BBCode-style tags. Currently converted:
 
| Steam | Markdown |
|---|---|
| Paragraphs (`[p]`) and line breaks (`[br]`) | Blank lines and newlines |
| Bold (`[b]`) and italic (`[i]`) | `**bold**` and `*italic*` |
| Images (`[cloudimg …]`) | `![[vault/path/to/image]]` |
 
Any other Steam formatting tag is currently left in the text as-is, so you may see raw tags for things like lists, links or underline. Better conversion is planned. If you find a tag that isn't converted, please open an issue and include the tag.
 
If a note refers to an image that isn't in the images folder, SteamyNotes leaves a comment in its place (`<!-- Steam image not imported: … -->`).
 
### Privacy
 
- SteamyNotes reads files from your Steam folder and writes files into your vault.
- With **Resolve game names** on, it also asks Steam's public store API (`store.steampowered.com/api/appdetails`) for each game's name. Only the **AppID** is sent, never your note content. Names are cached in the plugin's data file. Turn the setting off to avoid all network requests.
- Each note's `steam_source` frontmatter contains the **local path** of the Steam file, which includes your numeric Steam user ID. Remove that line before publishing or sharing notes.
---
 
## Troubleshooting
 
**"Set the Steam Game Notes folder in Settings first."**
Open Settings → SteamyNotes and set the folder (Auto-detect is the quickest way).
 
**"No notes_<gameid> files were found in that folder."**
The folder must be the one that directly contains files named `notes_<AppID>`, usually `…\userdata\<SteamUserID>\2371090\remote`. If you have several Steam accounts, make sure you picked the one you take notes with.
 
**Auto-detect finds nothing.**
It only checks default install locations. If Steam lives on another drive, use **Browse** or paste the path.
 
**Browse does nothing.**
The native folder picker isn't available in every Obsidian build. Paste the path into the text box instead.
 
**A folder is named `Steam App 12345`.**
The name lookup failed. You may be offline, Steam's store API may have declined the request, or the game may be delisted or a non-Steam shortcut. If a later pull succeeds in resolving the name, it creates a *new* game-named folder and leaves the old one. Delete the old folder once you've checked its contents.
 
**The notice says some files failed.**
Open the developer console (**Ctrl+Shift+I** / **Cmd+Opt+I**) and look for `SteamyNotes import failed` for details, and please include it in an issue.
 
**Steam shows empty notes for every game, or I see a cloud icon in the Notes window.**
This is a Steam-side sync problem, not a SteamyNotes problem. Several players have reported that a *cloud conflict* can make all notes appear blank, even though the notes were still intact in the local folder. **Run a pull first** to get a readable copy, then open a game with notes, press **Shift+Tab**, open **Notes**, click the **cloud icon** and compare the timestamps of the local and cloud versions. Players report that choosing the more recent version restores everything. This reportedly doesn't work while the **Big Picture overlay** is active (**Steam → Settings → In Game → "Use Big Picture overlay when using a controller"**).
 
**My latest edits are missing in Steam.**
Some players report recent note edits not being saved or synced reliably. Valve's beta notes in December 2024 mention improved save reliability, but reports have continued since. Pulling regularly gives you a safety net, but remember that each pull overwrites the previous copy.
 
**The plugin doesn't appear on mobile.**
SteamyNotes is desktop-only because it reads files from your Steam installation. The notes it imports are normal vault files and can be viewed on mobile if your vault syncs there.
 
---
 
## Roadmap
 
- [x] Pull notes from Steam, organized by game
- [x] Pull attached images and embed them
- [x] Game name lookup and optional raw source copy
- [x] Auto-detect for the Steam notes folder
- [ ] Push notes back to Steam *(in development, disabled)*
- [ ] Never overwrite a note edited in Obsidian; write a conflict copy instead
- [ ] Wider formatting conversion (lists, links, and more)
- [ ] Steam-compatible formatting check before pushing
- [ ] Multi-account support
- [ ] Community Plugins listing

 
---
 
## Community feedback that shaped this plugin
 
These Steam Community threads describe the problems above:
 
- [All Steam notes disappeared](https://steamcommunity.com/discussions/forum/1/601908674063081415): cloud conflict blanking notes for every game
- [Steam notes not saving](https://steamcommunity.com/discussions/forum/1/6679490218977026954/): edits lost when switching notes or relaunching
- [Steam Notes unreliable in keeping note contents](https://steamcommunity.com/groups/SteamClientBeta/discussions/0/6400272865046922307): bug report and the December 2024 beta note
- [Broken notes feature?](https://steamcommunity.com/discussions/forum/10/3951406499782450770): notes for one game became inaccessible
- [New Overlay and Notes — General Feedback](https://steamcommunity.com/groups/SteamClientBeta/discussions/3/3826413850813031019/): organization and UI feedback
- [Notes missing important features, such as checkboxes](https://steamcommunity.com/groups/SteamClientBeta/discussions/3/6861841362671827963): checklists and tables
- [Accessing and editing notes through the mobile app](https://steamcommunity.com/discussions/forum/10/3801650156479108336): no access outside the overlay
- [How to access notes when not in the game?](https://steamcommunity.com/groups/SteamClientBeta/discussions/3/3826414483644187709/): request for an "all notes" view
- [Expand "notes" feature](https://steamcommunity.com/discussions/forum/10/4031347296570621957/): images, drawing, export as Guide
- [Steam's note-taking feature (gHacks)](https://www.ghacks.net/2023/04/30/steams-note-taking-feature-is-quite-the-useful-addition/): overview, including the lack of import/export
---
 
 
## Disclaimer
 
SteamyNotes is an unofficial community plugin. It is not affiliated with, endorsed by, or sponsored by Valve Corporation or Obsidian. Steam and the Steam logo are trademarks of Valve Corporation. Steam's notes storage format is not officially documented, so a Steam client update could change how SteamyNotes behaves. Keep your own backups of anything important.
 
## License
 
[MIT](LICENSE) © pengd0t
 
