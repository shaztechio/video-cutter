# Installing FFmpeg

This application requires [FFmpeg](https://ffmpeg.org/) to be installed on your system and available in your `PATH`.

---

## macOS

### Option 1: Homebrew (Recommended)

If you don't have Homebrew, install it first:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install FFmpeg:

```bash
brew install ffmpeg
```

### Option 2: MacPorts

```bash
sudo port install ffmpeg
```

---

## Windows

### Option 1: winget (Recommended, Windows 10+)

```powershell
winget install Gyan.FFmpeg
```

### Option 2: Chocolatey

```powershell
choco install ffmpeg
```

### Option 3: Scoop

```powershell
scoop install ffmpeg
```

### Option 4: Manual Install

1. Download the latest release from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) — choose the **ffmpeg-release-essentials.zip** build.
2. Extract the archive to a permanent location, e.g. `C:\ffmpeg`.
3. Add `C:\ffmpeg\bin` to your system `PATH`:
   - Open **Start** → search for **"Environment Variables"**.
   - Under **System variables**, select **Path** → click **Edit**.
   - Click **New** and add `C:\ffmpeg\bin`.
   - Click **OK** to save.
4. Open a new terminal and verify with `ffmpeg -version`.

---

## Linux

### Debian / Ubuntu

```bash
sudo apt update
sudo apt install ffmpeg
```

### Fedora

```bash
sudo dnf install ffmpeg-free
```

For the full (non-free codecs) build via RPM Fusion:

```bash
sudo dnf install \
  https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm \
  https://download1.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-$(rpm -E %fedora).noarch.rpm
sudo dnf install ffmpeg
```

### Arch Linux

```bash
sudo pacman -S ffmpeg
```

### openSUSE

```bash
sudo zypper install ffmpeg
```

### Snap (Any distro with Snap support)

```bash
sudo snap install ffmpeg
```

---

## Verifying the Installation

After installing, open a **new** terminal window and run:

```bash
ffmpeg -version
```

You should see version and build information printed to the console. If you get a "command not found" error, FFmpeg is either not installed or not in your `PATH` — revisit the steps above.

## Troubleshooting

### "command not found" after installing

- **macOS/Linux:** Make sure your shell profile (`.zshrc`, `.bashrc`, etc.) includes the path where FFmpeg was installed. Restart your terminal or run `source ~/.zshrc` (or equivalent).
- **Windows:** Ensure you added the `bin` directory (not just the root folder) to your `PATH`, and that you opened a **new** terminal after making the change.

### Node.js can't find FFmpeg at runtime

Some Node.js libraries (e.g. `fluent-ffmpeg`) look for FFmpeg using the system `PATH`. If you installed FFmpeg to a non-standard location, you can point to it explicitly:

```js
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath('/path/to/ffmpeg');
ffmpeg.setFfprobePath('/path/to/ffprobe');
```

Alternatively, set the environment variable before running your app:

```bash
export FFMPEG_PATH=/path/to/ffmpeg
```

### Version too old

Some distributions ship older FFmpeg versions. If you need a newer release, consider building from source via the [official compilation guide](https://trac.ffmpeg.org/wiki/CompilationGuide) or using a static build from [John Van Sickle's site](https://johnvansickle.com/ffmpeg/) (Linux only).
