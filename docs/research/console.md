# Console: zsh line editing, history and browser limits

Research for Stage 1, read on 13 and 14 November 2026. The console is a purpose-built one-line command editor in the browser, not a terminal emulator. This document records the zsh behaviour worth reproducing (R7), what browsers take away, and how the editor should present itself to assistive technology.

## Sources and status words

| Key   | Source                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ZLE   | zsh manual, Zsh Line Editor: https://zsh.sourceforge.io/Doc/Release/Zsh-Line-Editor.html                                                                            |
| EXP   | zsh manual, History Expansion: https://zsh.sourceforge.io/Doc/Release/Expansion.html#History-Expansion                                                              |
| OPT   | zsh manual, Options: https://zsh.sourceforge.io/Doc/Release/Options.html                                                                                            |
| BLT   | zsh manual, Shell Builtin Commands: https://zsh.sourceforge.io/Doc/Release/Shell-Builtin-Commands.html                                                              |
| PAR   | zsh manual, Parameters: https://zsh.sourceforge.io/Doc/Release/Parameters.html                                                                                      |
| SRC   | zsh source on GitHub, read for behaviour only: https://github.com/zsh-users/zsh/blob/master/Src/ (files named in the text)                                          |
| BASH  | bash manual: https://www.gnu.org/software/bash/manual/bash.html                                                                                                     |
| CHR   | Chrome keyboard shortcuts: https://support.google.com/chrome/answer/157179                                                                                          |
| CRSRC | Chromium source, `BrowserCommandController::IsReservedCommandOrKey`: https://github.com/chromium/chromium/blob/main/chrome/browser/ui/browser_command_controller.cc |
| APPLE | Mac keyboard shortcuts: https://support.apple.com/en-us/102650                                                                                                      |
| LOCAL | A run of zsh 5.9 started with `zsh -f` (no rc files) during the research. Not a URL, so these claims are marked "observed".                                         |

"Confirmed" means read in the cited page. "Observed" means seen in the local zsh 5.9 run. "Not confirmed" means no source was found or a fetch failed. Nothing is copied from zsh beyond widget names, short manual quotations and prompt strings.

In the tables, Alt-x is what the zsh manual writes as `ESC-x`.

## 1. The emacs keymap

All bindings are confirmed in ZLE section 18.6 and agree with an observed `bindkey -M emacs` dump.

### Movement

| Key           | Widget              | Behaviour                                     |
| ------------- | ------------------- | --------------------------------------------- |
| Ctrl-A        | `beginning-of-line` | Start of line.                                |
| Ctrl-E        | `end-of-line`       | End of line.                                  |
| Ctrl-F, Right | `forward-char`      | One character forward.                        |
| Ctrl-B, Left  | `backward-char`     | One character back.                           |
| Alt-F         | `forward-word`      | "Move to the beginning of the next word."     |
| Alt-B         | `backward-word`     | "Move to the beginning of the previous word." |

zsh's `forward-word` goes to the start of the next word. bash and emacs go to the end of the current word ("Move forward to the end of the next word", BASH). zsh has the bash behaviour as a separate unbound widget, `emacs-forward-word`. The spec has to pick one. The brief says "like zsh", so the default should be zsh's.

### Deleting and killing

| Key               | Widget                 | Behaviour                                                                                |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| Ctrl-D            | `delete-char-or-list`  | Delete under the cursor. At the end of the line, list completions.                       |
| Ctrl-H, Backspace | `backward-delete-char` | Delete behind the cursor. Not a kill: nothing goes to the kill ring.                     |
| Ctrl-W            | `backward-kill-word`   | Kill the word behind the cursor.                                                         |
| Alt-Backspace     | `backward-kill-word`   | The same widget as Ctrl-W.                                                               |
| Alt-D             | `kill-word`            | Kill the current word.                                                                   |
| Ctrl-K            | `kill-line`            | Kill from the cursor to the end of the line.                                             |
| Ctrl-U            | `kill-whole-line`      | Kill the whole line, both sides of the cursor. bash's Ctrl-U kills backward only (BASH). |
| Delete            | none by default        | `delete-char` exists but is unbound (observed). The console should bind it anyway.       |

