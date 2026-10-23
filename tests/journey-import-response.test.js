import {describe, expect, test} from 'bun:test'
import {Buffer} from 'node:buffer'
import {
    inferRemoteJourneyExtension,
    isFitBinary,
    normalizeRemoteJourneyContent,
} from '../src/utils/RemoteJourneyResponse.js'

describe('remote journey response content', () => {
    test('keeps FIT response bytes in base64 without producing text content', () => {
        const bytes = new Uint8Array(18)
        bytes[0] = 14
        bytes.set([0x2E, 0x46, 0x49, 0x54], 8)
        bytes.set([0, 1, 2, 255], 14)

        const content = normalizeRemoteJourneyContent({buffer: bytes.buffer})

        expect(isFitBinary(bytes)).toBe(true)
        expect(content.content).toBeUndefined()
        expect(Buffer.from(content.contentBase64, 'base64').equals(Buffer.from(bytes))).toBe(true)
    })

    test('keeps TCX response content as XML text', () => {
        const xml = '<?xml version="1.0"?><TrainingCenterDatabase xmlns="urn:tcx"><Activities/></TrainingCenterDatabase>'
        const content = normalizeRemoteJourneyContent({
            buffer: Buffer.from(xml),
            contentType: 'application/vnd.garmin.tcx+xml',
        })

        expect(content).toEqual({content: xml})
    })

    test('keeps explicitly named but malformed FIT files binary for client validation', () => {
        const bytes = Buffer.from('not a valid FIT file')
        const content = normalizeRemoteJourneyContent({buffer: bytes, isFitCandidate: true})

        expect(content.content).toBeUndefined()
        expect(Buffer.from(content.contentBase64, 'base64').equals(bytes)).toBe(true)
    })

    test('infers direct URL FIT and TCX formats from signatures, MIME types, and XML roots', () => {
        const fitBytes = new Uint8Array(12)
        fitBytes.set([0x2E, 0x46, 0x49, 0x54], 8)

        expect(inferRemoteJourneyExtension({content: fitBytes, contentType: 'application/octet-stream'})).toBe('fit')
        expect(inferRemoteJourneyExtension({contentType: 'application/vnd.garmin.tcx+xml'})).toBe('tcx')
        expect(inferRemoteJourneyExtension({content: '<tcx:TrainingCenterDatabase />'})).toBe('tcx')
    })
})
