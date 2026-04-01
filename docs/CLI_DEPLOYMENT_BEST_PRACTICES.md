# CLI Deployment Best Practices

> A checklist and reference guide for deploying **Pool Agent** (or any Node.js/TypeScript CLI) the right way.

---

## 1. Package Metadata

| Field | Why it matters |
|-------|---------------|
| `name` | Must be unique on npm; use a scope (`@org/name`) to avoid collisions |
| `version` | Follow [SemVer](https://semver.org/) — `MAJOR.MINOR.PATCH` |
| `description` | Short, searchable summary shown on npm |
| `keywords` | Helps discoverability on npm search |
| `license` | Legal clarity for users |
| `repository` | Links npm page back to source code |
| `engines` | Declares minimum Node.js version so users get early warnings |

## 2. The `bin` Field

```json
"bin": {
  "pool-agent": "./dist/cli.js"
}
```

- Points to the **compiled** JS entry point, not the TypeScript source.
- The entry file **must** start with a shebang: `#!/usr/bin/env node`
- After `npm install -g`, the command becomes available system-wide.
- For local installs, it's accessible via `npx pool-agent`.

## 3. Build Pipeline

- **Always ship compiled JavaScript**, never raw `.ts` files.
- Use `tsc` (or a bundler) to compile `src/` → `dist/`.
- Add a `build` script: `"build": "tsc"`
- Add a `prepare` script: `"prepare": "npm run build"` — this runs automatically on `npm install` and before `npm publish`.
- Add a `prepublishOnly` script for linting/testing gates.

## 4. Files & Ignoring

### `files` field in package.json
Controls what gets **included** in the npm tarball:
```json
"files": ["dist", "README.md", "INSTRUCTIONS.md", ".env.example"]
```
Everything else is excluded. This is the allowlist approach (preferred over `.npmignore`).

### `.npmignore`
Blocklist approach — use as a safety net:
```
src/
*.ts
!dist/**
tsconfig.json
.env
data/
node_modules/
pool-ss/
*.md
!README.md
!INSTRUCTIONS.md
```

### `.gitignore`
Keep build artifacts and secrets out of version control:
```
node_modules/
dist/
.env
data/
*.tsbuildinfo
```

## 5. Entry Point & Shebang

```typescript
#!/usr/bin/env node
// cli.ts — this line is REQUIRED for the binary to work on Unix/macOS
```

- The shebang tells the OS to run the file with Node.js.
- Must be the **very first line** — no blank lines above it.
- Works on macOS, Linux, and WSL. Windows npm handles it via a `.cmd` wrapper.

## 6. CLI Arguments & Help

Every CLI should support at minimum:
- `--help` / `-h` — print usage instructions and exit
- `--version` / `-v` — print the version number and exit

These must work **before** any interactive prompts or heavy initialization.

```
$ pool-agent --help
$ pool-agent --version
```

## 7. Environment & Configuration

- Ship a `.env.example` with placeholder values — never commit real `.env`.
- Validate required env vars at startup with clear error messages.
- Use `dotenv` to load `.env` files.
- Support both env vars and CLI flags where possible.

## 8. Error Handling

- Catch top-level errors with `.catch()` on the main promise.
- Exit with code `1` on errors, `0` on success.
- Print human-readable error messages (not raw stack traces) in production.
- Handle `SIGINT` (Ctrl+C) gracefully — clean up resources, close DB connections.

## 9. Cross-Platform Compatibility

- Use `path.join()` / `path.resolve()` instead of hardcoded `/` separators.
- Use `fileURLToPath(import.meta.url)` for `__dirname` in ESM modules.
- Avoid shell-specific syntax in npm scripts.
- Test on macOS, Linux, and Windows (or at least WSL).

## 10. Dependencies

- Keep production dependencies minimal — every dep is an install-time cost.
- Put build tools (`typescript`, `tsx`, `@types/*`) in `devDependencies`.
- Lock versions with `package-lock.json` (committed to git).
- Audit regularly: `npm audit`.

## 11. Testing Before Publish

```bash
# 1. Build
npm run build

# 2. Test the binary locally
node dist/cli.js --help
node dist/cli.js --version

# 3. Dry-run publish to see what would be included
npm pack --dry-run

# 4. Test global install locally
npm install -g .
pool-agent --help
```

## 12. Publishing Checklist

- [ ] Version bumped in `package.json`
- [ ] `npm run build` succeeds with no errors
- [ ] `--help` and `--version` work on compiled output
- [ ] `.env.example` is up to date
- [ ] `npm pack --dry-run` includes only intended files
- [ ] README / INSTRUCTIONS are current
- [ ] No secrets in the tarball
- [ ] `npm publish` (or `npm publish --access public` for scoped packages)

## 13. Post-Install Experience

A great CLI gives the user a clear path from install to first use:

```
npm install -g pool-agent
pool-agent --help        # See all options
cp .env.example .env     # Configure API keys
pool-agent               # Launch interactive mode
```

## 14. Graceful Degradation

- If optional features (e.g., web search) lack API keys, disable them gracefully instead of crashing.
- Show which features are available vs. disabled on startup.
- Provide actionable setup instructions when a feature is missing config.

---

*This guide was written for the Pool Agent CLI project. Adapt as needed for other Node.js CLI tools.*
