import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
// import { cloneDeep } from "lodash-es";
import { format, sub } from "date-fns";
import pRetry from "p-retry";
import delay from 'delay';
import { BaseDataTypes, BaseUtilityOptions, GenericInvoice, MontoInvoice } from "@montopay/base-scraper/types";
import { FieldglassAuthentication, FieldglassCredentials, FieldglassInvoice, MontoInvoiceStatus, FgWindow } from "./types.ts";

import {
    PAST_INVOICE_BODY,
    PORTAL_NAME,
    DEFAULT_COOKIES,
    DEFAULT_HEADERS_PAST,
    INVOICE_MAPPED_STATUSES,
    KEYBOARD_TYPE_DELAY,
    PASSWORD_INPUT_SELECTOR,
    RETRIES,
    TIME_BETWEEN_REQUESTS,
    USERNAME_INPUT_SELECTOR,
    WRONG_IDENTIFIERS_HEADER_SELECTOR,
    DATA_TYPE_MAP,
    COOKIE_STATEMENT_SELECTOR,
    COOKIE_STATEMENT_BUTTO_SELECTOR
} from "./constants.ts";
import { cacheGet, cacheSet, cacheLoad } from "./cache.ts";

// /**
//  * getting the authentication tokens using Puppeteer
//  * @param credentials 
//  * @param page 
//  * @param options 
//  * @returns Fieldglass Authentication object
//  */
export async function getFieldglassAuthentication(credentials: FieldglassCredentials): Promise<FieldglassAuthentication> {

    const cachedAuthData = cacheGet(credentials);
    // check if the token is already in the cache
    if (cachedAuthData) {
        return cachedAuthData;
    }

    // If no cached data, perform the authentication process using Puppeteer
    const { rootUrl, username, password } = credentials;

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();


    try {
        await page.goto(rootUrl, { waitUntil: 'load' });
        const cookieStatement = await page.$(COOKIE_STATEMENT_SELECTOR);
        // Check if the cookie statement is present
        if (cookieStatement) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.click(COOKIE_STATEMENT_BUTTO_SELECTOR)
            ]);
        }

        // Login
        await page.waitForSelector(USERNAME_INPUT_SELECTOR).then(async (el) => { await el?.type(username, { delay: KEYBOARD_TYPE_DELAY }) });
        // do retry if the username not equal to the username input
        // await pRetry(async () => {
        //     const usernameInputValue = await page.evaluate(() => (document.querySelector(USERNAME_INPUT_SELECTOR) as HTMLInputElement).value);
        //     if (usernameInputValue !== username) {
        //         throw new Error("Username input value is not equal to the username");
        //     }
        // }, { retries: RETRIES });
        await delay(TIME_BETWEEN_REQUESTS);
        await page.waitForSelector(PASSWORD_INPUT_SELECTOR).then(async (el) => {
            await el?.type(password, { delay: KEYBOARD_TYPE_DELAY });
        });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.keyboard.press('Enter')
        ]);

        if (await page.$(WRONG_IDENTIFIERS_HEADER_SELECTOR)) {
            throw new Error("Invalid credentials");
        }

        // Procude one string from the cookies
        const cookie = await page.cookies().then(cookies => {
            return cookies.reduce((acc, v) => acc += `${v.name}=${v.value}; `, '');
        });;
        const sgjy = await page.evaluate(() => (window as unknown as FgWindow)._CSRF_TOKEN_VALUE);
        const __cid = await page.evaluate(() => (window as unknown as FgWindow).__cid);

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
 * Parses the HTML content of an invoice page and extracts the invoice details.
 * @param html - The HTML content of the invoice page.
 * @returns A FieldglassInvoice object containing the extracted details.
 */
export async function getFieldglassPastInvoices(
    credentials: FieldglassCredentials, authentication: FieldglassAuthentication, fromDate: string, toDate: string):
    Promise<MontoInvoice[]> {
    // const formatedFromDate = formatDate(fromDate);
    // const formatedToDate = formatDate(toDate);
    const pastInvoicesSearch = new URLSearchParams({
        moduleId: "180",
        cf: "1"
    });
    const pastInvoicesUrl = new URL(`${authentication.rootUrl}/past_invoice_list.do`);
    pastInvoicesUrl.search = pastInvoicesSearch.toString();

    const pastInvoicesBody = new URLSearchParams({
        "filterStartDate": "07/23/2020",
        "filterEndDate": "11/07/2024",
        "past_invoice_supplier_list_visibility": "label.myAccount",
        "moduleId": "180",
        "invoiceListTypeFilter": "1,2,0",
        "past_invoice_supplier_list_grouping": "none",
        "ttFilterButtonClicked": "true",
        "lastFocus": "past_invoice_supplier_list_search",
        "past_invoice_supplier_list_status_sch": "",
        "past_invoice_supplier_list_invoice_ref_sch": "",
        "past_invoice_supplier_list_invoice_code_sch": "",
        "past_invoice_supplier_list_name_sch": "",
        "past_invoice_supplier_list_cons_invoice_ref_sch": "",
        "past_invoice_supplier_list_buyer_name_sch": "",
        "fgGridPager": "1",
        "past_invoice_supplier_list_refresh": "",
        "sgjy": `${authentication.sgjy}`,
        "__cid": `${authentication.__cid}`,
        "ajaxCall": "true",
        "sgjy_duplicate": `${authentication.sgjy}`
    }
    );
    const response = await fetch("https://www.fieldglass.net/past_invoice_list.do?moduleId=180&cf=1", {
        "headers": {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "sec-ch-ua": "\"Google Chrome\";v=\"125\", \"Chromium\";v=\"125\", \"Not.A/Brand\";v=\"24\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"macOS\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "x-requested-with": "XMLHttpRequest",
            "x-tabsessionid": "tid1723309423028",
            "cookie": authentication.cookie,
            "Referer": "https://www.fieldglass.net/past_invoice_list.do?moduleId=180&cf=1",
            "Referrer-Policy": "strict-origin-when-cross-origin"
        },
        "body": pastInvoicesBody,
        "method": "POST"
    });
    let contentType = response.headers.get("content-type");
    let data;
    try {
        if (response.ok) {
            console.log('helloooo');

            data = <any | string>contentType?.includes("application/json")
                ? await response.json()
                : await response.text();
        }
    } catch (error) {
        console.log('wronggg');

        console.log('error', error);
    }

    console.log('data', data);




    let invoices: MontoInvoice[] = [];


    return invoices;
}
