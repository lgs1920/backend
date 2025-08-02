
/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: ConvertVideoController.js                                                                                    *
 *                                                                                                                    *
 * Author : LGS1920 Team                                                                                              *
 * email: contact@lgs1920.fr                                                                                          *
 *                                                                                                                    *
 * Created on: 2025-08-02                                                                                             *
 * Last modified: 2025-08-02                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2025 LGS1920                                                                                           *
 **********************************************************************************************************************/

/**
 * Controller for handling video conversion operations
 */
import { nanoid } from 'nanoid'
import * as path  from 'node:path'
import { tmpdir } from 'node:os'
import { activeConversions } from './conversions'

export class ConvertVideoController {
    FFMPEG_PATH = 'ffmpeg'
    verbose = false

    /**
     * Starts SSE stream for progress updates
     * @param {Object} args - Route arguments containing params, set, query
     * @returns {AsyncGenerator} SSE stream for progress updates
     */
    async* startProgressStream({params = {}, set = {}, query = {}}) {
        const {id} = params
        const {debug = 'false', interval = '500'} = query
        const encoder = new TextEncoder()

        // Log query parameters for debugging
        if (this.verbose) {
            console.log(`[progress][${id}] Query parameters: debug=${debug}, interval=${interval}`)
        }

        // Configure headers for SSE
        set.headers['Content-Type'] = 'text/event-stream'
        set.headers['Cache-Control'] = 'no-cache'
        set.headers['Connection'] = 'keep-alive'
        set.headers['Access-Control-Expose-Headers'] = 'X-Conversion-Id'
        set.headers['X-Accel-Buffering'] = 'no'

        if (!id || !activeConversions.has(id)) {
            console.error(`[progress][${id || 'unknown'}] Invalid ID or conversion not found`)
            set.status = 404
            yield encoder.encode(`event: error\ndata: ${JSON.stringify({error: 'Conversion ID not found'})}\n\n`)
            set.flush && set.flush()
            return
        }

        const conversion = activeConversions.get(id)
        const duration = conversion.duration
        const checkInterval = parseInt(interval) || 50 // Use query interval or default to 50ms

        if (this.verbose || debug === 'true') {
            console.log(`[progress][${id}] Starting SSE stream, duration: ${duration ? duration.toFixed(2) : 'N/A'} seconds, checkInterval: ${checkInterval}ms`)
        }
        yield encoder.encode(`event: start\ndata: ${JSON.stringify({started:         true,
                                                                       conversionId: id,
                                                                       percentage:   0,
                                                                       timeSec:      0,
                                                                   })}\n\n`)
        set.flush && set.flush() // Force immediate send

        let lastPercentage = -1
        const heartbeatInterval = 5000
        let lastHeartbeat = Date.now()

        while (activeConversions.has(id)) {
            try {
                const percentage = conversion.percentage || 0
                const timeSec = conversion.timeSec || 0
                if (percentage !== lastPercentage) {
                    console.log(`[progress][${id}] Conversion progress: ${percentage.toFixed(2)}% (${timeSec.toFixed(2)}s / ${duration ? duration.toFixed(2) : 'N/A'}s)`)
                    yield encoder.encode(`event: progress\ndata: ${JSON.stringify({
                                                                                      percentage: Number(percentage.toFixed(2)),
                                                                                      timeSec:    Number(timeSec.toFixed(2)),
                                                                                  })}\n\n`)
                    set.flush && set.flush() // Force immediate send
                    lastPercentage = percentage
                }

                if (conversion.done) {
                    console.log(`[progress][${id}] Conversion completed`)
                    yield encoder.encode(`event: complete\ndata: ${JSON.stringify({
                                                                                      done:       true,
                                                                                      percentage: 100,
                                                                                      timeSec:    Number(duration ? duration.toFixed(2) : timeSec),
                                                                                  })}\n\n`)
                    set.flush && set.flush() // Force immediate send
                    conversion.streamActive = false
                    break
                }

                await Bun.sleep(checkInterval)

                if (Date.now() - lastHeartbeat >= heartbeatInterval) {
                    if (this.verbose || debug === 'true') {
                        console.log(`[progress][${id}] Sent heartbeat`)
                    }
                    yield encoder.encode(`event: heartbeat\ndata: heartbeat\n\n`)
                    set.flush && set.flush() // Force immediate send
                    lastHeartbeat = Date.now()
                }
            }
            catch (error) {
                console.error(`[progress][${id}] Error in progress stream: ${error.message}`)
                yield encoder.encode(`event: error\ndata: ${JSON.stringify({error: error.message})}\n\n`)
                set.flush && set.flush() // Force immediate send
                conversion.streamActive = false
                break
            }
        }

        if (activeConversions.has(id)) {
            conversion.streamActive = false
            if (this.verbose || debug === 'true') {
                console.log(`[progress][${id}] Stream marked as inactive`)
            }
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
            this.verbose = body.verbose !== undefined ? body.verbose : false
            if (this.verbose) {
                console.log(`[convert][${id}] Request body:`, body)
            }
            let duration = body.duration ? Number(body.duration) / 1000 : null

            if (!file || !body) {
                console.error(`[convert][${id}] Invalid request data: file=${!!file}, body=${!!body}`)
                set.status = 400
                return new Response('Invalid request data')
            }

            const {from, to, params, metadata} = body
            const originalName = file.name || 'input'
            const baseName = path.basename(originalName, path.extname(originalName))
            input = path.join(tmpdir(), `input-${id}.${from.toLowerCase()}`)
            output = path.join(tmpdir(), `output-${id}.${to.toLowerCase()}`)

            // Initialize conversion tracking
            activeConversions.set(id, {
                output,
                streamActive: true,
                duration,
                inputFile: input,
                percentage: 0,
                timeSec:   0,
                done:      false,
            })

            // Wait for SSE connection
            console.log(`[convert][${id}] Waiting for SSE connection...`)
            await Bun.sleep(1000) // Wait 1 second

            if (this.verbose) {
                console.log(`[convert][${id}] Added to activeConversions: ${activeConversions.size}`)
            }

            // Save file temporarily
            await Bun.write(input, await file.arrayBuffer())
            if (this.verbose) {
                console.log(`[convert][${id}] Saved input file: ${input}`)
            }

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
                            if (this.verbose) {
                                console.log(`[convert][${id}] Input file stable at ${currentSize} bytes`)
                            }
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

            // Get duration from file if not provided or invalid
            if (!duration || duration <= 0) {
                duration = await this.getFileDuration(input)
                if (duration === null) {
                    console.warn(`[convert][${id}] Could not retrieve duration, setting to 1 to avoid division by zero`)
                    duration = 1 // Fallback to avoid division by zero
                }
                if (this.verbose) {
                    console.log(`[convert][${id}] Duration from ffprobe: ${duration.toFixed(2)} seconds`)
                }
            }

            // Update duration in activeConversions
            activeConversions.get(id).duration = duration

            // Add metadata to input file, overwriting the original input
            if (metadata) {
                const metadataArgs = this.buildMetadataArgs(metadata)
                const tempInput = path.join(tmpdir(), `temp-input-${id}.${from.toLowerCase()}`)
                const fixArgs = ['-i', input, '-map', '0', '-c', 'copy', '-fflags', '+genpts', ...metadataArgs, '-y', tempInput]
                if (this.verbose) {
                    console.log(`[convert][${id}] Fixing input with metadata: ${this.FFMPEG_PATH} ${fixArgs.join(' ')}`)
                }
                const fixProcess = Bun.spawn([this.FFMPEG_PATH, ...fixArgs])
                const fixCode = await fixProcess.exited
                if (fixCode !== 0) {
                    console.error(`[convert][${id}] Failed to add metadata, exit code: ${fixCode}`)
                    throw new Error('Failed to add metadata')
                }
                await Bun.write(input, await Bun.file(tempInput).arrayBuffer())
                await Bun.file(tempInput).delete()
                if (this.verbose) {
                    console.log(`[convert][${id}] Metadata added, input file updated: ${input}`)
                }

                // Update duration after metadata processing
                const newDuration = await this.getFileDuration(input)
                if (newDuration !== null) {
                    activeConversions.get(id).duration = newDuration
                    duration = newDuration
                    if (this.verbose) {
                        console.log(`[convert][${id}] Updated duration: ${newDuration.toFixed(2)} seconds`)
                    }
                }
            }

            const hasAudio = await this.checkAudioTrack(input)
            const filteredParams = params.filter(arg =>
                                                     arg !== '-i' &&
                                                     !arg.includes('input.') &&
                                                     !arg.includes('output.') &&
                                                     (!arg.includes('-b:a') || hasAudio) &&
                                                     (!arg.includes('-c:a') || hasAudio)
            )

            // Add options for real-time stdout
            const ffmpegArgs = ['-i', input, ...filteredParams, '-progress', 'pipe:1', '-flush_packets', '1', '-map_metadata', '0', '-y', output]
            if (this.verbose) {
                console.log(`[convert][${id}] FFmpeg command: ${this.FFMPEG_PATH} ${ffmpegArgs.join(' ')}`)
            }

            const ffmpeg = Bun.spawn([this.FFMPEG_PATH, ...ffmpegArgs], {stdio: ['ignore', 'pipe', 'pipe']})
            activeConversions.get(id).ffmpegProcess = ffmpeg
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
                    buffer = lines.pop()
                    for (const line of lines) {
                        if (this.verbose) {
                            console.log(`[convert][${id}] FFmpeg stdout: ${line}`)
                        }
                        if (line.startsWith('out_time_ms=')) {
                            const timeSec = Number(line.split('=')[1]) / 1000000
                            const percentage = duration ? Math.min(100, (timeSec / duration) * 100) : 0
                            if (activeConversions.has(id)) {
                                activeConversions.get(id).percentage = percentage
                                activeConversions.get(id).timeSec = timeSec
                                console.log(`[convert][${id}] Conversion progress: ${percentage.toFixed(2)}% (${timeSec.toFixed(2)}s / ${duration.toFixed(2)}s)`)
                            }
                        }
                        else if (line === 'progress=end') {
                            if (this.verbose) {
                                console.log(`[convert][${id}] FFmpeg progress end`)
                            }
                            if (activeConversions.has(id)) {
                                activeConversions.get(id).percentage = 100
                                activeConversions.get(id).timeSec = duration || timeSec || 0
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
                    if (this.verbose) {
                        console.log(`[convert][${id}] FFmpeg stderr: ${chunk}`)
                    }
                }
            })()

            const code = await ffmpeg.exited
            await stdoutPromise
            await stderrPromise

            console.log(`[convert][${id}] FFmpeg process exited with code: ${code}`)

            if (code !== 0) {
                console.error(`[convert][${id}] FFmpeg failed with code ${code}: ${ffmpegError || 'Unknown error'}`)
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
                setTimeout(() => this.cleanupProgress(id, input, output), 5000)
            }
            set.status = 500
            return new Response(`Error: ${error.message}`)
        }
    }

