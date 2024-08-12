import { Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import { cloneDeep } from "lodash-es";
import { format, sub } from "date-fns";
import pRetry from "p-retry";
import delay from 'delay';
import { BaseDataTypes, BaseUtilityOptions, GenericInvoice, MontoInvoice } from "@montopay/base-scraper/types";
import {
    FieldglassAuthentication,
    FieldglassCredentials,
    FieldglassInvoice,
    MontoInvoiceStatus,
    FgWindow,
    formatMapping,
    InvoiceData,
    InvoiceRow,
    InvoiceColumn
} from "./types.ts";
import { AuthenticationBadCredentialsError } from "@montopay/base-scraper/errors";
import {
    PAST_INVOICE_BODY,
    DEFAULT_HEADERS_PAST,
    PORTAL_NAME,
    DEFAULT_COOKIES,
    INVOICE_MAPPED_STATUSES,
    KEYBOARD_TYPE_DELAY,
    PASSWORD_INPUT_SELECTOR,
    RETRIES,
    TIME_BETWEEN_REQUESTS,
    USERNAME_INPUT_SELECTOR,
    WRONG_IDENTIFIERS_HEADER_SELECTOR,
    DATA_TYPE_MAP,
    COOKIE_STATEMENT_SELECTOR,
    COOKIE_STATEMENT_BUTTON_SELECTOR,
    DROPDOWN_LIST_SELECTOR,
    MAXIMUM_DROPDOWN_SELECTOR,
    DATA_ROWS_REGEX,
    NEXT_BUTTON,
    INVOICES_TABLE_CLASS,
    FETCH_PAST_LINK_HEADERS
} from "./constants.ts";
import { cacheGet, cacheSet, cacheLoad } from "./cache.ts";
import { has } from 'node_modules/cheerio/dist/esm/api/traversing.js';
import { Url } from 'url';
import { log } from 'console';
/**
 * getting the authentication tokens using Puppeteer
 * @param credentials 
 * @param page 
 * @param options 
 * @returns Fieldglass Authentication object
 */
export async function getFieldglassAuthentication(credentials: FieldglassCredentials, page: Page, options: BaseUtilityOptions = {}): Promise<FieldglassAuthentication> {

    const cachedAuthData = cacheGet(credentials);
    // check if the token is already in the cache
    if (cachedAuthData) {
        return cachedAuthData;
    }

    // If no cached data, perform the authentication process using Puppeteer
    const { rootUrl, username, password } = credentials;
    const { logger } = options;
    if (logger) {
        logger.info(`Getting authentication for username ${username}.`);
    }

    try {
        await page.goto(rootUrl, { waitUntil: 'load' });
        const cookieStatement = await page.$(COOKIE_STATEMENT_SELECTOR);
        // Check if the cookie statement is present
        if (cookieStatement) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.click(COOKIE_STATEMENT_BUTTON_SELECTOR)
            ]);
        }

        // Login
        await page.waitForSelector(USERNAME_INPUT_SELECTOR).then(async (el) => {
            await el?.type(username, { delay: KEYBOARD_TYPE_DELAY })
        });
        await delay(TIME_BETWEEN_REQUESTS);
        await page.waitForSelector(PASSWORD_INPUT_SELECTOR).then(async (el) => {
            await el?.type(password, { delay: KEYBOARD_TYPE_DELAY });
        });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.keyboard.press('Enter')
        ]);

        if (await page.$(WRONG_IDENTIFIERS_HEADER_SELECTOR)) {
            throw new AuthenticationBadCredentialsError(`Bad credentials for username ${username}`);
        }

        // Procude one string from the cookies
        const sgjy = await page.evaluate(() => (window as unknown as FgWindow)._CSRF_TOKEN_VALUE);
        const __cid = await page.evaluate(() => (window as unknown as FgWindow).__cid);
        const cookie = await page.cookies().then(cookies => {
            return cookies.reduce((acc, v) => acc += `${v.name}=${v.value}; `, '');
        });;

        const ttl = 5 * 60 * 1000;
        const now = new Date().getTime();
        const expiration = now + ttl;

        // cache the authentication data
        cacheSet(credentials, { cookie, sgjy, __cid, expiration, rootUrl, username }, ttl);

        return {
            cookie,
            sgjy,
            __cid,
            expiration,
            rootUrl,
            username
        } satisfies FieldglassAuthentication;

    } catch (error) {
        throw new Error("Error while getting the authentication token");
    }
}

