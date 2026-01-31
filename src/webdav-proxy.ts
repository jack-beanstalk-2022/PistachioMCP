import * as http from "http";
import * as https from "https";
import { join, resolve, normalize } from "path";
import { homedir } from "os";
import { statSync, existsSync } from "fs";
import { logger } from "./utils/Logger.js";
import { URL } from "url";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const TARGET_URL = process.env.TARGET_URL || "http://localhost:8081";
const PROJECTS_ROOT = process.env.PROJECTS_ROOT
    ? resolve(process.env.PROJECTS_ROOT.replace("~", homedir()))
    : join(homedir(), "PistachioMCPProjects");

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Allowed HTTP methods for rclone sync
const ALLOWED_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "PROPFIND", "OPTIONS", "MKCOL"]);

// Blocked file extensions (explicitly blocked)
const BLOCKED_EXTENSIONS = new Set([
    ".sh",
    ".bash",
    ".py",
    ".js",
    ".mjs",
    ".exe",
    ".bin",
    ".dll",
    ".so",
]);

/**
 * Extracts file extension from a path
 */
function getFileExtension(path: string): string {
    const lastDot = path.lastIndexOf(".");
    const lastSlash = path.lastIndexOf("/");
    if (lastDot > lastSlash && lastDot !== -1) {
        return path.substring(lastDot).toLowerCase();
    }
    return "";
}

/**
 * Validates if a file extension is allowed
 */
function isExtensionAllowed(path: string): boolean {
    const ext = getFileExtension(path);

    // Block explicitly blocked extensions
    if (BLOCKED_EXTENSIONS.has(ext)) {
        return false;
    }

    return true;
}

/**
 * Validates if a path is safe and within the projects root
 */
export function validatePath(requestPath: string): { valid: boolean; error?: string; resolvedPath?: string } {
    try {
        // Parse and normalize the path
        const url = new URL(requestPath, `http://localhost`);
        let pathname = decodeURIComponent(url.pathname);

        // Remove leading slash
        if (pathname.startsWith("/")) {
            pathname = pathname.substring(1);
        }

        // Resolve to absolute path
        const resolvedPath = resolve(PROJECTS_ROOT, pathname);
        const normalizedBase = normalize(PROJECTS_ROOT);
        const normalizedResolved = normalize(resolvedPath);

        // Ensure path is within base directory (prevent path traversal)
        if (!normalizedResolved.startsWith(normalizedBase + "/") && normalizedResolved !== normalizedBase) {
            return {
                valid: false,
                error: "Path traversal detected or path outside projects root",
            };
        }

        // Check if path contains suspicious patterns
        if (pathname.includes("..") || pathname.includes("//")) {
            return {
                valid: false,
                error: "Path contains suspicious patterns",
            };
        }

        // For PUT/DELETE operations, ensure the project directory exists
        // Extract project ID (first segment of path)
        const segments = pathname.split("/").filter((s) => s.length > 0);
        if (segments.length > 0) {
            const projectId = segments[0];
            const projectPath = join(PROJECTS_ROOT, projectId);

            if (!existsSync(projectPath)) {
                return {
                    valid: false,
                    error: `Project directory does not exist: ${projectId}`,
                };
            }

            // Ensure it's a directory
            try {
                const stats = statSync(projectPath);
                if (!stats.isDirectory()) {
                    return {
                        valid: false,
                        error: `Project path is not a directory: ${projectId}`,
                    };
                }
            } catch (error) {
                return {
                    valid: false,
                    error: `Cannot access project directory: ${projectId} - ${error instanceof Error ? error.message : String(error)}`,
                };
            }
        }

        return {
            valid: true,
            resolvedPath: normalizedResolved,
        };
    } catch (error) {
        return {
            valid: false,
            error: `Path validation error: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Validates the request before proxying
 */
function validateRequest(req: http.IncomingMessage): { valid: boolean; statusCode?: number; error?: string } {
    // Check User-Agent
    const userAgent = req.headers["user-agent"] || "";
    if (!userAgent.toLowerCase().includes("rclone")) {
        return {
            valid: false,
            statusCode: 403,
            error: "Request must come from rclone client",
        };
    }

    // Check HTTP method
    if (!ALLOWED_METHODS.has(req.method || "")) {
        return {
            valid: false,
            statusCode: 405,
            error: `Method ${req.method} not allowed. Only sync-compatible methods are permitted.`,
        };
    }

    // Validate path
    const pathValidation = validatePath(req.url || "/");
    if (!pathValidation.valid) {
        return {
            valid: false,
            statusCode: 403,
            error: pathValidation.error || "Invalid path",
        };
    }

    // Check file extension for PUT requests (file uploads)
    if (req.method === "PUT" && req.url) {
        if (!isExtensionAllowed(req.url)) {
            return {
                valid: false,
                statusCode: 403,
                error: `File type not allowed. Only source code and asset files are permitted.`,
            };
        }
    }

    // Check Content-Length for size limits
    const contentLength = req.headers["content-length"];
    if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > MAX_FILE_SIZE) {
            return {
                valid: false,
                statusCode: 413,
                error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
            };
        }
    }

    return { valid: true };
}

/**
 * Proxies the request to the target WebDAV server
 */
function proxyRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    targetUrl: string
): void {
    const target = new URL(targetUrl);
    const targetPath = req.url || "/";

    const options: http.RequestOptions = {
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: targetPath,
        method: req.method,
        headers: {
            ...req.headers,
            host: target.host,
        },
    };

    const client = target.protocol === "https:" ? https : http;

    const proxyReq = client.request(options, (proxyRes) => {
        // Copy response headers
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

        // Pipe response
        proxyRes.pipe(res, { end: true });
    });

    proxyReq.on("error", (error) => {
        logger.error(
            {
                error_message: error.message,
                target_url: targetUrl,
                path: targetPath,
            },
            "Proxy request error"
        );

        if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Bad Gateway" }));
        }
    });

    // Pipe request body
    req.pipe(proxyReq, { end: true });
}

/**
 * Main request handler
 */
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Validate request
    const validation = validateRequest(req);

    if (!validation.valid) {
        const statusCode = validation.statusCode || 403;
        logger.warn(
            {
                method: req.method,
                url: req.url,
                user_agent: req.headers["user-agent"],
                status_code: statusCode,
                error: validation.error,
                remote_address: req.socket.remoteAddress,
            },
            "Request rejected by security proxy"
        );

        res.writeHead(statusCode, { "Content-Type": "application/json" });
        // obfuscate the error message
        res.end(JSON.stringify({ error: "Forbidden" }));
        return;
    }

    // Proxy the request
    proxyRequest(req, res, TARGET_URL);
}

/**
 * Main server function
 */
function main(): void {
    const server = http.createServer(handleRequest);

    server.listen(PORT, "0.0.0.0", () => {
        logger.info(
            {
                port: PORT,
                target_url: TARGET_URL,
                projects_root: PROJECTS_ROOT,
                max_file_size_mb: MAX_FILE_SIZE / 1024 / 1024,
            },
            "WebDAV security proxy started"
        );
    });

    server.on("error", (error) => {
        logger.error(
            {
                error_message: error.message,
                port: PORT,
            },
            "Server error"
        );
        process.exit(1);
    });
}

// Start the server
main();
