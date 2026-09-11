import {describe, expect, test} from 'bun:test'
import {parsePort, parseUnixProcessIds, parseWindowsProcessIds} from '../scripts/free-dev-port.mjs'

describe('free development port utility', () => {
    test('validates TCP ports', () => {
        expect(parsePort('3333')).toBe(3333)
        expect(() => parsePort('0')).toThrow('Invalid TCP port')
        expect(() => parsePort('65536')).toThrow('Invalid TCP port')
    })

    test('parses Unix listener process identifiers without duplicates', () => {
        expect(parseUnixProcessIds('9042\n9042\n3333/tcp: 1234', 3333)).toEqual([9042, 1234])
    })

    test('parses Windows listeners for the requested port only', () => {
        const output = [
            '  TCP    0.0.0.0:3333    0.0.0.0:0    LISTENING    9042',
            '  TCP    0.0.0.0:5173    0.0.0.0:0    LISTENING    9043',
        ].join('\n')

        expect(parseWindowsProcessIds(output, 3333)).toEqual([9042])
    })
})
