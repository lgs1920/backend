/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: ConvertVideoController.js                                                                                    *
 *                                                                                                                    *
 * Author : LGS1920 Team                                                                                              *
 * email: contact@lgs1920.fr                                                                                          *
 *                                                                                                                    *
 * Created on: 2025-08-01                                                                                             *
 * Last modified: 2025-08-01                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2025 LGS1920                                                                                           *
 **********************************************************************************************************************/

import { nanoid }            from 'nanoid'
import * as path             from 'node:path'
import { tmpdir }            from 'node:os'
import { activeConversions } from './conversions'

export class ConvertVideoController {
    FFMPEG_PATH = 'ffmpeg'

    /**
     * Starts SSE stream for progress updates
     * @param {Object} args - Route arguments containing params, set
     * @returns {AsyncGenerator} SSE stream for progress updates
     */
    async* startProgressStream({params = {}, set = {}}) {
        const {id} = params

        set.headers['Content-Type'] = 'text/event-stream'
        set.headers['Cache-Control'] = 'no-cache'
        set.headers['Connection'] = 'keep-alive'
        set.headers['Access-Control-Expose-Headers'] = 'X-Conversion-Id'

        if (!id || !activeConversions.has(id)) {
            console.error(`[progress][${id || 'unknown'}] Invalid ID or conversion not found`)
            set.status = 404
            yield `data: ${JSON.stringify({error: 'Conversion ID not found'})}\n\n`
            return
        }

        const conversion = activeConversions.get(id)
        const duration = conversion.duration

        console.log(`[progress][${id}] Starting SSE stream, duration: ${duration ? duration.toFixed(2) : 'N/A'} seconds`)
        yield `data: ${JSON.stringify({started: true, conversionId: id, percentage: 0, timeSec: 0})}\n\n`

        let lastPercentage = -1
        const checkInterval = 200 // Reduced interval for more frequent updates
        const heartbeatInterval = 5000
        let lastHeartbeat = Date.now()

        while (activeConversions.has(id)) {
            try {
                const percentage = conversion.percentage || 0
                const timeSec = conversion.timeSec || 0
                if (percentage !== lastPercentage) { // Update on any change
                    console.log(`[progress][${id}] Progress: ${percentage.toFixed(2)}%`)
                    yield `data: ${JSON.stringify({
                                                      percentage: Number(percentage.toFixed(2)),
                                                      timeSec:    Number(timeSec.toFixed(2)),
                                                  })}\n\n`
                    lastPercentage = percentage
                }

                if (conversion.done) {
                    console.log(`[progress][${id}] Conversion done`)
                    yield `data: ${JSON.stringify({
                                                      done:       true,
                                                      percentage: 100,
                                                      timeSec:    Number(duration ? duration.toFixed(2) : 0),
                                                  })}\n\n`
                    conversion.streamActive = false
                    break
                }

                await Bun.sleep(checkInterval)

                if (Date.now() - lastHeartbeat >= heartbeatInterval) {
                    console.log(`[progress][${id}] Sent heartbeat`)
                    yield ': heartbeat\n\n'
                    lastHeartbeat = Date.now()
                }
            }
            catch (error) {
                console.error(`[progress][${id}] Error in progress stream: ${error.message}`)
                yield `data: ${JSON.stringify({error: error.message})}\n\n`
                conversion.streamActive = false
                break
            }
        }

        if (activeConversions.has(id)) {
            activeConversions.get(id).streamActive = false
            console.log(`[progress][${id}] Stream marked as inactive`)
        }
    }

