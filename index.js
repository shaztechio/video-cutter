#!/usr/bin/env node
/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import inquirer from 'inquirer'
import { Command, Option } from 'commander'
import { fileURLToPath } from 'url'
import colors from 'colors'
import {
  getVideoDuration,
  createCountSegments,
  createTimeSegments,
  detectSceneChanges,
  createSceneSegments,
  parseTimecodes,
  createTimecodeSegments
} from './src/core.js'

// Colored console output helpers
const warn = (msg) => console.warn(colors.yellow(`Warning: ${msg}`))
const error = (msg) => console.error(colors.red(`Error: ${msg}`))

// Check if ffmpeg and ffprobe are installed
try {
  execSync('ffmpeg -version')
  execSync('ffprobe -version')
} catch (err) {
  error('ffmpeg and ffprobe are required but not installed.')
  console.error('')
  console.error('Installation instructions:')
  console.error('- macOS: brew install ffmpeg')
  console.error('- Windows: Download from https://www.gyan.dev/ffmpeg/builds/')
  console.error('- Linux: sudo apt-get install ffmpeg')
  console.error('')
  process.exit(1)
}

/**
 * Main function that handles the video cutting logic
 *
 * @param {Object} options - The command line options
 * @param {string} options.input - Input video file path
 * @param {number} [options.segments] - Number of segments to create
 * @param {number} [options.duration] - Duration of each segment in seconds
 * @param {string} [options.output] - Output directory for segments
 * @param {boolean} [options.verify] - Whether to verify each segment's duration
 * @param {boolean} [options.reEncode] - Whether to re-encode for exact duration
 * @returns {Promise<void>}
 */
