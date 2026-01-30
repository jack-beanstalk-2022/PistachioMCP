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
            args: "-c \"rclone serve webdav ~/PistachioMCPProjects --addr :8080\"",
            instances: 1,
            exec_mode: "fork",
            // Log configuration
            error_file: "logs/rclone-error.log",
            out_file: "logs/rclone-combined.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            merge_logs: false,
        },
    ],
};
