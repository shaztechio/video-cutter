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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

import { spawn } from 'child_process'
import { getVideoDuration, createSegment, createCountSegments, createTimeSegments, detectSceneChanges, createSceneSegments } from '../src/core.js'

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

function createMockProcess ({ stdoutData = null, stderrData = null, exitCode = 0 } = {}) {
  const proc = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  setTimeout(() => {
    if (stdoutData !== null) proc.stdout.emit('data', Buffer.from(stdoutData))
    if (stderrData !== null) proc.stderr.emit('data', Buffer.from(stderrData))
    proc.emit('close', exitCode)
  }, 0)
  return proc
}

describe('getVideoDuration', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('resolves with parsed duration on success', async () => {
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ stdoutData: '120.5\n' }))
    const duration = await getVideoDuration('video.mp4')
    expect(duration).toBe(120.5)
  })

  it('handles stderr data without error', async () => {
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ stdoutData: '90.0\n', stderrData: 'some warning' }))
    const duration = await getVideoDuration('video.mp4')
    expect(duration).toBe(90.0)
  })

  it('rejects on non-zero exit code', async () => {
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ exitCode: 1 }))
    await expect(getVideoDuration('video.mp4')).rejects.toThrow('ffprobe exited with code 1')
  })

  it('rejects when output cannot be parsed as number', async () => {
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ stdoutData: 'invalid_output', exitCode: 0 }))
    await expect(getVideoDuration('video.mp4')).rejects.toThrow('Could not parse duration')
  })
})

describe('createSegment', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('creates segment using stream copy by default (reEncode=false)', async () => {
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess())
    await expect(createSegment('video.mp4', 0, 60, 'out/seg.mp4', false)).resolves.toBeUndefined()
    expect(spawn).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining(['-c', 'copy']))
  })

  it('creates segment with re-encoding when reEncode=true', async () => {
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess())
    await expect(createSegment('video.mp4', 0, 60, 'out/seg.mp4', true)).resolves.toBeUndefined()
    expect(spawn).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining(['-c:v', 'libx264']))
  })

  it('handles stdout and stderr data', async () => {
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ stdoutData: 'progress', stderrData: 'info' }))
    await expect(createSegment('video.mp4', 0, 60, 'out/seg.mp4')).resolves.toBeUndefined()
  })

  it('rejects on non-zero exit code', async () => {
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ exitCode: 1 }))
    await expect(createSegment('video.mp4', 0, 60, 'out/seg.mp4')).rejects.toThrow('ffmpeg exited with code 1')
  })
})

