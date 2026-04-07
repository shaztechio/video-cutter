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

    let stderrOutput = ''
    ffmpeg.stderr.on('data', (data) => {
      stderrOutput += data.toString()
    })

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        if (stderrOutput) console.error(stderrOutput)
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

/**
 * Detect scene changes using ffprobe's scdet filter
 *
 * Note: file paths containing `:` or `,` may break the lavfi filter string.
 *
 * @param {string} inputFile - Path to the input video file
 * @param {number} threshold - Scene change sensitivity (0–100, default: 10)
 * @returns {Promise<number[]>} - Array of timestamps (always starts with 0)
 */
async function detectSceneChanges (inputFile, threshold = 10) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-f', 'lavfi',
      '-i', `movie=${inputFile},scdet=threshold=${threshold}:sc_pass=1`,
      '-show_frames', '-select_streams', 'v:0',
      '-of', 'json'
    ]
    const proc = spawn('ffprobe', args)
    let output = ''
    proc.stdout.on('data', chunk => { output += chunk })
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe exited with code ${code}`))
      let parsed
      try { parsed = JSON.parse(output) } catch {
        return reject(new Error('Could not parse scene detection output'))
      }
      const frames = parsed.frames ?? []
      const timestamps = frames.map(f => parseFloat(f.pts_time ?? f.pkt_pts_time))
      const result = timestamps.length > 0 && timestamps[0] === 0
        ? timestamps
        : [0, ...timestamps]
      resolve(result)
    })
  })
}

/**
 * Create video segments at scene change boundaries
 *
 * @param {string} inputFile - Path to the input video file
 * @param {string} outputDir - Directory to save the segments
 * @param {number[]} boundaries - Array of timestamps including 0 at start and total duration at end
 * @param {boolean} verifySegments - Whether to verify segment durations
 * @param {boolean} reEncode - Whether to re-encode for exact duration
 * @returns {Promise<void>}
 */
async function createSceneSegments (inputFile, outputDir, boundaries, verifySegments = false, reEncode = false) {
  const segmentCount = boundaries.length - 1
  const promises = []

  for (let i = 0; i < segmentCount; i++) {
    const startTime = boundaries[i]
    const endTime = boundaries[i + 1]
    const segmentFile = path.join(outputDir, `scene_${String(i + 1).padStart(3, '0')}.mp4`)
    promises.push(createSegment(inputFile, startTime, endTime, segmentFile, reEncode))
  }

  return Promise.all(promises)
    .then(async () => {
      console.log('All segments created successfully!')

      if (verifySegments) {
        console.log('Verifying segment durations...')
        for (let i = 0; i < segmentCount; i++) {
          const expectedDuration = boundaries[i + 1] - boundaries[i]
          const segmentFile = path.join(outputDir, `scene_${String(i + 1).padStart(3, '0')}.mp4`)

          const actualDuration = await getVideoDuration(segmentFile)
          const difference = Math.abs(actualDuration - expectedDuration)
          const tolerance = reEncode ? 0.1 : 1.0
          if (difference > tolerance) {
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
 * Parse a CSV string of timecodes into an array of seconds.
 * Supported formats are HH:MM:SS[.nnnn], Ns, N.Ns, and [Nh][Nm]N[.N]s.
 *
 * @param {string} timecodeString - Comma-separated timecodes, e.g. "00:00:10.000,00:00:30.000", "10s,10.25s", or "0h0m10s,1h30m15.2s"
 * @returns {number[]} - Array of timestamps in seconds
 */
function parseTimecodes (timecodeString) {
  return timecodeString.split(',').map((tc, i) => {
    const trimmed = tc.trim()
    const pos = i + 1

    // Format: HH:MM:SS[.nnn]
    if (trimmed.includes(':')) {
      const colonMatch = trimmed.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/)
      if (!colonMatch) throw new Error(`Invalid timecode at position ${pos}: "${trimmed}"`)
      const [, h, m, s] = colonMatch
      const seconds = Number.parseInt(h, 10) * 3600 + Number.parseInt(m, 10) * 60 + Number.parseFloat(s)
      if (!Number.isFinite(seconds)) throw new Error(`Invalid timecode at position ${pos}: "${trimmed}"`)
      return seconds
    }

    // Format: [Nh][Nm]N[.N]s — covers "10s", "10.25s", "0h0m10s", "1h30m15.2s"
    const hmsMatch = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s$/)
    if (hmsMatch) {
      const h = parseInt(hmsMatch[1] ?? '0')
      const m = parseInt(hmsMatch[2] ?? '0')
      const s = parseFloat(hmsMatch[3])
      return h * 3600 + m * 60 + s
    }

    throw new Error(`Invalid timecode at position ${pos}: "${trimmed}"`)
  })
}

/**
 * Create video segments at specified timecode boundaries
 *
 * @param {string} inputFile - Path to the input video file
 * @param {string} outputDir - Directory to save the segments
 * @param {number[]} boundaries - Array of timestamps including 0 at start and total duration at end
 * @param {boolean} verifySegments - Whether to verify segment durations
 * @param {boolean} reEncode - Whether to re-encode for exact duration
 * @returns {Promise<void>}
 */
async function createTimecodeSegments (inputFile, outputDir, boundaries, verifySegments = false, reEncode = false) {
  const segmentCount = boundaries.length - 1
  const promises = []

  for (let i = 0; i < segmentCount; i++) {
    const startTime = boundaries[i]
    const endTime = boundaries[i + 1]

    const hours = Math.floor(startTime / 3600)
    const minutes = Math.floor((startTime % 3600) / 60)
    const secs = startTime % 60
    const pad = (n) => String(n).padStart(2, '0')
    const millisStr = secs.toFixed(3).split('.')[1]
    const timeStr = `${pad(hours)}-${pad(minutes)}-${pad(Math.floor(secs))}.${millisStr}`
    const seqStr = String(i + 1).padStart(3, '0')
    const segmentFile = path.join(outputDir, `tc_${seqStr}_${timeStr}.mp4`)

    promises.push(createSegment(inputFile, startTime, endTime, segmentFile, reEncode))
  }

  return Promise.all(promises)
    .then(async () => {
      console.log('All segments created successfully!')

      if (verifySegments) {
        console.log('Verifying segment durations...')
        for (let i = 0; i < segmentCount; i++) {
          const startTime = boundaries[i]
          const endTime = boundaries[i + 1]
          const expectedDuration = endTime - startTime

          const hours = Math.floor(startTime / 3600)
          const minutes = Math.floor((startTime % 3600) / 60)
          const secs = startTime % 60
          const pad = (n) => String(n).padStart(2, '0')
          const millisStr = secs.toFixed(3).split('.')[1]
          const timeStr = `${pad(hours)}-${pad(minutes)}-${pad(Math.floor(secs))}.${millisStr}`
          const seqStr = String(i + 1).padStart(3, '0')
          const segmentFile = path.join(outputDir, `tc_${seqStr}_${timeStr}.mp4`)

          const actualDuration = await getVideoDuration(segmentFile)
          const difference = Math.abs(actualDuration - expectedDuration)
          const tolerance = reEncode ? 0.1 : 1.0
          if (difference > tolerance) {
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
  createTimeSegments,
  detectSceneChanges,
  createSceneSegments,
  parseTimecodes,
  createTimecodeSegments
}
