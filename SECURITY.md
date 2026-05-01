# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.14.x  | :white_check_mark: |
| < 2.14  | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public issue.

Instead, report it privately via GitHub's [Security Advisories](https://github.com/ZeR020/opencode-mem0/security/advisories/new) or email the maintainer directly.

We aim to respond to security reports within 48 hours and will work with you to understand and resolve the issue.

## Security Best Practices for Users

- Keep your dependencies up to date (`bun update` or `npm update`)
- Use strong API keys for AI providers and store them securely
- The plugin stores data locally in SQLite; ensure your filesystem permissions are appropriate
- Review the `privacy` configuration to control what data is captured

## Dependency Security

This project uses `bun audit` / `npm audit` to monitor for known vulnerabilities. Overrides are configured in `package.json` to patch transitive dependency vulnerabilities when upstream fixes are not yet available.
