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

// Core video cutting logic functions
import { spawn } from 'child_process'
import path from 'path'
import colors from 'colors'

/**
 * Get video duration using ffprobe
 *
 * @param {string} inputFile - Path to the input video file
 * @returns {Promise<number>} - Video duration in seconds
 */
async function getVideoDuration (inputFile) {
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
async function createCountSegments (inputFile, duration, segmentCount, outputPath, verifySegments = false, reEncode = false) {
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
            console.warn(`Warning: Segment ${segmentFile} duration is ${actualDuration.toFixed(2)} seconds, expected ${expectedDuration.toFixed(2)} seconds`)
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
async function createTimeSegments (inputFile, videoDuration, segmentDuration, outputPath, verifySegments = false, reEncode = false) {
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
            console.warn(`Warning: Segment ${segmentFile} duration is ${actualDuration.toFixed(2)} seconds, expected ${expectedDuration.toFixed(2)} seconds`)
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

export {
  getVideoDuration,
  createSegment,
  createCountSegments,
  createTimeSegments
}