Ctrl-D on an empty line is end-of-file in zsh, handled outside the keymap (SRC `Zle/zle_main.c`). The console has nothing to exit, so on an empty line it should do nothing.

In bash, Ctrl-W uses white space as the boundary and Alt-Backspace uses letters and digits, so the two keys differ. In zsh they are one widget with one rule (section 2).

### Yank, transpose, case, undo

| Key                              | Widget                                              | Behaviour                                                                                                            |
| -------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Ctrl-Y                           | `yank`                                              | Insert the kill buffer at the cursor.                                                                                |
| Alt-Y                            | `yank-pop`                                          | Replace the text just yanked with the next ring entry. "Only works following yank" or another yank-pop.              |
| Ctrl-T                           | `transpose-chars`                                   | Swap the two characters before the cursor at end of line, otherwise the one under the cursor with the one before it. |
| Alt-T                            | `transpose-words`                                   | Swap the current word with the one before it.                                                                        |
| Alt-U, Alt-L, Alt-C              | `up-case-word`, `down-case-word`, `capitalize-word` | Change the case of the current word and move past it.                                                                |
| Ctrl-\_, Ctrl-X u, Ctrl-X Ctrl-U | `undo`                                              | "Incrementally undo the last text modification."                                                                     |
| unbound                          | `redo`                                              | Exists, but has no emacs binding.                                                                                    |

### History and search

| Key              | Widget                                | Behaviour                                                                                                       |
| ---------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Ctrl-P, Up       | `up-line-or-history`                  | Previous event (the console has one line).                                                                      |
| Ctrl-N, Down     | `down-line-or-history`                | Next event.                                                                                                     |
| Alt-<            | `beginning-of-buffer-or-history`      | First event in the list.                                                                                        |
| Alt->            | `end-of-buffer-or-history`            | Last event.                                                                                                     |
| Alt-P, Alt-N     | `history-search-backward`, `-forward` | Search for a line "beginning with the first word in the buffer". The first word, not the text up to the cursor. |
| Alt-.            | `insert-last-word`                    | Insert the last word of the previous event. Repeating it walks further back.                                    |
| Ctrl-O           | `accept-line-and-down-history`        | Run the line and load the next event. Good for replaying a run of commands.                                     |
| Alt-Space, Alt-! | `expand-history`                      | Expand history references in the buffer without running it.                                                     |
| Ctrl-R           | `history-incremental-search-backward` | See section 5.                                                                                                  |
| Ctrl-S           | `history-incremental-search-forward`  | In a terminal this is usually swallowed by flow control. A browser has no tty, so it is available.              |

### Other

| Key           | Widget               | Behaviour                                                                                     |
| ------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| Enter, Ctrl-J | `accept-line`        | Run the line.                                                                                 |
| Tab           | `expand-or-complete` | Complete. See section 9 for the keyboard-trap problem.                                        |
| Ctrl-L        | `clear-screen`       | Clear the screen and keep the line.                                                           |
| Ctrl-G        | `send-break`         | Abort the current editor function or the line.                                                |
| Ctrl-Q, Alt-Q | `push-line`          | Park the half-typed line, run one other command, and get the parked line back.                |
| Alt-H         | `run-help`           | Push the line, show help for the command being typed. A good model for console help.          |
| Ctrl-C        | not a widget         | The tty turns it into an interrupt. The line is abandoned (observed: absent from the keymap). |
| Ctrl-X Ctrl-E | unbound              | Opening an editor is bash's default, not zsh's (observed, and BASH).                          |

Leave out: the mark and region widgets (Ctrl-@, Ctrl-X Ctrl-X, Alt-W), numeric arguments (Alt-0 to Alt-9), `quoted-insert` (Ctrl-V is paste on Windows and Linux), `overwrite-mode`, `execute-named-cmd` and `vi-cmd-mode`.

