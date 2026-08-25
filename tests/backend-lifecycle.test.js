import {describe, expect, test} from 'bun:test'
import {createBackendLifecycle} from '../src/utils/BackendLifecycle.js'

describe('backend lifecycle', () => {
    test('marks the backend as draining and runs shutdown once', async () => {
        let shutdownCount = 0
        let receivedSignal
        const lifecycle = createBackendLifecycle({
            shutdown: async ({signal}) => {
                shutdownCount += 1
                receivedSignal = signal
            },
        })

        expect(lifecycle.isDraining()).toBe(false)
        await lifecycle.requestShutdown('SIGTERM')
        await lifecycle.requestShutdown('SIGINT')

        expect(lifecycle.isDraining()).toBe(true)
        expect(shutdownCount).toBe(1)
        expect(receivedSignal).toBe('SIGTERM')
    })
})