describe('createCountSegments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('creates segments without verification', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess())
    await expect(createCountSegments('video.mp4', 120, 2, '/output')).resolves.toBeUndefined()
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('verifies valid segment durations within stream copy tolerance (1s)', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess({ stdoutData: '120.0\n' }))
    await expect(createCountSegments('video.mp4', 120, 1, '/output', true)).resolves.toBeUndefined()
  })

  it('warns when verified segment duration is outside tolerance', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess({ stdoutData: '117.0\n' })) // 3s diff > 1s tolerance
    await createCountSegments('video.mp4', 120, 1, '/output', true)
    expect(console.warn).toHaveBeenCalled()
  })

  it('uses 0.1s tolerance when re-encoding and warns on invalid segments', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess({ stdoutData: '119.5\n' })) // 0.5s diff > 0.1s tolerance
    await createCountSegments('video.mp4', 120, 1, '/output', true, true)
    expect(console.warn).toHaveBeenCalled()
  })

  it('logs success when verified segment is within re-encode tolerance', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess({ stdoutData: '120.05\n' })) // 0.05s diff <= 0.1s tolerance
    await createCountSegments('video.mp4', 120, 1, '/output', true, true)
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Verified'))
  })

  it('calls process.exit(1) when segment creation fails', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ exitCode: 1 }))
    await expect(createCountSegments('video.mp4', 120, 1, '/output')).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('createTimeSegments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('creates segments without verification', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess())
    await expect(createTimeSegments('video.mp4', 120, 60, '/output')).resolves.toBeUndefined()
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('verifies valid segment durations', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess({ stdoutData: '60.0\n' }))
    await expect(createTimeSegments('video.mp4', 60, 60, '/output', true)).resolves.toBeUndefined()
  })

  it('warns when verified segment duration is outside tolerance', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess({ stdoutData: '57.0\n' })) // 3s diff > 1s tolerance
    await createTimeSegments('video.mp4', 60, 60, '/output', true)
    expect(console.warn).toHaveBeenCalled()
  })

  it('uses 0.1s tolerance when re-encoding and warns on invalid segments', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess({ stdoutData: '59.5\n' })) // 0.5s diff > 0.1s tolerance
    await createTimeSegments('video.mp4', 60, 60, '/output', true, true)
    expect(console.warn).toHaveBeenCalled()
  })

  it('logs success when verified segment is within re-encode tolerance', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess({ stdoutData: '60.05\n' })) // 0.05s diff <= 0.1s tolerance
    await createTimeSegments('video.mp4', 60, 60, '/output', true, true)
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Verified'))
  })

  it('calls process.exit(1) when segment creation fails', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ exitCode: 1 }))
    await expect(createTimeSegments('video.mp4', 60, 60, '/output')).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('detectSceneChanges', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('resolves with timestamps when frames are returned using pts_time (ffmpeg 7+)', async () => {
    const framesJson = JSON.stringify({
      frames: [
        { pts_time: '5.2' },
        { pts_time: '12.8' }
      ]
    })
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ stdoutData: framesJson }))
    const result = await detectSceneChanges('video.mp4')
    expect(result).toEqual([0, 5.2, 12.8])
  })

  it('resolves with timestamps when frames are returned using pkt_pts_time fallback (ffmpeg <7)', async () => {
    const framesJson = JSON.stringify({
      frames: [
        { pkt_pts_time: '5.2' },
        { pkt_pts_time: '12.8' }
      ]
    })
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ stdoutData: framesJson }))
    const result = await detectSceneChanges('video.mp4')
    expect(result).toEqual([0, 5.2, 12.8])
  })

  it('resolves with [0] when frames array is empty', async () => {
    const framesJson = JSON.stringify({ frames: [] })
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ stdoutData: framesJson }))
    const result = await detectSceneChanges('video.mp4')
    expect(result).toEqual([0])
  })

  it('resolves with [0] when frames key is missing (malformed JSON object)', async () => {
    const framesJson = JSON.stringify({})
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ stdoutData: framesJson }))
    const result = await detectSceneChanges('video.mp4')
    expect(result).toEqual([0])
  })

  it('rejects on non-zero exit code', async () => {
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ exitCode: 1 }))
    await expect(detectSceneChanges('video.mp4')).rejects.toThrow('ffprobe exited with code 1')
  })

  it('rejects when stdout is not valid JSON', async () => {
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ stdoutData: 'not-json' }))
    await expect(detectSceneChanges('video.mp4')).rejects.toThrow('Could not parse scene detection output')
  })

  it('uses default threshold 10 in spawn args', async () => {
    const framesJson = JSON.stringify({ frames: [] })
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ stdoutData: framesJson }))
    await detectSceneChanges('video.mp4')
    expect(spawn).toHaveBeenCalledWith('ffprobe', expect.arrayContaining([
      expect.stringContaining('threshold=10')
    ]))
  })

  it('uses provided threshold in spawn args', async () => {
    const framesJson = JSON.stringify({ frames: [] })
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ stdoutData: framesJson }))
    await detectSceneChanges('video.mp4', 25)
    expect(spawn).toHaveBeenCalledWith('ffprobe', expect.arrayContaining([
      expect.stringContaining('threshold=25')
    ]))
  })

  it('does not duplicate 0 if first frame timestamp is already 0', async () => {
    const framesJson = JSON.stringify({
      frames: [
        { pts_time: '0' },
        { pts_time: '8.5' }
      ]
    })
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ stdoutData: framesJson }))
    const result = await detectSceneChanges('video.mp4')
    expect(result[0]).toBe(0)
    expect(result.filter(t => t === 0)).toHaveLength(1)
  })
})

describe('createSceneSegments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('creates N-1 segments from N boundaries with scene_NNN.mp4 filenames', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess())
    await expect(createSceneSegments('video.mp4', '/output', [0, 5.2, 30])).resolves.toBeUndefined()
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([expect.stringContaining('scene_001.mp4')]))
    expect(spawn).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([expect.stringContaining('scene_002.mp4')]))
  })

  it('passes reEncode=true through to spawn args (-c:v libx264)', async () => {
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess())
    await createSceneSegments('video.mp4', '/output', [0, 30], false, true)
    expect(spawn).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining(['-c:v', 'libx264']))
  })

  it('verifies durations when verifySegments=true', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess({ stdoutData: '30.0\n' }))
    await createSceneSegments('video.mp4', '/output', [0, 30], true)
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Verified'))
  })

  it('warns on duration mismatch during verification', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(createMockProcess())
      .mockReturnValueOnce(createMockProcess({ stdoutData: '1.0\n' })) // expected 30s
    await createSceneSegments('video.mp4', '/output', [0, 30], true)
    expect(console.warn).toHaveBeenCalled()
  })

  it('calls process.exit(1) on segment creation failure', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    vi.mocked(spawn).mockReturnValueOnce(createMockProcess({ exitCode: 1 }))
    await expect(createSceneSegments('video.mp4', '/output', [0, 5.2, 30])).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
