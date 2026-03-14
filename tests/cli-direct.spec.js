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

// Tests that index.js calls setupCli() when invoked as the main entry point.
// This file has its own module registry so vi.doMock works correctly.

import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'path'
import { fileURLToPath } from 'url'

describe('index.js invoked directly as main module', () => {
  afterEach(() => vi.resetModules())

  it('calls program.parse() when process.argv[1] matches the module path', async () => {
    const parseMock = vi.fn()

    vi.doMock('child_process', () => ({
      execSync: vi.fn(), // does not throw → ffmpeg available
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
        parse: parseMock
      }
      return {
        // eslint-disable-next-line prefer-arrow-callback
        Command: vi.fn(function MockCommand () { return mockProgram }),
        // eslint-disable-next-line prefer-arrow-callback
        Option: vi.fn(function MockOption () { return { conflicts: vi.fn().mockReturnThis() } })
      }
    })

    // Simulate running `node index.js` by setting argv[1] to the index.js path
    const indexPath = path.resolve(fileURLToPath(new URL('../index.js', import.meta.url)))
    const originalArgv1 = process.argv[1]
    process.argv[1] = indexPath

    try {
      await import('../index.js')
    } finally {
      process.argv[1] = originalArgv1
    }

    expect(parseMock).toHaveBeenCalled()
  })

  it('does not call setupCli when process.argv[1] is empty (covers falsy argv branch)', async () => {
    vi.doMock('child_process', () => ({
      execSync: vi.fn(),
      spawn: vi.fn()
    }))
    vi.doMock('../src/core.js', () => ({
      getVideoDuration: vi.fn(),
      createCountSegments: vi.fn(),
      createTimeSegments: vi.fn(),
      detectSceneChanges: vi.fn(),
      createSceneSegments: vi.fn()
    }))
    const parseMock = vi.fn()
    vi.doMock('commander', () => {
      const mockProgram = {
        name: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        version: vi.fn().mockReturnThis(),
        requiredOption: vi.fn().mockReturnThis(),
        addOption: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
        parse: parseMock
      }
      return {
        // eslint-disable-next-line prefer-arrow-callback
        Command: vi.fn(function MockCommand () { return mockProgram }),
        // eslint-disable-next-line prefer-arrow-callback
        Option: vi.fn(function MockOption () { return { conflicts: vi.fn().mockReturnThis() } })
      }
    })

    // Empty argv[1] triggers the `? ... : ''` false branch in index.js
    const originalArgv1 = process.argv[1]
    process.argv[1] = ''

    try {
      await import('../index.js')
    } finally {
      process.argv[1] = originalArgv1
    }

    // setupCli is not called because mainModule ('') !== path to index.js
    expect(parseMock).not.toHaveBeenCalled()
  })
})