zsh treats Esc then a key as Alt plus that key, after a wait of `KEYTIMEOUT` (0.4 s by default, ZLE 18.2.1). Section 8 explains why the console should not copy this.

## 2. Word boundaries

Confirmed: "The editor's idea of a word is specified with the WORDCHARS parameter" (ZLE 18.6.1), and WORDCHARS is "A list of non-alphanumeric characters considered part of a word by the line editor" (PAR). A word is a run of letters, digits and WORDCHARS characters.

The manual does not print the default. The source does: `*?_-.[]~=/&;!#$%^(){}<>` (SRC `zsh.h`, and observed). Space, comma, colon and plus are not in it. `backward-kill-word` skips back over non-word characters, then over word characters, and kills that span (SRC `Zle/zle_word.c`).

Recommendation for the console: WORDCHARS of `-_`. The tokens look like `a0`, `g3`, `scene 4`, `set-max-level` and `0x1F`. With the hyphen as a word character, a kebab-case command name is one word, which is how a person thinks of it. Everything else is a boundary, so `a0,a1` or `level=128` can be edited a part at a time. Keep it as one constant in the editor core. If the address syntax in Stage 2 uses a hyphen for ranges (`a0-a5`), revisit it, because the range would then be one word.

## 3. The kill ring

Confirmed (ZLE 18.4 and 18.5):

- `CUTBUFFER` holds the last kill, which is what the next yank inserts.
- `killring` holds earlier kills, most recent first. "The default size for the kill ring is eight." There is no `KILLRINGMAX` parameter in zsh.
- "When repeatedly invoking a kill widget, text is appended to the cutbuffer instead of replacing it."

From the source (SRC `Zle/zle_utils.c`, `cuttext`):

- If the previous command was not a kill, the current CUTBUFFER moves onto the ring and a new one starts. If it was a kill, the new text joins the existing buffer.
- Backward kills prepend and forward kills append, so the buffer always reads in the original order. Three presses of Ctrl-W over `one two three` leave `one two three`, not the reverse.
- Any other command in between, including a cursor move, breaks the chain.
- `backward-delete-char` and `delete-char` never touch the ring.

Model for the editor core: `cutBuffer`, a `killRing` of up to eight strings, a flag for "the last command was a kill", and for `yank-pop` a flag for "the last command was a yank" with the range just inserted. `yank-pop` after anything else does nothing. Keep the ring in memory and apart from the system clipboard: reading the clipboard needs a permission prompt, and mixing the two surprises people.

## 4. Undo

The manual says only "Incrementally undo the last text modification". The source shows what a step is (SRC `Zle/zle_main.c` and `zle_utils.c`): after every widget, zle records the difference as one change. In emacs mode each keystroke is its own undo step. Typing `scene` and pressing Ctrl-\_ five times removes one letter at a time. A word kill is one step.

Each change remembers which history line it was made on. If undo meets a change from a different history line than the one showing, it first switches back to that line, and that counts as the step. Type `abc`, press Up, press Ctrl-\_: the `abc` line returns. Press it again and the `c` goes. The undo list is reset when a line is accepted.

Recommendation: copy the model (a linear list of changes, each tagged with its history index, redo cleared by a new edit), but group a run of typed characters into one step, broken at a space or by any other command. Letter-at-a-time undo is accurate and tedious. Give `redo` a binding, since zsh leaves it unbound. Map the platform's own undo keys (Cmd-Z, and Ctrl-Z on Windows and Linux) to the same undo, so there is one history.

## 5. Incremental search

Confirmed (ZLE 18.6.2):

- "The search is case-insensitive if the search string does not have uppercase letters and no numeric argument was given."
- "The string may begin with '^' to anchor the search to the beginning of the line."
- It matches a plain substring. Pattern search is a separate, unbound pair of widgets.
- Enter runs the found line at once.
- Ctrl-R again finds the next older match. With an empty search string it brings back the last search string.
- Backspace backs up "one place in the search history", which may undo a Ctrl-R step and not a typed character.
- Ctrl-S reverses direction.
- Ctrl-G aborts and returns to the original line. So does an interrupt.
- Any other key ends the search, keeps the found line, and then acts. Left, Right, Ctrl-A and Ctrl-E accept the line without running it.

