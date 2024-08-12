import { JSONSchema } from "json-schema-to-ts";

const userSchema = {
    type: "object",
    properties: {
        _id: {
            type: "string",
        },
        customer: {
            type: "string",
        },
        rootUrl: {
            type: "string",
            format: "url",
            default: "https://www.fieldglass.net",
        },
        username: {
            type: "string",
        },
        password: {
            type: "string",
        },
        passwordKey: {
            type: "string",
        },
    },
    additionalProperties: false,
    required: ["_id", "customer", "username"],
    oneOf: [
        {
            required: ["password"],
        },
        {
            required: ["passwordKey"],
        },
    ],
} as const satisfies JSONSchema;

export const fieldglassInputSchema = {
    $id: "fieldglassInputSchema",
    type: "object",
    properties: {
        job_id: {
            type: "string",
        },
        portal_id: {
            type: "string",
        },
        eventBus: {
            type: "string",
        },
        user: userSchema,
        invoices: {
            type: "object",
            properties: {
                fromDate: {
                    type: "string",
                    format: "date",
                },
                toDate: {
                    type: "string",
                    format: "date",
                },
            },
            required: [],
            additionalProperties: false,
        },
    },
    required: ["user"],
    additionalProperties: false,
} as const satisfies JSONSchema;
