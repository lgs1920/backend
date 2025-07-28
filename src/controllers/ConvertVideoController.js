/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: ConvertVideoController.js                                                                                    *
 *                                                                                                                    *
 * Author : LGS1920 Team                                                                                              *
 * email: contact@lgs1920.fr                                                                                          *
 *                                                                                                                    *
 * Created on: 2025-07-28                                                                                             *
 * Last modified: 2025-07-28                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2025 LGS1920                                                                                           *
 **********************************************************************************************************************/

import { spawn }         from 'bun'
import { nanoid }        from 'nanoid'
import *   as fspromises from 'node:fs/promises'
import * as path         from 'node:path'
import { FileUtils }     from '../utils/FileUtils'
import { Controller }    from './Controller'

export class ConvertVideoController extends Controller {

    //const FFMPEG_PATH = spawn(`pwd`)

    getProcessDuration = async (filePath) => {
        const { stdout } = await $`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${filePath}`
        return Math.floor(Number(stdout.trim()))
    }

    convert=async ({set, files, body}) => {
//console.log($`pwd`)
        const file = files.file
        const originalName = uploadedFile.name
        const baseName = path.basename(originalName, path.extname(originalName))


        const {from, to, params} = body

        const id = nanoid()
        const input = join(tmpdir(), `input-${id}.${from}`)
        const output = join(tmpdir(), `output-${id}.${to}`)
        const progressFile = join(tmpdir(), `progress-${id}.txt`)

        // Écriture du fichier uploadé en local
        await Bun.write(input, await file.arrayBuffer())

        // Conversion avec FFmpeg + suivi de progress dans fichier texte
        const ffmpegArgs = ['-i', input, ...(params || []), '-progress', progressFile, '-y', output]
        const ffmpeg = spawn('ffmpeg', ffmpegArgs)

        //SSE headers
        set.headers['Content-Type'] = 'text/event-stream'
        set.headers['Connection'] = 'keep-alive'
        set.headers['Cache-Control'] = 'no-cache'

        const interval = setInterval(() => {
            try {
                const txt = Bun.file(progressFile).text()
                const match = txt.match(/out_time_ms=(\d+)/)
                if (match) {
                    const sec = Math.floor(Number(match[1]) / 1e6)
                    set.write(`data: {"progress":${sec}}\n\n`)
                }
            }
            catch (_) {
            }
        }, 500)

        ffmpeg.on('close', () => {
            clearInterval(interval)
            set.write(`data: {"done":true}\n\n`)
            set.write('event: end\n\n')

            // 📤 Envoi final du fichier converti
            set.headers['Content-Disposition'] = `attachment; filename="${basename}.${format_out}"`
            set.headers['Content-Type'] = 'application/octet-stream'

            const stream = createReadStream(output)
            stream.on('close', () => {
                try {
                    unlinkSync(input)
                    unlinkSync(output)
                    unlinkSync(progressFile)
                }
                catch (_) {
                }
            })

            return stream
        })
    }

    progress=({ params, set }) => {
        const progressFile = join(tmpdir(), `progress-${params.id}.txt`)

        // Headers SSE
        set.headers['Content-Type'] = 'text/event-stream'
        set.headers['Cache-Control'] = 'no-cache'
        set.headers['Connection'] = 'keep-alive'

        const interval = setInterval(() => {
            try {
                const content = Bun.file(progressFile).text()
                const match = content.match(/out_time_ms=(\d+)/)

                if (match) {
                    const timeSec = Math.floor(Number(match[1]) / 1e6)
                    set.write(`data: {"progress": ${timeSec}}\n\n`)
                }
            } catch (_) {}
        }, 500)

        // Fermer proprement quand le client coupe
        set.socket.on('close', () => {
            clearInterval(interval)
        })


    }

}