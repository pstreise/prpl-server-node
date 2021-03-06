/**
 * @license
 * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
import * as capabilities from 'browser-capabilities';
import * as express from 'express';
import * as http from 'http';
export interface Config {
    cacheControl?: string;
    forwardErrors?: boolean;
    unregisterMissingServiceWorkers?: boolean;
    entrypoint?: string;
    builds?: {
        name?: string;
        browserCapabilities?: capabilities.BrowserCapability[];
    }[];
}
/**
 * Return a new HTTP handler to serve a PRPL-style application.
 */
export declare function makeHandler(root?: string, config?: Config): (request: http.IncomingMessage, response: http.ServerResponse, next?: express.NextFunction, pushAssets?: Array) => void;
