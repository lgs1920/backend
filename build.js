
/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 *                                                                                                                    *
 * File: build.js                                                                                                     *
 * Path: /home/christian/devs/assets/lgs1920/backend/build.js                                                         *
 *                                                                                                                    *
 * Author : Christian Denat                                                                                           *
 * email: christian.denat@orange.fr                                                                                   *
 *                                                                                                                    *
 * Created on: 2024-09-21                                                                                             *
 * Last modified: 2024-09-21                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2024 LGS1920                                                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

// build.js
import argparse         from 'argparse'
import { execSync }     from 'child_process'
import { copyFileSync, cpSync, mkdirSync } from 'node:fs'

/**
 * Get arguments
 *
 * usage: build.js [-h] -v VERSION [-m]
 *
 */
const parser = new argparse.ArgumentParser()
parser.add_argument('-v', '--version', {
    help:    'Version number',
    type:'str',
    required:true
})
parser.add_argument('-m', '--minify', {
    help:    'Minify the output',
    action: 'store_true',
})


const args = parser.parse_args()
const version =args.version??null
if (!version) {
    console.error('build.js : Please specify --version,-v with a version number')
    process.exit(1)
}

const minify = args.minify?'--minify':''
const buildDirectory = `./dist/${version}`

// Build the project into /dist/<version>
execSync(`bun build ${minify} --outdir=${buildDirectory} --target=bun src/index.js --splitting`)
execSync(`bun build ${minify} --target=bun scripts/launch-registrations-cli.js --outfile=${buildDirectory}/launch-registrations.js`)
execSync(`bun build ${minify} --target=bun scripts/backend-process-cli.js --outfile=${buildDirectory}/backend-process.js`)
execSync(`bun build ${minify} --target=bun scripts/backend-startup.js --outfile=${buildDirectory}/backend-startup.js`)
execSync(`bun build ${minify} --target=bun scripts/backend-watchdog.js --outfile=${buildDirectory}/backend-watchdog.js`)
copyFileSync('package.json', `${buildDirectory}/package.json`)
mkdirSync(`${buildDirectory}/messages/forms`, {recursive: true})
copyFileSync('messages/forms/en.md', `${buildDirectory}/messages/forms/en.md`)
copyFileSync('messages/forms/fr.md', `${buildDirectory}/messages/forms/fr.md`)
cpSync('messages/forms/contact', `${buildDirectory}/messages/forms/contact`, {recursive: true})
cpSync('messages/forms/support/contact', `${buildDirectory}/messages/forms/support/contact`, {recursive: true})