The prompt text is not in the manual. From the source (SRC `Zle/zle_hist.c`) the status line, drawn under the command line, reads `bck-i-search: sce_`, `fwd-i-search: sce_` or `failing bck-i-search: scx_`. bash's `(reverse-i-search)` prompt is different and should not be mixed in.

Also from the source: with a match, the buffer shows the whole history line with the cursor at the start of the match. A repeat that finds nothing keeps the last match and adds `failing`. A line identical to the one showing is skipped, and `HIST_FIND_NO_DUPS` extends that to duplicates further apart (OPT).

One deliberate difference: in zsh a bare Esc is "any other key" and accepts the found line. On the web Esc means cancel. The console should treat Esc, Ctrl-G and Ctrl-C alike: abort and restore the original line.

## 6. History expansion

All confirmed in EXP unless marked.

### When it happens

- A reference "begins with the first character of the histchars parameter, which is '!' by default, and may occur anywhere on the command line, including inside double quotes (but not inside single quotes '...' or C-style quotes $'...' nor when escaped with a backslash)."
- `!` starts an expansion "except when followed by a blank, newline, '=' or '('".
- "Input lines containing history expansions are echoed after being expanded, but before any other expansions take place and before the command is executed. It is this expanded form that is recorded as the history event."
- "History expansions do not nest."
- Events are numbered "beginning with 1 (one) when the shell starts up".

### Forms

| Form             | Meaning                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `!!`             | The previous command.                                                                                           |
| `!n`             | Command number n.                                                                                               |
| `!-n`            | The command n back from the current one.                                                                        |
| `!str`           | The most recent command starting with str.                                                                      |
| `!?str[?]`       | The most recent command containing str. The closing `?` is needed if anything follows.                          |
| `!$`, `!^`, `!*` | Last argument, first argument, all arguments of the previous command.                                           |
| `:s/l/r/`        | Replace the first l with r. `:gs/l/r/` replaces all. `:&` repeats the last substitution. l is a literal string. |
| `:p`             | "Print the new command but do not execute it."                                                                  |
| `^old^new[^]`    | "repeats the last command, replacing the string foo with bar". The same as `!!:s^old^new^`. First match only.   |

### Errors and side effects (observed on zsh 5.9)

| Input                                 | Message                        |
| ------------------------------------- | ------------------------------ |
| `!nosuch` (no command starts with it) | `zsh: event not found: nosuch` |
| `!?zzz?` (no command contains it)     | `zsh: no such event: zzz`      |
| `!99` (no such number)                | `zsh: no such event: 99`       |
| `^nomatch^x` (left side not found)    | `zsh: substitution failed`     |

A line whose expansion fails is not run and is not added to history. `!!:p` prints the expansion, does not run it, and does add it to history, so a following `!!` runs it.

### What to copy

Copy:

- The five event forms in R7, `^old^new`, and `!$`, `!^` and `!*`. "Same again on address 5" and "same arguments, different command" are the natural moves on a lighting bench.
- `:p`. On a console that drives real lights, "show me and do not send" is a safety feature.
- `:s`, `:gs` and `:&`, which `^old^new` needs anyway.
- The exclusion rules: no expansion when `!` is followed by a blank, the end of the line, `=` or `(`, and `\!` gives a literal `!`.
- Record the expanded line in history, echo it before it runs, and neither run nor store a line whose expansion failed.
- The error texts, with the app's name in place of `zsh:`.

Leave out: `!#`, `!{...}`, the `%` designator, word ranges, the file path modifiers (`:h :t :r :e :a :A :c :P`), the quoting modifiers (`:q :Q :x`), `!"` and changing `histchars`. Each adds parser and test work for little use with commands of two or three words.

One rule of our own: history expansion applies only to lines typed at the prompt. It never applies to scripts, sequences or imported text, which are untrusted data. An expanded line then goes through the normal parser and the governor like any other. Expansion is a text rewrite before parsing and nothing more.

