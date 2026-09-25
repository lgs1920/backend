import {execFileSync} from 'node:child_process'

const args = process.argv.slice(2)

/**
 * Check whether one of the supplied flags was provided.
 *
 * @param {...string} flags Flags to search for.
 * @returns {boolean} Whether any flag is present.
 */
const hasFlag = (...flags) => flags.some((flag) => args.includes(flag))

const target = hasFlag('--test', '-t')
    ? 'test'
    : hasFlag('--nightly', '-n')
        ? 'nightly'
        : hasFlag('--staging', '-s')
            ? 'staging'
            : null

if (!target || hasFlag('--prod', '-p')) {
    throw new Error('Use --test/-t, --nightly/-n, or --staging/-s to dispatch a GitHub Backend deployment')
}

const currentRef = execFileSync('git', ['branch', '--show-current'], {encoding: 'utf8'}).trim()
const sourceRef = currentRef || execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim()
const workflowArguments = ['workflow', 'run', 'deploy-backend.yml']

// GitHub requires --ref to locate the workflow file when the source is detached.
if (currentRef) {
    workflowArguments.push('--ref', currentRef)
}

workflowArguments.push('-f', `target=${target}`, '-f', `ref=${sourceRef}`)
execFileSync('gh', workflowArguments, {stdio: 'inherit'})
console.log(`GitHub Backend deployment workflow dispatched for ${target}`)