/**
 * 
 * @param authentication 
 * @param fromDate 
 * @param toDate 
 * @param options 
 */
export async function getFieldglassCurrentInvoices(page: Page,
    authentication: FieldglassAuthentication, fromDate: string, toDate: string, options: BaseUtilityOptions = {}):
    Promise<FieldglassInvoice[]> {
    const invoices: FieldglassInvoice[] = [];
    return invoices;
}

/**
    * Gets the past invoices from Fieldglass.
    * @param page - The Puppeteer page object.
    * @param authentication - The Fieldglass authentication object.
    * @param fromDate - The start date of the invoices to fetch.
    * @param toDate - The end date of the invoices to fetch.
    * @param options - The options object.
    * @returns An array of FieldglassInvoice objects.
 */
export async function getFieldglassPastInvoices(page: Page,
    authentication: FieldglassAuthentication, fromDate: string, toDate: string, options: BaseUtilityOptions = {}):
    Promise<FieldglassInvoice[]> {
    const { logger } = options;
    if (logger) {
        logger.info(`Getting past invoices for user ${authentication.username}.`);
    }
    /**
     * Getting the date format from the page
     */
    const dateFormat = await page.evaluate(() => {
        return (window as unknown as FgWindow).getDateFormat();
    });
    const targetDateFormat = formatMapping[dateFormat];
    if (!targetDateFormat) {
        if (logger) {
            logger.info(`Unsupported date format: ${dateFormat}`);
        }
        throw new Error(`Unknown date format: ${dateFormat}`);
    }
    const formatedFromDate = format(new Date(fromDate), targetDateFormat);
    const formatedToDate = format(new Date(toDate), targetDateFormat);
    /**
     * Setting the search parameters for the past invoices
     */
    const pastInvoicesSearch = new URLSearchParams({
        moduleId: "180",
        cf: "1"
    });
    const pastInvoicesUrl = new URL(`${authentication.rootUrl}/past_invoice_list.do`);
    pastInvoicesUrl.search = pastInvoicesSearch.toString();

    const invoices: FieldglassInvoice[] = [];
    let hasNextPage = true;
    let totalInvoices = 0;
    let actualInvoicesCount = 0;

    do {
        const pastInvoicesBody = new URLSearchParams({
            ...PAST_INVOICE_BODY,
            "filterStartDate": formatedFromDate,
            "filterEndDate": formatedToDate,
            "sgjy": `${authentication.sgjy}`,
            "__cid": `${authentication.__cid}`,
        });
        /*
        Retry if one of the page requests fail
        **/
        const data = await pRetry(
            async () => {
                if (logger) {
                    logger.info(`Retrying fetch for past invoices.`);
                }
                const response = await fetch(pastInvoicesUrl, {
                    "headers": {
                        ...DEFAULT_HEADERS_PAST,
                        "cookie": authentication.cookie,
                        "Referer": `${pastInvoicesUrl}`,
                    },
                    "body": pastInvoicesBody,
                    "method": "POST"
                });
                const contentType = response.headers.get("content-type");
                const data = <any | string>contentType?.includes("application/json")
                    ? await response.json()
                    : await response.text();

                if (!response.ok) {
                    const cause = {
                        fn: "getFielglassPastInvoices - get invoices",
                        args: {
                            page,
                            authentication,
                            fromDate,
                            toDate,
                            logger,
                        },
                        url: pastInvoicesUrl,
                        payload: pastInvoicesBody,
                        response: data,
                    };
                    throw new Error("getFieldglassPastInvoices !response.ok", { cause });
                }
                return data;
            },
            {
                retries: RETRIES,
                minTimeout: TIME_BETWEEN_REQUESTS,
                onFailedAttempt: () => {
                    if (logger) {
                        logger.warn(`Failed attempt to fetch past invoices.`);
                    }
                },
            },
        );

        const invoicesLinks = getPastInvoicesLinks(data);
        if (invoicesLinks.length === 0) {
            logger?.info('No invoices found');
            console.log('No invoices found');
            return invoices;
        }

        // const cookies = authentication.cookie;
        // getting an array of cookies objects and transforming it into a single object of cookies as key-value pairs
        const newCookies = await page.cookies();
        const cookiesObj: { [key: string]: string } = newCookies.reduce((acc: { [key: string]: string }, cookie) => {
            acc[cookie.name] = cookie.value;
            return acc;
        }, {});
        for (const link of invoicesLinks) {
            /*
        Retry if one of the page requests fail
        **/
            const data = await pRetry(
                async () => {
                    if (logger) {
                        logger.info(`Retrying fetch for past invoices.`);
                    }
                    const response = await fetch(link, {
                        "headers": {
                            ...FETCH_PAST_LINK_HEADERS,
                            "cookie": Object.entries(cookiesObj).reduce((acc, [key, value]) => `${acc}${key}=${value}; `, ""),
                            "Referer": `${pastInvoicesUrl}`,
                        },
                        "body": null,
                        "method": "GET"
                    });
                    const contentType = response.headers.get("content-type");
                    const data = <any | string>contentType?.includes("application/json")
                        ? await response.json()
                        : await response.text();

                    if (!response.ok) {
                        const cause = {
                            fn: "getFielglassPastInvoices - fetch link",
                            args: {
                                authentication,
                                logger,
                            },
                            url: link,
                            payload: "",
                            response: data,
                        };
                        throw new Error("getFieldglassPastInvoices - fetch link !response.ok", { cause });
                    }
                    return data;
                },
                {
                    retries: RETRIES,
                    minTimeout: TIME_BETWEEN_REQUESTS,
                    onFailedAttempt: () => {
                        if (logger) {
                            logger.warn(`Failed attempt to fetch past invoices.`);
                        }
                    },
                },
            );
            if (data) {
                const filedglassInvoice = getFieldglassInvoiceDetails(link, data);
                const montoInvoice = parseFieldglassInvoice(filedglassInvoice, options);
                invoices.push(montoInvoice);
            }
        }

        /**
         * Handling pagination & total invoices counter
         */
        actualInvoicesCount = invoicesLinks.length;
        const result = await navigateToNextpage(page, pastInvoicesUrl);
        hasNextPage = result.hasNextPage;
        if (totalInvoices === 0) {
            totalInvoices = result.total;
        }
        // Throw an error due to unexpected case where invoicesLinks are lower than the totalInvoices
        if (actualInvoicesCount < totalInvoices) {
            logger?.info(`Expected ${totalInvoices} invoices, but got ${actualInvoicesCount}`);
            throw new Error(`Expected ${totalInvoices} invoices, but got ${actualInvoicesCount}`);
        }
    } while (hasNextPage && (actualInvoicesCount < totalInvoices));
    console.log('invoices', invoices);
    console.log('number of invoices', invoices.length);


    return invoices;
}

