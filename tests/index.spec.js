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

import fs from 'fs'
import inquirer from 'inquirer'
import { Command, Option } from 'commander'
import { getVideoDuration, createCountSegments, createTimeSegments, detectSceneChanges, createSceneSegments, parseTimecodes, createTimecodeSegments } from '../src/core.js'
import { processVideo, setupCli } from '../index.js'

vi.mock('child_process', () => ({
  execSync: vi.fn(), // doesn't throw = ffmpeg/ffprobe available
  spawn: vi.fn()
}))

vi.mock('../src/core.js', () => ({
  getVideoDuration: vi.fn(),
  createCountSegments: vi.fn(),
  createTimeSegments: vi.fn(),
  detectSceneChanges: vi.fn(),
  createSceneSegments: vi.fn(),
  parseTimecodes: vi.fn(),
  createTimecodeSegments: vi.fn()
}))

vi.mock('commander', () => {
  const mockProgram = {
    name: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    version: vi.fn().mockReturnThis(),
    requiredOption: vi.fn().mockReturnThis(),
    addOption: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
    parse: vi.fn()
  }
  // eslint-disable-next-line prefer-arrow-callback
  const MockOption = vi.fn(function MockOption () { return { conflicts: vi.fn().mockReturnThis() } })
  // eslint-disable-next-line prefer-arrow-callback
  return { Command: vi.fn(function MockCommand () { return mockProgram }), Option: MockOption }
})

