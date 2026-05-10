# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in opencode-mem0, please report it responsibly.

**Please do NOT open a public issue for security vulnerabilities.**

Instead, contact the maintainers directly:

- GitHub: [@ZeR020](https://github.com/ZeR020) (via private security advisory)
- Or open a [private security advisory](https://github.com/ZeR020/opencode-mem0/security/advisories/new) on this repository

We aim to respond within 48 hours and will work with you to assess and address the issue promptly.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| 1.x     | :x:                |

## Security Design

opencode-mem0 is designed with the following security principles:

- **Local-first**: All data (memories, transcripts, vector indices) is stored in local SQLite databases — no data leaves your machine unless explicitly configured.
- **No hardcoded secrets**: API keys and tokens are resolved via environment variables or secret files (with file permission validation).
- **Parameterized SQL**: All database queries use prepared statements to prevent injection.
- **Sanitized web UI**: The built-in web UI uses DOMPurify and textContent-based escaping to prevent XSS.
- **No wildcard CORS**: The web server binds to `127.0.0.1` by default with no CORS headers.
- **Sanitized errors**: API errors return generic "Internal error" messages; actual details are logged server-side only.

## Dependencies

This project undergoes periodic security audits. Known transitive vulnerabilities are patched via `overrides` in `package.json`.

Run `bun audit` or `npm audit` to check the current state.

## Disclosure Policy

We follow a coordinated disclosure policy:

1. Reporter submits vulnerability privately
2. Maintainers acknowledge receipt within 48 hours
3. We investigate and develop a fix
4. Fix is released and reporter is credited (if desired)
5. Public disclosure after users have had reasonable time to update