## 7. History options and the `history` builtin

### Options (OPT 16.2.4)

| Option                 | What the manual says                                                                                                 | For the console                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `HIST_VERIFY`          | "don't execute the line directly; instead, perform history expansion and reload the line into the editing buffer."   | On by default, as a preference. zsh has it off. With lights on the bus, `!!` should show what it will send and wait for a second Enter. |
| `HIST_IGNORE_DUPS`     | Do not add a line that duplicates the previous event.                                                                | On by default.                                                                                                                          |
| `HIST_IGNORE_ALL_DUPS` | Remove an older duplicate from anywhere in the list.                                                                 | Off by default. It destroys the order of events, and leaves gaps in the numbering (observed).                                           |
| `HIST_IGNORE_SPACE`    | Drop lines that start with a space. "the command lingers in the internal history until the next command is entered". | Yes, as the optional rule in the stage plan. Copy the lingering, so Up recalls the line once.                                           |
| `HIST_REDUCE_BLANKS`   | "Remove superfluous blanks from each command line being added to the history list."                                  | Yes. It makes duplicate detection work. Revisit if the grammar gains quoted strings (`pause "message"` has one).                        |
| `HIST_FIND_NO_DUPS`    | Do not show duplicates of a line already found during a search.                                                      | Yes, for Ctrl-R and Alt-P.                                                                                                              |
| `HIST_NO_STORE`        | Remove the `history` command itself from the list.                                                                   | Yes.                                                                                                                                    |
| `INC_APPEND_HISTORY`   | Lines are added to the file "as soon as they are entered".                                                           | Yes. A tab can close without warning.                                                                                                   |
| `SHARE_HISTORY`        | Import other sessions' lines as they appear.                                                                         | No. See "Two tabs".                                                                                                                     |
| `EXTENDED_HISTORY`     | Save each command's start time.                                                                                      | Store a timestamp per entry so `history -i` can work.                                                                                   |
| `BANG_HIST`            | "Perform textual history expansion, csh-style".                                                                      | A preference, on by default.                                                                                                            |

`HISTSIZE` is the in-memory limit and `SAVEHIST` the saved limit (PAR). Stock zsh starts with `HISTSIZE=30` and `SAVEHIST=0` (observed), so it saves nothing. One preference, default 1000, can serve as both.

### The builtin (BLT)

- `history` is "Same as fc -l".
- Without arguments it lists the last 16 events ("-16 if the -l flag is given").
- `history 1` lists everything. `history -20` lists the last 20. `history 10 20` lists that range.
- `-n` drops the numbers, `-r` reverses, `-i` adds ISO timestamps, `-m pattern` filters by a glob over the whole line.
- Output (observed): the event number right-aligned in five characters, two spaces, then the command.

zsh has no `history -c`. It prints `history: bad option: -c` (observed). The flag is bash's: "Clear the history list" (BASH). The stage plan asks for `history -c`, which is the right choice, because zsh's nearest thing (`fc -p`) pushes a new list onto a stack and makes no sense here. Record it as a deliberate bash feature in a zsh-flavoured console. It should clear the stored copy too, and since that destroys data it should ask first.

### Event numbers (observed)

- With `HIST_IGNORE_DUPS` a dropped duplicate uses no number. Numbers stay contiguous.
- Trimming at the size limit drops the oldest events. Their numbers are not reused, and `!1` then fails.
- Lines removed by `HIST_NO_STORE` or `HIST_IGNORE_SPACE` give their number to the next command.

So numbers only grow within a session and are never reassigned. The console should keep them fixed for the life of the page and renumber from 1 when it loads stored history, as zsh does when it reads its file.

### Two tabs

These are recommendations, not zsh facts. Each tab should write a line to storage as soon as it is accepted, and merge with what is stored before writing so that neither tab overwrites the other. Up and Down in a tab should walk that tab's own lines plus what was stored when it opened. Lines from another tab appearing under the Up key mid-task is the known annoyance of `SHARE_HISTORY`, and the zsh manual itself suggests turning it off for more control.

