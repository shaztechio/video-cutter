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

import { spawn, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import inquirer from 'inquirer'
import { Command, Option } from 'commander'
import { fileURLToPath } from 'url'
import colors from 'colors'

// Colored console output helpers
const warn = (msg) => console.warn(colors.yellow(`Warning: ${msg}`))
const error = (msg) => console.error(colors.red(`Error: ${msg}`))

// Check if ffmpeg and ffprobe are installed
try {
  execSync('ffmpeg -version')
  execSync('ffprobe -version')
} catch (error) {
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

    if (segmentDuration) {
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
    error('Error creating segments: ' + err.message)
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

// Export the main function for testing purposes
export { processVideo }

// Helper functions remain at the end
/**
 * Get video duration using ffprobe
 *
 * @param {string} inputFile - Path to the input video file
 * @returns {Promise<number>} - Video duration in seconds
 */
function getVideoDuration (inputFile) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      inputFile
    ])

    let output = ''
    ffprobe.stdout.on('data', (data) => {
      output += data.toString()
    })

    ffprobe.stderr.on('data', (data) => {
      // Ignore stderr for this operation
    })

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}`))
        return
      }

      const duration = parseFloat(output.trim())
      if (isNaN(duration)) {
        reject(new Error('Could not parse duration'))
        return
      }

      resolve(duration)
    })
  })
}

/**
 * Create video segments based on count
 *
 * @param {string} inputFile - Path to the input video file
 * @param {number} duration - Total duration of the video
 * @param {number} segmentCount - Number of segments to create
 * @param {string} outputPath - Directory to save the segments
 * @param {boolean} verifySegments - Whether to verify segment durations
 * @param {boolean} reEncode - Whether to re-encode for exact duration
 * @returns {Promise<void>}
 */
function createCountSegments (inputFile, duration, segmentCount, outputPath, verifySegments = false, reEncode = false) {
  // Calculate segment duration
  const segmentDuration = duration / segmentCount

  // Generate segments
  const promises = []
  for (let i = 0; i < segmentCount; i++) {
    const startTime = i * segmentDuration
    const endTime = Math.min((i + 1) * segmentDuration, duration)

    const segmentFile = path.join(outputPath, `segment_${String(i + 1).padStart(3, '0')}.mp4`)

    promises.push(createSegment(inputFile, startTime, endTime, segmentFile, reEncode))
  }

  return Promise.all(promises)
    .then(async () => {
      console.log('All segments created successfully!')

      // Verify segments if requested
      if (verifySegments) {
        console.log('Verifying segment durations...')
        for (let i = 0; i < segmentCount; i++) {
          const startTime = i * segmentDuration
          const endTime = Math.min((i + 1) * segmentDuration, duration)
          const expectedDuration = endTime - startTime
          const segmentFile = path.join(outputPath, `segment_${String(i + 1).padStart(3, '0')}.mp4`)

          const actualDuration = await getVideoDuration(segmentFile)
          const difference = Math.abs(actualDuration - expectedDuration)
          const tolerance = reEncode ? 0.1 : 1.0 // Stricter tolerance when re-encoding
          const isValid = difference <= tolerance
          if (!isValid) {
            warn(`Segment ${segmentFile} duration is ${actualDuration.toFixed(2)} seconds, expected ${expectedDuration.toFixed(2)} seconds`)
          } else {
            console.log(colors.green(`Verified: ${segmentFile} duration is correct`))
          }
        }
      }
    })
    .catch(err => {
      console.error('Error creating segments:', err)
      process.exit(1)
    })
}

/**
 * Create video segments based on duration
 *
 * @param {string} inputFile - Path to the input video file
 * @param {number} videoDuration - Total duration of the video
 * @param {number} segmentDuration - Duration of each segment in seconds
 * @param {string} outputPath - Directory to save the segments
 * @param {boolean} verifySegments - Whether to verify segment durations
 * @param {boolean} reEncode - Whether to re-encode for exact duration
 * @returns {Promise<void>}
 */
function createTimeSegments (inputFile, videoDuration, segmentDuration, outputPath, verifySegments = false, reEncode = false) {
  // Calculate number of segments needed
  const segmentCount = Math.ceil(videoDuration / segmentDuration)

  // Generate segments
  const promises = []
  for (let i = 0; i < segmentCount; i++) {
    const startTime = i * segmentDuration
    const endTime = Math.min((i + 1) * segmentDuration, videoDuration)

    // Convert start time to HH-MM-SS format for filename
    const hours = Math.floor(startTime / 3600)
    const minutes = Math.floor((startTime % 3600) / 60)
    const seconds = Math.floor(startTime % 60)

    const padTime = (num) => String(num).padStart(2, '0')
    const timeStr = `${padTime(hours)}-${padTime(minutes)}-${padTime(seconds)}`
    const segmentFile = path.join(outputPath, `seg_${padTime(i + 1)}_${timeStr}.mp4`)

    promises.push(createSegment(inputFile, startTime, endTime, segmentFile, reEncode))
  }

  return Promise.all(promises)
    .then(async () => {
      console.log('All segments created successfully!')

      // Verify segments if requested
      if (verifySegments) {
        console.log('Verifying segment durations...')
        for (let i = 0; i < segmentCount; i++) {
          const startTime = i * segmentDuration
          const endTime = Math.min((i + 1) * segmentDuration, videoDuration)
          const expectedDuration = endTime - startTime

          // Recalculate the time string for verification
          const hours = Math.floor(startTime / 3600)
          const minutes = Math.floor((startTime % 3600) / 60)
          const seconds = Math.floor(startTime % 60)
          const padTime = (num) => String(num).padStart(2, '0')
          const timeStr = `${padTime(hours)}-${padTime(minutes)}-${padTime(seconds)}`
          const segmentFile = path.join(outputPath, `seg_${padTime(i + 1)}_${timeStr}.mp4`)

          const actualDuration = await getVideoDuration(segmentFile)
          const difference = Math.abs(actualDuration - expectedDuration)
          const tolerance = reEncode ? 0.1 : 1.0 // Stricter tolerance when re-encoding
          const isValid = difference <= tolerance
          if (!isValid) {
            warn(`Segment ${segmentFile} duration is ${actualDuration.toFixed(2)} seconds, expected ${expectedDuration.toFixed(2)} seconds`)
          } else {
            console.log(colors.green(`Verified: ${segmentFile} duration is correct`))
          }
        }
      }
    })
    .catch(err => {
      console.error('Error creating segments:', err)
      process.exit(1)
    })
}

/**
 * Create a video segment using ffmpeg
 *
 * @param {string} inputFile - Path to the input video file
 * @param {number} startTime - Start time of the segment in seconds
 * @param {number} endTime - End time of the segment in seconds
 * @param {string} outputFile - Path to save the output segment
 * @param {boolean} reEncode - Whether to re-encode for exact duration
 * @returns {Promise<void>}
 */
function createSegment (inputFile, startTime, endTime, outputFile, reEncode = false) {
  return new Promise((resolve, reject) => {
    console.log(`Creating segment: ${outputFile}`)

    const args = [
      '-ss', startTime.toString(),
      '-t', (endTime - startTime).toString(),
      '-i', inputFile
    ]

    if (reEncode) {
      args.push(
        '-c:v', 'libx264', // Re-encode to ensure exact duration
        '-c:a', 'aac', // Re-encode audio
        '-avoid_negative_ts', 'make_zero',
        '-reset_timestamps', '1'
      )
    } else {
      args.push(
        '-c', 'copy', // Copy streams without re-encoding for speed
        '-avoid_negative_ts', 'make_zero',
        '-reset_timestamps', '1'
      )
    }

    args.push(outputFile)

    const ffmpeg = spawn('ffmpeg', args)

    ffmpeg.stdout.on('data', (data) => {
      // Log progress if needed
    })

    ffmpeg.stderr.on('data', (data) => {
      // Handle errors
    })

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`))
      } else {
        resolve()
      }
    })
  })
}
