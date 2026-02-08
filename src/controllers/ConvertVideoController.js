/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: ConvertVideoController.js                                                                                    *
 *                                                                                                                    *
 * Author : LGS1920 Team                                                                                              *
 * email: contact@lgs1920.fr                                                                                          *
 *                                                                                                                    *
 * Created on: 2025-08-08                                                                                             *
 * Last modified: 2025-08-08                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2025 LGS1920                                                                                           *
 **********************************************************************************************************************/

import { spawn }             from 'bun'
import { nanoid }            from 'nanoid'
import * as path             from 'node:path'
import { tmpdir }            from 'node:os'
import { readdir, unlink }   from 'node:fs/promises'
import { activeConversions } from './conversions'
import { configuration, CONVERT_VIDEO_ROUTE } from '../index'

/**
 * Controller for handling video conversion operations
 * Manages FFmpeg-based video conversion with real-time progress tracking via SSE and polling
 */
export class ConvertVideoController {
    /** @private {boolean} Verbose logging flag */
    #verbose = false

    // Constants for timing and thresholds
    /** @private {number} Maximum time to wait for file operations */
    static #WAIT_TIMEOUT = 5000
    /** @private {number} Interval for file stability checks */
    static #CHECK_INTERVAL = 100
    /** @private {number} Heartbeat interval for SSE connections */
    static #HEARTBEAT_INTERVAL = 5000
    /** @private {number} Delay before fallback cleanup operations (10 minutes) */
    static #CLEANUP_DELAY = 600000 // 10 minutes in milliseconds
    /** @private {number} Minimum progress change threshold for SSE updates */
    static #MIN_PROGRESS_THRESHOLD = 0.1
    /** @private {number} Maximum retry attempts for finding conversions */
    static #MAX_RETRY_ATTEMPTS = 50
    /** @private {number} Retry interval for finding conversions */
    static #RETRY_INTERVAL = 100

    /**
     * Constructor initializes periodic cleanup and temp directory cleanup
     */
    constructor() {
        this.#cleanupTempDir()
        this.#cleanupStaleConversions()
    }