Stored history is untrusted when read back: limit its size, check its shape, and never run anything from it on load. Two tabs holding one WebHID device is a larger problem than history, and belongs in the architecture document.

Not confirmed: the mechanism. The `storage` event and the Web Locks API were noted from memory and not fetched. Stage 5 uses IndexedDB, where a read-merge-write inside one transaction does the same job.

## 8. Browser limits

### What browsers bind

Confirmed from CHR for Chrome on Windows and Linux. These clash with the emacs keymap:

| Key            | Chrome action                | zsh widget                                     |
| -------------- | ---------------------------- | ---------------------------------------------- |
| Ctrl-W         | Close the current tab        | `backward-kill-word`                           |
| Ctrl-N         | Open a new window            | `down-line-or-history`                         |
| Ctrl-T         | Open a new tab               | `transpose-chars`                              |
| Ctrl-R         | Reload                       | `history-incremental-search-backward`          |
| Ctrl-P         | Print                        | `up-line-or-history`                           |
| Ctrl-D         | Bookmark                     | `delete-char-or-list`                          |
| Ctrl-K, Ctrl-E | Search from the address bar  | `kill-line`, `end-of-line`                     |
| Ctrl-L, Alt-D  | Jump to the address bar      | `clear-screen`, `kill-word`                    |
| Ctrl-U         | View source                  | `kill-whole-line`                              |
| Ctrl-F, Ctrl-G | Find, find next              | `forward-char`, `send-break`                   |
| Ctrl-H, Ctrl-J | History page, downloads page | `backward-delete-char`, `accept-line`          |
| Ctrl-S, Ctrl-O | Save page, open file         | forward search, `accept-line-and-down-history` |
| Alt-F          | Open the Chrome menu         | `forward-word`                                 |

On a Mac the same page lists the Cmd forms (Cmd-W, Cmd-N, Cmd-T, Cmd-R and so on). Browser commands on macOS do not use Ctrl, so on a Mac the whole Ctrl-letter set is free. The clash is a Windows and Linux problem.

### What a page cannot stop

Confirmed from CRSRC: Chromium sends most shortcuts to the page first and runs the browser command only if the page did not call `preventDefault()` on the keydown. A small set of commands is reserved, and the browser acts on those first. The function has three exceptions:

- "In Apps mode, no keys are reserved." An installed app window, or one started with `--app=`, gets every key.
- In fullscreen, all commands except leaving fullscreen go to the page.
- On Linux, a key the user has registered as a text editing hotkey is not reserved.

Not confirmed: the exact reserved list, which lives in a file the research did not reach. The expected set is close tab, close window, new tab, new window, new incognito window, reopen closed tab, next and previous tab, and exit. In keys: Ctrl-W, Ctrl-N, Ctrl-T, their Shift forms, and Ctrl-Tab.

Also not confirmed: that each other shortcut in the table can be cancelled, key by key. It follows from the design and matches how web editors behave, but the test plan should prove it with a Playwright matrix in Chromium. Firefox, Safari and Edge were not checked at all (the Firefox page failed to load). The simulator runs in those browsers, so their behaviour matters for the console even though hardware does not.

### macOS text fields and the Option key

Confirmed from APPLE: standard text fields on macOS already handle Control-A, E, F, B, P, N, H, D, K, T, O and L, and Option-Delete. They differ from zsh. Control-K and Control-Y use a private one-slot clipboard with no ring. Control-P and Control-N move by line. There is no Control-W, Control-U or Control-R on Apple's list. The console must handle every key itself and call `preventDefault()`, or the native action and the console's will both run and the kill ring will be split across two stores.

Option plus a letter types a character on macOS (Option-F gives `ƒ`), and some are dead keys. So `event.key` cannot identify Alt bindings on a Mac. `KeyboardEvent.code` "represents a physical key on the keyboard", unaffected by layout or modifiers (https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code). The cost is that bindings become positional: `KeyQ` is the A key on an AZERTY keyboard.

