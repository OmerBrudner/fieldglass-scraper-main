import { Page } from "puppeteer";

import { BaseDataTypes, BaseUtilityOptions, MontoInvoice } from "@montopay/base-scraper/types";
import {
    FieldglassAuthentication,
    FieldglassCredentials,
    FieldglassExtractors,
    FieldglassInvoice,
    FieldglassScraperOptions,
    FieldglassCreditMemo
} from "./types.js";

import { BaseExtractor, BaseHeadlessScraper } from "@montopay/base-scraper";
import { getFieldglassAuthentication, getFieldglassInvoices, mapFieldglassTransaction, getFieldglassCreditMemos } from "./utils.js";

import { ScraperNotInitializedError } from "@montopay/base-scraper/errors";

import { SCRAPER_NAME } from "./constants.js";

/**
 * Fieldglass Scraper
*/
export class FieldglassScraper extends BaseHeadlessScraper<FieldglassCredentials, FieldglassAuthentication, FieldglassScraperOptions> {
    protected _name = SCRAPER_NAME;
    public declare authentication?: FieldglassAuthentication;
    public extractors: FieldglassExtractors = {};

    public constructor(credentials: FieldglassCredentials, options: FieldglassScraperOptions) {
        super(credentials, options);

        if (options.extractors.invoices) {
            this.extractors.invoices = new BaseExtractor<FieldglassInvoice, MontoInvoice>(options.extractors.invoices);
        }
        if (options.extractors.creditMemos) {
            this.extractors.creditMemos = new BaseExtractor<FieldglassCreditMemo, MontoInvoice>(options.extractors.creditMemos);
        }
    }

    public async scrape(): Promise<FieldglassScraper> {
        const { verbose, logger } = this;
        const options: BaseUtilityOptions = {
            onError: this.onError.bind(this),
            onData: this.onData.bind(this),
        };
        const page = this.page as unknown as Page;
        if (verbose) {
            logger.info(`${this.name} started.`);
            options.logger = logger;
        }
        if (!this.initialized) {
            throw new ScraperNotInitializedError(`${this.name} not initialized.`);
        }
        if (!this.authentication) {
            this.authentication = await getFieldglassAuthentication(this._credentials, page, options);
            this.emit("authentication:success", this.authentication);
        }

        // Handle Invoices
        if (this.extractors.invoices) {
            const extractor = this.extractors.invoices;
            const { fromDate, toDate } = extractor;
            extractor.clean();

            const eventType = "data";
            const eventListener = (type: BaseDataTypes, data: FieldglassInvoice) => {
                if (type === BaseDataTypes.INVOICE) {
                    const mappedInvoice = mapFieldglassTransaction(data, type, { username: this.credentials.username }, options);
                    extractor.mapped.push(mappedInvoice);
                }
            };
            this.on(eventType, eventListener);
            extractor.data = await getFieldglassInvoices(this.authentication, fromDate, toDate, options);
            this.off(eventType, eventListener);
        }
        
        // Handle Credit Memos
        if (this.extractors.creditMemos) {
            const extractor = this.extractors.creditMemos;
            const { fromDate, toDate } = extractor;
            extractor.clean();

            const eventType = "data";
            const eventListener = (type: BaseDataTypes, data: FieldglassCreditMemo) => {
                // The map function works for both invoice and credit memo
                if (type === BaseDataTypes.CREDIT_MEMO) {
                    const mappedCreditMemo = mapFieldglassTransaction(data, type, { username: this.credentials.username }, options);
                    extractor.mapped.push(mappedCreditMemo);
                }
            };
            this.on(eventType, eventListener);
            extractor.data = await getFieldglassCreditMemos(this.authentication, fromDate, toDate, options);
            this.off(eventType, eventListener);
        }
        if (verbose) {
            logger.info(`${this.name} finished.`);
        }

        return this;
    }
}

