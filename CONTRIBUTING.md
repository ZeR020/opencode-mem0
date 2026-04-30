# Contributing to opencode-mem0

Thank you for your interest in contributing! This document outlines the process for contributing to this project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/opencode-mem0.git`
3. Install dependencies: `bun install`
4. Create a branch: `git checkout -b feature/your-feature-name`

## Development Workflow

- **TypeScript**: All code must pass `bun run typecheck`
- **Tests**: Run `bun test` before submitting
- **Formatting**: Run `bun run format` or ensure lint-staged runs on commit
- **Build**: Verify `bun run build` succeeds

## Pull Request Process

1. Ensure your branch is up to date with `main`
2. Include a clear description of the changes
3. Reference any related issues
4. Wait for CI checks to pass
5. Request review from maintainers

## Code Style

- Use TypeScript strict mode
- Prefer explicit types over `any`
- Write JSDoc for public functions
- Keep functions focused and testable

## Reporting Issues

When reporting bugs, please include:

- Node.js/Bun version
- Steps to reproduce
- Expected vs actual behavior
- Any error messages or logs

## Security Issues

Please do not open public issues for security vulnerabilities. Instead, email security concerns directly to the maintainer or use GitHub's private vulnerability reporting.
