import { MontoDataTypes } from "@montopay/base-scraper/types";
import { MontoInvoiceStatus } from "@montopay/base-scraper/constants";

export const SCRAPER_NAME = "FieldglassScraper";
export const PORTAL_NAME = "Fieldglass";

export const RETRIES = 3;
export const TIME_BETWEEN_REQUESTS = 1000;
export const KEYBOARD_TYPE_DELAY = 250;
export const DEFAULT_COOKIES = {};
export const DEFAULT_HEADERS_PAST = {
    "accept-language": "en-US,en;q=0.9",
    "sec-ch-ua": "\"Google Chrome\";v=\"125\", \"Chromium\";v=\"125\", \"Not.A/Brand\";v=\"24\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "Referrer-Policy": "strict-origin-when-cross-origin",

};
export const PAST_INVOICE_BODY = {}
export const COOKIE_STATEMENT_SELECTOR = "#truste-consent-track";
export const COOKIE_STATEMENT_BUTTO_SELECTOR = "#truste-consent-button"
export const USERNAME_INPUT_SELECTOR = "#usernameId_new";
export const PASSWORD_INPUT_SELECTOR = "#passwordId_new";
export const WRONG_IDENTIFIERS_HEADER_SELECTOR = ".error_msg > .errorDiv";

export const INVOICE_MAPPED_STATUSES = {
    // Define statuses based on Fieldglass mappings
};

export const DATA_TYPE_MAP = {
    // Define data type mappings
};