    /**
     * Cleans up leftover temporary files on startup, avoiding active conversion files
     * @private
     */
    #cleanupTempDir = async () => {
        try {
            this.#logInfo('[cleanup][startup] Starting cleanup of temporary directory', false)

            // Collect active file paths from activeConversions
            const activeFiles = new Set()
            for (const conversion of activeConversions.values()) {
                if (conversion.inputFile) {
                    activeFiles.add(conversion.inputFile)
                }
                if (conversion.output) {
                    activeFiles.add(conversion.output)
                }
            }

            const tempDir = tmpdir()
            const files = await readdir(tempDir)
            for (const file of files) {
                if (file.startsWith('input_') || file.startsWith('output_') || file.startsWith('downloaded_')) {
                    const filePath = path.join(tempDir, file)
                    if (!activeFiles.has(filePath) && await Bun.file(filePath).exists()) {
                        try {
                            await unlink(filePath)
                            this.#logInfo(`[cleanup][startup] Deleted leftover file: ${filePath}`, false)
                        }
                        catch (error) {
                            this.#logError(`[cleanup][startup] Could not delete file ${filePath}: ${error.message}`)
                        }
                    }
                }
            }
            this.#logInfo('[cleanup][startup] Temporary directory cleanup completed', false)
        }
        catch (error) {
            this.#logError(`[cleanup][startup] Error during temp directory cleanup: ${error.message}`)
        }
    }

    /**
     * Periodically cleans up stale conversions
     * @private
     */
    #cleanupStaleConversions = () => {
        setInterval(async () => {
            try {
                this.#logInfo('[cleanup][stale] Checking for stale conversions', false)
                const now = Date.now()
                for (const [id, conversion] of activeConversions) {
                    if (conversion.done && !conversion.downloadStarted && now - conversion.timestamp > ConvertVideoController.#CLEANUP_DELAY) {
                        this.#logInfo(`[cleanup][stale][${id}] Cleaning up stale conversion`, false)
                        await this.#cleanupAfterDownload(id, conversion.inputFile, conversion.output)
                    }
                }
                this.#logInfo(`[cleanup][stale] Stale conversions cleanup completed, ${activeConversions.size} remaining`, false)
            }
            catch (error) {
                this.#logError(`[cleanup][stale] Error during stale conversions cleanup: ${error.message}`)
            }
        }, ConvertVideoController.#CLEANUP_DELAY)
    }

    /**
     * Starts video conversion asynchronously and returns conversion ID immediately
     * @param {Object} context - Request context
     * @param {Request} context.request - HTTP request object
     * @param {Object} context.set - Response headers object
     * @returns {Promise<Response>} Conversion ID response
     */
    convertVideo = async ({request, set}) => {
        const id = nanoid()

        try {
            const {body, file} = await this.#parseRequest(request)
            this.#verbose = body.verbose ?? false
            const isDebug = (new URL(request.url).searchParams.get('debug') === 'true') || false

            this.#logIfVerbose(`[convert][${id}] Parsed request body:`, isDebug, body)
            this.#validateRequest(file, body, id)

            // Set up conversion tracking immediately
            const duration = body.duration ? Number(body.duration) / 1000 : null
            activeConversions.set(id, {
                streamActive: false,
                duration:    duration || 1, // Will be updated later
                percentage: 0,
                timeSec:     0,
                done:        false,
                error:       null,
                outputReady: false,
                originalName: file.name || 'converted',
                outputFormat: body.to,
                downloadStarted: false,
                cancelled:   false,
                inputFile:   null, // Will be set in #setupFiles
                output:      null, // Will be set in #setupFiles
                isDownloaded: file.isDownloaded || false, // Track if file was read from path
                timestamp:   Date.now(), // For cleanup timing
            })

            // Start conversion in background (fire and forget)
            this.#startBackgroundConversion(id, file, body, isDebug).catch(error => {
                this.#logError(`[convert][${id}] Background conversion failed: ${error.message}`)
                if (activeConversions.has(id)) {
                    const conversion = activeConversions.get(id)
                    conversion.error = error.message
                    conversion.done = true

                    // Notify SSE stream of error if active
                    const {controller, encoder, isDebug: streamDebug} = conversion.sseStream || {}
                    if (controller && encoder) {
                        this.#handleStreamError(id, controller, encoder, error, streamDebug)
                    }
                }
            })

            // Return conversion ID immediately with all URLs
            set.headers['Access-Control-Expose-Headers'] = 'X-Conversion-Id'
            set.headers['X-Conversion-Id'] = id
            set.headers['Content-Type'] = 'application/json'

            return new Response(JSON.stringify({
                                                   success:  true,
                                                   conversionId: id,
                                                   message:  'Conversion started successfully',
                                                   urls:     {
                                                       progress: `/${CONVERT_VIDEO_ROUTE.convert}${CONVERT_VIDEO_ROUTE.progress}/${id}`,
                                                       download: `/${CONVERT_VIDEO_ROUTE.convert}${CONVERT_VIDEO_ROUTE.download}/${id}`,
                                                       cancel: `/${CONVERT_VIDEO_ROUTE.convert}${CONVERT_VIDEO_ROUTE.cancel}/${id}`,
                                                   },
                                                   metadata: {
                                                       timestamp:    new Date().toISOString(),
                                                       originalFilename: file.name,
                                                       targetFormat: body.to,
                                                       estimatedDuration: duration ? `${duration}s` : 'unknown',
                                                   },
                                               }) + '\n\n', {
                                    headers: {'Content-Type': 'application/json'},
                                })
        }
        catch (error) {
            this.#logError(`[convert][${id}] Setup error: ${error.message}`)
            set.status = 500
            return new Response(JSON.stringify({
                                                   success: false,
                                                   error: error.message,
                                               }) + '\n\n', {
                headers: {'Content-Type': 'application/json'},
                                })
        }
    }

    /**
     * Downloads the converted file and cleans up after completion
     * @param {Object} context - Request context
     * @param {Object} context.params - URL parameters
     * @param {string} context.params.id - Conversion ID
     * @param {Object} context.set - Response headers object
     * @returns {Promise<Response>} Download response or error
     */
    downloadConvertedFile = async ({params, set}) => {
        const {id} = params

        if (!activeConversions.has(id)) {
            this.#logError(`[download][${id}] Conversion not found`)
            set.status = 404
            return new Response(JSON.stringify({error: 'Conversion not found'}) + '\n\n', {
                headers: {'Content-Type': 'application/json'},
            })
        }

        const conversion = activeConversions.get(id)

        if (conversion.error) {
            this.#logError(`[download][${id}] Conversion has error: ${conversion.error}`)
            set.status = 500
            return new Response(JSON.stringify({error: conversion.error}) + '\n\n', {
                headers: {'Content-Type': 'application/json'},
            })
        }

        if (!conversion.done || !conversion.outputReady) {
            this.#logInfo(`[download][${id}] Conversion not ready: done=${conversion.done}, outputReady=${conversion.outputReady}`, false)
            set.status = 202 // Accepted but not ready
            return new Response(JSON.stringify({
                                                   message: 'Conversion in progress',
                                                   percentage: conversion.percentage,
                                               }) + '\n\n', {
                headers: {'Content-Type': 'application/json'},
                                })
        }

        // File is ready, stream download
        const output = conversion.output
        if (!output || !await Bun.file(output).exists()) {
            this.#logError(`[download][${id}] Output file not found: ${output}`)
            set.status = 500
            return new Response(JSON.stringify({error: 'Output file not found'}) + '\n\n', {
                headers: {'Content-Type': 'application/json'},
            })
        }

        // Mark download as started to prevent premature cleanup
        conversion.downloadStarted = true

        // Set download headers
        const originalName = conversion.originalName || 'converted'
        const baseName = path.basename(originalName, path.extname(originalName))
        const outputFormat = conversion.outputFormat || 'mp4'

        set.headers['Content-Type'] = 'application/octet-stream'
        set.headers['Content-Disposition'] = `attachment; filename="${baseName}.${outputFormat.toLowerCase()}"`

        return this.#streamDownloadWithCleanup(id, output)
    }

    /**
     * Cancels an ongoing conversion and cleans up resources
     * @param {Object} context - Request context
     * @param {Object} context.params - URL parameters
     * @param {string} context.params.id - Conversion ID
     * @param {Object} context.set - Response headers object
     * @returns {Promise<Response>} Cancellation response
     */
    cancelConversion = async ({params, set}) => {
        const {id} = params

        if (!activeConversions.has(id)) {
            set.status = 404
            return new Response(JSON.stringify({
                                                   success: false,
                                                   error: 'Conversion not found',
                                               }) + '\n\n', {
                headers: {'Content-Type': 'application/json'},
                                })
        }

        const conversion = activeConversions.get(id)

        try {
            // Mark as cancelled
            conversion.cancelled = true
            conversion.error = 'Conversion cancelled by user'
            conversion.done = true

            this.#logInfo(`[cancel][${id}] Cancelling conversion (status: ${conversion.percentage}% completed)`, false)

            // Kill FFmpeg process if running
            if (conversion.ffmpegProcess && !conversion.ffmpegProcess.killed) {
                conversion.ffmpegProcess.kill('SIGTERM') // Graceful termination
                this.#logInfo(`[cancel][${id}] FFmpeg process terminated`, false)

                // Force kill if still running after 2 seconds
                setTimeout(() => {
                    if (conversion.ffmpegProcess && !conversion.ffmpegProcess.killed) {
                        conversion.ffmpegProcess.kill('SIGKILL')
                        this.#logInfo(`[cancel][${id}] FFmpeg process force killed`, false)
                    }
                }, 2000)
            }

            // Notify SSE stream of cancellation
            if (conversion.sseStream?.controller && conversion.streamActive) {
                try {
                    const {controller, encoder} = conversion.sseStream
                    const cancelData = {
                        cancelled: true,
                        message: 'Conversion cancelled by user',
                        percentage: conversion.percentage,
                    }
                    controller.enqueue(encoder.encode(`event: cancelled\ndata: ${JSON.stringify(cancelData)}\n\n`))
                    controller.close()
                }
                catch (e) {
                    // Stream might already be closed
                }
                conversion.streamActive = false
                delete conversion.sseStream
            }

            // Clean up files immediately
            const inputFile = conversion.inputFile
            const outputFile = conversion.output
            await this.#cleanupFiles(inputFile, outputFile)

            // Remove from active conversions
            activeConversions.delete(id)
            this.#logInfo(`[cleanup][${id}] Removed from active conversions (${activeConversions.size} remaining)`, true)

            set.headers['Content-Type'] = 'application/json'
            return new Response(JSON.stringify({
                                                   success: true,
                                                   message: 'Conversion cancelled successfully',
                                                   conversionId: id,
                                                   finalPercentage: conversion.percentage,
                                               }) + '\n\n', {
                                    headers: {'Content-Type': 'application/json'},
                                })
        }
        catch (error) {
            this.#logError(`[cancel][${id}] Error during cancellation: ${error.message}`)
            // Attempt to clean up files on error
            const inputFile = conversion.inputFile
            const outputFile = conversion.output
            await this.#cleanupFiles(inputFile, outputFile)

            set.status = 500
            return new Response(JSON.stringify({
                                                   success: false,
                                                   error: `Cancellation failed: ${error.message}`,
                                               }) + '\n\n', {
                headers: {'Content-Type': 'application/json'},
                                })
        }
    }

    /**
     * Handles progress updates via SSE (sse=true) or polling (sse=false)
     * Returns a stream for SSE or a single JSON response for polling
     * @param {Object} context - Request context
     * @param {Object} context.params - URL parameters
     * @param {string} context.params.id - Conversion ID
     * @param {Object} context.set - Response headers object
     * @param {Object} context.request - HTTP request object
     * @returns {Promise<Response>} SSE stream or JSON response
     */
    startProgressStream = async ({request, params, set}) => {
        const {id: conversionId} = params
        const url = new URL(request.url)
        const query = url.searchParams
        const sse = query.get('sse') === 'true'
        const isDebug = query.get('debug') === 'true'

        // Retrieve conversion context
        const conversion = activeConversions.get(conversionId)
        if (!conversion) {
            this.#logError(`[progress][${conversionId}] Conversion not found`)
            set.status = 404
            return new Response(JSON.stringify({success: false, error: 'Conversion not found'}) + '\n\n', {
                status:  404,
                headers: {'Content-Type': 'application/json'},
            })
        }

        // Ensure FFmpeg is started and duration is available
        if (!conversion.ffmpegProcess && !conversion.done) {
            this.#logInfo(`[progress][${conversionId}] Starting FFmpeg for conversion`, isDebug)
            await this.#startBackgroundConversion(conversionId, {
                name:         conversion.originalName,
                isDownloaded: conversion.isDownloaded,
            }, conversion.body, isDebug)
        }

        if (sse) {
            // Mode SSE: Stream progress updates
            this.#setSSEHeaders(set)
            const stream = new ReadableStream({
                                                  start:  async (controller) => {
                                                      // Initialize SSE stream
                                                      conversion.sseStream = {
                                                          controller,
                                                          encoder: new TextEncoder(),
                                                          isDebug,
                                                      }
                                                      conversion.streamActive = true

                                                      // Wait for conversion to be registered
                                                      try {
                                                          await this.#waitForConversion(conversionId, controller, conversion.sseStream.encoder, isDebug)
                                                      }
                                                      catch (error) {
                                                          this.#handleStreamError(conversionId, controller, conversion.sseStream.encoder, error, isDebug)
                                                          controller.close()
                                                          return
                                                      }

                                                      // Send initial event with duration
                                                      this.#sendStartEvent(controller, conversion.sseStream.encoder, conversionId, conversion.duration, isDebug)

                                                      // Start heartbeat
                                                      const heartbeatInterval = setInterval(() => {
                                                          this.#sendHeartbeatEvent(controller, conversion.sseStream.encoder, conversionId, isDebug)
                                                      }, ConvertVideoController.#HEARTBEAT_INTERVAL)

                                                      // Poll cache for progress updates
                                                      const progressInterval = setInterval(() => {
                                                          const updatedConversion = activeConversions.get(conversionId)
                                                          if (!updatedConversion) {
                                                              this.#logError(`[progress][${conversionId}] Conversion not found during polling`)
                                                              this.#handleStreamError(conversionId, controller, conversion.sseStream.encoder, new Error('Conversion not found'), isDebug)
                                                              controller.close()
                                                              clearInterval(progressInterval)
                                                              clearInterval(heartbeatInterval)
                                                              return
                                                          }

                                                          if (updatedConversion.percentage !== undefined) {
                                                              if (updatedConversion.done && updatedConversion.percentage >= 100) {
                                                                  if (updatedConversion.sseStream?.controller && updatedConversion.streamActive) {
                                                                      this.#sendCompleteEvent(updatedConversion.sseStream.controller, updatedConversion.sseStream.encoder, conversionId, updatedConversion.duration, updatedConversion.timeSec, isDebug)
                                                                      updatedConversion.sseStream.controller.close()
                                                                      updatedConversion.streamActive = false
                                                                      delete updatedConversion.sseStream
                                                                  }
                                                                  clearInterval(progressInterval)
                                                                  clearInterval(heartbeatInterval)
                                                              }
                                                              else if (updatedConversion.error) {
                                                                  if (updatedConversion.sseStream?.controller && updatedConversion.streamActive) {
                                                                      this.#handleStreamError(conversionId, updatedConversion.sseStream.controller, updatedConversion.sseStream.encoder, new Error(updatedConversion.error), isDebug)
                                                                      updatedConversion.sseStream.controller.close()
                                                                      updatedConversion.streamActive = false
                                                                      delete updatedConversion.sseStream
                                                                  }
                                                                  clearInterval(progressInterval)
                                                                  clearInterval(heartbeatInterval)
                                                              }
                                                              else {
                                                                  if (updatedConversion.sseStream?.controller && updatedConversion.streamActive) {
                                                                      this.#sendProgressEvent(updatedConversion.sseStream.controller, updatedConversion.sseStream.encoder, conversionId, updatedConversion.percentage, updatedConversion.timeSec, updatedConversion.duration, isDebug)
                                                                  }
                                                              }
                                                          }
                                                      }, 1000)

                                                      // Clean up intervals on stream cancellation
                                                      conversion.sseStream.cleanup = () => {
                                                          clearInterval(progressInterval)
                                                          clearInterval(heartbeatInterval)
                                                      }
                                                  },
                                                  cancel: () => {
                                                      this.#handleStreamCancel(conversionId, isDebug)
                                                      const conversion = activeConversions.get(conversionId)
                                                      if (conversion?.sseStream?.cleanup) {
                                                          conversion.sseStream.cleanup()
                                                      }
                                                  }
                                              })

            return new Response(stream, {
                headers: {
                    'Content-Type':      'text/event-stream',
                    'Cache-Control':     'no-cache',
                    'Connection':        'keep-alive',
                    'Access-Control-Expose-Headers': 'X-Conversion-Id',
                    'X-Accel-Buffering': 'no',
                }
            })
        }
        else {
            // Mode polling: Return current progress
            if (conversion.done && conversion.percentage >= 100) {
                this.#logInfo(`[progress][${conversionId}] Conversion complete in polling mode, expecting download`, isDebug)
                const completeData = {
                    done:    true,
                    percentage: 100,
                    timeSec: Number(conversion.duration ? conversion.duration.toFixed(2) : conversion.timeSec.toFixed(2)),
                    duration: Number(conversion.duration?.toFixed(2)) || null,
                }
                const jsonResponse = JSON.stringify({
                                                        success: true,
                                                        event: 'complete',
                                                        data:  completeData,
                                                    }) + '\n\n'

                return new Response(jsonResponse, {
                    status:  200,
                    headers: {'Content-Type': 'application/json'},
                })
            }

            if (conversion.error) {
                this.#logError(`[progress][${conversionId}] Conversion error: ${conversion.error}`)
                const jsonResponse = JSON.stringify({
                                                        success: false,
                                                        event: 'error',
                                                        data:  {error: conversion.error},
                                                    }) + '\n\n'

                return new Response(jsonResponse, {
                    status:  500,
                    headers: {'Content-Type': 'application/json'},
                })
            }

            // Progress case
            const progressData = {
                percentage: Number(conversion.percentage.toFixed(2)) || 0,
                timeSec: Number(conversion.timeSec.toFixed(2)) || 0,
                duration: Number(conversion.duration?.toFixed(2)) || null,
            }
            const jsonResponse = JSON.stringify({
                                                    success: true,
                                                    event: 'progress',
                                                    data:  progressData,
                                                }) + '\n\n'

            return new Response(jsonResponse, {
                status:  200,
                headers: {'Content-Type': 'application/json'},
            })
        }
    }

    /**
     * Handles the actual conversion process in background
     * @private
     * @param {string} id - Conversion ID
     * @param {File} file - Uploaded or read file
     * @param {Object} body - Request body
     * @param {boolean} isDebug - Debug logging flag
     */
    #startBackgroundConversion = async (id, file, body, isDebug) => {
        let input, output

        try {
            const {input: inputPath, output: outputPath} = await this.#setupFiles(id, file, body, isDebug)
            input = inputPath
            output = outputPath

            // Update conversion with file paths
            const conversion = activeConversions.get(id)
            conversion.inputFile = input
            conversion.output = output
            conversion.body = body // Store body for restart if needed

            const duration = await this.#getDurationAndUpdateConversion(id, body, input, isDebug)

            await this.#processMetadata(id, body, input)

            await this.#executeConversion(id, input, output, body, duration, isDebug)

            // Mark as ready for download
            conversion.outputReady = true

            // Clean up input file immediately after conversion
            await this.#cleanupFiles(input, null, isDebug)
        }
        catch (error) {
            this.#logError(`[convert][${id}] Background conversion error: ${error.message}`)
            // Clean up both files in case of error
            await this.#cleanupFiles(input, output, isDebug)

            if (activeConversions.has(id)) {
                const conversion = activeConversions.get(id)
                conversion.error = error.message
                conversion.done = true
            }

            throw error
        }
    }

    /**
     * Streams file download with automatic cleanup after completion
     * @private
     * @param {string} id - Conversion ID
     * @param {string} output - Output file path
     * @returns {Promise<Response>} Stream download response with cleanup
     */
    #streamDownloadWithCleanup = async (id, output) => {
        try {
            const outputFile = Bun.file(output)
            if (!await outputFile.exists()) {
                this.#logError(`[download][${id}] File not found: ${output}`)
                return new Response('Output file not found', {status: 500})
            }

            const conversion = activeConversions.get(id)
            const inputFile = conversion?.inputFile

            // Create a custom readable stream that handles cleanup after download
            const stream = new ReadableStream({
                                                  start: async (controller) => {
                                                      try {
                                                          const fileStream = outputFile.stream()
                                                          const reader = fileStream.getReader()

                                                          const pump = async () => {
                                                              while (true) {
                                                                  const {done, value} = await reader.read()

                                                                  if (done) {
                                                                      // Download completed successfully
                                                                      this.#logInfo(`[download][${id}] Download completed, scheduling cleanup`, true)

                                                                      // Schedule immediate cleanup after download
                                                                      setTimeout(async () => {
                                                                          await this.#cleanupAfterDownload(id, inputFile, output)
                                                                      }, 1000) // 1 second delay to ensure stream is
                                                                               // properly closed

                                                                      controller.close()
                                                                      break
                                                                  }

                                                                  controller.enqueue(value)
                                                              }
                                                          }

                                                          await pump()
                                                      }
                                                      catch (error) {
                                                          this.#logError(`[download][${id}] Stream error during download: ${error}`)
                                                          controller.error(error)

                                                          // Cleanup on error too
                                                          setTimeout(async () => {
                                                              await this.#cleanupAfterDownload(id, inputFile, output)
                                                          }, 1000)
                                                      }
                                                  },

                                                  cancel: async () => {
                                                      // Cleanup if download is cancelled by client
                                                      this.#logInfo(`[download][${id}] Download cancelled, scheduling cleanup`, false)
                                                      setTimeout(async () => {
                                                          await this.#cleanupAfterDownload(id, inputFile, output)
                                                      }, 1000)
                                                  }
                                              })

            return new Response(stream, {
                headers: {
                    'Content-Type': 'application/octet-stream',
                }
            })
        }
        catch (error) {
            this.#logError(`[download][${id}] Stream setup error: ${error.message}`)
            // Cleanup on any error
            const conversion = activeConversions.get(id)
            const inputFile = conversion?.inputFile
            await this.#cleanupAfterDownload(id, inputFile, output)
            return new Response(`Error: ${error.message}`, {status: 500})
        }
    }

    /**
     * Cleans up all resources after download completion
     * @private
     * @param {string} id - Conversion ID
     * @param {string} inputFile - Input file path
     * @param {string} outputFile - Output file path
     */
    #cleanupAfterDownload = async (id, inputFile, outputFile) => {
        try {
            this.#logInfo(`[cleanup][${id}] Starting post-download cleanup`, false)

            if (activeConversions.has(id)) {
                const conversion = activeConversions.get(id)

                // Kill FFmpeg process if still running
                if (conversion.ffmpegProcess && !conversion.ffmpegProcess.killed) {
                    conversion.ffmpegProcess.kill()
                    this.#logIfVerbose(`[cleanup][${id}] FFmpeg process terminated`)
                }

                // Close SSE stream if still active
                if (conversion.sseStream?.controller) {
                    try {
                        conversion.sseStream.controller.close()
                    }
                    catch (e) {
                        // Stream might already be closed, ignore error
                    }
                    conversion.streamActive = false
                    delete conversion.sseStream
                }
            }

            // Delete output file (input file already deleted after conversion)
            await this.#cleanupFiles(null, outputFile)

            // Remove from active conversions
            if (activeConversions.has(id)) {
                activeConversions.delete(id)
                this.#logInfo(`[cleanup][${id}] Removed from active conversions (${activeConversions.size} remaining)`, true)
            }
        }
        catch (error) {
            this.#logError(`[cleanup][${id}] Post-download cleanup error: ${error.message}`)
        }
    }

    /**
     * Sets and generates a full path  according to the predefined
     * backend ffmpeg configuration path.
     *
     * @param {string} path - The relative path .
     * @returns {string} The full path.
     */
    #setPath = (path) => {
        return `${configuration.backend.ffmpeg}/${path}`
    }

    /**
     * Sets Server-Sent Events headers for streaming response
     * @private
     * @param {Object} set - Response headers object
     */
    #setSSEHeaders = (set) => {
        Object.assign(set.headers, {
            'Content-Type':      'text/event-stream',
            'Cache-Control':     'no-cache',
            'Connection':        'keep-alive',
            'Access-Control-Expose-Headers': 'X-Conversion-Id',
            'X-Accel-Buffering': 'no',
        })
    }

    /**
     * Waits for conversion to be registered in activeConversions
     * @private
     * @param {string} id - Conversion ID
     * @param {ReadableStreamDefaultController} controller - Stream controller
     * @param {TextEncoder} encoder - Text encoder for SSE
     * @param {boolean} isDebug - Debug logging flag
     * @throws {Error} If conversion not found after max attempts
     */
    #waitForConversion = async (id, controller, encoder, isDebug) => {
        let attempts = 0

        while (!activeConversions.has(id) && attempts < ConvertVideoController.#MAX_RETRY_ATTEMPTS) {
            this.#logIfVerbose(`[progress][${id}] Conversion not found, retrying (${attempts + 1}/${ConvertVideoController.#MAX_RETRY_ATTEMPTS})`, isDebug)
            await Bun.sleep(ConvertVideoController.#RETRY_INTERVAL)
            attempts++
        }

        if (!id || !activeConversions.has(id)) {
            throw new Error('Conversion ID not found')
        }
    }

    /**
     * Sends SSE start event
     * @private
     * @param {ReadableStreamDefaultController} controller - Stream controller
     * @param {TextEncoder} encoder - Text encoder
     * @param {string} id - Conversion ID
     * @param {number|null} duration - Total duration in seconds
     * @param {boolean} isDebug - Debug logging flag
     */
    #sendStartEvent = (controller, encoder, id, duration, isDebug) => {
        this.#logIfVerbose(`[progress][${id}] Sending start event`, isDebug)
        const startData = {
            started: true,
            conversionId: id,
            percentage: 0,
            timeSec: 0,
            duration: Number(duration?.toFixed(2)) || null,
        }
        controller.enqueue(encoder.encode(`event: start\ndata: ${JSON.stringify(startData)}\n\n`))
    }

    /**
     * Sends SSE heartbeat event
     * @private
     * @param {ReadableStreamDefaultController} controller - Stream controller
     * @param {TextEncoder} encoder - Text encoder
     * @param {string} id - Conversion ID
     * @param {boolean} isDebug - Debug logging flag
     */
    #sendHeartbeatEvent = (controller, encoder, id, isDebug) => {
        this.#logIfVerbose(`[progress][${id}] Sending heartbeat event`, isDebug)
        const heartbeatData = {
            timestamp: new Date().toISOString(),
        }
        controller.enqueue(encoder.encode(`event: heartbeat\ndata: ${JSON.stringify(heartbeatData)}\n\n`))
    }

    /**
     * Sends SSE progress event
     * @private
     * @param {ReadableStreamDefaultController} controller - Stream controller
     * @param {TextEncoder} encoder - Text encoder
     * @param {string} id - Conversion ID
     * @param {number} percentage - Conversion progress percentage
     * @param {number} timeSec - Current time in seconds
     * @param {number|null} duration - Total duration
     * @param {boolean} isDebug - Debug mode flag
     */
    #sendProgressEvent = (controller, encoder, id, percentage, timeSec, duration, isDebug) => {
        this.#logIfVerbose(`[progress][${id}] Sending progress: ${percentage.toFixed(2)}% (${timeSec.toFixed(2)}s / ${duration ? duration.toFixed(2) : 'N/A'}s)`, isDebug)

        const progressData = {
            percentage: Number(percentage.toFixed(2)),
            timeSec: Number(timeSec.toFixed(2)),
            duration: Number(duration?.toFixed(2)) || null,
        }
        controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify(progressData)}\n\n`))
    }

    /**
     * Sends SSE completion event
     * @private
     * @param {ReadableStreamDefaultController} controller - Stream controller
     * @param {TextEncoder} encoder - Text encoder
     * @param {string} id - Conversion ID
     * @param {number|null} duration - Total duration
     * @param {number} timeSec - Final time in seconds
     * @param {boolean} isDebug - Debug mode flag
     */
    #sendCompleteEvent = (controller, encoder, id, duration, timeSec, isDebug) => {
        this.#logIfVerbose(`[progress][${id}] Sending completion event`, isDebug)

        const completeData = {
            done:    true,
            percentage: 100,
            timeSec: Number(duration ? duration.toFixed(2) : timeSec.toFixed(2)),
            duration: Number(duration?.toFixed(2)) || null,
        }
        controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify(completeData)}\n\n`))
    }

    /**
     * Handles SSE stream errors
     * @private
     * @param {string} id - Conversion ID
     * @param {ReadableStreamDefaultController} controller - Stream controller
     * @param {TextEncoder} encoder - Text encoder
     * @param {Error} error - Error object
     * @param {boolean} isDebug - Debug logging flag
     */
    #handleStreamError = (id, controller, encoder, error, isDebug) => {
        this.#logError(`[progress][${id}] SSE stream error: ${error.message}`)
        const errorData = {error: error.message || 'Unknown error'}
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(errorData)}\n\n`))

        if (activeConversions.has(id)) {
            const conversion = activeConversions.get(id)
            conversion.streamActive = false
            delete conversion.sseStream
        }
        controller.close()
    }

    /**
     * Handles SSE stream cancellation
     * @private
     * @param {string} id - Conversion ID
     * @param {boolean} isDebug - Debug logging flag
     */
    #handleStreamCancel = (id, isDebug) => {
        if (activeConversions.has(id)) {
            const conversion = activeConversions.get(id)
            conversion.streamActive = false
            delete conversion.sseStream
            this.#logIfVerbose(`[progress][${id}] SSE stream cancelled`, isDebug)
        }
    }

    /**
     * Parses multipart form data from request and handles file reading if necessary
     * @private
     * @param {Request} request - HTTP request object
     * @returns {Promise<{body: Object, file: File}>} Parsed request data
     */
    #parseRequest = async (request) => {
        const formData = await request.formData()
        const body = JSON.parse(decodeURIComponent(formData.get('body') || '{}'))
        let file = formData.get('file')
        const id = nanoid() // Generate ID early for logging

        if (typeof file === 'string') {
            // File is a local path, read it
            this.#logInfo(`[parse][${id}] Reading file from path: ${file}`, false)
            const fileContent = await Bun.file(file).arrayBuffer()
            if (!fileContent || fileContent.byteLength === 0) {
                throw new Error(`Failed to read file: ${file}`)
            }
            const fileName = path.basename(file) || 'downloaded_file'
            const tempPath = path.join(tmpdir(), `downloaded_${nanoid()}_${fileName}`)
            await Bun.write(tempPath, fileContent)
            file = new File([fileContent], fileName, {type: 'application/octet-stream'})
            file.isDownloaded = true
            file.tempPath = tempPath
        }

        return {body, file}
    }

    /**
     * Validates request data
     * @private
     * @param {File} file - Uploaded or read file
     * @param {Object} body - Request body
     * @param {string} id - Conversion ID
     * @throws {Error} If validation fails
     */
    #validateRequest = (file, body, id) => {
        if (!file || !body) {
            this.#logError(`[convert][${id}] Invalid request: file=${!!file}, body=${!!body}`)
            throw new Error('Invalid request data')
        }

        // Validate metadata if present
        if (body.metadata && typeof body.metadata === 'object') {
            for (const [key, value] of Object.entries(body.metadata)) {
                if (typeof key !== 'string' || typeof value !== 'string' || !key.trim() || !value.trim()) {
                    this.#logError(`[convert][${id}] Invalid metadata: key=${key}, value=${value}`)
                    throw new Error(`Invalid metadata: key=${key}, value=${value}`)
                }
            }
        }

        // Validate audio option if present
        if (body.audio && !['none', 'copy', 'encode'].includes(body.audio)) {
            this.#logError(`[convert][${id}] Invalid audio option: ${body.audio}`)
            throw new Error(`Invalid audio option: ${body.audio}. Must be 'none', 'copy', or 'encode'`)
        }
    }

    /**
     * Sets up input and output files for conversion
     * @private
     * @param {string} id - Conversion ID
     * @param {File} file - Uploaded or read file
     * @param {Object} body - Request body with conversion parameters
     * @param {boolean} isDebug - Debug logging flag
     * @returns {Promise<{input: string, output: string}>} File paths
     */
    #setupFiles = async (id, file, body, isDebug) => {
        const {from, to} = body
        const timestamp = Date.now()

        let input
        if (file.isDownloaded) {
            input = file.tempPath // Use the read file path
        }
        else {
            input = path.join(tmpdir(), `input_${id}_${timestamp}.${from}`)
            const buffer = await file.arrayBuffer()
            await Bun.write(input, buffer)
        }

        const output = path.join(tmpdir(), `output_${id}_${timestamp}.${to}`)

        this.#logInfo(`[convert][${id}] Files setup: input=${input}, output=${output}`, isDebug)

        return {input, output}
    }

    /**
     * Gets video duration and updates conversion tracking
     * @private
     * @param {string} id - Conversion ID
     * @param {Object} body - Request body
     * @param {string} input - Input file path
     * @param {boolean} isDebug - Debug logging flag
     * @returns {Promise<number>} Duration in seconds
     */
    #getDurationAndUpdateConversion = async (id, body, input, isDebug) => {
        let duration = body.duration ? Number(body.duration) / 1000 : null

        if (!duration) {
            try {
                duration = await this.#extractDuration(input)
                this.#logInfo(`[convert][${id}] Extracted duration: ${duration}`, isDebug)
            }
            catch (error) {
                this.#logError(`[convert][${id}] Could not extract duration: ${error.message}`)
                duration = 1 // Fallback
            }
        }

        // Update conversion with actual duration
        const conversion = activeConversions.get(id)
        if (conversion) {
            conversion.duration = duration
        }

        return duration
    }

    /**
     * Processes metadata and logs conversion details
     * @private
     * @param {string} id - Conversion ID
     * @param {Object} body - Request body
     * @param {string} input - Input file path
     */
    #processMetadata = async (id, body, input) => {
        const {from, to, bitrate, resolution, fps, audio} = body

        this.#logInfo(`[convert][${id}] Starting conversion: ${from} → ${to}${audio ? `, audio: ${audio}` : ''}`, true)

        if (bitrate) {
            this.#logIfVerbose(`[convert][${id}] Target bitrate: ${bitrate}`)
        }
        if (resolution) {
            this.#logIfVerbose(`[convert][${id}] Target resolution: ${resolution}`)
        }
        if (fps) {
            this.#logIfVerbose(`[convert][${id}] Target FPS: ${fps}`)
        }
        if (audio) {
            this.#logIfVerbose(`[convert][${id}] Audio option: ${audio}`)
        }
    }

    /**
     * Parses FFmpeg progress output line and updates conversion state
     * @private
     * @param {string} id - Conversion ID
     * @param {string} line - Progress line from FFmpeg
     * @param {number|null} duration - Total duration in seconds
     * @param {boolean} isDebug - Debug logging flag
     */
    #parseFffmpegProgress = (id, line, duration, isDebug) => {
        if (!activeConversions.has(id)) {
            return
        }

        const conversion = activeConversions.get(id)

        // Parse time progress (format: out_time_ms=123456)
        if (line.startsWith('out_time_ms=')) {
            const timeMs = parseInt(line.split('=')[1])
            if (!isNaN(timeMs)) {
                const timeSec = timeMs / 1000000 // Convert microseconds to seconds
                conversion.timeSec = timeSec

                if (duration && duration > 0) {
                    const percentage = Math.min((timeSec / duration) * 100, 100)
                    const oldPercentage = conversion.percentage

                    // Only update if significant change
                    if (Math.abs(percentage - oldPercentage) >= ConvertVideoController.#MIN_PROGRESS_THRESHOLD) {
                        conversion.percentage = percentage

                        // Send progress to SSE stream if active
                        const {controller, encoder} = conversion.sseStream || {}
                        if (controller && encoder && conversion.streamActive) {
                            this.#sendProgressEvent(controller, encoder, id, percentage, timeSec, duration, isDebug)
                        }
                    }
                }
            }
        }
    }

    /**
     * Executes the FFmpeg conversion process
     * @private
     * @param {string} id - Conversion ID
     * @param {string} input - Input file path
     * @param {string} output - Output file path
     * @param {Object} body - Request body with conversion parameters
     * @param {number|null} duration - Video duration in seconds
     * @param {boolean} isDebug - Debug logging flag
     */
    #executeConversion = async (id, input, output, body, duration, isDebug) => {
        const {to, bitrate, resolution, fps, from, metadata, customEncoding, audio = 'encode'} = body

        // Initialize FFmpeg args
        const args = ['-i', input, '-y'] // -y to overwrite output

        if (from.toLowerCase() === to.toLowerCase()) {
            args.push('-c', 'copy')
            this.#logIfVerbose(`[convert][${id}] Same input/output format (${from}), copying streams without re-encoding`, isDebug)
        }
        else {
            // Handle audio option
            if (audio === 'none') {
                args.push('-an')
                this.#logIfVerbose(`[convert][${id}] Audio disabled`, isDebug)
            }
            else if (audio === 'copy') {
                args.push('-c:a', 'copy')
                this.#logIfVerbose(`[convert][${id}] Copying audio stream without re-encoding`, isDebug)
            }
            else if (audio === 'encode') {
                if (customEncoding?.audioCodec) {
                    args.push('-c:a', customEncoding.audioCodec)
                    this.#logIfVerbose(`[convert][${id}] Using custom audio codec: ${customEncoding.audioCodec}`, isDebug)
                }
                else {
                    // Default audio codec based on output format
                    if (to.toLowerCase() === 'avi') {
                        args.push('-c:a', 'mp3')
                    }
                    else {
                        args.push('-c:a', 'aac', '-b:a', '128k')
                    }
                    this.#logIfVerbose(`[convert][${id}] Using default audio codec: ${to.toLowerCase() === 'avi' ? 'mp3' : 'aac'}`, isDebug)
                }
            }

            // If customEncoding is provided, override default video encoding logic
            if (customEncoding) {
                if (customEncoding.codec) {
                    args.push('-c:v', customEncoding.codec)
                }
                if (customEncoding.videoFilters) {
                    args.push('-vf', customEncoding.videoFilters)
                }
                if (Array.isArray(customEncoding.extraArgs)) {
                    args.push(...customEncoding.extraArgs)
                }
            }
            else {
                // Default video encoding logic based on output format
                if (to.toLowerCase() === 'mp4') {
                    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '23')
                }
                else if (to.toLowerCase() === 'webm') {
                    args.push('-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0')
                }
                else if (to.toLowerCase() === 'avi') {
                    args.push('-c:v', 'libx264')
                }
            }

            // Optional dynamic parameters
            if (bitrate) {
                args.push('-b:v', bitrate)
            }
            if (resolution) {
                args.push('-s', resolution)
            }
            if (fps) {
                args.push('-r', fps)
            }

            // Enable progress tracking
            args.push('-progress', 'pipe:2')
        }

        // Add custom metadata if provided
        if (metadata && typeof metadata === 'object') {
            const metadataEntries = Object.entries(metadata)
            if (metadataEntries.length > 0) {
                for (const [key, value] of metadataEntries) {
                    // Sanitize key and value to prevent command injection
                    const sanitizedKey = key.replace(/[^a-zA-Z0-9_]/g, '')
                    const sanitizedValue = value.replace(/["';]/g, '')
                    args.push('-metadata', `${sanitizedKey}=${sanitizedValue}`)
                }
                this.#logIfVerbose(
                    `[convert][${id}] Applying custom metadata: ${metadataEntries
                        .map(([k, v]) => `${k}="${v}"`)
                        .join(', ')}`,
                    isDebug,
                )
            }
            else {
                this.#logIfVerbose(`[convert][${id}] No custom metadata provided`, isDebug)
            }
        }

        args.push(output)


        this.#logInfo(`[convert][${id}] Executing FFmpeg: ffmpeg ${args.join(' ')}`, isDebug)

        return new Promise((resolve, reject) => {

            const ffmpeg = Bun.spawn([this.#setPath('ffmpeg'), ...args], {
                stderr: 'pipe',
                stdout: 'pipe',
            })

            // Store process reference for potential cancellation
            const conversion = activeConversions.get(id)
            if (conversion) {
                conversion.ffmpegProcess = ffmpeg
            }

            let progressBuffer = ''

            // Process FFmpeg progress output
            const processProgress = async () => {
                if (!ffmpeg.stderr) {
                    return
                }

                try {
                    const decoder = new TextDecoder()
                    const reader = ffmpeg.stderr.getReader()

                    while (true) {
                        const {done, value} = await reader.read()
                        if (done) {
                            break
                        }

                        const text = decoder.decode(value, {stream: true})
                        progressBuffer += text

                        const lines = progressBuffer.split('\n')
                        progressBuffer = lines.pop() || '' // Keep incomplete line

                        for (const line of lines) {
                            if (line.trim()) {
                                this.#parseFffmpegProgress(id, line.trim(), duration, isDebug)
                            }
                        }
                    }
                }
                catch (error) {
                    this.#logError(`[convert][${id}] Progress parsing error: ${error.message}`)
                }
            }

            processProgress()

            // Handle process completion
            ffmpeg.exited.then((exitCode) => {
                const conversion = activeConversions.get(id)

                if (exitCode === 0) {
                    this.#logInfo(`[convert][${id}] FFmpeg conversion completed successfully`, true)

                    if (conversion) {
                        conversion.done = true
                        conversion.percentage = 100

                        // Send completion event to SSE stream if active
                        const {controller, encoder} = conversion.sseStream || {}
                        if (controller && encoder && conversion.streamActive) {
                            this.#sendCompleteEvent(controller, encoder, id, duration, conversion.timeSec, isDebug)
                        }
                    }

                    resolve()
                }
                else {
                    const errorMsg = `FFmpeg exited with code ${exitCode}`
                    this.#logError(`[convert][${id}] ${errorMsg}`)

                    if (conversion) {
                        conversion.error = errorMsg
                        conversion.done = true

                        // Send error event to SSE stream if active
                        const {controller, encoder} = conversion.sseStream || {}
                        if (controller && encoder && conversion.streamActive) {
                            this.#handleStreamError(id, controller, encoder, new Error(errorMsg), isDebug)
                        }
                    }

                    reject(new Error(errorMsg))
                }
            }).catch(error => {
                this.#logError(`[convert][${id}] FFmpeg process error: ${error.message}`)
                reject(error)
            })
        })
    }


    /**
     * Extracts video duration using FFprobe
     * @private
     * @param {string} input - Input file path
     * @returns {Promise<number>} Duration in seconds
     */
    #extractDuration = async (input) => {
        return new Promise((resolve, reject) => {
            const ffprobe = Bun.spawn([
                                          this.#setPath('ffprobe'),
                                          '-v', 'quiet',
                                          '-print_format', 'json',
                                          '-show_format',
                                          input,
                                      ], {
                                          stdout: 'pipe',
                                      })

            let output = ''

            const processOutput = async () => {
                if (!ffprobe.stdout) {
                    return
                }

                const reader = ffprobe.stdout.pipeThrough(new TextDecoderStream()).getReader()

                try {
                    while (true) {
                        const {done, value} = await reader.read()
                        if (done) {
                            break
                        }
                        output += value
                    }
                }
                catch (error) {
                    reject(error)
                }
            }

            processOutput()

            ffprobe.exited.then((exitCode) => {
                if (exitCode === 0) {
                    try {
                        const data = JSON.parse(output)
                        const duration = parseFloat(data.format?.duration || '0')
                        resolve(duration)
                    }
                    catch (error) {
                        reject(new Error('Failed to parse FFprobe output'))
                    }
                }
                else {
                    reject(new Error(`FFprobe exited with code ${exitCode}`))
                }
            })
        })
    }

    /**
     * Cleans up temporary files
     * @private
     * @param {string} input - Input file path
     * @param {string} output - Output file path
     * @param {boolean} isDebug - Debug logging flag
     */
    #cleanupFiles = async (input, output, isDebug) => {
        const filesToClean = [input, output].filter(Boolean)

        for (const file of filesToClean) {
            try {
                if (await Bun.file(file).exists()) {
                    await unlink(file)
                    this.#logInfo(`[cleanup] Deleted temporary file: ${file}`, isDebug)
                }
            }
            catch (error) {
                this.#logError(`[cleanup] Could not delete file ${file}: ${error.message}`)
            }
        }
    }

    /**
     * Logs informational messages, conditionally based on debug flag or mandatory messages
     * @private
     * @param {string} message - Message to log
     * @param {boolean} forceLog - Force logging regardless of debug flag
     * @param {...any} args - Additional arguments
     */
    #logInfo = (message, forceLog = false, ...args) => {
        const mandatoryMessages = [
            'Starting conversion:',
            'FFmpeg conversion completed successfully',
            'Download completed, scheduling cleanup',
            'Removed from active conversions',
        ]
        const isMandatory = mandatoryMessages.some(pattern => message.includes(pattern))

        if (forceLog || isMandatory) {
            console.log(message, ...args)
        }
    }

    /**
     * Logs error messages with [ERROR] prefix
     * @private
     * @param {string} message - Error message to log
     * @param {...any} args - Additional arguments
     */
    #logError = (message, ...args) => {
        console.error(`[ERROR] ${message}`, ...args)
    }

    /**
     * Logs verbose messages if verbose mode or debug mode is enabled
     * @private
     * @param {string} message - Message to log
     * @param {boolean} isDebug - Debug mode flag
     * @param {...any} args - Additional arguments
     */
    #logIfVerbose = (message, isDebug = false, ...args) => {
        if (this.#verbose && isDebug) {
            console.log(`[VERBOSE] ${message}`, ...args)
        }
    }
}