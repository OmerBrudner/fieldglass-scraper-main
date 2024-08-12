const NODE_ENV = process.env.NODE_ENV || "development";

export const SCRAPER_NAME = "FieldglassScraper";
export const PORTAL_NAME = "Fieldglass";

export const RETRIES = 3;
export const TIME_BETWEEN_REQUESTS = 1000;
export const KEYBOARD_TYPE_DELAY = 250;
export const DEFAULT_COOKIES = {};
export const DEFAULT_HEADERS_PAST = {
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
    "Referrer-Policy": "strict-origin-when-cross-origin"
};

export const PAST_INVOICE_BODY = {
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
    "ajaxCall": "true",
}

export const FETCH_PAST_LINK_HEADERS = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
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
}
export const COOKIE_STATEMENT_SELECTOR = "#truste-consent-track";
export const COOKIE_STATEMENT_BUTTON_SELECTOR = "#truste-consent-button"
export const USERNAME_INPUT_SELECTOR = "#usernameId_new";
export const PASSWORD_INPUT_SELECTOR = "#passwordId_new";
export const WRONG_IDENTIFIERS_HEADER_SELECTOR = ".error_msg > .errorDiv";
export const DROPDOWN_LIST_SELECTOR = '#dropdownlistWrappergridpagerlistpast_invoice_supplier_list';
export const MAXIMUM_DROPDOWN_SELECTOR = '#listitem7innerListBoxgridpagerlistpast_invoice_supplier_list > span';
export const DATA_ROWS_REGEX = 'div[style*="margin-right: 7px; float: right;"]';
export const NEXT_BUTTON = 'div[title="Next"]';
export const INVOICES_TABLE_CLASS = '.jqxGridParent.fd-table';

export const INVOICE_MAPPED_STATUSES = {
    // Define statuses based on Fieldglass mappings
};

export const DATA_TYPE_MAP = {
    // Define data type mappings
};