export async function getFieldglassInvoices(
    page: Page,
    authentication: FieldglassAuthentication, fromDate: string, toDate: string, options: BaseUtilityOptions = {}
) { }

export async function getFieldglassCurrentCreditMemos(
    page: Page,
    authentication: FieldglassAuthentication, fromDate: string, toDate: string, options: BaseUtilityOptions = {}
) { }
export async function getFieldglassPastCreditMemos(
    page: Page,
    authentication: FieldglassAuthentication, fromDate: string, toDate: string, options: BaseUtilityOptions = {}
) { }

export async function getFieldglassCreditMemos(
    page: Page,
    authentication: FieldglassAuthentication, fromDate: string, toDate: string, options: BaseUtilityOptions = {}
) { }

/**
 * Parses the HTML content of an invoice page and extracts the invoice details.
 * @param html - The HTML content of the invoice page.
 * @returns A FieldglassInvoice object containing the extracted details.
 */
function getFieldglassInvoiceDetails(link: string, html: string): FieldglassInvoice {
    const $ = cheerio.load(html);
    const fgInvoiceId = link.split('id=')[1].split('&')[0];
    const fgPortalName = 'Fieldglass';
    const fgInvoiceNumber = $('table.box tr:contains("Invoice Code") td').text().trim();
    const fgPoNumber = $('table.box tr:contains("PO Number") td').text().trim();
    const fgInvoiceEndDateText = $('table.box tr:contains("End Date") td').text().trim();
    const fgCurrency = $('#invoiceDetails .fd-container h3').first().text().match(/\(([^)]+)\)/)?.[1]; // Applying the regex to find text within parentheses
    if (!fgCurrency) {

        throw new Error('Currency not found');
    }
    const fgTotalText = $('table.box tr:contains("Total Amount Due") td').text().trim();

    // Extract the script content where the other details are stored
    const scriptContent = $('script').filter((_, script): any => {
        return $(script).html()?.includes('initBadge');
    }).html() || '';

    // Extract the status, submit date, and buyer from the script content
    const scrapedData = extractDataFromScript(scriptContent);

    // Extract values within the script content
    const fgBuyer = scrapedData['buyer'];
    const fgStatusText = scrapedData['status'];
    const fgSubmitDateText = scrapedData['submitDate'];

    // Converting 
    const fgSubmitDate = new Date(fgSubmitDateText);
    const fgInvoiceEndDate = new Date(fgInvoiceEndDateText);
    const fgTotal = parseFloat(fgTotalText.replace(/,/g, ''));

    return {
        id: fgInvoiceId,
        portal_name: fgPortalName,
        invoice_number: fgInvoiceNumber,
        po_number: fgPoNumber,
        buyer: fgBuyer,
        status: fgStatusText,
        invoice_date: fgSubmitDate,
        due_date: fgInvoiceEndDate,
        currency: fgCurrency,
        total: fgTotal
    } satisfies FieldglassInvoice;
}

