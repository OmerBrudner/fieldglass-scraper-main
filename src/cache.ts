import { CacheData, FieldglassCredentials, FieldglassAuthentication } from "./types.ts";
import * as fs from 'fs/promises';
import { createHash } from "crypto";

const cacheStore: { [key: string]: CacheData } = {};

// load cache from file
export async function cacheLoad(): Promise<void> {
    try {
        const data = await fs.readFile('./cache.json', 'utf-8');
        const parsedData = JSON.parse(data); // makes it json object
        Object.assign(cacheStore, parsedData);
    } catch (error) {
        console.error('Error while loading cache', error);
    }
}

// save cache to file
export async function saveCache(): Promise<void> {
    try {
        await fs.writeFile('./cache.json', JSON.stringify(cacheStore, null, 2), 'utf-8');
    } catch (error) {
        console.error('Error while saving cache', error);
    }
}

function generateHashKey(credential: FieldglassCredentials): string {
    const hash = createHash('sha256');
    hash.update(`${credential.rootUrl}:${credential.username}:${credential.password}`);
    return hash.digest('hex'); // Finalize the hash computation and get the result as a hexadecimal string
}


export function cacheGet(credential: FieldglassCredentials): any | null {
    const key = generateHashKey(credential);
    const cacheData = cacheStore[key];

    if (!cacheData) {
        return null;
    }

    const now = new Date().getTime();
    if (now > cacheData.expiration) {
        delete cacheStore[key];
        return null;
    }

    return cacheData.data;
}

export function cacheSet(credential: FieldglassCredentials, data: FieldglassAuthentication, ttl: number = 1000 * 60 * 10): any { // default ttl is 10 minutes
    const key = generateHashKey(credential);
    const expiration = new Date().getTime() + ttl;
    cacheStore[key] = { data, expiration };
    saveCache(); // save cache to file

    return { data, expiration };
}

