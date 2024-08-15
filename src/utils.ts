import { Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import { cloneDeep } from "lodash-es";
import { format, sub } from "date-fns";
import pRetry from "p-retry";
import delay from 'delay';
import { BaseDataTypes, BaseUtilityOptions, MontoInvoice } from "@montopay/base-scraper/types";
import {
    FieldglassAuthentication,
    FieldglassCredentials,
    FieldglassInvoice,
    MontoInvoiceStatus,
    FgWindow,
    formatMapping,
    InvoiceData,
    InvoiceRow,
    FieldglassCreditMemo,
} from "./types.ts";
import { AuthenticationBadCredentialsError } from "@montopay/base-scraper/errors";
import {
    PAST_INVOICE_BODY,
    PAST_DEFAULT_HEADERS,
    PORTAL_NAME,
    CURR_INVOICE_BODY,
    CURR_DEFAULT_HEADERS,
    PAST_CREDIT_MEMO_BODY,
    PAST_CREDIT_MEMO_DEFAULT_HEADERS,
    CURR_CREDIT_MEMO_BODY,
    CURR_CREDIT_MEMO_DEFAULT_HEADERS,
    KEYBOARD_TYPE_DELAY,
    PASSWORD_INPUT_SELECTOR,
    RETRIES,
    TIME_BETWEEN_REQUESTS,
    USERNAME_INPUT_SELECTOR,
    WRONG_IDENTIFIERS_HEADER_SELECTOR,
    COOKIE_STATEMENT_SELECTOR,
    COOKIE_STATEMENT_BUTTON_SELECTOR,
    FETCH_PAST_LINK_HEADERS,
    CURRENT_LINK_SELECTOR,
    PAST_LINK_SELECTOR,
    MAX_ROWS,
} from "./constants.ts";
import { cacheGet, cacheSet, cacheLoad } from "./cache.ts";
import { Sentry } from '../../base-scraper/dist/src/utils/sentry.js';
/**
 * Getting the authentication tokens using Puppeteer
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

        if (cookieStatement) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.click(COOKIE_STATEMENT_BUTTON_SELECTOR)
            ]);
        }

        /**
         * Login
        */
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

        const sgjy = await page.evaluate(() => (window as unknown as FgWindow)._CSRF_TOKEN_VALUE);
        const __cid = await page.evaluate(() => (window as unknown as FgWindow).__cid);
        const cookie = await page.cookies().then(cookies => {
            return cookies.reduce((acc, v) => acc += `${v.name}=${v.value}; `, '');
        });;

        const dateFormat = await page.evaluate(() => {
            return (window as unknown as FgWindow).getDateFormat();
        });

        const ttl = 5 * 60 * 1000;
        const now = new Date().getTime();
        const expiration = now + ttl;

        // cache the authentication data
        cacheSet(credentials, { cookie, sgjy, __cid, expiration, rootUrl, username, dateFormat }, ttl);

        return {
            cookie,
            sgjy,
            __cid,
            expiration,
            rootUrl,
            username,
            dateFormat
        } satisfies FieldglassAuthentication;

    } catch (error) {
        throw new Error("Error while getting the authentication token");
    }
}
/**
 * Fetches the current invoices from Fieldglass within a specified date range.
 * Handles pagination but probably it's  not needed
 * @param authentication - Object containing authentication details for accessing Fieldglass.
 * @param fromDate - The start date for fetching invoices, string
 * @param toDate - The end date for fetching invoices, string
 *
 * @returns Promise<FieldglassInvoice[]> - A promise that resolves to an array of `FieldglassInvoice` objects containing details of the current invoices.
 *
 * Throws an error if new Curent links found, because this situation is not handled.
 */