Recommendation: match Alt bindings on `altKey` and `code`, and Ctrl bindings on `key`. Never bind Ctrl-Alt, because AltGr reports as Ctrl plus Alt on Windows (not confirmed by a fetched source) and several European layouts need it for characters the grammar uses.

### Key by key

"Mac" is any browser on macOS. "Windows and Linux" is Chrome or Edge in a normal tab.

| Key                                    | Mac                                     | Windows and Linux                             | Decision                                                                                                                         |
| -------------------------------------- | --------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Ctrl-W                                 | free                                    | closes the tab, cannot be stopped             | Alt-Backspace is the main key for `backward-kill-word` everywhere. Add Ctrl-Backspace. Ctrl-W works on Mac and in an app window. |
| Ctrl-N                                 | free                                    | new window, cannot be stopped                 | Use Down.                                                                                                                        |
| Ctrl-T                                 | free                                    | new tab, cannot be stopped                    | `transpose-chars` on Mac and in an app window only. A small loss.                                                                |
| Ctrl-R                                 | free                                    | reload, can be stopped                        | Bind it. If focus is elsewhere the page reloads, so history must already be saved and a reload must leave the lights safe.       |
| Ctrl-P, D, K, E, L, U, H, S, O         | free                                    | can be stopped                                | Bind them while the console has focus.                                                                                           |
| Ctrl-F, Ctrl-G                         | free                                    | find, can be stopped                          | Bind only while the console has focus. Find stays the browser's everywhere else.                                                 |
| Ctrl-A                                 | free                                    | select all                                    | Follow zsh (start of line), keep Home as the plain key, and say so in the legend.                                                |
| Ctrl-Y                                 | free                                    | redo in text fields                           | `yank`.                                                                                                                          |
| Ctrl-C                                 | free (Cmd-C copies)                     | copy                                          | With a selection, let copy happen. With none, abandon the line and stop any running script. Never block copy.                    |
| Ctrl-V, Ctrl-X, Ctrl-Z                 | free                                    | paste, cut, undo                              | Leave paste and cut to the platform. Route undo to the console's undo. No Ctrl-X prefix bindings.                                |
| Alt-F, Alt-B, Alt-D and other Alt keys | types a symbol unless matched by `code` | menu or address bar, can be stopped in Chrome | Bind by `code`. Also bind the platform's word keys (Ctrl-Left and Ctrl-Right, Option-Left and Option-Right).                     |
| Cmd-anything                           | the browser's                           | n/a                                           | Never bind Cmd.                                                                                                                  |

### Workarounds, most useful first

1. Give every reserved key a second binding that works everywhere, so nothing important depends on a key the browser may take.
2. Scope by focus. One keydown listener on the console element, not on the window. Outside the console every browser shortcut behaves as usual. Panic is the one global shortcut, and it needs a key that no browser or system reserves.
3. An on-screen key legend, and `help keys`, generated from the same binding table the handler uses, showing what works on this platform.
4. A `beforeunload` guard for a stray Ctrl-W. MDN (https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event) says to listen only while there is something to lose and to remove the listener afterwards, that the dialog text is the browser's own, and that the event "is not reliably fired". Add it while a line is half typed, a script or sequence is running, or the hasseb is connected. It must never be the safety mechanism: closing the tab has to leave the bus safe anyway.
5. An installed app window. Chromium reserves no keys in app mode, so a web app manifest, or starting Chrome with `--app=http://127.0.0.1:47821`, gives Ctrl-W, Ctrl-N and Ctrl-T back. It costs a manifest and icons and no dependency. Offer it in the README as an option. A service worker would need its own security review and is not needed for this.

