import { FromSchema } from "json-schema-to-ts";
import { Cookie } from "puppeteer";

import { BaseExtractor } from "@montopay/base-scraper";
import {
    BaseAuthentication,
    BaseCredentials,
    BaseExtractorOptions,
    BaseScraperData,
    BaseScraperOptions,
    MontoInvoice
} from "@montopay/base-scraper/types";
import { fieldglassInputSchema } from "./input.ts";

export type FieldglassInput = FromSchema<typeof fieldglassInputSchema>;

export type FieldglassCredentials = BaseCredentials;

// export type FieldglassCredentials = {
//     rootUrl: string;
//     userName: string;
//     password: string;
// }

export type CacheData = {
    data: FieldglassAuthentication;
    expiration: number;
}

export type FieldglassAuthentication = {
    cookie: string;
    sgjy: string;
    __cid: string;
    expiration: number;
    rootUrl: string;
    username: string;
}

// export type MontoInvoice = {
//     portal_name: string;
//     // type: MontoDataTypes;
//     id_on_portal: string;
//     invoice_number: string;
//     portal_invoice_number?: string;
//     po_number?: string;
//     buyer: string;
//     status: string;
//     invoice_date: Date;
//     due_date?: Date;
//     currency: string;
//     total: number;
//     portal_user_id?: string;
//     portal_user?: string;
//     username?: string;
// };

export enum MontoInvoiceStatus {
    APPROVED = "Approved",
    PENDING_APPROVAL = "Pending Approval",
    PAID = "Paid",
    REJECTED = "Rejected",
    CANCELED = "Canceled",
};

export type FieldglassInvoice = {
    id: string;
    portal_name: string;
    invoice_number: string;
    po_number?: string;
    buyer: string;
    status: string;
    invoice_date: Date;
    due_date?: Date;
    currency: string;
    total: number;
};

export enum MontoDataTypes {
    INVOICE = "Invoice",
    CREDIT_MEMO = "Credit Memo",
}

export type FieldglassExtractors = {
    invoices?: BaseExtractor<FieldglassInvoice, MontoInvoice>;
};

export type FieldglassScraperOptions = BaseScraperOptions<FieldglassAuthentication> & {
    extractors: {
        invoices?: BaseExtractorOptions;
    };
};

export interface FgWindow extends Window {
    _CSRF_TOKEN_VALUE: string;
    _API_TOKEN_VALUE: string;
    __cid: string;
    getDateFormat: () => string;
}

// Define a mapping for date-fns
export const formatMapping: { [key: string]: string } = {
    'MM/DD/YYYY': 'MM/dd/yyyy',
    'DD/MM/YYYY': 'dd/MM/yyyy',
    'YYYY/MM/DD': 'yyyy/MM/dd',
};

/**
 * For extracting invoice link from the page.
 */
export type InvoiceColumn = {
    name: string;
    value: string;
    html?: string;
};

export type InvoiceRow = {
    columns: InvoiceColumn[];
};

export type InvoiceData = {
    rows: InvoiceRow[];
};