export async function getFieldglassCurrentInvoices(
    authentication: FieldglassAuthentication, fromDate: string, toDate: string, options: BaseUtilityOptions = {}):
    Promise<FieldglassInvoice[]> {

    const { logger } = options;
    if (logger) {
        logger.info(`Getting past invoices for user ${authentication.username}.`);
    }
    const targetDateFormat = formatMapping[authentication.dateFormat];
    if (!targetDateFormat) {
        if (logger) {
            logger.info(`Unsupported date format: ${authentication.dateFormat}`);
        }
        throw new Error(`Unknown date format: ${authentication.dateFormat}`);
    }
    const formatedFromDate = format(new Date(fromDate), targetDateFormat);
    const formatedToDate = format(new Date(toDate), targetDateFormat);
    /**
     * Setting the search parameters for the past invoices
     */
    const currInvoicesSearch = new URLSearchParams({
        moduleId: "180",
        cf: "1"
    });
    const currInvoicesUrl = new URL(`${authentication.rootUrl}/invoice_list.do`);
    currInvoicesUrl.search = currInvoicesSearch.toString();
    const invoices: FieldglassInvoice[] = [];

    const currInvoicesBody = new URLSearchParams({
        ...CURR_INVOICE_BODY,
        "filterStartDate": formatedFromDate,
        "filterEndDate": formatedToDate,
        "sgjy": `${authentication.sgjy}`,
        "__cid": `${authentication.__cid}`,
    });
    /*
    * Geting the response of the past invoices deployment 
    * Retry if one of the page requests fail
    **/
    const data = await pRetry(
        async () => {
            if (logger) {
                logger.info(`Retrying fetch for past invoices.`);
            }
            const response = await fetch(currInvoicesUrl, {
                "headers": {
                    ...CURR_DEFAULT_HEADERS,
                    "cookie": authentication.cookie,
                    "Referer": `${currInvoicesUrl}`,
                },
                "body": currInvoicesBody,
                "method": "POST"
            });;
            const contentType = response.headers.get("content-type");
            const data = <any | string>contentType?.includes("application/json")
                ? await response.json()
                : await response.text();

            if (!response.ok) {
                const cause = {
                    fn: "getFielglassCurrentInvoices - get invoices",
                    args: {
                        authentication,
                        fromDate,
                        toDate,
                        logger,
                    },
                    url: currInvoicesUrl,
                    payload: currInvoicesBody,
                    response: data,
                };
                throw new Error("getFieldglassCurrentInvoices !response.ok", { cause });
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

    const invoicesLinks = getLinks(data, options);
    if (invoicesLinks.length === 0) {
        logger?.info('No invoices found');
        console.log('No invoices found');
        return invoices;
    }
    /** 
     * if number of links is more than 0, throw an error beacuse new links are found and this situation is not handled
     * */
    Sentry.captureMessage('New Current links found, need to be handled');
    throw new Error('New Current links found, need to be handled');
}
/**
    * Gets the past invoices from Fieldglass.
    * @param authentication - The Fieldglass authentication object.
    * @param fromDate - The start date of the invoices to fetch.
    * @param toDate - The end date of the invoices to fetch.
    * @param options - The options object.
    * @returns An array of FieldglassInvoice objects.
 */
export async function getFieldglassPastInvoices(
    authentication: FieldglassAuthentication, fromDate: string, toDate: string, options: BaseUtilityOptions = {}):
    Promise<FieldglassInvoice[]> {

    const { logger } = options;
    if (logger) {
        logger.info(`Getting past invoices for user ${authentication.username}.`);
    }
    const targetDateFormat = formatMapping[authentication.dateFormat];
    if (!targetDateFormat) {
        if (logger) {
            logger.info(`Unsupported date format: ${authentication.dateFormat} `);
        }
        throw new Error(`Unknown date format: ${authentication.dateFormat} `);
    }
    const formatedFromDate = format(new Date(fromDate), targetDateFormat);
    const formatedToDate = format(new Date(toDate), targetDateFormat);

    const pastInvoicesSearch = new URLSearchParams({
        moduleId: "180",
        cf: "1"
    });
    const pastInvoicesUrl = new URL(`${authentication.rootUrl}/past_invoice_list.do`);
    pastInvoicesUrl.search = pastInvoicesSearch.toString();

    const invoices: FieldglassInvoice[] = [];
    let hasNextPage = true;

    do {
        const pastInvoicesBody = new URLSearchParams({
            ...PAST_INVOICE_BODY,
            "filterStartDate": formatedFromDate,
            "filterEndDate": formatedToDate,
            "sgjy": `${authentication.sgjy}`,
            "__cid": `${authentication.__cid}`,
        });
        /*
        * Geting the response of the past invoices deployment 
        * Retry if one of the page requests fail
        **/
        const data = await pRetry(
            async () => {
                if (logger) {
                    logger.info(`Retrying fetch for past invoices.`);
                }
                const response = await fetch(pastInvoicesUrl, {
                    "headers": {
                        ...PAST_DEFAULT_HEADERS,
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

        const maxRowCountReach = getmaxRowCountReached(data, options);

        const invoicesLinks = getLinks(data, options);
        if (invoicesLinks.length === 0) {
            logger?.info('No invoices found');
            console.log('No invoices found');
            return invoices;
        }


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
                            "cookie": authentication.cookie,
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
        // const totalPages = Math.ceil(invoicesLinks.length / MAX_ROWS);
        // hasNextPage = pageNumber < totalPages;
        hasNextPage = (invoicesLinks.length > MAX_ROWS)
        if (hasNextPage || maxRowCountReach) {
            // Throw an error due to unexpected case where invoicesLinks are lower than the totalInvoices
            logger?.info('New Past links found, need to be handled');
            Sentry.captureException('New Past links found, probably because there are more than 1000 invoices, need to be handled');
            throw new Error('New Past links found, need to be handled');
        }
    } while (hasNextPage);

    console.log('invoices', invoices);
    console.log('number of invoices', invoices.length);

    return invoices;
}
/**
 * Retrieves both current and past invoices from Fieldglass based on the provided date range and authentication details.
 * 
 * Handling the case when new links are found with an error
 * 
* @param authentication - The authentication details required for accessing Fieldglass invoices, including cookies and session identifiers.
 * @param fromDate - The start date for fetching invoices, string
 * @param toDate - The end date for fetching invoices, string
 * 
 * @returns Promise<FieldglassInvoice[]> A promise that resolves to an array of `FieldglassInvoice` objects, representing the consolidated invoices from both the current and past invoice endpoints.
 * 
 */
export async function getFieldglassInvoices(
    authentication: FieldglassAuthentication, fromDate: string, toDate: string, options: BaseUtilityOptions = {}
): Promise<FieldglassInvoice[]> {
    try {
        const currentInvoices = await getFieldglassCurrentInvoices(authentication, fromDate, toDate, options);
        const pastInvoices = await getFieldglassPastInvoices(authentication, fromDate, toDate, options);
        return [...currentInvoices, ...pastInvoices];
    } catch (error: any) {
        if (error.message.includes('New Current links found')) {
            Sentry.captureMessage('New Current links found, need to be handled');
        }
        throw error;
    }
}
/**
 * Retrieves current credit memos from Fieldglass based on the provided date range and authentication details.
 * 
 * This function fetches credit memos from the Fieldglass API using the specified date range and authentication details, handling potential errors and logging messages as needed. If new credit memo links are found, an error is thrown for further handling.
 * 
 * @param authentication - The authentication details required for accessing Fieldglass credit memos, including cookies and session identifiers.
 * @param fromDate - The start date for fetching credit memos, string
 * @param toDate - The end date for fetching credit memos, string
 * 
 * @returns Promise<FieldglassCreditMemo[] A promise that resolves to an array of `FieldglassCreditMemo` objects, representing the current credit memos fetched from Fieldglass.
 * 
 * @throws {Error} Throws an error if there is an issue retrieving credit memos or if new credit memo links are found and need to be handled.
 */
export async function getFieldglassCurrentCreditMemos(
    authentication: FieldglassAuthentication, fromDate: string, toDate: string, options: BaseUtilityOptions = {}
) {
    const { logger } = options;
    if (logger) {
        logger.info(`Getting current credit memos for user ${authentication.username}.`);
    }

    const targetDateFormat = formatMapping[authentication.dateFormat];
    if (!targetDateFormat) {
        if (logger) {
            logger.info(`Unsupported date format: ${authentication.dateFormat}`);
        }
        throw new Error(`Unknown date format: ${authentication.dateFormat}`);
    }
    const formatedFromDate = format(new Date(fromDate), targetDateFormat);
    const formatedToDate = format(new Date(toDate), targetDateFormat);

    const creditMemosSearch = new URLSearchParams({
        cf: "1"
    });
    const creditMemosUrl = new URL(`${authentication.rootUrl}/crdb_list.do`);
    creditMemosUrl.search = creditMemosSearch.toString();

    const creditMemos: FieldglassCreditMemo[] = [];

    const creditMemosBody = new URLSearchParams({
        ...CURR_CREDIT_MEMO_BODY,
        "filterStartDate": formatedFromDate,
        "filterEndDate": formatedToDate,
        "sgjy": `${authentication.sgjy}`,
        "__cid": `${authentication.__cid}`,
    });

    const data = await pRetry(
        async () => {
            if (logger) {
                logger.info(`Retrying fetch for current credit memos.`);
            }
            const response = await fetch(creditMemosUrl.toString(), {
                "headers": {
                    ...CURR_CREDIT_MEMO_DEFAULT_HEADERS,
                    "cookie": authentication.cookie,
                    "Referer": `${creditMemosUrl}`,
                },
                "body": creditMemosBody,
                "method": "POST"
            });
            const contentType = response.headers.get("content-type");
            const data = contentType?.includes("application/json")
                ? await response.json()
                : await response.text();

            if (!response.ok) {
                const cause = {
                    fn: "getFieldglassCurrentCreditMemos - get credit memos",
                    args: {
                        authentication,
                        fromDate,
                        toDate,
                        logger,
                    },
                    url: creditMemosUrl,
                    payload: creditMemosBody,
                    response: data,
                };
                throw new Error("getFieldglassCurrentCreditMemos !response.ok", { cause });
            }
            return data;
        },
        {
            retries: RETRIES,
            minTimeout: TIME_BETWEEN_REQUESTS,
            onFailedAttempt: () => {
                if (logger) {
                    logger.warn(`Failed attempt to fetch current credit memos.`);
                }
            },
        }
    );

    const creditMemoLinks = getLinks(data, options);
    if (creditMemoLinks.length === 0) {
        logger?.info('No credit memos found');
        console.log('No credit memos found');
        return creditMemos;
    }
    Sentry.captureMessage('New Curent links found, need to be handled');
    throw new Error('New Current credit memo links found, need to be handled');

}
/**
 * Retrieves past credit memos from Fieldglass based on the provided date range and authentication details.
 * 
 * @param authentication - The authentication details required for accessing Fieldglass credit memos, including cookies and session identifiers.
 * @param fromDate - The start date for fetching credit memos, string
 * @param toDate - The end date for fetching credit memos, string
 * 
 * @returns Promise<FieldglassCreditMemo[]> A promise that resolves to an array of `FieldglassCreditMemo` objects, representing the past credit memos fetched from Fieldglass.
 * 
 * @Throws an error if there is an issue retrieving credit memos or if new credit memo links are found and need to be handled.
 * 
*/
export async function getFieldglassPastCreditMemos(
    authentication: FieldglassAuthentication,
    fromDate: string,
    toDate: string,
    options: BaseUtilityOptions = {}
): Promise<FieldglassCreditMemo[]> {

    const { logger } = options;
    if (logger) {
        logger.info(`Getting past credit memos for user ${authentication.username}.`);
    }
    const targetDateFormat = formatMapping[authentication.dateFormat];
    if (!targetDateFormat) {
        if (logger) {
            logger.info(`Unsupported date format: ${authentication.dateFormat}`);
        }
        throw new Error(`Unknown date format: ${authentication.dateFormat}`);
    }
    const formatedFromDate = format(new Date(fromDate), targetDateFormat);
    const formatedToDate = format(new Date(toDate), targetDateFormat);

    const pastCreditMemosSearch = new URLSearchParams({
        moduleId: "412",
        cf: "1"
    });
    const pastCreditMemosUrl = new URL(`${authentication.rootUrl}/past_crdb_list.do`);
    pastCreditMemosUrl.search = pastCreditMemosSearch.toString();

    const creditMemos: FieldglassCreditMemo[] = [];

    const pastCreditMemosBody = new URLSearchParams({
        ...PAST_CREDIT_MEMO_BODY,
        "filterStartDate": formatedFromDate,
        "filterEndDate": formatedToDate,
        "sgjy": `${authentication.sgjy}`,
        "__cid": `${authentication.__cid}`,
    });

    /*
    * Getting the response of the past credit memos deployment
    * Retry if one of the page requests fail
    **/
    const data = await pRetry(
        async () => {
            if (logger) {
                logger.info(`Retrying fetch for past credit memos.`);
            }
            const response = await fetch(pastCreditMemosUrl, {
                "headers": {
                    ...PAST_CREDIT_MEMO_DEFAULT_HEADERS,
                    "cookie": authentication.cookie,
                    "Referer": `${pastCreditMemosUrl}`,
                },
                "body": pastCreditMemosBody,
                "method": "POST"
            });
            const contentType = response.headers.get("content-type");
            const data = <any | string>contentType?.includes("application/json")
                ? await response.json()
                : await response.text();

            if (!response.ok) {
                const cause = {
                    fn: "getFieldglassPastCreditMemos - get credit memos",
                    args: {
                        authentication,
                        fromDate,
                        toDate,
                        logger,
                    },
                    url: pastCreditMemosUrl,
                    payload: pastCreditMemosBody,
                    response: data,
                };
                throw new Error("getFieldglassPastCreditMemos !response.ok", { cause });
            }
            return data;
        },
        {
            retries: RETRIES,
            minTimeout: TIME_BETWEEN_REQUESTS,
            onFailedAttempt: () => {
                if (logger) {
                    logger.warn(`Failed attempt to fetch past credit memos.`);
                }
            },
        },
    );

    const creditMemoLinks = getLinks(data, options);
    if (creditMemoLinks.length === 0) {
        logger?.info('No credit memos found');
        return creditMemos;
    }
    Sentry.captureMessage('New Past links found, need to be handled');
    throw new Error('New Current credit memo links found, need to be handled');
}
/**
 * Retrieves both current and past credit memos from Fieldglass based on the provided date range and authentication details.
 * 
 * @param page - The page object used for navigation and interaction, typically provided by a web scraping or automation library like Puppeteer.
 * @param authentication - The authentication details required for accessing Fieldglass credit memos, including cookies and session identifiers.
 * @param fromDate - The start date for fetching credit memos, formatted as 'YYYY-MM-DD'.
 * @param toDate - The end date for fetching credit memos, formatted as 'YYYY-MM-DD'.
 * @param options - Optional settings for logging and other utility options.
 * 
 * @returns Promise<FieldglassCreditMemo[]> A promise that resolves to an array of `FieldglassCreditMemo` objects, representing the credit memos fetched from Fieldglass.
 * 
 * @Throws an error if there is an issue retrieving credit memos or if new credit memo links are found and need to be handled.
 */
export async function getFieldglassCreditMemos(
    authentication: FieldglassAuthentication, fromDate: string, toDate: string, options: BaseUtilityOptions = {}
): Promise<FieldglassCreditMemo[]> {
    try {
        const currentCreditMemos = await getFieldglassCurrentCreditMemos(authentication, fromDate, toDate, options);
        const pastCreditMemos = await getFieldglassPastCreditMemos(authentication, fromDate, toDate, options);
        return [...currentCreditMemos, ...pastCreditMemos];
    } catch (error: any) {
        if (error.message.includes('New Curent links found')) {
            Sentry.captureMessage('New Curent links found, need to be handled');
        }
        throw error;
    }

}
/**
 * Parses the HTML content of an invoice page and extracts the invoice details.
 * @param html - The HTML content of the invoice page.
 * @returns A FieldglassInvoice object containing the extracted details.
 */
function getFieldglassInvoiceDetails(link: string, html: string): FieldglassInvoice {
    const $ = cheerio.load(html);
    const fgInvoiceId = link.split('id=')[1].split('&')[0];
    const fgPortalName = PORTAL_NAME;
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
 * Maps a Fieldglass transaction (invoice or credit memo) object to a MontoInvoice object.
 * @param fieldglassTransaction - The Fieldglass document object to map.
 * @returns A MontoInvoice object containing the mapped details.
 */
export function mapFieldglassTransaction(
    fieldglassTransaction: FieldglassInvoice | FieldglassCreditMemo,
    type: BaseDataTypes,
    overrides: { [Property in keyof MontoInvoice]?: MontoInvoice[Property] } = {},
    options: BaseUtilityOptions = {},
): MontoInvoice {
    const { onData, onError } = options;
    return {
        portal_name: fieldglassTransaction.portal_name,
        type: type,
        id_on_portal: fieldglassTransaction.id,
        invoice_number: fieldglassTransaction.invoice_number,
        po_number: fieldglassTransaction.po_number,
        buyer: fieldglassTransaction.buyer,
        status: mapStatusTextToEnum(fieldglassTransaction.status),
        invoice_date: fieldglassTransaction.invoice_date,
        due_date: fieldglassTransaction.due_date,
        currency: fieldglassTransaction.currency,
        total: fieldglassTransaction.total,
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
 * Extracts the links to the past invoices from the HTML content.
 * @param html 
 * @returns links to the past invoices
 */
function getLinks(html: string, options: BaseUtilityOptions = {})
    : string[] {
    const { logger } = options;
    const links: string[] = [];
    const $ = cheerio.load(html);

    const title = $('title').text().trim();
    const selector = title.includes('Past') ? PAST_LINK_SELECTOR : CURRENT_LINK_SELECTOR;

    $(selector).each((_, element) => {
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
            logger?.info('No transactions links found');
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

function getmaxRowCountReached(html: string, options: BaseUtilityOptions = {})
    : boolean | null {
    const { logger } = options;
    const $ = cheerio.load(html);
    const title = $('title').text().trim();
    const selector = title.includes('Past') ? PAST_LINK_SELECTOR : CURRENT_LINK_SELECTOR;
    let maxRowCountReached: boolean | null = null;

    $(selector).each((_, element) => {
        const jsonString = $(element).text().trim();
        const objectData: InvoiceData = JSON.parse(jsonString);
        maxRowCountReached = objectData.maxRowCountReached;
    });
    return maxRowCountReached;
}