Not recommended: the Keyboard Lock API (fullscreen only, a draft at https://wicg.github.io/keyboard-lock/, and marked limited availability by MDN), Esc as a Meta prefix (Esc is the web's cancel key, and section 9 needs it), and a browser extension.

## 9. Accessibility

### The line is a real input

MDN on the textbox role: "Whenever possible, rather than using this role, use an `<input>` element with type="text"" (https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/textbox_role).

Recommendation: a real single-line `<input type="text">`, driven by the editor core. On a handled keydown: `preventDefault()`, apply the widget to the core's text and cursor, then write `input.value` and call `setSelectionRange()`. For ordinary typing, IME composition, dictation and paste, do the reverse: let the browser edit the input and read the result back on the `input` event, treating it as an insertion. Ignore keydowns while `event.isComposing` is true.

This keeps screen readers, braille displays, voice control and IMEs working with no extra code. It also fits the security rules, since only `.value` and text nodes are written. The cost is that parts of the line cannot be coloured. Show errors and the search status in a line under the input, which is where zsh draws its minibuffer anyway.

`contenteditable` brings browser-specific DOM changes and pasted markup, and more room for injection mistakes. A custom-drawn line has to rebuild the caret, selection, IME and the accessibility interface by hand. Neither is worth it here.

### Output is a log

MDN on the log role: it "creates a live region where new information is added in a meaningful order and old information may disappear", with an implicit polite `aria-live`, and "The log is required to have an accessible name" (https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/log_role).

- The scrollback is one element with `role="log"` and a name. Append each command and reply as a new element. Do not re-render the whole log, or it is all read again.
- Keep the high-rate bus monitor out of the live region. A polite region that never goes idle either floods the listener or never speaks.
- Keep `role="alert"` for safety events: panic, and a refusal by the governor.
- A small status element under the input announces the search prompt and completion lists.
- Do not rely on colour alone to tell commands, replies and errors apart. Prefix them.
- zsh's beep becomes a brief visual cue.

### Tab

WCAG 2.1.2 No Keyboard Trap, Level A: "If keyboard focus can be moved to a component of the page using a keyboard interface, then focus can be moved away from that component using only a keyboard interface, and, if it requires more than unmodified arrow or tab keys or other standard exit methods, the user is advised of the method for moving focus away." (https://www.w3.org/WAI/WCAG21/Understanding/no-keyboard-trap.html)

zsh binds Tab to completion. If the console takes every Tab, focus can never leave it by keyboard. The answer, in three parts:

1. Take Tab only when there is something to complete: the cursor is at the end of a non-empty word that has at least one completion. On an empty line Tab moves focus as usual. Shift-Tab is never taken.
2. Esc releases the console. If a search or completion list is open, the first Esc closes that and the second releases.
3. Say so in the key legend and in the input's description.

The panic button is a real `<button>` outside the console, always reachable by Tab, and its shortcut must pass through the console's key handler.

## Decisions for Stage 2

| Question                                                        | Recommendation                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `forward-word`: zsh (start of next word) or bash (end of word)? | zsh.                                                                         |
| WORDCHARS                                                       | `-_`, revisited once the address syntax is fixed.                            |
| Undo granularity                                                | Group typed runs. A departure from zsh.                                      |
| Esc in search                                                   | Cancel. A departure from zsh.                                                |
| Verify mode                                                     | On by default. zsh has it off.                                               |
| `history -c`                                                    | Keep it, as a bash feature, clearing the stored copy, behind a confirmation. |
| Shared history between tabs                                     | Append and merge, but do not import mid-session.                             |
| Tab                                                             | Complete only when there is something to complete. Esc releases.             |
| Ctrl-W on Windows and Linux                                     | Alt-Backspace and Ctrl-Backspace as the main keys. Offer the app window.     |

## Not confirmed

- Chromium's exact reserved command list, and that every other shortcut can be cancelled. Needs an e2e matrix.
- Everything specific to Firefox, Safari and Edge.
- That `preventDefault()` on keydown stops macOS dead-key composition.
- AltGr reporting as Ctrl plus Alt on Windows.
- Installed app details: what Ctrl-W does in an app window when the page ignores it, and Safari's and Firefox's equivalents.
- That `^old^new` is recognised only at the start of a line (true of csh-style shells, not quoted from the manual).
- `yank-pop` rotation when the ring has empty slots.
- `HIST_VERIFY` is quoted from the manual and was not exercised.