describe('processVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('exits when input file does not exist', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValueOnce(false)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(processVideo({ input: 'missing.mp4', segments: 2, output: '/out' })).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('creates default output directory path when none provided', async () => {
    vi.spyOn(fs, 'existsSync')
      .mockReturnValueOnce(true) // input file exists
      .mockReturnValueOnce(false) // output dir does not exist
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {})
    vi.mocked(getVideoDuration).mockResolvedValue(120)
    vi.mocked(createCountSegments).mockResolvedValue()

    await processVideo({ input: 'video.mp4', segments: 2 })

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('output'), { recursive: true })
  })

  it('creates output directory when it does not exist', async () => {
    vi.spyOn(fs, 'existsSync')
      .mockReturnValueOnce(true) // input file exists
      .mockReturnValueOnce(false) // output dir does not exist
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {})
    vi.mocked(getVideoDuration).mockResolvedValue(120)
    vi.mocked(createCountSegments).mockResolvedValue()

    await processVideo({ input: 'video.mp4', segments: 2, output: '/out' })

    expect(fs.mkdirSync).toHaveBeenCalledWith('/out', { recursive: true })
  })

  it('exits when video duration cannot be determined (falsy)', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.mocked(getVideoDuration).mockResolvedValue(0)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(processVideo({ input: 'video.mp4', segments: 2, output: '/out' })).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits when getVideoDuration throws', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.mocked(getVideoDuration).mockRejectedValue(new Error('ffprobe failed'))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(processVideo({ input: 'video.mp4', segments: 2, output: '/out' })).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  describe('time-based segmentation (--duration)', () => {
    it('warns about stream copy mode when not re-encoding', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(createTimeSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', duration: 60, output: '/out' })

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('stream copy mode'))
      expect(createTimeSegments).toHaveBeenCalledWith('video.mp4', 120, 60, '/out', false, false)
    })

    it('does not warn when re-encoding', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(createTimeSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', duration: 60, output: '/out', reEncode: true })

      expect(console.warn).not.toHaveBeenCalled()
      expect(createTimeSegments).toHaveBeenCalledWith('video.mp4', 120, 60, '/out', false, true)
    })

    it('prompts user for short segments (<30s) and proceeds when confirmed', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(60)
      vi.mocked(createTimeSegments).mockResolvedValue()
      vi.spyOn(inquirer, 'prompt').mockResolvedValue({ confirm: true })

      await processVideo({ input: 'video.mp4', duration: 10, output: '/out' })

      expect(inquirer.prompt).toHaveBeenCalled()
      expect(createTimeSegments).toHaveBeenCalled()
    })

    it('exits when user cancels short segment prompt', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(60)
      vi.spyOn(inquirer, 'prompt').mockResolvedValue({ confirm: false })
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })

      await expect(processVideo({ input: 'video.mp4', duration: 10, output: '/out' })).rejects.toThrow('exit')
      expect(exitSpy).toHaveBeenCalledWith(0)
    })
  })

  describe('count-based segmentation (--segments)', () => {
    it('warns about stream copy mode when segments >= 30s', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(createCountSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', segments: 2, output: '/out' })

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('stream copy mode'))
      expect(createCountSegments).toHaveBeenCalledWith('video.mp4', 120, 2, '/out', false, false)
    })

    it('does not warn when re-encoding with segments >= 30s', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(createCountSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', segments: 2, output: '/out', reEncode: true })

      expect(console.warn).not.toHaveBeenCalled()
    })

    it('warns about stream copy mode when segments < 30s and not re-encoding', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(60)
      vi.mocked(createCountSegments).mockResolvedValue()
      vi.spyOn(inquirer, 'prompt').mockResolvedValue({ confirm: true })

      await processVideo({ input: 'video.mp4', segments: 10, output: '/out' })

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('stream copy mode'))
    })

    it('does not warn when re-encoding with short count segments', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(60)
      vi.mocked(createCountSegments).mockResolvedValue()
      vi.spyOn(inquirer, 'prompt').mockResolvedValue({ confirm: true })

      await processVideo({ input: 'video.mp4', segments: 10, output: '/out', reEncode: true })

      expect(console.warn).not.toHaveBeenCalled()
      expect(createCountSegments).toHaveBeenCalled()
    })

    it('prompts user for short segments and proceeds when confirmed', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(60)
      vi.mocked(createCountSegments).mockResolvedValue()
      vi.spyOn(inquirer, 'prompt').mockResolvedValue({ confirm: true })

      await processVideo({ input: 'video.mp4', segments: 10, output: '/out' })

      expect(inquirer.prompt).toHaveBeenCalled()
      expect(createCountSegments).toHaveBeenCalled()
    })

    it('exits when user cancels short segment prompt', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(60)
      vi.spyOn(inquirer, 'prompt').mockResolvedValue({ confirm: false })
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })

      await expect(processVideo({ input: 'video.mp4', segments: 10, output: '/out' })).rejects.toThrow('exit')
      expect(exitSpy).toHaveBeenCalledWith(0)
    })

    it('passes verify and reEncode flags correctly', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(createCountSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', segments: 2, output: '/out', verify: true, reEncode: true })

      expect(createCountSegments).toHaveBeenCalledWith('video.mp4', 120, 2, '/out', true, true)
    })
  })

  describe('timecode segmentation (--timecodes)', () => {
    it('calls createTimecodeSegments with boundaries [0, ...parsed, duration]', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(parseTimecodes).mockReturnValue([10, 30, 60])
      vi.mocked(createTimecodeSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', output: '/out', timecodes: '00:00:10.000,00:00:30.000,00:01:00.000' })

      expect(parseTimecodes).toHaveBeenCalledWith('00:00:10.000,00:00:30.000,00:01:00.000')
      expect(createTimecodeSegments).toHaveBeenCalledWith('video.mp4', '/out', [0, 10, 30, 60, 120], false, false)
    })

    it('passes verify and reEncode flags correctly', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(parseTimecodes).mockReturnValue([10, 30])
      vi.mocked(createTimecodeSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', output: '/out', timecodes: '00:00:10.000,00:00:30.000', verify: true, reEncode: true })

      expect(createTimecodeSegments).toHaveBeenCalledWith('video.mp4', '/out', [0, 10, 30, 120], true, true)
    })

    it('warns about stream copy mode when not re-encoding', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(parseTimecodes).mockReturnValue([10, 30])
      vi.mocked(createTimecodeSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', output: '/out', timecodes: '00:00:10.000,00:00:30.000' })

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('stream copy mode'))
    })

    it('does not warn about stream copy when reEncode is true', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(parseTimecodes).mockReturnValue([10, 30])
      vi.mocked(createTimecodeSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', output: '/out', timecodes: '00:00:10.000,00:00:30.000', reEncode: true })

      expect(console.warn).not.toHaveBeenCalled()
    })

    it('exits with error when parseTimecodes throws (invalid format)', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(parseTimecodes).mockImplementation(() => { throw new Error('Invalid timecode at position 1: "badval"') })
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })

      await expect(processVideo({ input: 'video.mp4', output: '/out', timecodes: 'badval' })).rejects.toThrow('exit')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid timecode at position 1'))
    })

    it('exits with error when a timecode is zero or negative', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(parseTimecodes).mockReturnValue([0, 10])
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })

      await expect(processVideo({ input: 'video.mp4', output: '/out', timecodes: '0s,10s' })).rejects.toThrow('exit')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('position 1'))
    })

    it('exits with error when timecodes are not in ascending order', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(parseTimecodes).mockReturnValue([30, 10])
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })

      await expect(processVideo({ input: 'video.mp4', output: '/out', timecodes: '00:00:30.000,00:00:10.000' })).rejects.toThrow('exit')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('position 2'))
    })

    it('exits with error when a timecode exceeds video duration', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(parseTimecodes).mockReturnValue([10, 200])
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })

      await expect(processVideo({ input: 'video.mp4', output: '/out', timecodes: '00:00:10.000,00:03:20.000' })).rejects.toThrow('exit')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('position 2'))
    })
  })

  describe('scene-detect segmentation (--scene-detect)', () => {
    it('calls detectSceneChanges with threshold 10 when sceneDetect is true', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(detectSceneChanges).mockResolvedValue([0, 5.2, 12.8])
      vi.mocked(createSceneSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', output: '/out', sceneDetect: true })

      expect(detectSceneChanges).toHaveBeenCalledWith('video.mp4', 10)
    })

    it('calls detectSceneChanges with parsed threshold when sceneDetect is a string', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(detectSceneChanges).mockResolvedValue([0, 5.2, 12.8])
      vi.mocked(createSceneSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', output: '/out', sceneDetect: '25' })

      expect(detectSceneChanges).toHaveBeenCalledWith('video.mp4', 25)
    })

    it('appends duration to boundaries before calling createSceneSegments', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(detectSceneChanges).mockResolvedValue([0, 5.2, 12.8])
      vi.mocked(createSceneSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', output: '/out', sceneDetect: true })

      expect(createSceneSegments).toHaveBeenCalledWith('video.mp4', '/out', [0, 5.2, 12.8, 120], false, false)
    })

    it('exits with code 0 and warns when only [0] is returned (no scenes)', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(detectSceneChanges).mockResolvedValue([0])
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })

      await expect(processVideo({ input: 'video.mp4', output: '/out', sceneDetect: true })).rejects.toThrow('exit')
      expect(exitSpy).toHaveBeenCalledWith(0)
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('No scene changes detected'))
    })

    it('warns about stream copy mode when not re-encoding', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(detectSceneChanges).mockResolvedValue([0, 5.2, 12.8])
      vi.mocked(createSceneSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', output: '/out', sceneDetect: true })

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('stream copy mode'))
    })

    it('does not warn about stream copy when reEncode is true', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(detectSceneChanges).mockResolvedValue([0, 5.2, 12.8])
      vi.mocked(createSceneSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', output: '/out', sceneDetect: true, reEncode: true })

      expect(console.warn).not.toHaveBeenCalled()
    })

    it('passes verify and reEncode flags correctly to createSceneSegments', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(getVideoDuration).mockResolvedValue(120)
      vi.mocked(detectSceneChanges).mockResolvedValue([0, 5.2, 12.8])
      vi.mocked(createSceneSegments).mockResolvedValue()

      await processVideo({ input: 'video.mp4', output: '/out', sceneDetect: true, verify: true, reEncode: true })

      expect(createSceneSegments).toHaveBeenCalledWith('video.mp4', '/out', [0, 5.2, 12.8, 120], true, true)
    })
  })
})

describe('setupCli', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('configures CLI with correct name, version, and options then calls parse', () => {
    setupCli()
    const program = vi.mocked(Command).mock.results[0].value
    expect(program.name).toHaveBeenCalledWith('video-cutter')
    expect(program.version).toHaveBeenCalledWith('1.0.0')
    expect(program.requiredOption).toHaveBeenCalledWith('-i, --input <path>', expect.any(String))
    expect(program.action).toHaveBeenCalledWith(processVideo)
    expect(program.parse).toHaveBeenCalled()
  })

  it('registers --timecodes option via addOption', () => {
    setupCli()
    expect(vi.mocked(Option)).toHaveBeenCalledWith(
      expect.stringContaining('--timecodes'),
      expect.any(String)
    )
  })
})
