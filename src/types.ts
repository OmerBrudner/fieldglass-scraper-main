import { FromSchema } from "json-schema-to-ts";

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
    dateFormat: string;
}

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

export type FieldglassCreditMemo = FieldglassInvoice;

export enum MontoDataTypes {
    INVOICE = "Invoice",
    CREDIT_MEMO = "Credit Memo",
}

export type FieldglassExtractors = {
    invoices?: BaseExtractor<FieldglassInvoice, MontoInvoice>;
    creditMemos?: BaseExtractor<FieldglassCreditMemo, MontoInvoice>;
};

export type FieldglassScraperOptions = BaseScraperOptions<FieldglassAuthentication> & {
    extractors: {
        invoices?: BaseExtractorOptions;
        creditMemos?: BaseExtractorOptions;
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
export type InvoiceData = {
    rows: InvoiceRow[];
};
export type InvoiceRow = {
    columns: InvoiceColumn[];
};
export type InvoiceColumn = {
    name: string;
    value: string;
    html?: string;
};

/**
 * For extracting credit memos details from the page.
 */
// Define types similar to the ones used for invoices
export type CreditMemoData = {
    rows: CreditMemoRow[];
};

export type CreditMemoRow = {
    columns: CreditMemoColumn[];
};

export type CreditMemoColumn = {
    name: string;
    value: string;
    html?: string;
};
