#!/usr/bin/env zx

process.env.FORCE_COLOR = 3
process.env.DATABASE_URL = 'postgresql://prisma:prisma@localhost:5433/dev'

await $`npx prisma generate`

cd('./.server')
await $`docker-compose up -d`

cd('../')
await $`npx prisma db push --accept-data-loss`

console.log(chalk.yellow('\nRunning a GraphQL API server at: http://localhost:4000/graphql\n'))

await nothrow($`pm2 delete prisma-appsync--server`)

await $`pm2 start ./.server/server.ts --name prisma-appsync--server --watch="./" --ignore-watch="**/node_modules **/cdk **/schema.prisma" --no-daemon -f`