async function processVideo (options) {
  const verifySegments = !!options.verify
  const reEncode = !!options.reEncode

  const inputFile = options.input
  const segmentCount = options.segments ? parseInt(options.segments) : null
  const segmentDuration = options.duration ? parseInt(options.duration) : null
  let outputPath = options.output

  // Validate input file exists
  if (!fs.existsSync(inputFile)) {
    error(`Input file does not exist: ${inputFile}`)
    process.exit(1)
  }

  // Create default output path if not provided
  if (!outputPath) {
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace('T', '_').substring(0, 19)
    outputPath = path.join('./output', timestamp)
  }

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true })
  }

  console.log(`Output directory: ${outputPath}`)

  // Get video duration using ffprobe
  try {
    const duration = await getVideoDuration(inputFile)
    if (!duration) {
      error('Could not determine video duration')
      process.exit(1)
    }

    console.log(`Video duration: ${duration} seconds`)

    const timecodes = options.timecodes ?? null

    if (timecodes !== null) {
      let parsed
      try {
        parsed = parseTimecodes(timecodes)
      } catch (err) {
        error(err.message)
        process.exit(1)
      }

      // Validate ascending order
      for (let i = 1; i < parsed.length; i++) {
        if (parsed[i] <= parsed[i - 1]) {
          error(`Timecode at position ${i + 1} is not in ascending order`)
          process.exit(1)
        }
      }

      // Validate within video duration
      for (let i = 0; i < parsed.length; i++) {
        if (parsed[i] >= duration) {
          error(`Timecode at position ${i + 1} exceeds video duration of ${duration.toFixed(2)} seconds`)
          process.exit(1)
        }
      }

      const boundaries = [0, ...parsed, duration]
      console.log(`${boundaries.length - 1} segment(s) will be created.`)
      if (!reEncode) {
        console.warn('Using stream copy mode. Durations may vary slightly. Use --re-encode for exact cuts.')
      }
      return createTimecodeSegments(inputFile, outputPath, boundaries, verifySegments, reEncode)
    }

    const sceneDetect = options.sceneDetect ?? null
    const threshold = sceneDetect === true ? 10 : (sceneDetect ? parseInt(sceneDetect) : null)

    if (sceneDetect !== null) {
      console.log(`Detecting scene changes with threshold: ${threshold}...`)
      const timestamps = await detectSceneChanges(inputFile, threshold)
      if (timestamps.length <= 1) {
        console.warn('No scene changes detected. Cannot create segments.')
        process.exit(0)
      }
      const boundaries = [...timestamps, duration]
      console.log('boundaries:', boundaries)
      console.log(`${boundaries.length - 1} scene segment(s) will be created.`)
      if (!reEncode) {
        console.warn('Using stream copy mode. Durations may vary slightly. Use --re-encode for exact cuts.')
      }
      return createSceneSegments(inputFile, outputPath, boundaries, verifySegments, reEncode)
    } else if (segmentDuration) {
      // Time-based segmentation
      const calculatedSegmentCount = Math.ceil(duration / segmentDuration)
      console.log(`${calculatedSegmentCount} segments will be created.`)

      // Issue the re-encode warning once at the beginning of time-based segmentation
      if (!reEncode) {
        warn(`Using stream copy mode (-d flag without --re-encode). Segment durations may not be exactly ${segmentDuration} seconds due to keyframe alignment. Use --re-encode for exact durations.`)
      }

      // Check if segment duration is less than 30 seconds
      if (segmentDuration < 30) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Warning: You're creating segments of ${segmentDuration} seconds each. Short segments may be inefficient and result in many small files. Continue?`,
            default: false
          }
        ])

        if (confirm) {
          return createTimeSegments(inputFile, duration, segmentDuration, outputPath, verifySegments, reEncode)
        } else {
          console.log('Operation cancelled.')
          process.exit(0)
        }
      }

      return createTimeSegments(inputFile, duration, segmentDuration, outputPath, verifySegments, reEncode)
    } else {
      // Count-based segmentation
      const calculatedSegmentDuration = duration / segmentCount
      console.log(`Each segment will be ~${calculatedSegmentDuration.toFixed(2)} seconds`)

      // Check if calculated segment duration is less than 30 seconds
      if (calculatedSegmentDuration < 30) {
        // Issue re-encode warning for count-based segmentation too, if appropriate
        if (!reEncode) {
          warn('Using stream copy mode (-n flag without --re-encode). Segment durations may not be exactly as calculated due to keyframe alignment. Use --re-encode for exact durations.')
        }

        const optimalSegmentCount = Math.max(1, Math.floor(duration / 30))
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Warning: With ${segmentCount} segments, each will be ~${calculatedSegmentDuration.toFixed(2)} seconds. Short segments may be inefficient and result in many small files. Consider using ~${optimalSegmentCount} segments for 30-second durations. Continue?`,
            default: false
          }
        ])

        if (confirm) {
          return createCountSegments(inputFile, duration, segmentCount, outputPath, verifySegments, reEncode)
        } else {
          console.log('Operation cancelled.')
          process.exit(0)
        }
      } else {
        // Issue re-encode warning for count-based segmentation when segments are >= 30s
        if (!reEncode) {
          warn('Using stream copy mode (-n flag without --re-encode). Segment durations may not be exactly as calculated due to keyframe alignment. Use --re-encode for exact durations.')
        }
      }

      return createCountSegments(inputFile, duration, segmentCount, outputPath, verifySegments, reEncode)
    }
  } catch (err) {
    error('Error getting video duration: ' + err.message)
    process.exit(1)
  }
}

/**
 * Set up CLI only when run directly
 *
 * @returns {void}
 */
function setupCli () {
  const program = new Command()

  program
    .name('video-cutter')
    .description('CLI tool to cut videos into segments using ffmpeg')
    .version('1.0.0')
    .requiredOption('-i, --input <path>', 'input video file path')
    .addOption(new Option('-n, --segments <number>', 'number of segments to create').conflicts('duration'))
    .addOption(new Option('-d, --duration <seconds>', 'duration of each segment in seconds').conflicts('segments'))
    .addOption(
      new Option('--scene-detect [threshold]', 'cut at scene change boundaries (threshold 0–100, default: 10)')
        .conflicts('segments')
        .conflicts('duration')
    )
    .addOption(
      new Option('-t, --timecodes <timecodes>', 'cut at specified timecodes (CSV: HH:MM:SS[.nnnn],...)')
        .conflicts('segments')
        .conflicts('duration')
        .conflicts('scene-detect')
    )
    .option('-o, --output <path>', 'output directory for segments (default: ./output/YYYY-MM-DD_HH-MM-SS/)')
    .option('--verify', 'verify that each segment matches its intended duration')
    .option('--re-encode', 're-encode segments for exact duration (slower but more accurate)')
    .action(processVideo)

  program.parse()
}

// Only run the CLI if this file is executed directly
const currentFile = fileURLToPath(import.meta.url)
const mainModule = process.argv[1] ? path.resolve(process.argv[1]) : ''

if (mainModule === path.resolve(currentFile)) {
  setupCli()
}

// Export the main function and CLI setup for testing purposes
export { processVideo, setupCli }
