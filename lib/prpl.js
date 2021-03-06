"use strict";
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const capabilities = require("browser-capabilities");
const fs = require("fs");
const httpErrors = require("http-errors");
const path = require("path");
const send = require("send");
const statuses = require("statuses");
const url = require("url");
const push = require("./push");
// Matches URLs like "/foo/bar.png" but not "/foo.png/bar".
const hasFileExtension = /\.[^/]*$/;
// TODO Service worker location should be configurable.
const isServiceWorker = /service-worker.js$/;
/**
 * Return a new HTTP handler to serve a PRPL-style application.
 */
function makeHandler(root, config) {
    const absRoot = path.resolve(root || '.');
    console.info(`Serving files from "${absRoot}".`);
    const builds = loadBuilds(absRoot, config);
    const cacheControl = (config && config.cacheControl) || 'max-age=60';
    const unregisterMissingServiceWorkers = (config && config.unregisterMissingServiceWorkers != undefined) ?
        config.unregisterMissingServiceWorkers :
        true;
    const forwardErrors = config && config.forwardErrors;
    return function prplHandler(request, response, next, pushAssets) {
        return __awaiter(this, void 0, void 0, function* () {
            const handleError = (err) => {
                if (forwardErrors && next) {
                    next(err);
                }
                else {
                    writePlainTextError(response, err);
                }
            };
            const urlPath = url.parse(request.url || '/').pathname || '/';
            // Let's be extra careful about directory traversal attacks, even though
            // the `send` library should already ensure we don't serve any file outside
            // our root. This should also prevent the file existence check we do next
            // from leaking any file existence information (whether you got the
            // entrypoint or a 403 from `send` might tell you if a file outside our
            // root exists). Add the trailing path separator because otherwise "/foo"
            // is a prefix of "/foo-secrets".
            const absFilepath = path.normalize(path.join(absRoot, urlPath));
            if (!absFilepath.startsWith(addTrailingPathSep(absRoot))) {
                handleError(httpErrors(403, 'Forbidden'));
                return;
            }
            // Serve the entrypoint for the root path, and for all other paths that
            // don't have a corresponding static resource on disk. As a special
            // case, paths with file extensions are always excluded because they are
            // likely to be not-found static resources rather than application
            // routes.
            const serveEntrypoint = urlPath === '/' ||
                (!hasFileExtension.test(urlPath) && !(yield fileExists(absFilepath)));
            // Find the highest ranked build suitable for this user agent.
            const clientCapabilities = capabilities.browserCapabilities(request.headers['user-agent']);
            const build = builds.find((b) => b.canServe(clientCapabilities));
            // We warned about this at startup. You should probably provide a fallback
            // build with no capabilities, at least to nicely inform the user. Note
            // that we only return this error for the entrypoint; we always serve fully
            // qualified static resources.
            if (!build && serveEntrypoint) {
                handleError(httpErrors(500, 'This browser is not supported.'));
                return;
            }
            const fileToSend = (build && serveEntrypoint) ? build.entrypoint : urlPath;
            if (isServiceWorker.test(fileToSend)) {
                // A service worker may only register with a scope above its own path if
                // permitted by this header.
                // https://www.w3.org/TR/service-workers-1/#service-worker-allowed
                response.setHeader('Service-Worker-Allowed', '/');
                // Automatically unregister service workers that no longer exist to
                // prevent clients getting stuck with old service workers indefinitely.
                if (unregisterMissingServiceWorkers && !(yield fileExists(absFilepath))) {
                    response.setHeader('Content-Type', 'application/javascript');
                    response.writeHead(200);
                    response.end(`self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.registration.unregister());`);
                    return;
                }
            }
            // Don't set the Cache-Control header if it's already set. This way another
            // middleware can control caching, and we won't touch it.
            if (!response.getHeader('Cache-Control')) {
                response.setHeader('Cache-Control', serveEntrypoint ? 'max-age=0' : cacheControl);
            }
            if (build && build.pushManifest) {
                var linkHeaders = new Array;
                if (typeof pushAssets === 'object' && pushAssets.length > 0) {
                    pushAssets.forEach(function (assetName) {
                        linkHeaders.push(...build.pushManifest.linkHeaders('/' + build.buildDir + '/' + assetName));
                    });
                }
                else {
                    linkHeaders = build.pushManifest.linkHeaders(urlPath);
                    if (urlPath !== fileToSend) {
                        // Also check the filename against the push manifest. In the case of
                        // the entrypoint, these will be different (e.g. "/my/app/route" vs
                        // "/es2015/index.html"), and we want to support configuring pushes in
                        // terms of both.
                        linkHeaders.push(...build.pushManifest.linkHeaders(fileToSend));
                    }
                }
                response.setHeader('Link', linkHeaders);
            }
            const sendOpts = {
                root: absRoot,
                // We handle the caching header ourselves.
                cacheControl: false,
            };
            send(request, fileToSend, sendOpts)
                .on('error', (err) => {
                // `send` puts a lot of detail in the error message, like the
                // absolute system path of the missing file for a 404. We don't
                // want that to leak out, so let's use a generic message instead.
                err.message = statuses[err.status] || String(err.status);
                handleError(err);
            })
                .pipe(response);
        });
    };
}
exports.makeHandler = makeHandler;
/**
 * Return a promise for the existence of a file.
 */
