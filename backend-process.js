import {run} from './scripts/backend-process-cli.js'

run().catch(error => {
    console.error(error.message)
    process.exitCode = 1
})