    /**
     * Builds FFmpeg metadata arguments from request body metadata
     * @param {Object} metadata - Metadata object from request body
     * @returns {Array<string>} Array of FFmpeg metadata arguments
     */
    buildMetadataArgs(metadata) {
        const args = []
        if (metadata.artist) {
            args.push('-metadata', `artist="${metadata.artist}"`)
        }
        if (metadata.date) {
            args.push('-metadata', `creation_time="${metadata.date}"`)
        }
        if (metadata.description) {
            args.push('-metadata', `comment="${metadata.description}"`)
        }
        return args
    }

    /**
     * Gets the duration of a video file using ffprobe
     * @param {string} input - Input file path
     * @returns {Promise<number|null>} Duration in seconds or null if not available
     */
    async getFileDuration(input) {
        try {
            const ffprobe = Bun.spawn(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', input], {
                stdio: ['ignore', 'pipe', 'pipe'],
            })
            const stdout = await new Response(ffprobe.stdout).text()
            const data = JSON.parse(stdout)
            const duration = parseFloat(data.format?.duration)
            if (isNaN(duration)) {
                console.error(`[ffprobe][${input}] Invalid duration in ffprobe output`)
                return null
            }
            return duration
        }
        catch (error) {
            console.error(`[ffprobe][${input}] Error retrieving duration: ${error.message}`)
            return null
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

            if (this.verbose) {
                console.log(`[download][${id}] Starting stream download for: ${output}`)
            }
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
                    if (this.verbose) {
                        console.log(`[cleanup][${id}] Killed FFmpeg process`)
                    }
                }
                if (inputFile && await Bun.file(inputFile).exists()) {
                    await Bun.file(inputFile).delete()
                    if (this.verbose) {
                        console.log(`[cleanup][${id}] Deleted input file: ${inputFile}`)
                    }
                }
                if (outputFile && await Bun.file(outputFile).exists()) {
                    await Bun.file(outputFile).delete()
                    if (this.verbose) {
                        console.log(`[cleanup][${id}] Deleted output file: ${outputFile}`)
                    }
                }
                activeConversions.delete(id)
                if (this.verbose) {
                    console.log(`[cleanup][${id}] Removed from activeConversions: ${activeConversions.size}`)
                }
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