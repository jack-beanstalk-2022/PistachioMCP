module.exports = {
    apps: [
        {
            name: "pistachio-mcp",
            script: "dist/index.js",
            instances: 1,
            exec_mode: "fork",
            env: {
                NODE_ENV: "production",
                PORT: process.env.PORT || 3001,
                NUM_WORKERS: process.env.NUM_WORKERS || 2,
                LOG_LEVEL: process.env.LOG_LEVEL || "info",
            },
            // Log configuration
            error_file: "logs/mcp-error.log",
            out_file: "logs/mcp-combined.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            merge_logs: false,
            // Log rotation configuration
            log_type: "json",
        },
        {
            name: "rclone-webdav",
            script: "sh",
            args: "-c \"rclone serve webdav ~/PistachioMCPProjects --addr :8081\"",
            instances: 1,
            exec_mode: "fork",
            // Log configuration
            error_file: "logs/rclone-error.log",
            out_file: "logs/rclone-combined.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            merge_logs: false,
        },
        {
            name: "webdav-proxy",
            script: "dist/webdav-proxy.js",
            instances: 1,
            exec_mode: "fork",
            env: {
                NODE_ENV: "production",
                PORT: process.env.WEBDAV_PROXY_PORT || 8080,
                TARGET_URL: process.env.WEBDAV_TARGET_URL || "http://localhost:8081",
                PROJECTS_ROOT: process.env.PROJECTS_ROOT || "~/PistachioMCPProjects",
                LOG_LEVEL: process.env.LOG_LEVEL || "info",
            },
            // Log configuration
            error_file: "logs/webdav-proxy-error.log",
            out_file: "logs/webdav-proxy-combined.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            merge_logs: false,
            log_type: "json",
        },
    ],
};
