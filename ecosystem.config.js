module.exports = {
  apps: [
    {
      name: 'priv-bot',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1, // the Discord gateway connection must be a single process
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '30s', // a run shorter than this counts as a failed restart
      restart_delay: 5000,
      max_memory_restart: '800M',
      kill_timeout: 15000, // give graceful shutdown time to finish
      listen_timeout: 30000,
      shutdown_with_message: true, // required for graceful shutdown on Windows
      time: true,
      merge_logs: true,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
