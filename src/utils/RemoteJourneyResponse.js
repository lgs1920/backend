/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: RemoteJourneyResponse.js                                                                                     *
 *                                                                                                                    *
 * Author : LGS1920 Team                                                                                              *
 * email: contact@lgs1920.fr                                                                                          *
 *                                                                                                                    *
 * Created on: 2026-10-23                                                                                             *
 * Last modified: 2026-10-23                                                                                          *
 *                                                                                                                    *
 * Copyright © 2026 LGS1920                                                                                           *
 **********************************************************************************************************************/

import { Buffer } from 'node:buffer'

export const REMOTE_JOURNEY_SUPPORTED_EXTENSIONS = Object.freeze(['geojson', 'json', 'kml', 'gpx', 'fit', 'tcx'])

/**
 * Checks whether a byte buffer has the FIT file signature.
 * @param {ArrayBuffer | ArrayBufferView | string | undefined} content
 * @returns {boolean}
 */
export const isFitBinary = content => {
    if (typeof content === 'string' || !content) {
        return false
    }

    const bytes = content instanceof ArrayBuffer
        ? new Uint8Array(content)
        : ArrayBuffer.isView(content)
            ? new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
            : null
    return Boolean(bytes && bytes.length >= 12 && bytes[8] === 0x2E && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54)
}

/**
 * Normalizes a remote response body while keeping FIT payloads binary-safe.
 * @param {object} options
 * @param {ArrayBuffer} options.buffer
 * @param {string} options.contentType
 * @param {boolean} options.isFitCandidate
 * @returns {{content?: string, contentBase64?: string}}
 */
export const normalizeRemoteJourneyContent = ({buffer, contentType = '', isFitCandidate = false}) => {
    if (isFitCandidate || contentType.toLowerCase().includes('fit') || isFitBinary(buffer)) {
        return {contentBase64: Buffer.from(buffer).toString('base64')}
    }

    return {content: new TextDecoder().decode(buffer)}
}

/**
 * Infers a supported journey format from its filename, MIME type, or payload.
 * @param {object} options
 * @param {string} options.fileName
 * @param {string} options.contentType
 * @param {ArrayBuffer | ArrayBufferView | string} options.content
 * @param {string} options.contentBase64
 * @returns {string}
 */
export const inferRemoteJourneyExtension = ({fileName = '', contentType = '', content, contentBase64 = ''}) => {
    const extension = fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? ''
    if (REMOTE_JOURNEY_SUPPORTED_EXTENSIONS.includes(extension)) {
        return extension
    }
    if (contentBase64) {
        return 'fit'
    }

    const type = contentType.toLowerCase()
    if (type.includes('fit') || isFitBinary(content)) {
        return 'fit'
    }
    if (type.includes('tcx')) {
        return 'tcx'
    }
    if (type.includes('gpx')) {
        return 'gpx'
    }
    if (type.includes('kml')) {
        return 'kml'
    }
    if (type.includes('geo+json')) {
        return 'geojson'
    }
    if (type.includes('json')) {
        return 'json'
    }
    if (typeof content !== 'string') {
        return ''
    }

    const sample = content.trimStart().slice(0, 500)
    if (/<(?:[a-z0-9_-]+:)?gpx\b/i.test(sample)) {
        return 'gpx'
    }
    if (/<(?:[a-z0-9_-]+:)?kml\b/i.test(sample)) {
        return 'kml'
    }
    if (/<(?:[a-z0-9_-]+:)?TrainingCenterDatabase\b/i.test(sample)) {
        return 'tcx'
    }
    if (sample.startsWith('{') || sample.startsWith('[')) {
        try {
            const data = JSON.parse(content)
            return ['Feature', 'FeatureCollection'].includes(data?.type) ? 'geojson' : 'json'
        }
        catch {
            return 'json'
        }
    }

    return ''
}
