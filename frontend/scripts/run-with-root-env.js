const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const command = process.argv[2];
const allowedCommands = new Set(['start', 'build', 'test']);
if (!allowedCommands.has(command)) {
  throw new Error(`Unsupported react-scripts command: ${command || '(missing)'}`);
}

// CRA normally reads .env files beside package.json. Keep the project's
// environment files at the repository root and pass only browser-safe keys on.
const envDirectory = process.env.APP_ENV_DIR || path.resolve(__dirname, '../..');
const fileSet = command === 'build' ? '.env.production' : '.env.development';
const readEnvFile = (filename) => {
  const filePath = path.join(envDirectory, filename);
  return fs.existsSync(filePath) ? dotenv.parse(fs.readFileSync(filePath)) : {};
};
const fileValues = { ...readEnvFile('.env'), ...readEnvFile(fileSet) };

for (const [key, value] of Object.entries(fileValues)) {
  if (key.startsWith('REACT_APP_') && process.env[key] === undefined) {
    process.env[key] = value;
  }
}

// Keep Cognito's public configuration in one set of variables. Map it to CRA's
// required REACT_APP_* names only at frontend startup/build time.
const frontendAliases = {
  REACT_APP_COGNITO_DOMAIN: 'COGNITO_DOMAIN',
  REACT_APP_COGNITO_CLIENT_ID: 'COGNITO_CLIENT_ID',
  REACT_APP_COGNITO_REDIRECT_URI: 'COGNITO_REDIRECT_URI',
};
for (const [frontendKey, sharedKey] of Object.entries(frontendAliases)) {
  if (process.env[frontendKey] === undefined && process.env[sharedKey] !== undefined) {
    process.env[frontendKey] = process.env[sharedKey];
  }
  if (process.env[frontendKey] === undefined && fileValues[sharedKey] !== undefined) {
    process.env[frontendKey] = fileValues[sharedKey];
  }
}

const reactScripts = require.resolve(`react-scripts/scripts/${command}`);
const child = spawn(process.execPath, [reactScripts, ...process.argv.slice(3)], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
