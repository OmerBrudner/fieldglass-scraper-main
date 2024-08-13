import { Page } from "puppeteer";

import { BaseDataTypes, BaseUtilityOptions, MontoInvoice } from "@montopay/base-scraper/types";
import { FieldglassAuthentication, FieldglassCredentials, FieldglassExtractors, FieldglassInvoice, FieldglassScraperOptions } from "./types.js";

import { BaseExtractor, BaseHeadlessScraper } from "@montopay/base-scraper";
import { getFieldglassAuthentication, getFieldglassInvoices, mapFieldglassInvoice } from "./utils.js";

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
        if (this.extractors.invoices) {
            const extractor = this.extractors.invoices;
            const { fromDate, toDate } = extractor;
            extractor.clean();

            const eventType = "data";
            const eventListener = (type: BaseDataTypes, data: FieldglassInvoice) => {
                // The map function works for both invoice and credit memo
                if (type === BaseDataTypes.INVOICE || type === BaseDataTypes.CREDIT_MEMO) {
                    const mappedInvoice = mapFieldglassInvoice(data, { username: this.credentials.username }, options);
                    extractor.mapped.push(mappedInvoice);
                }
            };
            this.on(eventType, eventListener);

            extractor.data = await getFieldglassInvoices(this.authentication, fromDate, toDate, options);
            this.off(eventType, eventListener);
        }
        if (verbose) {
            logger.info(`${this.name} finished.`);
        }

        return this;
    }
}