    /**
     * Performs video conversion
     * @param {Object} request - Request object
     * @param {Object} set - Response configuration object
     * @returns {Promise<Response>} Response with converted video
     */
    async convertVideo({request, set}) {
        let id = nanoid()
        let input
        let output
        console.log(`[convert][${id}] Starting conversion`)

        try {
            set.headers['Access-Control-Expose-Headers'] = 'X-Conversion-Id'

            const formData = await request.formData()
            const body = JSON.parse(formData.get('body') || '{}')
            const file = formData.get('file')
            console.log(`[convert][${id}] Request body:`, body)
            const duration = body.duration ? Number(body.duration) / 1000 : null

            if (!file || !body || !duration) {
                console.error(`[convert][${id}] Invalid request data: file=${!!file}, duration=${duration}`)
                set.status = 400
                return new Response('Invalid request data')
            }

            const {from, to, params} = body
            const originalName = file.name || 'input'
            const baseName = path.basename(originalName, path.extname(originalName))
            input = path.join(tmpdir(), `input-${id}.${from.toLowerCase()}`)
            output = path.join(tmpdir(), `output-${id}.${to.toLowerCase()}`)

            // Initialize conversion tracking
            activeConversions.set(id, {
                output,
                streamActive: true,
                duration,
                inputFile:  input,
                percentage: 0,
                timeSec:    0,
                done:       false,
            })
            console.log(`[convert][${id}] Added to activeConversions: ${activeConversions.size}`)

            // Save file temporarily
            await Bun.write(input, await file.arrayBuffer())
            console.log(`[convert][${id}] Saved input file: ${input}`)

            // Ensure file is fully written
            let fileExists = false
            let lastSize = 0
            let stableCount = 0
            const maxWaitTime = 5000
            const checkInterval = 100
            for (let elapsed = 0; elapsed < maxWaitTime; elapsed += checkInterval) {
                if (await Bun.file(input).exists()) {
                    const currentSize = await Bun.file(input).size
                    if (currentSize === lastSize && currentSize > 0) {
                        stableCount++
                        if (stableCount >= 3) {
                            fileExists = true
                            console.log(`[convert][${id}] Input file stable at ${currentSize} bytes`)
                            break
                        }
                    }
                    else {
                        stableCount = 0
                    }
                    lastSize = currentSize
                }
                await Bun.sleep(checkInterval)
            }

            if (!fileExists) {
                console.error(`[convert][${id}] Input file not ready after ${maxWaitTime}ms`)
                throw new Error('Input file not ready')
            }

            const hasAudio = await this.checkAudioTrack(input)
            const filteredParams = params.filter(arg =>
                                                     arg !== '-i' &&
                                                     !arg.includes('input.') &&
                                                     !arg.includes('output.') &&
                                                     (!arg.includes('-b:a') || hasAudio) &&
                                                     (!arg.includes('-c:a') || hasAudio)
            )

            const ffmpegArgs = ['-i', input, ...filteredParams, '-progress', 'pipe:1', '-y', output]
            console.log(`[convert][${id}] FFmpeg command: ${this.FFMPEG_PATH} ${ffmpegArgs.join(' ')}`)

            const ffmpeg = Bun.spawn([this.FFMPEG_PATH, ...ffmpegArgs], {stdio: ['ignore', 'pipe', 'pipe']})
            activeConversions.get(id).ffmpegProcess = ffmpeg // Store the process
            let ffmpegError = ''

            // Read progress from stdout
            const stdoutReader = ffmpeg.stdout.getReader()
            const stdoutPromise = (async () => {
                const decoder = new TextDecoder()
                let buffer = ''
                while (true) {
                    const {done, value} = await stdoutReader.read()
                    if (done) {
                        break
                    }
                    const chunk = decoder.decode(value, {stream: true})
                    buffer += chunk

                    const lines = buffer.split('\n')
                    buffer = lines.pop() // Keep incomplete line in buffer

                    for (const line of lines) {
                        console.log(`[convert][${id}] FFmpeg stdout: ${line}`)

                        if (line.startsWith('out_time_ms=')) {
                            const timeSec = Number(line.split('=')[1]) / 1000000
                            const percentage = duration ? Math.min(100, (timeSec / duration) * 100) : 0
                            if (activeConversions.has(id)) {
                                activeConversions.get(id).percentage = percentage
                                activeConversions.get(id).timeSec = timeSec
                            }
                        }
                        else if (line === 'progress=end') {
                            console.log(`[convert][${id}] FFmpeg progress end`)
                            if (activeConversions.has(id)) {
                                activeConversions.get(id).percentage = 100
                                activeConversions.get(id).timeSec = duration || 0
                                activeConversions.get(id).done = true
                            }
                        }
                    }
                }
            })()

            // Capture errors from stderr
            const stderrReader = ffmpeg.stderr.getReader()
            const stderrPromise = (async () => {
                while (true) {
                    const {done, value} = await stderrReader.read()
                    if (done) {
                        break
                    }
                    const chunk = new TextDecoder().decode(value)
                    ffmpegError += chunk
                    console.log(`[convert][${id}] FFmpeg stderr: ${chunk}`)
                }
            })()

            const code = await ffmpeg.exited
            await stdoutPromise
            await stderrPromise

            console.log(`[convert][${id}] FFmpeg process exited with code: ${code}`)

            if (code !== 0) {
                console.error(`[convert][${id}] FFmpeg failed with code ${code}: ${ffmpegError}`)
                set.status = 500
                throw new Error(`FFmpeg failed with code ${code}: ${ffmpegError || 'Unknown error'}`)
            }

            // Verify output file exists and has content
            if (!await Bun.file(output).exists()) {
                console.error(`[convert][${id}] Output file does not exist: ${output}`)
                set.status = 500
                throw new Error('Output file was not created')
            }

            const outputSize = await Bun.file(output).size
            if (outputSize === 0) {
                console.error(`[convert][${id}] Output file is empty: ${output}`)
                set.status = 500
                throw new Error('Output file is empty')
            }

            console.log(`[convert][${id}] Output file created successfully: ${output} (${outputSize} bytes)`)

            set.headers['Content-Type'] = 'application/octet-stream'
            set.headers['Content-Disposition'] = `attachment; filename="${baseName}.${to.toLowerCase()}"`
            set.headers['X-Conversion-Id'] = id

            // Delay cleanup to allow SSE to complete
            setTimeout(() => this.cleanupProgress(id, input, output), 10000)

            return await this.streamDownload(id, output)
        }
        catch (error) {
            console.error(`[convert][${id || 'unknown'}] Error: ${error.message}`)
            if (input && await Bun.file(input).exists()) {
                await Bun.file(input).delete()
            }
            if (output && await Bun.file(output).exists()) {
                await Bun.file(output).delete()
            }
            if (activeConversions.has(id)) {
                setTimeout(() => this.cleanupProgress(id, activeConversions.get(id).inputFile, activeConversions.get(id).output), 5000)
            }
            set.status = 500
            return new Response(`Error: ${error.message}`)
        }
    }