/**
 * Extracts data from the script content 
 * @param scriptContent - The content of the script tag.
 * @returns 3 properties: status, submitDate, and buyer.
 */
function extractDataFromScript(scriptContent: string): { status: string; submitDate: string; buyer: string } {
    let fgStatusText = '';
    let fgSubmitDateText = '';
    let fgBuyer = '';
    const match = scriptContent.match(/initBadge\((\{.*?\})\s*,\s*'invoiceBadge'/s);
    if (match && match[1]) {
        try {
            const jsonObject = JSON.parse(match[1]);
            const items = jsonObject.items;
            items.forEach((item: any) => {
                switch (item.key) {
                    case 'Status':
                        fgStatusText = item.value;
                        break;
                    case 'Submit Date':
                        fgSubmitDateText = item.value;
                        break;
                    case 'Buyer':
                        fgBuyer = item.value;
                        break;
                }
            });
        } catch (error) {
            throw new Error('Failed to parse script data');
        }
    }

    return {
        status: fgStatusText,
        submitDate: fgSubmitDateText,
        buyer: fgBuyer,
    };
}

/**
 * Parse Fieldglass invoice.
 */
export function parseFieldglassInvoice(invoice: FieldglassInvoice, options: BaseUtilityOptions = {}) {
    const { onData } = options;
    const parsedInvoice = cloneDeep(invoice);

    if (onData) {
        onData(BaseDataTypes.INVOICE, parsedInvoice);
    }
    return parsedInvoice;
}

/**
 * Maps a FieldglassInvoice object to a MontoInvoice object.
 * @param fieldglassInvoice - The FieldglassInvoice object to map.
 * @returns A MontoInvoice object containing the mapped details.
 */
export function mapFieldglassInvoice(
    fieldglassInvoice: FieldglassInvoice,
    overrides: { [Property in keyof MontoInvoice]?: MontoInvoice[Property] } = {},
    options: BaseUtilityOptions = {},
): MontoInvoice {
    const { onData, onError } = options;
    return {
        portal_name: fieldglassInvoice.portal_name,
        id_on_portal: fieldglassInvoice.id,
        invoice_number: fieldglassInvoice.invoice_number,
        po_number: fieldglassInvoice.po_number,
        buyer: fieldglassInvoice.buyer,
        status: mapStatusTextToEnum(fieldglassInvoice.status),
        invoice_date: fieldglassInvoice.invoice_date,
        due_date: fieldglassInvoice.due_date,
        currency: fieldglassInvoice.currency,
        total: fieldglassInvoice.total,
        ...overrides,
    } as MontoInvoice;

    /**
     * handling the unknown status inside the mapFieldglassInvoice function
     */

}

/**
 * Creating an object to map the status text to the enum
 */
const mapStatusObject: Record<string, MontoInvoiceStatus> = {
    "Aprroval Paused": MontoInvoiceStatus.REJECTED,
    Approved: MontoInvoiceStatus.APPROVED,
    Consolidated: MontoInvoiceStatus.APPROVED,
    // Draft: ??? // not needed
    Paid: MontoInvoiceStatus.PAID,
    "Payment Pending": MontoInvoiceStatus.PENDING_APPROVAL,
    "Payment Review": MontoInvoiceStatus.PENDING_APPROVAL,
    "Pending Approval": MontoInvoiceStatus.PENDING_APPROVAL,
    "Pending Consolidation": MontoInvoiceStatus.PENDING_APPROVAL,
    "Pending SAP Quality Review": MontoInvoiceStatus.PENDING_APPROVAL,
    Rejected: MontoInvoiceStatus.REJECTED,
}

function mapStatusTextToEnum(statusText: string): MontoInvoiceStatus {
    const mappedStatus: MontoInvoiceStatus = mapStatusObject[statusText];
    if (!mappedStatus) {
        throw new Error(`Unknown status: ${statusText}`);
    }
    return mappedStatus as MontoInvoiceStatus;
}

/**
 * Navigates to the next page on the Fieldglass invoices table.
 * @param page Puppeteer Page object.
 * @returns A boolean indicating if there are more pages to navigate to.
 */
async function navigateToNextpage(page: Page, pastInvoicesUrl: URL): Promise<{ hasNextPage: boolean; total: number }> {
    try {
        const url = pastInvoicesUrl.toString();
        await page.goto(url, { waitUntil: 'load' });
        // Select the dropdown list to show all invoices
        await selectDropdown(page);
        // Get the current and total elements text
        const pageInfoText = await page.evaluate(() => {
            const element = document.querySelector('div[style*="margin-right: 7px; float: right;"]')
            if (!element || !element.textContent) {
                throw new Error('Page info element not found or has no text content');
            }
            return element.textContent.trim();
        });

        // Define a regular expression to extract numbers
        const pageInfoRegex = /(\d+)-(\d+) of (\d+)/;
        // Match the text content against the regular expression
        const match = pageInfoText.match(pageInfoRegex);

        if (match) {
            // Extract the current end index and total number
            const currentEnd = parseInt(match[2], 10);
            const total = parseInt(match[3], 10);

            // Determine if there are more pages
            if (currentEnd >= total) {
                return { hasNextPage: false, total };
            } else {
                try {
                    await page.waitForSelector(NEXT_BUTTON).then(async (el) => {
                        await el?.click();
                    });
                    await delay(TIME_BETWEEN_REQUESTS);
                    await page.waitForSelector(INVOICES_TABLE_CLASS);
                    return { hasNextPage: false, total };
                } catch (error) {
                    console.error('Next page button not found or not clickable:', error);
                    return { hasNextPage: false, total: 0 };
                }
            }
        } else {
            console.error('Unable to parse page info`:', pageInfoText);
            return { hasNextPage: false, total: 0 };
        }
    } catch (error) {
        console.error('Error during navigation:', error);
        return { hasNextPage: false, total: 0 };
    }
}

/**
 * Select the dropdown list to show all invoices on the Fieldglass page.
 * @param page Puppeteer Page object.
 */
async function selectDropdown(page: Page): Promise<void> {
    try {
        await page.waitForSelector(DROPDOWN_LIST_SELECTOR).then(async (el) => {
            await el?.click();
        });
        delay(TIME_BETWEEN_REQUESTS);
        // const dropdown_list = await page.$(DROPDOWN_LIST_SELECTOR);
        // if (dropdown_list) {}
        await page.waitForSelector(MAXIMUM_DROPDOWN_SELECTOR).then(async (el) => {
            await el?.click();
        });

    } catch (error) {
        console.error('Error during dropdown selection:', error);
    }
}

/**
 * Extracts the links to the past invoices from the HTML content.
 * @param html 
 * @returns links to the past invoices
 */
function getPastInvoicesLinks(html: string): string[] {
    const links: string[] = [];

    const $ = cheerio.load(html);

    $('#archivePastWrapper').each((_, element) => {
        const jsonString = $(element).text().trim();
        const objectData: InvoiceData = JSON.parse(jsonString);

        const rows: InvoiceRow[] = objectData.rows;

        if (!rows) {
            throw new Error("!data.rows");
        }

        if (!Array.isArray(rows)) {
            throw new Error("!Array.isArray(data.rows)");
        }

        if (rows.length === 0) {
            throw new Error("data.rows.length === 0");
            return;
        }
        rows.forEach((row) => {
            row.columns.forEach((column) => {
                if (column.html) {
                    const match = column.html.match(/href="([^"]+)"/);
                    if (match && match[1]) {
                        links.push(match[1]);
                    }
                }
            });
        });
    });
    return links;
}