function fileExists(filepath) {
    return new Promise((resolve) => fs.access(filepath, (err) => resolve(!err)));
}
/**
 * Write a plain text HTTP error response.
 */
function writePlainTextError(response, error) {
    response.statusCode = error.status;
    response.setHeader('Content-Type', 'text/plain');
    response.end(error.message);
}
function addTrailingPathSep(p) {
    return p.endsWith(path.sep) ? p : p + path.sep;
}
class Build {
    constructor(configOrder, requirements, entrypoint, buildDir, serverRoot) {
        this.configOrder = configOrder;
        this.requirements = requirements;
        this.entrypoint = entrypoint;
        this.buildDir = path.relative(serverRoot, buildDir);
        // TODO Push manifest location should be configurable.
        const pushManifestPath = path.join(buildDir, 'push-manifest.json');
        const relPath = path.relative(serverRoot, pushManifestPath);
        if (fs.existsSync(pushManifestPath)) {
            console.info(`Detected push manifest "${relPath}".`);
            // Note this constructor throws if invalid.
            this.pushManifest = new push.PushManifest(JSON.parse(fs.readFileSync(pushManifestPath, 'utf8')), path.relative(serverRoot, buildDir));
        }
    }
    /**
     * Order builds with more capabililties first -- a heuristic that assumes
     * builds with more features are better. Ties are broken by the order the
     * build appeared in the original configuration file.
     */
    compare(that) {
        if (this.requirements.size !== that.requirements.size) {
            return that.requirements.size - this.requirements.size;
        }
        return this.configOrder - that.configOrder;
    }
    /**
     * Return whether all requirements of this build are met by the given client
     * browser capabilities.
     */
    canServe(client) {
        for (const r of this.requirements) {
            if (!client.has(r)) {
                return false;
            }
        }
        return true;
    }
}
function loadBuilds(root, config) {
    const builds = [];
    const entrypoint = (config ? config.entrypoint : null) || 'index.html';
    if (!config || !config.builds || !config.builds.length) {
        // No builds were specified. Try to serve an entrypoint from the root
        // directory, with no capability requirements.
        console.warn(`WARNING: No builds configured.`);
        builds.push(new Build(0, new Set(), entrypoint, root, root));
    }
    else {
        for (let i = 0; i < config.builds.length; i++) {
            const build = config.builds[i];
            if (!build.name) {
                console.warn(`WARNING: Build at offset ${i} has no name; skipping.`);
                continue;
            }
            builds.push(new Build(i, new Set(build.browserCapabilities), path.posix.join(build.name, entrypoint), path.join(root, build.name), root));
        }
    }
    // Sort builds by preference in case multiple builds could be served to
    // the same client.
    builds.sort((a, b) => a.compare(b));
    // Sanity check.
    for (const build of builds) {
        const requirements = Array.from(build.requirements.values());
        console.info(`Registered entrypoint "${build.entrypoint}" with capabilities ` +
            `[${requirements.join(',')}].`);
        // Note `build.entrypoint` is relative to the server root, but that's not
        // neccessarily our cwd.
        // TODO Refactor to make filepath vs URL path and relative vs absolute
        // values clearer.
        if (!fs.existsSync(path.join(root, build.entrypoint))) {
            console.warn(`WARNING: Entrypoint "${build.entrypoint}" does not exist.`);
        }
    }
    if (!builds.find((b) => b.requirements.size === 0)) {
        console.warn('WARNING: All builds have a capability requirement. ' +
            'Some browsers will display an error. Consider a fallback build.');
    }
    return builds;
}
//# sourceMappingURL=prpl.js.map