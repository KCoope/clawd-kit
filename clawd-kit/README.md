# Clawd for Claude Code

Clawd stands in the snow above your Claude Code prompt. When Claude is working he runs along and jumps what's in his way, and if you click him he hops and sends up a heart.

There are two of him to pick from. The orange Clawd jumps trees on a dark brown window, and the small blue one hops snow-capped mountains on navy. The installer asks which you want, and each comes with a theme to match. The window colour shows in Windows Terminal and the VS Code terminal.

You need Claude Code installed first. Unzip this folder anywhere, then follow the steps for your computer.

## Mac

1. Open Terminal and go to the folder: type `cd `, drag the `clawd-kit` folder onto the window, and press Return.
2. Run `bash install.sh` and type 1 or 2 to pick a Clawd.

## Windows

1. Open the `clawd-kit` folder in File Explorer, type `powershell` in its address bar, and press Enter.
2. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1` and type 1 or 2 to pick a Clawd.

That flag lets this one script run without changing any PowerShell setting. Using WSL or Git Bash instead? Run `bash install.sh` there.

## Linux

From the `clawd-kit` folder, run `bash install.sh` and type 1 or 2 to pick a Clawd.

## Then

Open a new terminal tab, type `claude` to start Claude Code, run `/theme` and pick **Clawd**, or **Clawd Blue** for the blue one.

Clawd only shows in Claude Code running in a terminal. In VS Code that means its terminal (**View**, then **Terminal**), not the Claude Code extension's chat panel, which shows neither him nor the theme. To make the extension open in the terminal instead, turn on **Claude Code: Use Terminal** in VS Code's settings.

## Good to know

- Click Clawd to make him jump. If a click only selects text, run `/tui fullscreen`: in fullscreen mode Claude Code gets the mouse, so the click reaches him.
- `/clawd` hides him. Run it again to bring him back.
- After three quiet minutes he curls up for a nap while the snow keeps falling. A click or your next prompt wakes him.
- To switch Clawds, run the installer again and pick the other one, or name him at the end: `bash install.sh blue`, or on Windows `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 blue`.
- The window colour only shows in Windows Terminal and the VS Code terminal, the two that put your own colour back when Claude Code closes. Other terminals keep their colour, and Clawd and the theme work the same. Set `CLAWD_WINDOW=1` to try it in another terminal, or `CLAWD_WINDOW=0` to switch it off.
- If you already have your own `claude` command (an alias or a function), the installer leaves it alone and skips the window colour.
- No Clawd? Run `claude update`, then start Claude Code again.

## About

Unofficial fan mod, not made or endorsed by Anthropic. Clawd is Anthropic's character. The code is MIT (see `LICENSE`); the character isn't covered.

## Removing him

Mac, Linux, WSL or Git Bash: `bash uninstall.sh`. Windows PowerShell: `powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1`. Each takes out only what its installer added.