    /**
     * Streams the converted video
     * @param {string} id - Conversion ID
     * @param {string} output - Output file path
     * @returns {Response} Streamed response
     */
    async streamDownload(id, output) {
        try {
            const outputFile = Bun.file(output)
            if (!await outputFile.exists()) {
                console.error(`[download][${id}] Output file not found: ${output}`)
                return new Response('Output file not found', {status: 500})
            }

            console.log(`[download][${id}] Starting stream download for: ${output}`)
            const stream = outputFile.stream()
            return new Response(stream, {
                headers: {
                    'Content-Type': 'application/octet-stream',
                }
            })
        }
        catch (error) {
            console.error(`[download][${id}] Error: ${error.message}`)
            return new Response(`Error: ${error.message}`, {status: 500})
        }
    }

    /**
     * Cleans up files and conversion tracking
     * @param {string} id - Conversion ID
     * @param {string} inputFile - Input file path
     * @param {string} outputFile - Output file path
     */
    async cleanupProgress(id, inputFile, outputFile) {
        try {
            console.log(`[cleanup][${id}] Starting cleanup process`)
            if (activeConversions.has(id)) {
                const conversion = activeConversions.get(id)
                if (conversion.ffmpegProcess && !conversion.ffmpegProcess.killed) {
                    conversion.ffmpegProcess.kill()
                    console.log(`[cleanup][${id}] Killed FFmpeg process`)
                }
                if (inputFile && await Bun.file(inputFile).exists()) {
                    await Bun.file(inputFile).delete()
                    console.log(`[cleanup][${id}] Deleted input file: ${inputFile}`)
                }
                if (outputFile && await Bun.file(outputFile).exists()) {
                    await Bun.file(outputFile).delete()
                    console.log(`[cleanup][${id}] Deleted output file: ${outputFile}`)
                }
                activeConversions.delete(id)
                console.log(`[cleanup][${id}] Removed from activeConversions: ${activeConversions.size}`)
            }
        }
        catch (error) {
            console.error(`[cleanup][${id}] Error: ${error.message}`)
        }
    }

    /**
     * Checks for audio track in the input file
     * @param {string} input - Input file path
     * @returns {Promise<boolean>} True if audio track exists
     */
    async checkAudioTrack(input) {
        try {
            const ffprobe = Bun.spawn(['ffprobe', '-v', 'error', '-show_streams', '-select_streams', 'a', input])
            return (await ffprobe.exited) === 0
        }
        catch (error) {
            console.error(`[ffprobe] Error checking audio track: ${error.message}`)
            return false
        }
    }
}