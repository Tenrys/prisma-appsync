/* eslint-disable @typescript-eslint/no-use-before-define */
import { isObject } from '@client/utils'
import type {
    DocumentNode,
    FragmentDefinitionNode,
    GraphQLOutputType,
    OperationDefinitionNode,
    SelectionSetNode,
} from 'graphql'
import {
    GraphQLList, GraphQLNonNull, GraphQLObjectType, Kind,
} from 'graphql'
import gql from 'graphql-tag'
import type { GraphQLSchemaWithContext } from 'graphql-yoga'
import { merge } from 'lodash'

export type JSONPrimitive = string | number | boolean | null
export type JSONValue = JSONPrimitive | JSONObject | JSONArray
export interface JSONObject { [member: string]: JSONValue }
export interface JSONArray extends Array<JSONValue> {}
export type DeepPartial<T> = {
    [P in keyof T]?: DeepPartial<T[P]>;
}

  type FragmentMap = Record<string, FragmentDefinitionNode>

interface IOptions {
    includeMissingData?: boolean
}

const createFragmentMap = (query: DocumentNode): FragmentMap => {
    const fragments = query.definitions.filter(
        (definition): definition is FragmentDefinitionNode => {
            return definition.kind === Kind.FRAGMENT_DEFINITION
        },
    )

    const fragmentsMap: FragmentMap = {}
    for (const fragment of fragments) {
        const { name } = fragment
        fragmentsMap[name.value] = fragment
    }
    return fragmentsMap
}

function getFields(type: GraphQLOutputType) {
    switch (type.constructor.name) {
        case GraphQLObjectType.name:
            return (type as GraphQLObjectType).getFields()
        case GraphQLList.name:
        case GraphQLNonNull.name:
            return getFields((type as GraphQLList<any> | GraphQLNonNull<any>).ofType)
    }
}

const getTypeName = (
    schema: GraphQLSchemaWithContext<{}>,
    paths: string[],
) => {
    let fields = schema.getQueryType()?.getFields()?.[paths?.[0]]

    if (!fields || !fields?.type)
        return

    for (let index = 1; index < paths.length; index++) {
        fields = getFields(fields.type)?.[paths[index]]
        if (!fields)
            return
    }

    if (fields?.type)
        return String(fields.type).replace(/[\])}[{(!]/g, '')

    return null
}

const reduceObject = <T extends JSONObject>(
    schema: GraphQLSchemaWithContext<{}>,
    selectionSet: SelectionSetNode,
    fragments: FragmentMap,
    object: T,
    paths: string[],
    options: IOptions,
): T => {
    const reducedObject: Record<string, any> = {}

    for (const selection of selectionSet.selections) {
        if (selection.kind === Kind.FIELD) {
            const { name, alias } = selection
            const fieldName = alias?.value || name.value
            const value = object[fieldName]
            const localPaths = [...paths, selection.name.value]

            if (typeof value !== 'undefined' && value !== null && value !== '') {
                if (selection.selectionSet) {
                    reducedObject[fieldName] = reduceOutput(
                        schema,
                        selection.selectionSet,
                        fragments,
                        value as JSONObject,
                        localPaths,
                        options,
                    )
                }
                else {
                    reducedObject[fieldName] = value
                }
            }
            else {
                if (options.includeMissingData) {
                    // If the dataset provided does not include data requested by the query,
                    // include the data in the output as null
                    reducedObject[fieldName] = null
                }
            }
        }
        else if (selection.kind === Kind.FRAGMENT_SPREAD) {
            const { name } = selection
            const fragmentName = name.value
            const fragment = fragments[fragmentName]

            if (fragment) {
                const fragmentReducedObject = reduceOutput(
                    schema,
                    fragment.selectionSet,
                    fragments,
                    object,
                    paths,
                    options,
                )
                for (const key in fragmentReducedObject) {
                    if (isObject(fragmentReducedObject[key]))
                        reducedObject[key] = merge(reducedObject[key], fragmentReducedObject[key])
                    else if (Array.isArray(fragmentReducedObject[key]))
                        reducedObject[key] = (fragmentReducedObject[key] as any[]).map((item, i) => merge(reducedObject?.[key]?.[i], item))
                    else
                        reducedObject[key] = fragmentReducedObject[key]
                }
            }
        }
        else if (selection.kind === Kind.INLINE_FRAGMENT) {
            const fragmentReducedObject = reduceOutput(
                schema,
                selection.selectionSet,
                fragments,
                object,
                paths,
                options,
            )
            for (const key in fragmentReducedObject) {
                if (isObject(fragmentReducedObject[key]))
                    reducedObject[key] = merge(reducedObject[key], fragmentReducedObject[key])
                else if (Array.isArray(fragmentReducedObject[key]))
                    reducedObject[key] = (fragmentReducedObject[key] as any[]).map((item, i) => merge(reducedObject?.[key]?.[i], item))
                else
                    reducedObject[key] = fragmentReducedObject[key]
            }
        }
    }

    return reducedObject as T
}

const reduceOutput = <T extends JSONObject | Array<JSONObject>>(
    schema: GraphQLSchemaWithContext<{}>,
    selectionSet: SelectionSetNode,
    fragments: FragmentMap,
    object: T,
    paths: string[],
    options: IOptions,
): T => {
    // If object is an array, reduce output for each entry
    const typeName = getTypeName(schema, paths)

    if (Array.isArray(object)) {
        const output: Array<JSONObject> = []
        for (const item of object as Array<JSONObject>) {
            output.push({
                ...reduceObject(schema, selectionSet, fragments, item, paths, options),
                __typename: typeName as string,
            })
        }

        return output as T
    }
    else {
        // Or just reduce the object
        return {
            ...reduceObject(schema, selectionSet, fragments, object, paths, options) as T,
            __typename: typeName as string,
        }
    }
}

export const queryObject = <T extends {}>(
    schema: GraphQLSchemaWithContext<{}>,
    query: string | DocumentNode,
    data: T,
    options: IOptions = {},
): DeepPartial<T> => {
    const gqlQuery = typeof query == 'string' ? gql(query) : query
    const fragments = createFragmentMap(gqlQuery)

    const operationDefinitions = gqlQuery.definitions.filter(
        (definition): definition is OperationDefinitionNode =>
            definition.kind === Kind.OPERATION_DEFINITION,
    )

    const outputs = operationDefinitions.map((operationDefinition) => {
        return reduceOutput(
            schema,
            operationDefinition.selectionSet,
            fragments,
            data,
            [],
            options,
        )
    })

    // Combine all outputs into one object
    const outputObject: DeepPartial<T> = {}
    for (const output of outputs) {
        for (const key in output)
            outputObject[key] = output[key]
    }

    return outputObject
}
