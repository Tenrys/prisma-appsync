---
sidebarDepth: 0
---

# Securing the API

- 👉 [AppSync Authorization modes](#👉-appsync-authorization-modes)
- 👉 [Fine-Grained Access Control](#👉-fine-grained-access-control)
- 👉 [Data sanitization](#👉-data-sanitization)

::: danger

Reminder that Prisma-AppSync still is experimental and security must never be taken for granted. You should always test your own API security implementation.
:::

## 👉 AppSync Authorization modes

AWS AppSync provides [directives](https://docs.aws.amazon.com/appsync/latest/devguide/security.html) for configuring security and data protection on GraphQL API's. Using these directives with Prisma-AppSync can be done using AST comments, directly inside the `Prisma.schema` file.

### Protecting fields

To apply `@aws_cognito_user_pools(cognito_groups: ["admins"])` directive to the **Post title field**, add the below in the `Prisma.schema` file:

```graphql{3}
model Post {
    id         Int
    /// @PrismaAppSync.field: '@aws_cognito_user_pools(cognito_groups: ["admins"])'
    title      String
}
```

`@PrismaAppSync.[scope]` is a string of [AppSync directives](https://docs.aws.amazon.com/appsync/latest/devguide/security.html). With `[scope]` being one of the following values: `field` / `mutation` / `create` / `update`.

### Protecting types

To apply `@aws_cognito_user_pools(cognito_groups: ["admins"])` directive to the **Post mutation and subscription types**, add the below in the `Prisma.schema` file:

```graphql{1,2}
/// @PrismaAppSync.mutation: '@aws_cognito_user_pools(cognito_groups: ["admins"])'
/// @PrismaAppSync.subscription: '@aws_cognito_user_pools(cognito_groups: ["admins"])'
model Post {
    id         Int      @id @default(autoincrement())
    title      String
}
```

`@PrismaAppSync.[scope]` is a string of [AppSync directives](https://docs.aws.amazon.com/appsync/latest/devguide/security.html). With `[scope]` being one of the following values: `type` / `query` / `mutation` / `subscription` / `get` / `list` / `create` / `update` / `upsert` / `delete` / `deleteMany`.

### Directive aliases

To make it easier to use and read, it's possible to configure directive aliases from the generator config:

```typescript
generator appsync {
    // Can access: logged-in cognito users from the group "users", "admins", or "superuser"
    directiveAlias_default = "@aws_cognito_user_pools(cognito_groups: [\"users\", \"admins\", \"superuser\"])"

    // Can access: logged-in cognito users from the group "admins", or "superuser"
    directiveAlias_adminsOnly = "@aws_cognito_user_pools(cognito_groups: [\"admins\", \"superuser\"])"

    // Can access: logged-in cognito users from the group "superuser"
    directiveAlias_superUserOnly = "@aws_cognito_user_pools(cognito_groups: [\"superuser\"])"
}
```

The above will create x3 aliases:

- `default`: Applied by default for all Types in your `Prisma.schema` file (overwritten by scoped directive).
- `adminsOnly`: Can be used in your `Prisma.schema` using `@@adminsOnly`.
- `superUserOnly`: Can be used in your `Prisma.schema` using `@@superUserOnly`.

Example usage:

```typescript
/// @PrismaAppSync.mutation: '@@adminsOnly'
model Post {
    id              Int         @id @default(autoincrement())
    title           String
    published       Boolean     @default(false)
    lastSavedAt     DateTime    @default(now())

    /// @PrismaAppSync.field: '@@superUserOnly'
    secret
}
```

## 👉 Fine-Grained Access Control

Prisma-AppSync makes it easier to implement fine-grained access control around data. For example, we might want to only allow the owner of a given Post to update it. To do so, we can use the below methods, directly from the Lambda function handler.

Under the hood, Prisma AppSync uses [CASL](https://casl.js.org), an isomorphic authorization library. The API provided is very close to [CASL rules](https://casl.js.org/v4/en/guide/define-rules), except that Prisma AppSync automate data fetching for conditions.

**AFTER initiating `PrismaAppSync` class and BEFORE calling `app.resolve()`:**

```typescript
// allow access (get + list) action to field 'title' on Post
app.allow({ action: AuthActions.access, subject: 'Post', fields: ['title'] })

// allow modify (upsert + update + delete) action on Post, only if Post.authorId === 4
app.allow({ action: AuthActions.modify, subject: 'Post', condition: { authorId: 4 } })

// deny access (get + list) action to field 'secret' on Post
app.deny({ action: AuthActions.access, subject: 'Post', fields: ['secret'] })
```

See full list of options, methods and types in the [Reference](/reference) section.

### Example usage

```typescript
import { AuthModes, AuthActions } from './generated/prisma-appsync/client'

// before resolving any query
app.beforeResolve(async ({ authIdentity, prisma }: BeforeResolveProps) => {

    // rules only apply to Cognito authorization type
    if (authIdentity.authorization === AuthModes.AMAZON_COGNITO_USER_POOLS) {

        // get current user from database, using Prisma
        // we only need to know the user ID
        const currentUser = await prisma.user.findUnique({
            select: { id: true },
            where: { cognitoUuid: authIdentity.sub }
        }) || { id: null }

        // everyone can access (get + list) or create Posts
        app.allow({ action: AuthActions.access, subject: 'Post' })
        app.allow({ action: AuthActions.create, subject: 'Post' })

        // only the author is allowed to modify a given Post 
        app.deny({
            action: AuthActions.modify,
            subject: 'Post',
            // IF `Post.authorId` NOT_EQUAL_TO `currentUser.id` THEN DENY_QUERY
            condition: { authorId: { $ne: currentUser.id } }
        })
    
    }
    
})
```

## 👉 Data sanitization

By default, Prisma-AppSync performs xss sanitization for all data coming through the API. For example, something like `<IMG SRC=\"javascript:alert('XSS');\">` will automatically turn into `&lt;img src&gt;` before touching your database.

> With sanitization enabled (default), everything coming from the API might require to be manually parsed/decoded to properly display.

**Decoding from Browser:**

```javascript
// https://developer.mozilla.org/en-US/docs/Web/API/DOMParser
function decode(string) {
    return new DOMParser().parseFromString(string, 'text/html').documentElement.textContent
}
```

**Decoding from Node:**

```javascript
// https://github.com/jsdom/jsdom
function decode(string) {
    return new JSDOM(string).window.document.body.textContent
}
```

**Alternatively, it is possible to disable xss sanitization:**

```typescript{3}
const app = new PrismaAppSync({
    connectionUrl: String(process.env.CONNECTION_URL),
    sanitize: false // disable xss sanitization
})
```