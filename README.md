# Video Cutter

[![CI](https://github.com/shaztechio/video-cutter/actions/workflows/ci.yml/badge.svg)](https://github.com/shaztechio/video-cutter/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@shaztech/video-cutter.svg)](https://www.npmjs.com/package/@shaztech/video-cutter)

A CLI tool to cut a video file into segments using ffmpeg — by equal count, fixed duration, specific timecodes, or automatic scene change detection.

## Prerequisites

- Node.js
- ffmpeg (must be installed and available in PATH — see [INSTALLING_FFMPEG.md](INSTALLING_FFMPEG.md) for instructions)

## Installation

### From NPM

```bash
npm install -g @shaztech/video-cutter
```

### From Source

```bash
# Clone or download the repository
npm install
```

## Usage

```bash
video-cutter [options]
```

Options:
```text
  -V, --version                  output the version number
  -i, --input <path>             input video file path
  -n, --segments <number>        number of segments to create
  -d, --duration <seconds>       duration of each segment in seconds
  --scene-detect [threshold]     cut at scene change boundaries (threshold
                                 0–100, default: 10)
  -t, --timecodes <timecodes>    cut at specified timecodes (CSV, see formats
                                 below)
  -o, --output <path>            output directory for segments (default:
                                 ./output/YYYY-MM-DD_HH-MM-SS/)
  --verify                       verify that each segment matches its intended
                                 duration
  --re-encode                    re-encode segments for exact duration (slower
                                 but more accurate)
  -h, --help                     display help for command
```

## Examples

### Cut a video into 10 equal segments:

```bash
video-cutter -i my_video.mp4 -n 10
```

This will create files named `segment_001.mp4`, `segment_002.mp4`, etc. in the default timestamped output directory like `./output/2023-01-01_12-00-00/`.

### Cut a video into 30-second segments:

```bash
video-cutter -i my_video.mp4 -d 30
```

This will create files named `seg_01_00-00-00.mp4`, `seg_02_00-00-30.mp4`, etc. in the default timestamped output directory.

**Note:** When using the `-d` flag without `--re-encode`, segment durations may not be exactly as specified due to keyframe alignment when stream copying. For exact durations, use the `--re-encode` flag.

### Cut a video at specific timecodes:

```bash
video-cutter -i my_video.mp4 -t "00:00:10,00:00:30,00:01:00"
```

This cuts the video at 10s, 30s, and 1 minute, producing 4 segments that cover the full video:

```
tc_001_00-00-00.000.mp4   # 0s → 10s
tc_002_00-00-10.000.mp4   # 10s → 30s
tc_003_00-00-30.000.mp4   # 30s → 1m
tc_004_00-01-00.000.mp4   # 1m → end
```

Filenames include a sequence number and the segment's start timecode, so they sort correctly in any file browser.

#### Supported timecode formats

All formats can be mixed freely in a single `-t` value:

| Format | Example | Description |
|--------|---------|-------------|
| `HH:MM:SS` | `00:01:30` | Hours, minutes, seconds |
| `HH:MM:SS.nnn` | `00:01:30.500` | With milliseconds |
| `Ns` | `90s` | Seconds only |
| `N.Ns` | `90.5s` | Seconds with decimal |
| `NhNmNs` | `1h30m0s` | Hours, minutes, seconds with suffixes |
| `NhNmN.Ns` | `0h1m30.5s` | With decimal seconds |

The `h` and `m` components are optional — `5m30s` and `90s` are both valid.

**Note:** Timecodes must be in ascending order and within the video's duration, or the command will exit with an error indicating which position is invalid.

### Cut a video at scene changes (automatic detection):

```bash
video-cutter -i my_video.mp4 --scene-detect
```

This detects hard cuts between scenes and creates one segment per scene, named `scene_001.mp4`, `scene_002.mp4`, etc. The number of segments is content-driven — it depends entirely on what's in the video.

### Cut at scene changes with a custom threshold:

```bash
video-cutter -i my_video.mp4 --scene-detect 20
```

The `scdet` filter computes a per-frame difference score (0–100) representing how different each frame is from the previous one — essentially the percentage of maximum possible pixel change across the frame.

- **Low threshold (e.g. 2–5):** Very sensitive — detects subtle transitions, fades, and gradual lighting changes. Produces many cuts, including false positives.
- **Default threshold (10):** Catches hard cuts reliably with few false positives. ffmpeg's own docs suggest the sweet spot is 8–14.
- **High threshold (e.g. 30–50):** Only detects dramatic, obvious scene changes. May miss some real cuts.
- **100:** Would never trigger (nothing is ever 100% different).

So for a cartoon with sharp hard cuts between scenes, the default of 10 should work well. If you're getting too many segments (spurious cuts on action frames), raise it to 20–30. If you're getting too few (missing real scene changes), lower it to 5–8.

**Note:** File paths containing `:` or `,` may cause scene detection to fail due to limitations in the ffmpeg lavfi filter string format.

### Specify custom output directory:

```bash
video-cutter -i my_video.mp4 -n 10 -o ./my_segments/
```

## Notes

- The tool uses `ffprobe` to determine the video duration
- Segments are created using `ffmpeg` with stream copying for speed
- If no output directory is specified, a timestamped subdirectory is created in `./output/`
- When creating segments shorter than 30 seconds, you'll be prompted for confirmation
- Segment numbers are zero-padded to 3 digits (001, 002, etc.) for count-based segments
- Time-based segments are named with both sequence number and start time (e.g., seg_01_00-00-00.mp4)
- The `--segments`, `--duration`, `--scene-detect`, and `--timecodes` options are mutually exclusive
- By default, the tool uses stream copying for fast segment creation, which may result in slight duration inaccuracies due to keyframe alignment
- Use the `--re-encode` flag to re-encode segments for precise duration control (slower but exact)
- Use the `--verify` flag to check that each segment matches its intended duration after creation
- When using both `--re-encode` and `--verify`, segments will have exact durations as specified
- Scene-detect segments are named `scene_001.mp4`, `scene_002.mp4`, etc.
- Timecode segments are named `tc_NNN_HH-MM-SS.mmm.mp4` using the sequence number and start time of each segment
- The `--scene-detect` threshold is a value from 0–100 representing the minimum frame difference score to trigger a cut; the recommended range is 8–14 (default: 10)