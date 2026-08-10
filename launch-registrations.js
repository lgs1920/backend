import {run} from './scripts/launch-registrations-cli.js'

run().catch(error => {
    console.error(error.message)
    process.exitCode = 1
})
