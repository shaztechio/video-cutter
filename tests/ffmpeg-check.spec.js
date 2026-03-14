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

// This file tests the module-level ffmpeg/ffprobe availability check in index.js.
// It uses vi.doMock (not hoisted) so that the mock is applied before the dynamic import.

import { describe, it, expect, vi } from 'vitest'

describe('module-level ffmpeg/ffprobe check', () => {
  it('exits with code 1 when ffmpeg is not installed', async () => {
    vi.doMock('child_process', () => ({
      // eslint-disable-next-line prefer-arrow-callback
      execSync: vi.fn(function execSync () { throw new Error('command not found') }),
      spawn: vi.fn()
    }))
    vi.doMock('../src/core.js', () => ({
      getVideoDuration: vi.fn(),
      createCountSegments: vi.fn(),
      createTimeSegments: vi.fn(),
      detectSceneChanges: vi.fn(),
      createSceneSegments: vi.fn()
    }))
    vi.doMock('commander', () => {
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
      return {
        // eslint-disable-next-line prefer-arrow-callback
        Command: vi.fn(function MockCommand () { return mockProgram }),
        // eslint-disable-next-line prefer-arrow-callback
        Option: vi.fn(function MockOption () { return { conflicts: vi.fn().mockReturnThis() } })
      }
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await import('../index.js')
    } catch (e) {
      // expected: process.exit() throws in test environment
    }

    expect(exitSpy).toHaveBeenCalledWith(1)
    vi.restoreAllMocks()
  })
})
