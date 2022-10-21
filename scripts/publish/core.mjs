#!/usr/bin/env zx
import Listr from 'listr'
import prompts from 'prompts'

await $`zx scripts/env.mjs`
$.verbose = false

const { tag } = await prompts({
    type: 'select',
    name: 'tag',
    message: 'Select publish tag',
    choices: [
        { title: 'preview', value: 'preview' },
        { title: 'beta', value: 'beta' },
        { title: 'rc', value: 'rc' },
        { title: 'latest', value: 'latest' },
    ],
    initial: 0,
})

if (!tag)
    process.exit()

let latestPublished = '0.0.9'

try {
    latestPublished = String(await $`npm show prisma-appsync@${tag} version`)?.trim()
}
catch (err) {
    try {
        latestPublished = String(await $`npm show prisma-appsync version`)?.trim()
    }
    catch (err) {}
}

const minorPos = latestPublished.lastIndexOf('.')
const possibleFutureVersion = `${latestPublished.slice(0, minorPos)}.${
    parseInt(latestPublished.slice(minorPos + 1)) + 1
}`

const { publishVersion } = await prompts({
    type: 'text',
    name: 'publishVersion',
    message: `Enter new version for @${tag}? (latest = "${latestPublished}")`,
    initial: possibleFutureVersion,
})

if (!publishVersion || publishVersion === latestPublished)
    process.exit()

const { versionOk } = await prompts({
    type: 'confirm',
    name: 'versionOk',
    message: `Run "pnpm publish --tag ${tag} --no-git-checks" with pkg version "${publishVersion}"?`,
    initial: false,
})

if (versionOk) {
    await new Listr([
        {
            title: 'Running tests',
            task: async () => await $`zx scripts/test.mjs`,
        },
        {
            title: 'Cleansing package.json',
            task: async () => {
                await $`node scripts/publish/_pkg.core.cleanse`
                await $`eslint package.json --fix`
            },
        },
        {
            title: `Setting publish version to ${publishVersion}`,
            task: async () => {
                const pkg = await fs.readJson('./package.json')
                pkg.version = publishVersion
                await fs.writeJson('./package.json', pkg)

                const pkgAfter = await fs.readJson('./package-afterPublish.json')
                pkgAfter.version = publishVersion
                await fs.writeJson('./package-afterPublish.json', pkgAfter)

                await $`eslint package.json package-beforePublish.json package-afterPublish.json --fix`
            },
        },
        {
            title: `Publishing on NPM with tag ${tag}`,
            task: async () => await $`pnpm publish --tag ${tag} --no-git-checks`,
        },
        {
            title: 'Restoring package.json',
            task: async () => await $`node scripts/publish/_pkg.core.restore`,
        },
        {
            title: 'Prettifying package.json',
            task: async () => await $`eslint package.json --fix`,
        },
    ]).run()
}
