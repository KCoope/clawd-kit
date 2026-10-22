# Clawd for Claude Code

Clawd stands in the snow above your Claude Code prompt. When Claude is working he runs and jumps the trees, and if you click him he hops.

It comes with an orange-on-brown theme. In Windows Terminal and the VS Code terminal, the window also goes dark brown while Claude Code is open.

You need Claude Code installed first. Unzip this folder anywhere, then follow the steps for your computer.

## Mac

1. Open Terminal and go to the folder: type `cd `, drag the `clawd-kit` folder onto the window, and press Return.
2. Run `bash install.sh`.

## Windows

1. Open the `clawd-kit` folder in File Explorer, type `powershell` in its address bar, and press Enter.
2. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`.

That flag lets this one script run without changing any PowerShell setting. Using WSL or Git Bash instead? Run `bash install.sh` there.

## Linux

From the `clawd-kit` folder, run `bash install.sh`.

## Then

Open a new terminal tab, start Claude Code, run `/theme` and pick **Clawd**.

## Good to know

- Click Clawd to make him jump.
- `/clawd` hides him. Run it again to bring him back.
- After three quiet minutes he holds still, and your next prompt wakes him.
- The brown window only happens in Windows Terminal and the VS Code terminal, the two that put your own colour back when Claude Code closes. Other terminals keep their colour, and Clawd and the theme work the same. Set `CLAWD_WINDOW=1` to try it in another terminal, or `CLAWD_WINDOW=0` to switch it off.
- If you already have your own `claude` command (an alias or a function), the installer leaves it alone and skips the brown window.
- No Clawd? Run `claude update`, then start Claude Code again.

## About

Unofficial fan mod, not made or endorsed by Anthropic. Clawd is Anthropic's character. The code is MIT (see `LICENSE`); the character isn't covered.

## Removing him

Mac, Linux, WSL or Git Bash: `bash uninstall.sh`. Windows PowerShell: `powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1`. Each takes out only what its installer added.
