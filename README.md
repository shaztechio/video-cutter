# Video Cutter

A simple CLI tool to cut a video file into equal-length segments using ffmpeg.

## Prerequisites

- Node.js
- ffmpeg (must be installed and available in PATH)

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
  -V, --version             output the version number
  -i, --input <path>        input video file path
  -n, --segments <number>   number of segments to create
  -d, --duration <seconds>  duration of each segment in seconds
  -o, --output <path>       output directory for segments (default:
                            ./output/YYYY-MM-DD_HH-MM-SS/)
  --verify                  verify that each segment matches its intended
                            duration
  --re-encode               re-encode segments for exact duration (slower but
                            more accurate)
  -h, --help                display help for command
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
- The `--segments` and `--duration` options are mutually exclusive
- By default, the tool uses stream copying for fast segment creation, which may result in slight duration inaccuracies due to keyframe alignment
- Use the `--re-encode` flag to re-encode segments for precise duration control (slower but exact)
- Use the `--verify` flag to check that each segment matches its intended duration after creation
- When using both `--re-encode` and `--verify`, segments will have exact durations as specified